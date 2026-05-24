require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const multer = require('multer');
const NodeCache = require('node-cache');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const Sentry = require('@sentry/node');
const crypto = require('crypto');
const cron = require('node-cron');

// === ORACLE DB IMPORTS (replaces Mongoose) ===
const { getPool, execute } = require('./database/connection');
const OracleSessionStore = require('./database/session-store');

// === ORACLE MODELS (replaces Mongoose models) ===
const User = require('./database/models/user');
const Test = require('./database/models/test');
const Submission = require('./database/models/submission');
const Group = require('./database/models/group');
const Feedback = require('./database/models/feedback');
const Notification = require('./database/models/notification');

// === BACKUP SYSTEM ===
const { backupDatabase } = require('./backup-database-oracle');

// === UTILS ===
const logger = require('./utils/logger');
const CONSTANTS = require('./utils/constants');
const { generateHTMLFromTest } = require('./utils/htmlExporter');
const { analyzeWriting, analyzePatterns, detectPatterns } = require('./utils/aiAnalysis');
const { validateEnv } = require('./utils/config');
const { getAuthoringPageHtml } = require('./utils/builderAuthoring');

// Validate environment
validateEnv();

const app = express();

// Sentry
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0.1
    });
    app.use(Sentry.Handlers.requestHandler());
}

// Cache
const cache = new NodeCache({
    stdTTL: 300,
    checkperiod: 60,
    maxKeys: 1000
});

// B2 / S3 Storage
const b2Config = {
    endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
    region: process.env.B2_REGION || 'us-east-005',
    bucket: process.env.B2_BUCKET || 'test-platform-uploads'
};

logger.debug('B2 Configuration', {
    endpoint: b2Config.endpoint,
    region: b2Config.region,
    bucket: b2Config.bucket
});

const s3 = new S3Client({
    endpoint: b2Config.endpoint,
    region: b2Config.region,
    credentials: {
        accessKeyId: process.env.B2_APPLICATION_KEY_ID,
        secretAccessKey: process.env.B2_APPLICATION_KEY
    },
    forcePathStyle: true
});

async function uploadToB2(buffer, filename, mimetype) {
    await s3.send(new PutObjectCommand({
        Bucket: b2Config.bucket,
        Key: filename,
        Body: buffer,
        ContentType: mimetype
    }));
    return `${b2Config.endpoint}/${b2Config.bucket}/${filename}`;
}

function extractB2Filename(value) {
    if (!value) return null;
    if (typeof value === 'string' && value.includes(b2Config.bucket + '/')) {
        return value.split(b2Config.bucket + '/')[1];
    }
    if (typeof value === 'string' && value.includes('amazonaws.com/')) {
        return value.split('amazonaws.com/')[1]?.split('/').slice(1).join('/') || null;
    }
    return value;
}

// Helmet
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
    permissionsPolicy: {
        features: {
            camera: ["'self'"],
            microphone: ["'self'"],
            fullscreen: ["'self'"]
        }
    }
}));

// === DATABASE READINESS ===
let poolReady = false;

function isDatabaseReady() {
    return poolReady;
}

function sendDatabaseUnavailable(res) {
    res.status(503).render('error', {
        message: 'Database connection is not available. Please try again in a few moments.',
        error: { status: 503 }
    });
}

async function connectDatabase() {
    try {
        const pool = await getPool();
        // Test the pool
        const conn = await pool.getConnection();
        await conn.execute('SELECT 1 FROM dual');
        await conn.close();
        poolReady = true;
        logger.info('Oracle database connected successfully');
    } catch (err) {
        logger.error('Oracle database connection failed', { error: err.message });
        poolReady = false;
        // Retry after 5 seconds
        setTimeout(connectDatabase, 5000);
    }
}

// === MULTER ===
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50 MB
    },
    fileFilter(req, file, cb) {
        const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
            'audio/webm', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        // Always allow for our use cases
        cb(null, true);
    }
});

// === SESSION ===
const sessionConfig = {
    store: new OracleSessionStore(),
    secret: process.env.SESSION_SECRET || 'test-platform-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Must be false on HTTP; set true only if behind HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    }
};

// Trust the nginx reverse proxy (port 80 → 3000)
app.set('trust proxy', 1);

app.use(session(sessionConfig));

// Cookie parser required for CSRF cookies
app.use(cookieParser());

// === RATE LIMITERS ===
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please try again later.' }
});

const strictLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many requests. Please slow down.' }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many API requests.' }
});

const testCreationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many test creation attempts.' }
});

// === CSRF PROTECTION ===
// Cookie-based CSRF. The _csrf cookie is set the first time any route with
// csrfProtection middleware renders. All GET routes that serve pages with forms
// should include csrfProtection so the cookie is always available.
const csrfProtection = csrf({ cookie: true });

// === AUTH MIDDLEWARE ===
function isAdmin(req, res, next) {
    if (req.session.userRole !== CONSTANTS.ROLES.ADMIN) {
        return res.status(403).send('Access denied. Admin only.');
    }
    next();
}

function isTeacher(req, res, next) {
    if (req.session.userRole !== CONSTANTS.ROLES.TEACHER && req.session.userRole !== CONSTANTS.ROLES.ADMIN) {
        return res.status(403).send('Access denied. Teacher only.');
    }
    next();
}

async function canEditTest(req, testId) {
    if (!testId) return false;
    if (req.session.userRole === CONSTANTS.ROLES.ADMIN) return true;
    try {
        const test = await Test.findById(testId);
        return test && String(test.createdBy) === String(req.session.userId);
    } catch { return false; }
}

// === HELPER FUNCTIONS ===

// Validate ID (replaces mongoose.Types.ObjectId.isValid)
function validateObjectId(id) {
    if (id === null || id === undefined || id === '') {
        return { valid: false };
    }
    // Oracle IDs are numbers; also support string-form numbers
    const num = Number(id);
    if (Number.isNaN(num) || num <= 0 || !Number.isInteger(num)) {
        return { valid: false };
    }
    return { valid: true };
}

function groupTestsByType(tests = []) {
    const grouped = {
        reading: [],
        listening: [],
        writing: [],
        scheduled: []
    };
    tests.forEach(test => {
        const type = (test.type || '').toLowerCase();
        if (grouped[type]) grouped[type].push(test);
        else if (type === 'scheduled') grouped.scheduled.push(test);
    });
    return grouped;
}

function roundPercentage(score, totalQuestions) {
    if (!totalQuestions || totalQuestions === 0) return 0;
    return Math.round((Number(score) / Number(totalQuestions)) * 100);
}

// Fetch test + check access
async function getAccessibleTest(req, testId) {
    const test = await Test.findById(testId);
    if (!test) return { test: null, isAllowed: false };

    const userId = req.session.userId;
    const userRole = req.session.userRole;

    // Admin / creator always allowed
    if (userRole === CONSTANTS.ROLES.ADMIN ||
        String(test.createdBy) === String(userId)) {
        return { test, isAllowed: true };
    }

    // Check individual assignment
    const user = await User.findById(userId);
    if (user && user.assignedTests && Array.isArray(user.assignedTests)) {
        const hasIndividual = user.assignedTests.some(id => String(id) === String(testId));
        if (hasIndividual) return { test, isAllowed: true };
    }

    // Check group assignment
    if (user && user.groupId) {
        const hasGroupAssignment = await Group.exists({
            _id: user.groupId,
            assignedTests: { $in: [testId] }
        });
        if (hasGroupAssignment) return { test, isAllowed: true };
    }

    return { test, isAllowed: false };
}

// === SAVE STUDENT SUBMISSION ===
async function saveStudentSubmission({ req, payload }) {
    let isRetry = false;
    let attemptCount = 1;
    let submission;

    const existing = await Submission.findOne({
        testId: payload.testId,
        studentId: req.session.userId
    });

    if (existing) {
        isRetry = true;
        attemptCount = (existing.attemptCount || 0) + 1;
        // Merge details
        if (existing.details && payload.details) {
            payload.details = { ...existing.details, ...payload.details };
        }
        // Update
        submission = await Submission.findOneAndUpdate(
            { testId: payload.testId, studentId: req.session.userId },
            {
                $set: {
                    studentName: payload.studentName,
                    attemptCount,
                    score: payload.score,
                    totalQuestions: payload.totalQuestions,
                    percentage: payload.percentage,
                    band: payload.band,
                    wordCount1: payload.wordCount1,
                    wordCount2: payload.wordCount2,
                    timeRemainingText: payload.timeRemainingText,
                    lastSubmittedAt: new Date(),
                    details: payload.details,
                    type: payload.type
                }
            }
        );
    } else {
        // Create new submission
        const submissionPayload = {
            testId: payload.testId,
            studentId: req.session.userId,
            teacherId: payload.teacherId || null,
            groupId: payload.groupId || null,
            type: payload.type,
            studentName: payload.studentName,
            status: payload.status || 'completed',
            attemptCount,
            score: payload.score,
            totalQuestions: payload.totalQuestions,
            percentage: payload.percentage,
            band: payload.band,
            wordCount1: payload.wordCount1,
            wordCount2: payload.wordCount2,
            timeRemainingText: payload.timeRemainingText || '',
            details: payload.details
        };
        submission = await Submission.create(submissionPayload);
    }

    // Notifications for writing feedback
    if (payload.type === 'writing' && payload.details && payload.details.tasks) {
        const user = await User.findById(req.session.userId);
        const userName = user ? user.username : 'A student';

        await Notification.create({
            userId: user && user.teacherId ? user.teacherId : null,
            type: 'submission_writing',
            title: 'New Writing Submission',
            message: `${userName} submitted a writing test for review`,
            relatedId: submission._id,
            isRead: 0
        });

        // Check if all students in group have submitted
        if (user && user.groupId) {
            const group = await Group.findById(user.groupId);
            if (group && group.students) {
                const completedCount = await Submission.countDocuments({
                    testId: payload.testId,
                    groupId: user.groupId,
                    status: 'completed'
                });
                if (completedCount >= group.students.length) {
                    await Notification.create({
                        userId: user.teacherId,
                        type: 'all_submitted',
                        title: 'All Submissions Complete',
                        message: `All students in the group have submitted the writing test`,
                        relatedId: payload.testId,
                        isRead: 0
                    });
                }
            }
        }
    }

    return submission;
}

// === SAVE VALIDATED TEST ===
async function saveValidatedTest({ title, type, content, builderJson, req }) {
    logger.debug('Saving validated test', {
        type,
        title,
        hasContent: !!content,
        userId: req.session.userId
    });

    // Generate HTML from test
    let htmlContent = '';
    if (content) {
        try {
            htmlContent = await generateHTMLFromTest({
                title,
                type,
                content,
                teacherName: req.session.username || 'Teacher'
            });
        } catch (e) {
            logger.warn('HTML generation failed, continuing without preview', { error: e.message });
        }
    }

    // Store content in readingPassage:
    // - reading tests: the HTML passage is in content.readingPassage
    // - listening/writing tests: store the entire content object as JSON so
    //   generateHTMLFromTest() can parse it back on download/preview/edit
    let readingPassageValue = '';
    if (content && content.readingPassage) {
        readingPassageValue = content.readingPassage;
    } else if (content && (type === 'listening' || type === 'writing')) {
        readingPassageValue = typeof content === 'string' ? content : JSON.stringify(content);
    }

    const newTest = await Test.create({
        title,
        type,
        teacherName: req.session.username || 'Teacher',
        createdBy: req.session.userId,
        readingPassage: readingPassageValue,
        builderJson: builderJson || '',
        customTitle: content && content.customTitle ? content.customTitle : '',
        folder: content && content.folder ? content.folder : '',
        questions: content && content.questions ? content.questions : []
    });

    return newTest;
}

// === GENERIC DELETE HANDLER ===
async function handleDelete(req, res, options) {
    try {
        const { model, modelName, idField, ownerCheck, cascades } = options;
        const id = req.params[idField || 'id'];

        const idValidation = validateObjectId(id);
        if (!idValidation.valid) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).json({
                success: false,
                message: `Invalid ${modelName} ID format`
            });
        }

        const doc = await model.findById(id);
        if (!doc) {
            return res.status(CONSTANTS.STATUS.NOT_FOUND).json({
                success: false,
                message: `${modelName} not found`
            });
        }

        // Owner check
        if (ownerCheck) {
            const allowed = await ownerCheck(req, doc);
            if (!allowed) {
                logger.warn(`Unauthorized delete attempt for ${modelName}`, {
                    userId: req.session.userId,
                    itemId: id
                });
                return res.status(CONSTANTS.STATUS.FORBIDDEN).json({
                    success: false,
                    message: `You are not authorized to delete this ${modelName.toLowerCase()}`
                });
            }
        }

        // Run cascades
        if (cascades) {
            for (const cascade of cascades) {
                await cascade(doc);
            }
        }

        // Delete the document
        if (model.findByIdAndDelete) {
            await model.findByIdAndDelete(id);
        }

        logger.info(`${modelName} deleted successfully`, {
            userId: req.session.userId,
            itemId: id
        });

        res.json({
            success: true,
            message: `${modelName} deleted successfully`,
            redirect: req.body.redirect || '/teacher-dashboard'
        });
    } catch (err) {
        logger.error(`Error deleting ${options.modelName}`, {
            error: err.message,
            stack: err.stack
        });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: `Error deleting ${options.modelName.toLowerCase()}: ${err.message}`
        });
    }
}

// ====================================================
// EXPRESS MIDDLEWARE
// ====================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session debug
app.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.currentPath = req.path;
    res.locals.CONSTANTS = CONSTANTS;
    next();
});

// === AUDIO PROXY ===
app.get('/audio-proxy', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).send('Missing URL parameter');

        logger.debug('Audio proxy request', { url: url.substring(0, 80) });

        const key = extractB2Filename(url);
        if (!key) return res.status(400).send('Invalid audio URL');

        const command = new GetObjectCommand({
            Bucket: b2Config.bucket,
            Key: key
        });
        const object = await s3.send(command);

        res.setHeader('Content-Type', object.ContentType || 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        if (object.ContentLength) {
            res.setHeader('Content-Length', object.ContentLength);
        }

        object.Body.pipe(res);
    } catch (err) {
        logger.error('Audio proxy error', { error: err.message });
        res.status(500).send('Error streaming audio');
    }
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        database: isDatabaseReady() ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Public data stats (for verifying migration)
app.get('/api/stats', async (req, res) => {
    try {
        const [users, tests, groups, submissions, feedback, notifications, mappings] = await Promise.all([
            User.countDocuments(),
            Test.countDocuments(),
            Group.countDocuments(),
            Submission.countDocuments(),
            Feedback.countDocuments(),
            Notification.countDocuments(),
            execute('SELECT COUNT(*) AS cnt FROM id_mapping')
        ]);
        res.json({
            users, tests, groups, submissions, feedback, notifications,
            idMappings: mappings.rows[0].CNT,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === AUTH ROUTES ===
app.get('/login', csrfProtection, (req, res) => {
    if (req.session.userId) {
        const role = req.session.userRole;
        if (role === 'admin') return res.redirect('/admin');
        if (role === 'teacher') return res.redirect('/teacher-dashboard');
        if (role === 'student') return res.redirect('/student-dashboard');
    }
    res.render('login', { error: null, csrfToken: req.csrfToken() });
});

app.post('/login', loginLimiter, csrfProtection, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.render('login', { error: 'Username and password are required', csrfToken: req.csrfToken() });
        }
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const user = await User.findOne({ username });
        if (!user) {
            return res.render('login', { error: 'Invalid username or password', csrfToken: req.csrfToken() });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.render('login', { error: 'Invalid username or password', csrfToken: req.csrfToken() });
        }

        req.session.userId = user._id;
        req.session.username = user.username;
        req.session.userRole = user.role;

        req.session.save((err) => {
            if (err) {
                logger.error('Session save error', { error: err.message, stack: err.stack });
                return res.render('login', { error: 'Login error. Please try again.', csrfToken: req.csrfToken() });
            }

            logger.info('User logged in', { userId: user._id, username: user.username, role: user.role });

            if (user.role === CONSTANTS.ROLES.ADMIN) return res.redirect('/admin');
            if (user.role === CONSTANTS.ROLES.TEACHER) return res.redirect('/teacher-dashboard');
            return res.redirect('/student-dashboard');
        });
    } catch (err) {
        logger.error('Login error', { error: err.message });
        res.render('login', { error: 'An error occurred during login', csrfToken: req.csrfToken() });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// === ADMIN ROUTES ===
app.get('/admin', isAdmin, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const [users, tests, groups, teacherCount, studentCount, testCount] = await Promise.all([
            User.find({}),
            Test.find({}),
            Group.find({}),
            User.countDocuments({ role: 'teacher' }),
            User.countDocuments({ role: 'student' }),
            Test.countDocuments({})
        ]);

        const teachers = users.filter(u => u.role === 'teacher');
        const students = users.filter(u => u.role === 'student');

        // Bulk-load assignedTests for all teachers (from junction table)
        if (teachers.length > 0) {
            const tPlaceholders = teachers.map((_, i) => `:tid${i}`).join(',');
            const tBinds = {};
            teachers.forEach((t, i) => { tBinds[`tid${i}`] = t._id; });
            const assignedRes = await execute(
                `SELECT user_id AS "userId", test_id AS "testId" FROM user_assigned_tests WHERE user_id IN (${tPlaceholders})`,
                tBinds
            );
            const assignedByTeacher = {};
            assignedRes.rows.forEach(r => {
                const uid = String(r.userId);
                if (!assignedByTeacher[uid]) assignedByTeacher[uid] = [];
                assignedByTeacher[uid].push(r.testId);
            });
            teachers.forEach(t => {
                t.assignedTests = assignedByTeacher[String(t._id)] || [];
            });
        } else {
            teachers.forEach(t => { t.assignedTests = []; });
        }

        res.render('admin', {
            users,
            teachers,
            students,
            tests,
            groups,
            testsByType: groupTestsByType(tests),
            csrfToken: req.csrfToken(),
            stats: {
                teacherCount,
                studentCount,
                testCount,
                groupCount: groups.length
            }
        });
    } catch (err) {
        logger.error('Admin dashboard error', { error: err.message });
        res.status(500).send('Error loading admin dashboard');
    }
});

// === MIGRATION TRIGGER (Secret Key protected — runs restore-from-mongo.js on Render) ===
// Usage: curl -X POST https://ielts-platform-63xw.onrender.com/admin/run-migration \
//        -H "Content-Type: application/json" \
//        -d '{"secretKey": "MIGRATE_2026_SECURE", "fullReset": true}'
app.post('/admin/run-migration', async (req, res) => {
    const MIGRATION_SECRET = process.env.MIGRATION_SECRET || 'MIGRATE_2026_SECURE';
    const { secretKey, fullReset } = req.body || {};
    
    if (secretKey !== MIGRATION_SECRET) {
        return res.status(403).json({ success: false, error: 'Invalid secret key' });
    }
    
    const requester = (req.session && req.session.userId) ? req.session.userId : 'api-call';
    
    try {
        const args = fullReset ? '--full-reset' : '';
        const cmd = `node ${path.join(__dirname, 'restore-from-mongo.js')} ${args} 2>&1`;
        
        logger.info('Migration triggered via API', { requester, fullReset: !!fullReset });
        
        // Respond immediately, run migration async in background
        res.json({ success: true, message: 'Migration started. Check Render logs for progress.' });
        
        const { exec } = require('child_process');
        exec(cmd, { cwd: __dirname, timeout: 600000 }, (error, stdout, stderr) => {
            if (error) {
                logger.error('Migration script failed', { error: error.message, stdout: stdout.slice(-1000), stderr: stderr.slice(-1000) });
            } else {
                logger.info('Migration script completed successfully', { output: stdout.slice(-500) });
            }
        });
    } catch (err) {
        logger.error('Failed to start migration', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// Add teacher page
app.get('/admin/add-teacher', isAdmin, csrfProtection, (req, res) => {
    res.render('add-teacher', { csrfToken: req.csrfToken() });
});

// Add teacher
app.post('/admin/add-teacher', isAdmin, csrfProtection, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }

        const exists = await User.findOne({ username });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            username,
            password: hashedPassword,
            role: 'teacher'
        });

        logger.info('Teacher created by admin', { userId: req.session.userId, newTeacherId: user._id });
        res.json({ success: true, user });
    } catch (err) {
        logger.error('Add teacher error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

// Add student
app.post('/admin/add-student', isAdmin, csrfProtection, async (req, res) => {
    try {
        const { username, password, teacherId } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }

        const exists = await User.findOne({ username });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            username,
            password: hashedPassword,
            role: 'student',
            teacherId: teacherId || null
        });

        logger.info('Student created by admin', { userId: req.session.userId, newStudentId: user._id });
        res.json({ success: true, user });
    } catch (err) {
        logger.error('Add student error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

// Assign test to teacher
app.post('/admin/assign-test', isAdmin, csrfProtection, async (req, res) => {
    try {
        const teacherId = Number(req.body.teacherId);
        const testId = Number(req.body.testId);
        
        if (!teacherId || !testId) {
            return res.status(400).send('Teacher ID and Test ID required. <a href="/admin">Back</a>');
        }

        const [teacher, test] = await Promise.all([
            User.findById(teacherId),
            Test.findById(testId)
        ]);

        if (!teacher || teacher.role !== 'teacher') {
            return res.status(404).send('Teacher not found. <a href="/admin">Back</a>');
        }
        if (!test) {
            return res.status(404).send('Test not found. <a href="/admin">Back</a>');
        }

        await User.findByIdAndUpdate(teacherId, { $addToSet: { assignedTests: testId } });
        
        // Verify assignment - use String() for type-safe comparison (Oracle may return Number or String)
        const updatedUser = await User.findById(teacherId);
        const assigned = updatedUser && updatedUser.assignedTests &&
            updatedUser.assignedTests.some(id => String(id) === String(testId));
        logger.info('Test assigned to teacher', { testId, teacherId, adminId: req.session.userId, verified: assigned });
        
        if (assigned) {
            res.send('<h1>Success!</h1><p>Test assigned to teacher.</p><a href="/admin">Back to Admin</a>');
        } else {
            res.status(500).send('Assignment may have failed - test not found in teacher assignments. <a href="/admin">Back</a>');
        }
    } catch (err) {
        logger.error('Assign test error', { 
            error: err.message, 
            stack: err.stack,
            teacherId: req.body.teacherId,
            testId: req.body.testId
        });
        res.status(500).send('Error assigning test. <a href="/admin">Back</a>');
    }
});

// === CREATE TEST HUB ===
app.get('/create-test', isTeacher, (req, res) => {
    res.render('create-test-hub');
});

// === CREATE TEST (READING) ===
app.get('/create-test-reading', isTeacher, csrfProtection, (req, res) => {
    try {
        const html = getAuthoringPageHtml('reading', null, req.csrfToken());
        res.send(html);
    } catch (err) {
        logger.error('Error loading reading builder', { error: err.message });
        res.status(500).send('Error loading reading builder');
    }
});

// NOTE: csrfProtection must come AFTER multer for multipart forms so req.body._csrf is available
app.post('/create-test-reading', isTeacher, testCreationLimiter, upload.single('builderJson'), csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        let builderJson = '';
        let content = null;

        if (req.file) {
            builderJson = req.file.buffer.toString('utf-8');
        } else if (req.body.builderJson) {
            builderJson = req.body.builderJson;
        } else if (req.body.content) {
            try {
                content = typeof req.body.content === 'string' ? JSON.parse(req.body.content) : req.body.content;
            } catch {
                content = req.body.content;
            }
        }

        if (!builderJson && !content) {
            return res.status(400).json({ success: false, message: 'No test data provided' });
        }

        let title = req.body.title || 'Reading Test';
        let type = 'reading';

        if (builderJson) {
            try {
                const parsed = JSON.parse(builderJson);
                title = parsed.title || title;
                content = parsed;
            } catch {
                // Not JSON, might be raw HTML
                title = req.body.title || title;
            }
        }

        const newTest = await saveValidatedTest({
            title,
            type,
            content,
            builderJson,
            req
        });

        logger.info('Reading test created', { userId: req.session.userId, testId: newTest._id });
        res.json({
            success: true,
            test: newTest,
            redirect: '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Reading test creation error', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: err.message
        });
    }
});

// Alias route for builder compatibility (builder posts to /create-test/reading)
app.post('/create-test/reading', isTeacher, testCreationLimiter, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const title = req.body.title || 'Reading Test';
        const content = typeof req.body.content === 'string' ? JSON.parse(req.body.content) : req.body.content;
        const builderJson = req.body.builderJson;

        const newTest = await saveValidatedTest({
            title,
            type: 'reading',
            content,
            builderJson,
            req
        });

        logger.info('Reading test created via builder', { userId: req.session.userId, testId: newTest._id });
        res.json({
            success: true,
            test: newTest,
            redirect: '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Reading test creation error (builder)', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: err.message
        });
    }
});

// === CREATE TEST (LISTENING) ===
app.get('/create-test-listening', isTeacher, csrfProtection, (req, res) => {
    try {
        const html = getAuthoringPageHtml('listening', null, req.csrfToken());
        res.send(html);
    } catch (err) {
        logger.error('Error loading listening builder', { error: err.message });
        res.status(500).send('Error loading listening builder');
    }
});

// NOTE: csrfProtection must come AFTER multer for multipart forms so req.body._csrf is available
app.post('/create-test-listening', isTeacher, testCreationLimiter, upload.fields([
    { name: 'builderJson', maxCount: 1 },
    { name: 'audioFiles', maxCount: 20 }
]), csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        let builderJson = '';
        let content = null;

        if (req.files && req.files.builderJson && req.files.builderJson[0]) {
            builderJson = req.files.builderJson[0].buffer.toString('utf-8');
        } else if (req.body.builderJson) {
            builderJson = req.body.builderJson;
        } else if (req.body.content) {
            try {
                content = typeof req.body.content === 'string' ? JSON.parse(req.body.content) : req.body.content;
            } catch {
                content = req.body.content;
            }
        }

        // Upload audio files
        if (req.files && req.files.audioFiles) {
            const audioParts = [];
            for (const file of req.files.audioFiles) {
                const filename = `audio/${Date.now()}_${file.originalname}`;
                const url = await uploadToB2(file.buffer, filename, file.mimetype);
                audioParts.push({ url, originalName: file.originalname });
            }

            if (builderJson) {
                const parsed = JSON.parse(builderJson);
                parsed.audioParts = audioParts;
                builderJson = JSON.stringify(parsed);
            } else if (content) {
                content.audioParts = audioParts;
            }
        }

        const title = req.body.title || 'Listening Test';
        const newTest = await saveValidatedTest({
            title,
            type: 'listening',
            content,
            builderJson,
            req
        });

        logger.info('Listening test created', { userId: req.session.userId, testId: newTest._id });
        res.json({
            success: true,
            test: newTest,
            redirect: '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Listening test upload error', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: err.message
        });
    }
});

// Alias route for builder compatibility (builder posts to /create-test/listening)
// NOTE: csrfProtection must come AFTER multer for multipart forms so req.body._csrf is available
app.post('/create-test/listening', isTeacher, testCreationLimiter, upload.fields([
    { name: 'audioFile', maxCount: 1 },
    { name: 'part1', maxCount: 1 },
    { name: 'part2', maxCount: 1 },
    { name: 'part3', maxCount: 1 },
    { name: 'part4', maxCount: 1 }
]), csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const title = req.body.title || 'Listening Test';
        const builderJson = req.body.builderJson;
        const parts = req.body.parts ? JSON.parse(req.body.parts) : {};
        const answerKey = req.body.answerKey ? JSON.parse(req.body.answerKey) : {};
        const usePause = req.body.usePause === 'true';

        // Process audio files: upload to Backblaze B2 and embed URLs in content
        const audioParts = [];
        const fullAudio = req.files && req.files.audioFile && req.files.audioFile[0]
            ? await (async () => {
                const file = req.files.audioFile[0];
                const filename = `listening/${Date.now()}_${file.originalname}`;
                const url = await uploadToB2(file.buffer, filename, file.mimetype);
                return url;
            })()
            : null;

        // Part-specific audio files (part1-part4)
        for (let i = 1; i <= 4; i++) {
            const fieldName = `part${i}`;
            if (req.files && req.files[fieldName] && req.files[fieldName][0]) {
                const file = req.files[fieldName][0];
                const filename = `listening/${Date.now()}_${file.originalname}`;
                const url = await uploadToB2(file.buffer, filename, file.mimetype);
                audioParts[i - 1] = url;
            } else {
                audioParts[i - 1] = null;
            }
        }

        const content = { parts, answerKey, includePause: usePause, fullAudio, audioParts };

        const newTest = await saveValidatedTest({
            title,
            type: 'listening',
            content,
            builderJson,
            req
        });

        logger.info('Listening test created via builder', { userId: req.session.userId, testId: newTest._id });
        res.json({
            success: true,
            test: newTest,
            redirect: '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Listening test creation error (builder)', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: err.message
        });
    }
});

// === CREATE TEST (WRITING) ===
app.get('/create-test-writing', isTeacher, csrfProtection, (req, res) => {
    try {
        const html = getAuthoringPageHtml('writing', null, req.csrfToken());
        res.send(html);
    } catch (err) {
        logger.error('Error loading writing builder', { error: err.message });
        res.status(500).send('Error loading writing builder');
    }
});

app.post('/create-test-writing', isTeacher, testCreationLimiter, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const writingContent = req.body.content || {
            task1: {
                prompt: req.body.task1Prompt || '',
                instructions: req.body.task1Instructions || '',
                minWords: parseInt(req.body.task1MinWords) || 150
            },
            task2: {
                prompt: req.body.task2Prompt || '',
                instructions: req.body.task2Instructions || '',
                minWords: parseInt(req.body.task2MinWords) || 250
            }
        };

        const title = req.body.title || 'Writing Test';
        const newTest = await saveValidatedTest({
            title,
            type: 'writing',
            content: writingContent,
            builderJson: req.body.builderJson || '',
            req
        });

        logger.info('Writing test created', { userId: req.session.userId, testId: newTest._id });
        res.json({
            success: true,
            test: newTest,
            redirect: '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Writing test creation error', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: err.message
        });
    }
});

// Alias route for builder compatibility (builder posts to /create-test/writing)
app.post('/create-test/writing', isTeacher, testCreationLimiter, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const title = req.body.title || 'Writing Test';
        const content = typeof req.body.content === 'string' ? JSON.parse(req.body.content) : req.body.content;
        const builderJson = req.body.builderJson;

        const newTest = await saveValidatedTest({
            title,
            type: 'writing',
            content,
            builderJson,
            req
        });

        logger.info('Writing test created via builder', { userId: req.session.userId, testId: newTest._id });
        res.json({
            success: true,
            test: newTest,
            redirect: '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Writing test creation error (builder)', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: err.message
        });
    }
});

// === TEST EDIT ===
app.get('/edit-test/:id', isTeacher, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const test = await Test.findById(req.params.id);
        if (!test) return res.status(404).send('Test not found');

        const canEdit = await canEditTest(req, req.params.id);
        if (!canEdit) return res.status(403).send('You cannot edit this test');

        const html = getAuthoringPageHtml(test.type, test, req.csrfToken());
        res.send(html);
    } catch (err) {
        logger.error('Edit test error', { error: err.message });
        res.status(500).send('Error loading test');
    }
});

app.post('/edit-test/:id', isTeacher, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const canEdit = await canEditTest(req, req.params.id);
        if (!canEdit) return res.status(403).json({ success: false, message: 'Not authorized' });

        const update = {};
        if (req.body.title) update.title = req.body.title;
        if (req.body.type) update.type = req.body.type;
        if (req.body.content) {
            if (typeof req.body.content === 'string') {
                try {
                    update.questions = JSON.parse(req.body.content).questions || [];
                    update.readingPassage = JSON.parse(req.body.content).readingPassage || '';
                } catch {
                    update.builderJson = req.body.content;
                }
            } else {
                update.questions = req.body.content.questions || [];
                update.readingPassage = req.body.content.readingPassage || '';
            }
        }
        if (req.body.builderJson) update.builderJson = req.body.builderJson;
        if (req.body.customTitle !== undefined) update.customTitle = req.body.customTitle;
        if (req.body.folder !== undefined) update.folder = req.body.folder;

        await Test.findByIdAndUpdate(req.params.id, update);

        logger.info('Test updated', { userId: req.session.userId, testId: req.params.id });
        res.json({ success: true, redirect: '/teacher-dashboard' });
    } catch (err) {
        logger.error('Test update error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

// Alias for builder compatibility — builderAuthoring.js uses /update-test/:id
app.post('/update-test/:id', isTeacher, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const canEdit = await canEditTest(req, req.params.id);
        if (!canEdit) return res.status(403).json({ success: false, message: 'Not authorized' });

        const update = {};
        if (req.body.title) update.title = req.body.title;
        if (req.body.type) update.type = req.body.type;
        if (req.body.content) {
            if (typeof req.body.content === 'string') {
                try {
                    update.questions = JSON.parse(req.body.content).questions || [];
                    update.readingPassage = JSON.parse(req.body.content).readingPassage || '';
                } catch {
                    update.builderJson = req.body.content;
                }
            } else {
                update.questions = req.body.content.questions || [];
                update.readingPassage = req.body.content.readingPassage || '';
            }
        }
        if (req.body.builderJson) update.builderJson = req.body.builderJson;
        if (req.body.customTitle !== undefined) update.customTitle = req.body.customTitle;
        if (req.body.folder !== undefined) update.folder = req.body.folder;

        await Test.findByIdAndUpdate(req.params.id, update);

        logger.info('Test updated via builder', { userId: req.session.userId, testId: req.params.id });
        res.json({ success: true, redirect: '/teacher-dashboard' });
    } catch (err) {
        logger.error('Test update error (builder)', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

// === TEACHER DASHBOARD ===
app.get('/teacher-dashboard', isTeacher, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const userId = req.session.userId;
        const page = Math.max(1, parseInt(req.query.page) || 1);

        // Dashboard caching: avoid 14 DB round-trips on every page load
        const cacheKey = `dashboard_teacher_${userId}_page${page}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            cached.csrfToken = req.csrfToken();
            return res.render('teacher-dashboard', cached);
        }

        const PAGE_SIZE = 20;
        const skip = (page - 1) * PAGE_SIZE;

        const [teacher, groups, allStudents] = await Promise.all([
            User.findByIdWithGroup(userId),
            Group.find({ teacherId: userId }),
            User.find({ role: 'student', teacherId: userId })
        ]);

        if (!teacher) {
            return req.session.destroy(() => res.redirect('/login'));
        }

        // Get tests created by teacher + assigned tests
        // Load assigned test IDs from the junction table
        let assignedTestIds = [];
        try {
            const result = await execute(
                `SELECT test_id AS "testId" FROM user_assigned_tests WHERE user_id = :userId`,
                { userId }
            );
            assignedTestIds = result.rows.map(r => r.testId);
        } catch (assignErr) {
            logger.warn('Failed to load assigned tests for teacher', { error: assignErr.message, userId });
        }

        // Only admins create tests; skip wasteful createdBy queries for teachers
        const isAdminUser = req.session.role === 'admin';
        let createdCount = 0;
        let createdTests = [];

        if (isAdminUser) {
            createdCount = await Test.countDocuments({ createdBy: userId });
            createdTests = await Test.find({
                createdBy: userId,
                $sort: { createdAt: -1 },
                $skip: skip,
                $limit: PAGE_SIZE
            });
        }

        const totalTests = createdCount + assignedTestIds.length;
        const totalPages = Math.ceil(totalTests / PAGE_SIZE);

        // Load assigned tests (from admin) and merge with created
        let tests = createdTests;
        if (assignedTestIds.length > 0) {
            const assignedTests = await Test.find({ _id: { $in: assignedTestIds } });
            const createdTestIdSet = new Set(createdTests.map(t => String(t._id)));
            tests = [...createdTests, ...assignedTests.filter(t => !createdTestIdSet.has(String(t._id)))];
        }

        // Get submissions for teacher's students
        const studentIds = allStudents.map(s => s._id);
        const testIds = tests.map(t => t._id);
        let submissions = [];

        if (testIds.length > 0) {
            const recentSubs = await Submission.find({
                $or: [
                    { teacherId: userId },
                    ...(studentIds.length > 0 ? [{ studentId: { $in: studentIds } }] : [])
                ],
                testId: { $in: testIds }
            });
            submissions = recentSubs || [];
        }

        // Compute per-test metrics using the same logic as Mongoose server.js (lines 1240-1281)
        // Build group stats: which groups contain each test, plus unique student count
        const groupStatsByTestId = new Map();
        groups.forEach((group) => {
            const uniqueStudentIds = [...new Set(
                (group.students || []).filter(Boolean).map(student =>
                    String(typeof student === 'object' ? student._id : student)
                )
            )];
            (group.assignedTests || []).filter(Boolean).forEach((test) => {
                const key = String(typeof test === 'object' ? test._id : test);
                if (!groupStatsByTestId.has(key)) {
                    groupStatsByTestId.set(key, { groupCount: 0, studentIds: new Set() });
                }
                const current = groupStatsByTestId.get(key);
                current.groupCount += 1;
                uniqueStudentIds.forEach((studentId) => current.studentIds.add(studentId));
            });
        });

        // Build submission stats: unique completed student count per test
        const submissionStatsByTestId = new Map();
        submissions.forEach((submission) => {
            const key = String(submission.testId);
            if (!submissionStatsByTestId.has(key)) {
                submissionStatsByTestId.set(key, { completedCount: 0, studentIds: new Set(), latestSubmissionAt: null });
            }
            const current = submissionStatsByTestId.get(key);
            const studentKey = String(submission.studentId);
            if (!current.studentIds.has(studentKey)) {
                current.studentIds.add(studentKey);
                current.completedCount += 1;
            }
            if (!current.latestSubmissionAt || (submission.lastSubmittedAt || submission.createdAt) > current.latestSubmissionAt) {
                current.latestSubmissionAt = submission.lastSubmittedAt || submission.createdAt;
            }
        });

        // Enrich each test with the three metrics the template expects
        const enrichedTests = tests.map((test) => {
            const groupStats = groupStatsByTestId.get(String(test._id));
            const submissionStats = submissionStatsByTestId.get(String(test._id));
            return {
                ...test,
                assignedGroupCount: groupStats ? groupStats.groupCount : 0,
                assignedStudentCount: groupStats ? groupStats.studentIds.size : 0,
                completedStudentCount: submissionStats ? submissionStats.completedCount : 0,
                latestSubmissionAt: submissionStats ? submissionStats.latestSubmissionAt : null
            };
        });

        const viewData = {
            teacher,
            tests: enrichedTests,
            testsByType: groupTestsByType(enrichedTests),
            groups,
            students: allStudents,
            allStudents,
            csrfToken: req.csrfToken(),
            stats: {
                testsCount: totalTests,
                studentsCount: allStudents.length,
                groupsCount: groups.length,
                submissionsCount: submissions.length
            },
            pagination: { page, totalPages, totalTests, pageSize: PAGE_SIZE }
        };

        // Cache for 30 seconds so repeated navigations are instant
        cache.set(cacheKey, viewData, 30);

        res.render('teacher-dashboard', viewData);
    } catch (err) {
        logger.error('Teacher dashboard error', { error: err.message, stack: err.stack });
        res.status(500).send('Error loading teacher dashboard');
    }
});

// Add student page
app.get('/teacher/add-student', isTeacher, csrfProtection, (req, res) => {
    res.render('add-student', { csrfToken: req.csrfToken() });
});

// Teacher adds student
app.post('/teacher/add-student', isTeacher, csrfProtection, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required' });
        }

        const exists = await User.findOne({ username });
        if (exists) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newStudent = await User.create({
            username,
            password: hashedPassword,
            role: 'student',
            teacherId: req.session.userId
        });

        res.json({
            success: true,
            student: newStudent,
            message: 'Student added successfully'
        });
    } catch (err) {
        logger.error('Add student error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

// Teacher adds student to group
app.post('/teacher/add-student-to-group', isTeacher, csrfProtection, async (req, res) => {
    try {
        const { studentId, groupId } = req.body;
        const [student, group] = await Promise.all([
            User.findById(studentId),
            Group.findById(groupId)
        ]);

        if (!student || !group) {
            return res.status(404).json({ success: false, message: 'Student or group not found' });
        }
        if (req.session.userRole !== CONSTANTS.ROLES.ADMIN &&
            String(group.teacherId) !== String(req.session.userId)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        await Group.findByIdAndUpdate(groupId, { $addToSet: { students: studentId } });
        await User.findByIdAndUpdate(studentId, { $set: { groupId: groupId } });

        res.json({ success: true, message: 'Student added to group' });
    } catch (err) {
        logger.error('Add to group error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

// Create group
app.post('/teacher/create-group', isTeacher, csrfProtection, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Group name required' });

        const newGroup = await Group.create({
            name,
            teacherId: req.session.userId
        });

        res.json({ success: true, group: newGroup });
    } catch (err) {
        logger.error('Create group error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

// Assign student to group (alias route)
app.post('/teacher/assign-to-group', isTeacher, csrfProtection, async (req, res) => {
    try {
        const { studentId, groupId } = req.body;
        const [student, group] = await Promise.all([
            User.findById(studentId),
            Group.findById(groupId)
        ]);

        if (!student || student.role !== 'student') {
            return res.status(404).send("Student not found. <a href='/teacher-dashboard'>Go back</a>");
        }
        if (!group) {
            return res.status(404).send("Group not found. <a href='/teacher-dashboard'>Go back</a>");
        }
        if (req.session.userRole !== 'admin' && String(group.teacherId) !== String(req.session.userId)) {
            return res.status(403).send("Not authorized to manage this group. <a href='/teacher-dashboard'>Go back</a>");
        }
        if (req.session.userRole !== 'admin' && String(student.teacherId) !== String(req.session.userId)) {
            return res.status(403).send("Not authorized to assign this student. <a href='/teacher-dashboard'>Go back</a>");
        }

        await Group.findByIdAndUpdate(groupId, { $addToSet: { students: studentId } });
        await User.findByIdAndUpdate(studentId, { $set: { groupId: groupId } });

        logger.info('Student assigned to group', { studentId, groupId, teacherId: req.session.userId });
        res.redirect('/teacher-dashboard');
    } catch (err) {
        logger.error('Assign to group error', { error: err.message });
        res.status(500).send("Error assigning student to group: " + err.message);
    }
});

// === TEACHER PROGRESS ===
app.get('/teacher-progress', isTeacher, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const teacherId = req.session.userId;
        const [groups, allSubmissions] = await Promise.all([
            Group.find({ teacherId }),
            Submission.find({ teacherId })
        ]);

        // Get all students for this teacher
        const students = await User.find({ role: 'student', teacherId });

        // Build student rows with submission data
        const studentRows = new Map();
        students.forEach(s => {
            studentRows.set(String(s._id), {
                _id: s._id,
                username: s.username,
                groupId: s.groupId,
                totalSubmissions: 0,
                tests: []
            });
        });

        allSubmissions.forEach(sub => {
            const key = String(sub.studentId);
            const existing = studentRows.get(key) || {
                _id: sub.studentId,
                username: sub.studentName || 'Unknown',
                groupId: sub.groupId,
                totalSubmissions: 0,
                tests: []
            };
            existing.totalSubmissions++;
            existing.tests.push(sub);
            studentRows.set(key, existing);
        });

        const studentList = Array.from(studentRows.values());

        res.render('teacher-progress', {
            students: studentList,
            groups,
            summary: {
                totalStudents: students.length,
                totalSubmissions: allSubmissions.length,
                totalGroups: groups.length
            }
        });
    } catch (err) {
        logger.error('Teacher progress error', { error: err.message });
        res.status(500).send('Error loading progress');
    }
});

// === TEST TAKING ===
app.get('/test/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const access = await getAccessibleTest(req, req.params.id);
        if (!access.test) return res.status(404).send('Test not found');
        if (!access.isAllowed) return res.status(403).send('You do not have access to this test');

        let html = '';
        try {
            html = generateHTMLFromTest(access.test, {
                studentName: req.session.username,
                randomize: true
            });
        } catch (e) {
            logger.error('HTML generation error', { error: e.message });
            return res.status(500).send('Error generating test');
        }

        res.render('index', {
            test: access.test,
            html,
            student: { username: req.session.username }
        });
    } catch (err) {
        logger.error('Test taking error', { error: err.message });
        res.status(500).send('Error loading test');
    }
});

// === SUBMISSION ===
app.post('/submit-test', apiLimiter, csrfProtection, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: 'Not logged in' });
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const payload = req.body;
        const result = await saveStudentSubmission({ req, payload });

        res.json({
            success: true,
            submission: result,
            message: 'Submission saved successfully'
        });
    } catch (err) {
        logger.error('Submission error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/submit-writing', apiLimiter, csrfProtection, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: 'Not logged in' });
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const result = await saveStudentSubmission({
            req,
            payload: {
                testId: req.body.testId,
                teacherId: req.body.teacherId,
                groupId: req.body.groupId,
                type: 'writing',
                studentName: req.session.username,
                wordCount1: req.body.wordCount1,
                wordCount2: req.body.wordCount2,
                timeRemainingText: req.body.timeRemainingText,
                details: {
                    task1: req.body.task1 || '',
                    task2: req.body.task2 || ''
                }
            }
        });

        res.json({
            success: true,
            submission: result,
            message: 'Writing submission saved'
        });
    } catch (err) {
        logger.error('Writing submission error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

// === AI CHAT ===
app.get('/ai-chat', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const submissions = await Submission.find({ studentId: req.session.userId });
        const scopedSubmissions = submissions.filter(s => s.percentage != null && Number.isFinite(Number(s.percentage)));
        const stats = {
            totalTests: submissions.length,
            readingTests: submissions.filter(s => s.type === 'reading').length,
            listeningTests: submissions.filter(s => s.type === 'listening').length,
            writingTests: submissions.filter(s => s.type === 'writing').length,
            avgScore: scopedSubmissions.length > 0
                ? Math.round(scopedSubmissions.reduce((sum, s) => sum + Number(s.percentage), 0) / scopedSubmissions.length)
                : null
        };

        res.render('ai-chat', {
            studentName: req.session.username,
            stats
        });
    } catch (err) {
        logger.error('AI Chat page error', { error: err.message });
        res.status(500).send('Error loading AI chat');
    }
});

app.post('/api/ai-chat', apiLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        const { message, testType } = req.body;

        // Gather context
        const [readingSubmissions, listeningSubmissions, writingSubmissions] = await Promise.all([
            Submission.find({ studentId: req.session.userId, type: 'reading' }),
            Submission.find({ studentId: req.session.userId, type: 'listening' }),
            Submission.find({ studentId: req.session.userId, type: 'writing' })
        ]);

        const context = {
            reading: readingSubmissions,
            listening: listeningSubmissions,
            writing: writingSubmissions,
            totalTests: readingSubmissions.length + listeningSubmissions.length + writingSubmissions.length
        };

        const systemPrompt = `You are an IELTS tutor analyzing student performance data. 
Student stats: ${context.totalTests} tests taken (${context.reading.length} reading, ${context.listening.length} listening, ${context.writing.length} writing).
Provide helpful, encouraging feedback based on their actual performance data.`;

        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: message }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

        logger.info('AI chat response generated', { userId: req.session.userId });
        res.json({
            success: true,
            reply,
            context
        });
    } catch (err) {
        logger.error('AI chat error', { error: err.message });
        res.status(500).json({ error: 'Error generating response' });
    }
});

// === AI FEEDBACK ===
app.get('/ai-feedback/:submissionId', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const submission = await Submission.findOne({
            _id: req.params.submissionId,
            studentId: req.session.userId
        });
        if (!submission) return res.status(404).send('Submission not found');

        // Get test info
        let test = null;
        if (submission.testId) {
            test = await Test.findById(submission.testId);
        }

        res.render('ai-feedback', { submission, test });
    } catch (err) {
        logger.error('AI Feedback page error', { error: err.message });
        res.status(500).send('Error loading feedback');
    }
});

app.post('/api/ai-feedback/:submissionId', apiLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        const submission = await Submission.findOne({
            _id: req.params.submissionId,
            studentId: req.session.userId
        });
        if (!submission) return res.status(404).json({ error: 'Submission not found' });

        // Call AI analysis
        const analysis = await analyzeWriting(submission);

        if (analysis) {
            await Submission.findOneAndUpdate(
                { _id: req.params.submissionId },
                { $set: { aiAnalysis: analysis } }
            );
        }

        res.json({ success: true, analysis });
    } catch (err) {
        logger.error('AI feedback error', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// === PATTERN ANALYSIS ===
app.get('/pattern-analysis', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const submissions = await Submission.find({ studentId: req.session.userId });
        let patternResult = null;

        try {
            patternResult = await analyzePatterns(submissions);
        } catch (e) {
            logger.warn('Pattern analysis failed', { error: e.message });
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Pattern Analysis</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
                    h1 { color: #667eea; }
                    .section { margin: 20px 0; padding: 20px; background: #f8fafc; border-radius: 12px; }
                    .content { white-space: pre-wrap; }
                </style>
            </head>
            <body>
                <h1>Pattern Analysis</h1>
                <div class="section">
                    <div class="content">
                        ${patternResult && patternResult.success ? patternResult.patterns : 'Pattern analysis unavailable at this time.'}
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        logger.error('Pattern analysis error', { error: err.message });
        res.status(500).send('Error generating pattern analysis.');
    }
});

// === STUDENT DASHBOARD ===
app.get('/student-dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const search = (req.query.search || '').trim();
        const PAGE_SIZE = 10;

        // Get student with group and assigned tests using populated query
        const student = await User.findByIdWithGroupAndTests(req.session.userId);
        if (!student) {
            logger.warn('Student dashboard requested with stale session user', { userId: req.session.userId });
            return req.session.destroy(() => res.redirect('/login'));
        }

        // Get submissions
        const submissions = await Submission.find({ studentId: req.session.userId });

        const submissionsByTestId = new Map(
            submissions.map((submission) => [String(submission.testId), submission])
        );

        let allTests = student.groupId ? (student.groupId.assignedTests || []).filter(Boolean) : [];
        const now = new Date();
        const scheduledTests = [];

        // Process scheduled tests
        if (student.groupId && student.groupId.testSchedule) {
            student.groupId.testSchedule.forEach(schedule => {
                if (!schedule || !schedule.testId || !schedule.availableFrom) return;
                const availableDate = new Date(schedule.availableFrom);
                if (Number.isNaN(availableDate.getTime())) return;
                if (availableDate > now) {
                    scheduledTests.push({
                        _id: schedule.testId,
                        title: 'Scheduled Test',
                        type: 'scheduled',
                        availableFrom: availableDate,
                        isLocked: true
                    });
                }
            });

            const scheduledTestIds = new Set(scheduledTests.map(t => String(t._id)));
            allTests = allTests.filter(test => !scheduledTestIds.has(String(test._id)));
        }

        // Apply search filter
        if (search) {
            allTests = allTests.filter(test =>
                String(test.title || '').toLowerCase().includes(search.toLowerCase())
            );
        }

        // Combine and paginate
        const availableTests = allTests.map((testDoc) => {
            const test = { ...testDoc };
            return { ...test, submission: submissionsByTestId.get(String(test._id)) || null, isLocked: false };
        });

        const combinedTests = [...availableTests, ...scheduledTests];
        const total = combinedTests.length;
        const totalPages = Math.ceil(total / PAGE_SIZE);
        const tests = combinedTests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

        const groupName = student.groupId ? student.groupId.name : "No Group Assigned";
        res.render('student-dashboard', {
            student,
            tests,
            testsByType: groupTestsByType(tests),
            groupName,
            pagination: { page, totalPages, total, search }
        });
    } catch (err) {
        logger.error('Student dashboard error', { error: err.message, stack: err.stack, userId: req.session.userId });
        res.status(500).send("Error loading student dashboard.");
    }
});

// === VIEW/PREVIEW TEST ===
app.get('/view-test/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const isStaffPreview = req.session.userRole === 'teacher' || req.session.userRole === 'admin';
        const cacheKey = `test_html_${req.params.id}_${req.session.userId}_${isStaffPreview ? 'preview' : 'student'}`;
        let html = cache.get(cacheKey);

        if (html) {
            return res.send(html);
        }

        const access = await getAccessibleTest(req, req.params.id);
        if (!access.test) return res.status(404).send('Test not found.');
        if (!access.isAllowed) return res.status(403).send('Not authorized to view this test.');

        try {
            html = generateHTMLFromTest(access.test, {
                deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
                studentName: '',
                previewMode: isStaffPreview,
                useAudioProxy: false
            });

            cache.set(cacheKey, html);
            return res.send(html);
        } catch (genErr) {
            logger.error('HTML generation error', { error: genErr.message, stack: genErr.stack });
            return res.status(500).send('Error generating test HTML: ' + genErr.message);
        }
    } catch (err) {
        logger.error('View test error', { error: err.message, stack: err.stack });
        res.status(500).send('Error loading test: ' + err.message);
    }
});

// === DOWNLOAD STANDALONE HTML TEST ===
app.get('/download-test/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const { test, isAllowed } = await getAccessibleTest(req, req.params.id);
        if (!test) return res.status(404).send('Test not found.');
        if (!isAllowed) return res.status(403).send('Not authorized to download this test.');

        // Memory-safe streaming base64 converter: fetches one audio file at a time,
        // encodes to base64, and returns a data URI without holding all files in RAM.
        async function audioUrlToBase64(url) {
            if (!url || typeof url !== 'string' || !url.startsWith('http')) return url;
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                // Node.js native fetch() has arrayBuffer(), not buffer()
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const ct = response.headers.get('content-type') || 'audio/mpeg';
                logger.info('[download-test] Encoded audio to base64', { url, size: buffer.length });
                return `data:${ct};base64,${buffer.toString('base64')}`;
            } catch (err) {
                logger.warn('[download-test] Audio fetch failed, keeping URL:', url, err.message);
                return url;
            }
        }

        // Ensure listening tests have audio URLs in readingPassage (from readingPassage or builderJson)
        function ensureAudioUrls(testDoc) {
            let raw = testDoc.readingPassage;
            if ((!raw || typeof raw !== 'string' || !raw.trim()) && String(testDoc.type || '').toLowerCase() === 'listening') {
                if (testDoc.builderJson && typeof testDoc.builderJson === 'string' && testDoc.builderJson.trim()) {
                    try {
                        const bj = JSON.parse(testDoc.builderJson);
                        if (bj.audioUrls || bj.audioParts || bj.fullAudio) {
                            const audioParts = bj.audioUrls || bj.audioParts || [];
                            raw = JSON.stringify({
                                audioParts: Array.isArray(audioParts) ? audioParts : [audioParts],
                                fullAudio: bj.fullAudio || null
                            });
                        }
                    } catch (e) { /* keep raw as-is */ }
                }
            }
            if (raw && typeof raw === 'string' && raw.trim()) {
                try {
                    const parsed = JSON.parse(raw);
                    return { ...(typeof testDoc.toObject === 'function' ? testDoc.toObject() : { ...testDoc }), readingPassage: JSON.stringify(parsed) };
                } catch (e) { /* use original */ }
            }
            return testDoc;
        }

        try {
            const testForDownload = String(test.type || '').toLowerCase() === 'listening'
                ? ensureAudioUrls(test)
                : test;

            // Wipe renderedHtml so generateHTMLFromTest regenerates fresh HTML
            if (testForDownload.renderedHtml !== undefined) delete testForDownload.renderedHtml;

            let html = generateHTMLFromTest(testForDownload, { useAudioProxy: false });
            html = require('./utils/htmlExporter').injectPersistentStateForDownload(html, test);

            const safeTitle = test.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');

            // For listening tests: stream the response, replacing B2 audio URLs with
            // base64 data URIs one at a time to keep peak memory under control.
            const isListening = String(test.type || '').toLowerCase() === 'listening';
            if (!isListening) {
                return res.send(html);
            }

            // Match B2 audio URLs in the HTML: https://f004.backblazeb2.com/file/ielts-audio/listening-*.mp3
            const B2_URL_RE = /https?:\/\/f\d+\.backblazeb2\.com\/file\/ielts-audio\/[^\s"']+\.mp3/gi;
            const audioUrls = html.match(B2_URL_RE) || [];
            // Deduplicate URLs (same file may appear in multiple places)
            const uniqueUrls = [...new Set(audioUrls)];

            // Build a cache so we only fetch each URL once
            const base64Cache = new Map();

            // Stream the HTML, replacing each URL with its base64 data URI
            let remaining = html;
            for (const url of uniqueUrls) {
                const idx = remaining.indexOf(url);
                if (idx === -1) continue;

                // Write everything before this URL
                res.write(remaining.substring(0, idx));

                // Fetch and encode (or use cache)
                let dataUri = base64Cache.get(url);
                if (!dataUri) {
                    dataUri = await audioUrlToBase64(url);
                    base64Cache.set(url, dataUri);
                }
                res.write(dataUri);

                // Advance past the URL
                remaining = remaining.substring(idx + url.length);
            }
            // Write whatever remains after the last URL
            res.write(remaining);
            return res.end();
        } catch (generatorErr) {
            logger.error('HTML generation error for download', { error: generatorErr.message, stack: generatorErr.stack });
            return res.status(500).send(`Error generating test HTML: ${generatorErr.message}`);
        }
    } catch (err) {
        logger.error('Download test error', { error: err.message, stack: err.stack });
        res.status(500).send(`Error downloading test: ${err.message}`);
    }
});

// === LIVE MONITOR ===
const heartbeatStore = new Map();
const sseClients = new Map();

// Cleanup stale heartbeat entries every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - 300000; // 5 minutes
    heartbeatStore.forEach((studentMap) => {
        studentMap.forEach((data, name) => {
            if (data.lastSeen < cutoff) studentMap.delete(name);
        });
        if (studentMap.size === 0) heartbeatStore.delete(Array.from(heartbeatStore.keys()).find(k => heartbeatStore.get(k) === studentMap));
    });
    // Clean out empty maps
    heartbeatStore.forEach((v, k) => { if (v.size === 0) heartbeatStore.delete(k); });
}, 300000);

function getActiveStudents(testId) {
    const students = [];
    const sid = String(testId);
    const map = heartbeatStore.get(sid);
    if (map) {
        const cutoff = Date.now() - 30000;
        map.forEach((data) => { if (data.lastSeen > cutoff) students.push(data); });
    }
    return students;
}

function pushToTeachers(testId) {
    const sid = String(testId);
    const clients = sseClients.get(sid);
    if (!clients || clients.size === 0) return;
    const payload = `data: ${JSON.stringify({ students: getActiveStudents(testId) })}\n\n`;
    clients.forEach(res => { try { res.write(payload); } catch (e) { /* ignore */ } });
}

app.post('/api/heartbeat', apiLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ ok: false });
    const { testId, studentName, answeredCount, totalCount, currentPart, timeRemaining, type, task1Preview, task2Preview, wordCount1, wordCount2, examGuardViolations, examGuardLastReason } = req.body;
    if (!testId || !studentName) return res.json({ ok: false });

    const sid = String(testId);
    if (!heartbeatStore.has(sid)) heartbeatStore.set(sid, new Map());
    const studentKey = String(req.session.userId);
    const studentMap = heartbeatStore.get(sid);
    const previous = studentMap.get(studentKey);

    const nextAnswered = Number(answeredCount);
    const nextTotal = Number(totalCount);
    const safeAnswered = Number.isFinite(nextAnswered) ? nextAnswered : 0;
    const safeTotal = Number.isFinite(nextTotal) ? nextTotal : (previous ? previous.totalCount : 0);
    const boundedAnswered = safeTotal > 0
        ? Math.max(0, Math.min(safeAnswered, safeTotal))
        : Math.max(0, safeAnswered);

    studentMap.set(studentKey, {
        studentName,
        answeredCount: boundedAnswered,
        totalCount: safeTotal,
        currentPart: currentPart || (previous ? previous.currentPart : ''),
        timeRemaining: timeRemaining || (previous ? previous.timeRemaining : ''),
        type: type || (previous ? previous.type : ''),
        task1Preview: typeof task1Preview === 'string' ? task1Preview : (previous ? previous.task1Preview : null),
        task2Preview: typeof task2Preview === 'string' ? task2Preview : (previous ? previous.task2Preview : null),
        wordCount1: wordCount1 || (previous ? previous.wordCount1 : null),
        wordCount2: wordCount2 || (previous ? previous.wordCount2 : null),
        examGuardViolations: Number.isFinite(Number(examGuardViolations)) ? Number(examGuardViolations) : (previous ? previous.examGuardViolations : 0),
        examGuardLastReason: typeof examGuardLastReason === 'string' ? examGuardLastReason : (previous ? previous.examGuardLastReason : ''),
        lastSeen: Date.now()
    });

    pushToTeachers(testId);

    const activeCount = getActiveStudents(testId).length;
    res.json({ ok: true, activeCount });
});

app.get('/api/live-stream/:testId', isTeacher, async (req, res) => {
    const access = await getAccessibleTest(req, req.params.testId);
    if (!access.test) return res.status(404).end();
    if (!access.isAllowed) return res.status(403).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const testId = String(req.params.testId);
    if (!sseClients.has(testId)) sseClients.set(testId, new Set());
    sseClients.get(testId).add(res);

    res.write(`data: ${JSON.stringify({ students: getActiveStudents(testId) })}\n\n`);

    req.on('close', () => {
        const clients = sseClients.get(testId);
        if (clients) { clients.delete(res); if (clients.size === 0) sseClients.delete(testId); }
    });
});

app.get('/teacher/live/:testId', isTeacher, async (req, res) => {
    try {
        const access = await getAccessibleTest(req, req.params.testId);
        if (!access.test) return res.status(404).send('Test not found');
        if (!access.isAllowed) return res.status(403).send('Not authorized to monitor this test.');
        res.render('live-monitor', { test: access.test, students: [], testId: req.params.testId });
    } catch (err) {
        logger.error('Live monitor error', { error: err.message });
        res.status(500).send('Error loading monitor');
    }
});

// === DELETE ROUTES ===
app.post('/teacher/delete-test/:id', isTeacher, csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: Test,
        modelName: 'Test',
        ownerCheck: async (req, doc) => {
            if (req.session.userRole === CONSTANTS.ROLES.ADMIN) return true;
            return String(doc.createdBy) === String(req.session.userId);
        },
        cascades: [
            async (doc) => {
                // Remove from groups
                await Group.updateMany({}, { $pull: { assignedTests: { $in: [doc._id] }, testSchedule: { testId: doc._id } } });
                // Remove from users
                await User.updateMany({}, { $pull: { assignedTests: { $in: [doc._id] } } });
                // Delete submissions
                await Submission.deleteMany({ testId: doc._id });
            }
        ]
    });
});

app.post('/teacher/delete-group/:id', isTeacher, csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: Group,
        modelName: 'Group',
        ownerCheck: async (req, doc) => {
            if (req.session.userRole === CONSTANTS.ROLES.ADMIN) return true;
            return String(doc.teacherId) === String(req.session.userId);
        },
        cascades: [
            async (doc) => {
                // Unset groupId for all students in this group
                if (doc.students) {
                    for (const sid of doc.students) {
                        await User.findByIdAndUpdate(sid, { $unset: { groupId: 1 } });
                    }
                }
            }
        ]
    });
});

app.post('/teacher/delete-student/:id', isTeacher, csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: User,
        modelName: 'Student',
        ownerCheck: async (req, doc) => {
            if (req.session.userRole === CONSTANTS.ROLES.ADMIN) return true;
            return String(doc.teacherId) === String(req.session.userId) && doc.role === 'student';
        },
        cascades: [
            async (doc) => {
                // Remove from group
                if (doc.groupId) {
                    await Group.findByIdAndUpdate(doc.groupId, { $pull: { students: doc._id } });
                }
                // Delete submissions
                await Submission.deleteMany({ studentId: doc._id });
            }
        ]
    });
});

app.post('/admin/delete-user/:id', isAdmin, csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: User,
        modelName: 'User',
        ownerCheck: async () => true, // Admin can delete any user
        cascades: [
            async (doc) => {
                if (doc.role === 'teacher') {
                    const tests = await Test.find({ createdBy: doc._id });
                    for (const test of tests) {
                        await Test.findByIdAndDelete(test._id);
                    }
                }
                if (doc.groupId) {
                    await Group.findByIdAndUpdate(doc.groupId, { $pull: { students: doc._id } });
                }
                await Submission.deleteMany({ studentId: doc._id });
            }
        ]
    });
});

// === BACKWARD-COMPATIBLE DELETE ROUTES (unprefixed paths matching frontend deleteItem()) ===
app.post('/delete-test/:id', isTeacher, csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: Test,
        modelName: 'Test',
        ownerCheck: async (req, doc) => {
            if (req.session.userRole === CONSTANTS.ROLES.ADMIN) return true;
            return String(doc.createdBy) === String(req.session.userId);
        },
        cascades: [
            async (doc) => {
                await Group.updateMany({}, { $pull: { assignedTests: { $in: [doc._id] }, testSchedule: { testId: doc._id } } });
                await User.updateMany({}, { $pull: { assignedTests: { $in: [doc._id] } } });
                await Submission.deleteMany({ testId: doc._id });
            }
        ]
    });
});

app.post('/delete-group/:id', isTeacher, csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: Group,
        modelName: 'Group',
        ownerCheck: async (req, doc) => {
            if (req.session.userRole === CONSTANTS.ROLES.ADMIN) return true;
            return String(doc.teacherId) === String(req.session.userId);
        },
        cascades: [
            async (doc) => {
                if (doc.students) {
                    for (const sid of doc.students) {
                        await User.findByIdAndUpdate(sid, { $unset: { groupId: 1 } });
                    }
                }
            }
        ]
    });
});

app.post('/delete-student/:id', isTeacher, csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: User,
        modelName: 'Student',
        ownerCheck: async (req, doc) => {
            if (req.session.userRole === CONSTANTS.ROLES.ADMIN) return true;
            return String(doc.teacherId) === String(req.session.userId) && doc.role === 'student';
        },
        cascades: [
            async (doc) => {
                if (doc.groupId) {
                    await Group.findByIdAndUpdate(doc.groupId, { $pull: { students: doc._id } });
                }
                await Submission.deleteMany({ studentId: doc._id });
            }
        ]
    });
});

app.post('/delete-teacher/:id', isAdmin, csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: User,
        modelName: 'User',
        ownerCheck: async () => true,
        cascades: [
            async (doc) => {
                if (doc.role === 'teacher') {
                    const tests = await Test.find({ createdBy: doc._id });
                    for (const test of tests) {
                        await Test.findByIdAndDelete(test._id);
                    }
                }
                if (doc.groupId) {
                    await Group.findByIdAndUpdate(doc.groupId, { $pull: { students: doc._id } });
                }
                await Submission.deleteMany({ studentId: doc._id });
            }
        ]
    });
});

// --- MANUAL BACKUP ENDPOINT (Admin only) ---
app.post('/admin/backup-database', isAdmin, csrfProtection, async (req, res) => {
    try {
        console.log('🔄 Manual backup triggered by admin:', req.session.username);
        const result = await backupDatabase({ closeConnection: false });
        res.json({
            success: true,
            filename: result.filename,
            timestamp: new Date().toISOString(),
            stats: {
                sizeMB: (result.size / 1024 / 1024).toFixed(2)
            }
        });
    } catch (error) {
        console.error('❌ Manual backup failed:', error.message);
        res.status(500).json({
            success: false,
            error: 'Backup failed',
            message: error.message
        });
    }
});

// Remove student from group
app.post('/teacher/remove-student-from-group/:groupId/:studentId', isTeacher, csrfProtection, async (req, res) => {
    try {
        const { groupId, studentId } = req.params;
        const groupValidation = validateObjectId(groupId);
        const studentValidation = validateObjectId(studentId);
        if (!groupValidation.valid || !studentValidation.valid) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).json({
                success: false,
                message: 'Invalid ID format'
            });
        }

        const group = await Group.findById(groupId);
        const user = await User.findById(studentId);
        if (!group || !user) {
            return res.status(CONSTANTS.STATUS.NOT_FOUND).json({
                success: false,
                message: 'Group or student not found'
            });
        }

        if (req.session.userRole !== CONSTANTS.ROLES.ADMIN &&
            String(group.teacherId) !== String(req.session.userId)) {
            return res.status(CONSTANTS.STATUS.FORBIDDEN).json({
                success: false,
                message: 'Not authorized to remove students from this group'
            });
        }

        await Group.findByIdAndUpdate(groupId, { $pull: { students: studentId } });
        await User.findByIdAndUpdate(studentId, { $unset: { groupId: 1 } });

        logger.info('Student removed from group', {
            userId: req.session.userId,
            studentId
        });

        res.json({
            success: true,
            message: CONSTANTS.MESSAGES.STUDENT_REMOVED_FROM_GROUP,
            redirect: req.body.redirect || '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Error removing student from group', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Error removing student: ' + err.message
        });
    }
});

// Remove test from group
app.post('/teacher/remove-test-from-group/:groupId/:testId', isTeacher, csrfProtection, async (req, res) => {
    try {
        const { groupId, testId } = req.params;
        const groupValidation = validateObjectId(groupId);
        const testValidation = validateObjectId(testId);
        if (!groupValidation.valid || !testValidation.valid) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).json({ success: false, message: 'Invalid ID format' });
        }
        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(CONSTANTS.STATUS.NOT_FOUND).json({ success: false, message: 'Group not found' });
        }
        if (req.session.userRole !== CONSTANTS.ROLES.ADMIN && String(group.teacherId) !== String(req.session.userId)) {
            return res.status(CONSTANTS.STATUS.FORBIDDEN).json({ success: false, message: 'Not authorized' });
        }
        await Group.findByIdAndUpdate(groupId, {
            $pull: {
                assignedTests: testId,
                testSchedule: { testId: testId }
            }
        });
        logger.info('Test removed from group', { userId: req.session.userId, groupId, testId });
        res.json({ success: true, message: 'Test removed from group successfully', redirect: req.body.redirect || '/teacher-dashboard' });
    } catch (err) {
        logger.error('Error removing test from group', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({ success: false, message: 'Error: ' + err.message });
    }
});

// === PASSWORD VIEWERS ===
app.get('/admin/view-password/:userId', isAdmin, csrfProtection, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({
            username: user.username,
            role: user.role,
            message: 'Password is encrypted and cannot be viewed. Use reset password instead.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/admin/reset-password/:userId', isAdmin, csrfProtection, async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(req.params.userId, { password: hashedPassword });

        logger.info('Password reset by admin', { userId: req.params.userId, adminId: req.session.userId });
        res.json({ success: true, message: 'Password reset successfully', password: newPassword });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/teacher/view-password/:studentId', isTeacher, async (req, res) => {
    try {
        const student = await User.findById(req.params.studentId);
        if (!student || student.role !== 'student') return res.status(404).json({ error: 'Student not found' });
        if (req.session.userRole !== 'admin' && String(student.teacherId) !== String(req.session.userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        res.json({
            username: student.username,
            message: 'Password is encrypted and cannot be viewed. Use reset password instead.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/teacher/reset-password/:studentId', isTeacher, csrfProtection, async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }
        const student = await User.findById(req.params.studentId);
        if (!student || student.role !== 'student') {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }
        if (req.session.userRole !== 'admin' && String(student.teacherId) !== String(req.session.userId)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(req.params.studentId, { password: hashedPassword });

        logger.info('Password reset by teacher', { studentId: req.params.studentId, teacherId: req.session.userId });
        res.json({ success: true, message: 'Password reset successfully', password: newPassword });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// === BULK DELETE ===
app.post('/admin/bulk-delete', isAdmin, csrfProtection, async (req, res) => {
    try {
        const { type, ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'No items selected' });

        let deleted = 0;
        if (type === 'test') {
            await Test.deleteMany({ _id: { $in: ids } });
            await Group.updateMany({}, { $pull: { assignedTests: { $in: ids }, testSchedule: { testId: { $in: ids } } } });
            await User.updateMany({}, { $pull: { assignedTests: { $in: ids } } });
            await Submission.deleteMany({ testId: { $in: ids } });
            deleted = ids.length;
        } else if (type === 'teacher') {
            const teachers = await User.find({ _id: { $in: ids }, role: 'teacher' });
            for (const teacher of teachers) {
                const tests = await Test.find({ createdBy: teacher._id });
                const testIds = tests.map(t => t._id);
                if (testIds.length > 0) {
                    await Group.updateMany({}, { $pull: { assignedTests: { $in: testIds }, testSchedule: { testId: { $in: testIds } } } });
                    await User.updateMany({}, { $pull: { assignedTests: { $in: testIds } } });
                }
            }
            await User.deleteMany({ _id: { $in: ids }, role: 'teacher' });
            deleted = teachers.length;
        }
        logger.info('Bulk delete completed', { type, count: deleted, adminId: req.session.userId });
        res.json({ success: true, message: `${deleted} ${type}(s) deleted successfully` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/teacher/bulk-delete-students', isTeacher, csrfProtection, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'No students selected' });

        const students = await User.find({ _id: { $in: ids }, role: 'student', teacherId: req.session.userId });
        const validIds = students.map(s => s._id);

        for (const student of students) {
            if (student.groupId) await Group.findByIdAndUpdate(student.groupId, { $pull: { students: student._id } });
            await Submission.deleteMany({ studentId: student._id });
        }
        await User.deleteMany({ _id: { $in: validIds } });

        logger.info('Bulk student delete', { count: validIds.length, teacherId: req.session.userId });
        res.json({ success: true, message: `${validIds.length} student(s) deleted successfully` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// === SEARCH / FILTER ===
app.get('/api/search-tests', isTeacher, async (req, res) => {
    try {
        const query = (req.query.q || '').trim();
        let tests;
        if (query) {
            tests = await Test.find({ $or: [{ title: { $regex: query } }] });
        } else {
            tests = await Test.find({});
        }
        res.json(tests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === FEEDBACK ===
app.get('/feedback', csrfProtection, async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        let submissions = [];
        if (req.session.userRole === CONSTANTS.ROLES.TEACHER || req.session.userRole === CONSTANTS.ROLES.ADMIN) {
            submissions = await Submission.find({ $or: [{ teacherId: req.session.userId }, { studentId: req.session.userId }] });
        } else {
            submissions = await Submission.find({ studentId: req.session.userId });
        }

        const feedbacks = await Feedback.find({});
        res.render('feedback', { submissions, feedbacks, csrfToken: req.csrfToken() });
    } catch (err) {
        logger.error('Feedback page error', { error: err.message });
        res.status(500).send('Error loading feedback page');
    }
});

app.post('/feedback', csrfProtection, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        // Removed 3 unused parallel queries (submissions, tests, students) —
        // they were never referenced after fetch, wasting ~3 DB round-trips per submission.

        const feedback = await Feedback.create({
            teacherId: req.session.userId,
            ...req.body
        });

        res.json({ success: true, feedback });
    } catch (err) {
        logger.error('Create feedback error', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

app.post('/feedback/:id/reply', isTeacher, csrfProtection, async (req, res) => {
    try {
        await Feedback.findByIdAndUpdate(req.params.id, {
            reply: req.body.reply,
            repliedAt: new Date()
        });

        // Notify student
        const feedback = await Feedback.findById(req.params.id);
        if (feedback && feedback.studentId) {
            await Notification.create({
                userId: feedback.studentId,
                type: 'feedback_reply',
                title: 'Teacher replied to your feedback',
                message: req.body.reply ? req.body.reply.substring(0, 100) : 'You have a new reply',
                relatedId: req.params.id,
                isRead: 0
            });
        }

        logger.info('Reply sent to student', { feedbackId: req.params.id, teacherId: req.session.userId });
        res.json({ success: true });
    } catch (err) {
        logger.error('Reply error', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// === EXPORT ===
app.get('/export-csv', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const submissions = await Submission.find({ teacherId: req.session.userId });

        const history = submissions.map(sub => ({
            'Student Name': sub.studentName || 'N/A',
            'Test Type': sub.type || 'N/A',
            'Score': sub.score || 'N/A',
            'Total Questions': sub.totalQuestions || 'N/A',
            'Percentage': sub.percentage ? sub.percentage + '%' : 'N/A',
            'Band': sub.band || 'N/A',
            'Date': sub.lastSubmittedAt || sub.firstSubmittedAt || 'N/A'
        }));

        const csv = [
            Object.keys(history[0] || {}).join(','),
            ...history.map(row => Object.values(row).map(v => `"${v}"`).join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="submissions.csv"');
        res.send(csv);
    } catch (err) {
        logger.error('CSV export error', { error: err.message });
        res.status(500).send('Error exporting CSV');
    }
});

app.get('/export-history', isTeacher, async (req, res) => {
    try {
        const submissions = await Submission.find({ teacherId: req.session.userId });
        res.json(submissions);
    } catch (err) {
        res.status(500).send('Error exporting history');
    }
});

app.get('/settings/export-report', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId);
        const submissions = await Submission.find({ studentId: req.session.userId });

        const totalTests = submissions.length;
        const scoredSubs = submissions.filter(s => s.percentage);
        const avgScore = scoredSubs.length > 0
            ? scoredSubs.reduce((sum, s) => sum + Number(s.percentage), 0) / scoredSubs.length
            : 0;

        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Progress Report - ${user.username}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
        h1 { color: #667eea; border-bottom: 3px solid #667eea; padding-bottom: 10px; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 30px 0; }
        .stat-box { padding: 20px; background: #f8fafc; border-radius: 12px; border-left: 4px solid #667eea; }
        .stat-value { font-size: 2rem; font-weight: bold; color: #667eea; }
        .stat-label { color: #64748b; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 30px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #667eea; color: white; font-weight: bold; }
        tr:hover { background: #f8fafc; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; color: #64748b; text-align: center; }
    </style>
</head>
<body>
    <h1>Progress Report</h1>
    <p><strong>Student:</strong> ${user.username}</p>
    <p><strong>Member Since:</strong> ${new Date(user.createdAt).toLocaleDateString()}</p>
    <p><strong>Report Generated:</strong> ${new Date().toLocaleString()}</p>
    
    <div class="stats">
        <div class="stat-box">
            <div class="stat-value">${totalTests}</div>
            <div class="stat-label">Total Tests Taken</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${Math.round(avgScore)}%</div>
            <div class="stat-label">Average Score</div>
        </div>
    </div>
    
    <h2>Test History</h2>
    <table>
        <thead>
            <tr>
                <th>Test</th>
                <th>Type</th>
                <th>Score</th>
                <th>Percentage</th>
                <th>Date</th>
            </tr>
        </thead>
        <tbody>
            ${submissions.map(sub => `
            <tr>
                <td>${sub.testId || 'Unknown'}</td>
                <td style="text-transform: capitalize;">${sub.type || 'N/A'}</td>
                <td>${sub.score || 'N/A'}/${sub.totalQuestions || 'N/A'}</td>
                <td>${sub.percentage || 'N/A'}%</td>
                <td>${new Date(sub.lastSubmittedAt || sub.firstSubmittedAt).toLocaleDateString()}</td>
            </tr>
            `).join('')}
        </tbody>
    </table>
    
    <div class="footer">
        <p>Generated by IELTS Test Platform</p>
    </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="${user.username}_progress_report.html"`);
        res.send(html);
    } catch (err) {
        res.status(500).send('Error generating report');
    }
});

// === SCHEDULED TEST ACCESS ===
app.post('/teacher/assign-test-group', isTeacher, csrfProtection, async (req, res) => {
    const { testId, groupId, scheduleType, availableFrom } = req.body;
    try {
        const group = await Group.findByIdWithStudents(groupId);
        if (!group) return res.status(404).send("Group not found.");
        if (req.session.userRole !== 'admin' && String(group.teacherId) !== String(req.session.userId)) {
            return res.status(403).send("Not authorized to assign tests to this group.");
        }
        const access = await getAccessibleTest(req, testId);
        if (!access.test || !access.isAllowed) return res.status(403).send("You do not have access to this test.");

        await Group.findByIdAndUpdate(groupId, { $addToSet: { assignedTests: testId } });

        if (scheduleType === 'scheduled' && availableFrom) {
            await Group.findByIdAndUpdate(groupId, {
                $push: { testSchedule: { testId, availableFrom: new Date(availableFrom) } }
            });

            // Notify students
            if (group.students && group.students.length > 0) {
                const notifications = group.students.map(student => ({
                    userId: typeof student === 'object' ? student._id : student,
                    type: 'test_assigned',
                    title: 'New test scheduled',
                    message: `A new test will be available on ${new Date(availableFrom).toLocaleString()}`,
                    relatedId: testId,
                    isRead: 0
                }));
                await Notification.insertMany(notifications);
            }

            await Notification.create({
                userId: req.session.userId,
                type: 'general',
                title: 'Test Scheduled',
                message: `Test "${access.test.title}" scheduled for group "${group.name}" on ${new Date(availableFrom).toLocaleString()}`,
                relatedId: testId,
                isRead: 0
            });
        } else {
            if (group.students && group.students.length > 0) {
                const notifications = group.students.map(student => ({
                    userId: typeof student === 'object' ? student._id : student,
                    type: 'test_assigned',
                    title: 'New test assigned',
                    message: `A new test "${access.test.title}" has been assigned to your group`,
                    relatedId: testId,
                    isRead: 0
                }));
                await Notification.insertMany(notifications);
            }

            await Notification.create({
                userId: req.session.userId,
                type: 'general',
                title: 'Test Assigned',
                message: `Test "${access.test.title}" assigned to group "${group.name}" (${(group.students || []).length} students)`,
                relatedId: testId,
                isRead: 0
            });
        }

        logger.info('Test assigned to group', { testId, groupId, scheduleType, teacherId: req.session.userId });
        res.redirect('/teacher-dashboard');
    } catch (err) {
        res.status(500).send("Error assigning test.");
    }
});

// === ADMIN LOG VIEWER ===
app.get('/admin/logs', isAdmin, csrfProtection, async (req, res) => {
    try {
        const level = (req.query.level || 'info').toLowerCase();
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const PAGE_SIZE = 50;
        const logFile = path.join(__dirname, 'logs', `${level}.log`);

        if (!fs.existsSync(logFile)) {
            return res.json({ entries: [], total: 0, page, totalPages: 0 });
        }

        const raw = await fs.promises.readFile(logFile, 'utf8');
        const lines = raw.trim().split('\n').filter(Boolean).reverse();
        const total = lines.length;
        const totalPages = Math.ceil(total / PAGE_SIZE);
        const entries = lines
            .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
            .map(line => { try { return JSON.parse(line); } catch { return { raw: line }; } });

        res.json({ entries, total, page, totalPages, level });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === CACHE STATISTICS ===
app.get('/admin/cache-stats', isAdmin, csrfProtection, (req, res) => {
    const stats = cache.getStats();
    const keys = cache.keys();

    res.json({
        success: true,
        stats: {
            keys: stats.keys,
            hits: stats.hits,
            misses: stats.misses,
            hitRate: stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%' : '0%',
            ksize: stats.ksize,
            vsize: stats.vsize
        },
        cachedKeys: keys.map(key => ({
            key,
            ttl: cache.getTtl(key)
        }))
    });
});

app.post('/admin/clear-cache', isAdmin, csrfProtection, (req, res) => {
    cache.flushAll();
    res.json({ success: true, message: 'Cache cleared' });
});

// === DIAGNOSTIC ENDPOINT (admin-only) ===
// Visit: https://your-site.com/api/debug/oracle-data
app.get('/api/debug/oracle-data', isAdmin, async (req, res) => {
    try {
        const { execute } = require('./database/connection');

        // Raw counts
        const usersResult = await execute(`SELECT COUNT(*) AS cnt FROM users`);
        const testsResult = await execute(`SELECT COUNT(*) AS cnt FROM tests`);
        const groupsResult = await execute(`SELECT COUNT(*) AS cnt FROM groups`);

        // Sample tests (first 5, raw)
        const sampleTests = await execute(
            `SELECT id, title, type, teacher_name, created_by, folder, created_at FROM tests WHERE ROWNUM <= 5 ORDER BY created_at DESC`
        );

        // Sample users (first 5)
        const sampleUsers = await execute(
            `SELECT id, username, role FROM users WHERE ROWNUM <= 5 ORDER BY id ASC`
        );

        // Test via the model to see what comes back
        const Test = require('./database/models/test');
        const modelTests = await Test.find({});
        const modelUsers = await require('./database/models/user').find({});

        res.json({
            success: true,
            rawCounts: {
                users: usersResult.rows[0].CNT,
                tests: testsResult.rows[0].CNT,
                groups: groupsResult.rows[0].CNT
            },
            sampleTests: sampleTests.rows,
            sampleUsers: sampleUsers.rows,
            modelResults: {
                testsViaModel: modelTests.length,
                usersViaModel: modelUsers.length,
                firstTestTitle: modelTests.length > 0 ? modelTests[0].title : null,
                firstTestType: modelTests.length > 0 ? modelTests[0].type : null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, stack: err.stack });
    }
});

// === ANALYTICS ===
app.get('/analytics', isTeacher, async (req, res) => {
    try {
        const teacherId = req.session.userId;
        const isAdminUser = req.session.role === 'admin';

        // Only admins create tests — skip wasteful Test.find for teachers
        const testPromise = isAdminUser
            ? Test.find({ createdBy: teacherId })
            : Promise.resolve([]);

        const [submissions, tests, students] = await Promise.all([
            Submission.find({ teacherId }),
            testPromise,
            User.find({ teacherId, role: 'student' })
        ]);

        res.render('analytics', { submissions, tests, students });
    } catch (err) {
        logger.error('Analytics error', { error: err.message });
        res.status(500).send('Error loading analytics');
    }
});

// === NOTIFICATIONS ===
app.get('/api/notifications', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        const notifications = await Notification.find({ userId: req.session.userId });
        const unreadCount = notifications.filter(n => !n.isRead).length;
        res.json({ success: true, notifications, unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/notifications/mark-read', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        await Notification.updateMany(
            { userId: req.session.userId, isRead: 0 },
            { isRead: 1 }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notifications/mark-all-read', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        await Notification.updateMany(
            { userId: req.session.userId, isRead: 0 },
            { isRead: 1 }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notifications/:id/read', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === SETTINGS ===
app.get('/settings', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId);
        res.render('settings', { user });
    } catch (err) {
        res.status(500).send('Error loading settings');
    }
});

app.post('/settings/change-password', csrfProtection, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) return res.status(400).json({ error: 'Current password is incorrect' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(req.session.userId, { password: hashedPassword });

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === LISTENING EXPORT ===
app.get('/export-listening/:testId', isTeacher, async (req, res) => {
    try {
        const test = await Test.findById(req.params.testId);
        if (!test) return res.status(404).send('Test not found');
        res.render('export-listening', { test });
    } catch (err) {
        res.status(500).send('Error exporting listening test');
    }
});

app.get('/export-reading/:testId', isTeacher, async (req, res) => {
    try {
        const test = await Test.findById(req.params.testId);
        if (!test) return res.status(404).send('Test not found');
        res.render('export-reading', { test });
    } catch (err) {
        res.status(500).send('Error exporting reading test');
    }
});

app.get('/export-writing/:testId', isTeacher, async (req, res) => {
    try {
        const test = await Test.findById(req.params.testId);
        if (!test) return res.status(404).send('Test not found');
        res.render('export-writing', { test });
    } catch (err) {
        res.status(500).send('Error exporting writing test');
    }
});

// === ROOT REDIRECT ===
app.get('/', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    if (req.session.userRole === CONSTANTS.ROLES.ADMIN) return res.redirect('/admin');
    if (req.session.userRole === CONSTANTS.ROLES.TEACHER) return res.redirect('/teacher-dashboard');
    res.redirect('/student-dashboard');
});

// Oracle-missing routes (aliases + new handlers) — must be before 404 handler
require('./routes/missing-routes')(app, {
    csrfProtection, apiLimiter, isTeacher, isAdmin,
    canEditTest, getAccessibleTest, saveStudentSubmission
});

// 404 Handler
app.use((req, res) => {
    res.status(404).render('error', {
        message: 'Page not found',
        error: { status: 404 }
    });
});

// Import error handlers
const { csrfErrorHandler, errorHandler } = require('./middleware/errorHandler');

// CSRF error handler
app.use(csrfErrorHandler);

// Sentry error handler
if (process.env.SENTRY_DSN) {
    app.use(Sentry.Handlers.errorHandler());
}

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(err.status || 500).render('error', {
        message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
        error: process.env.NODE_ENV === 'production' ? {} : err
    });
});

// === START SERVER ===
async function startServer() {
    await connectDatabase();

    // ---- AUTO-MIGRATION ON RENDER (no Shell tab needed) ----
    // Set DO_MIGRATE=true env var on Render → deploy → check logs → remove env var
    if (process.env.DO_MIGRATE === 'true') {
        console.log('========================================');
        console.log('DO_MIGRATE=true detected — running MongoDB → Oracle migration...');
        console.log('========================================');
        try {
            // migrate-to-oracle.js exports { migrate } for direct use
            const { migrate } = require('./migrate-to-oracle');
            await migrate({ keepPoolAlive: true });
            console.log('========================================');
            console.log('✅ Migration completed successfully!');
            console.log('========================================');
        } catch (err) {
            console.error('========================================');
            console.error('Migration FAILED:', err.message);
            console.error(err.stack);
            console.error('========================================');
            // Don't crash — still start the server so you can check logs
        }
    }

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        logger.info(`Oracle-mode server running on port ${PORT}`);
        console.log(`Server running on http://localhost:${PORT}`);
    });

    // Periodic pool health check
    setInterval(async () => {
        try {
            const pool = await getPool();
            const conn = await pool.getConnection();
            await conn.execute('SELECT 1 FROM dual');
            await conn.close();
            poolReady = true;
        } catch (err) {
            logger.warn('Oracle health check failed', { error: err.message });
            poolReady = false;
            // Try reconnecting
            connectDatabase();
        }
    }, 30000);

    // Schedule automated daily backups at 2 AM
    if (process.env.NODE_ENV === 'production') {
        cron.schedule('0 2 * * *', async () => {
            console.log('🔄 Running scheduled database backup...');
            try {
                await backupDatabase({ closeConnection: false });
                console.log('✅ Scheduled backup completed');
            } catch (error) {
                console.error('❌ Scheduled backup failed:', error.message);
            }
        });
        console.log('⏰ Automated daily backups scheduled for 2:00 AM');

        // Schedule AI analysis cleanup: trim aiAnalysis from submissions older than 60 days
        cron.schedule('30 3 * * *', async () => {
            console.log('🧹 Running AI analysis cleanup (60-day retention)...');
            try {
                const { execute } = require('./database/connection');
                const result = await execute(
                    `UPDATE submissions
                     SET details = JSON_MERGEPATCH(details, JSON_OBJECT('aiAnalysis' VALUE NULL))
                     WHERE JSON_EXISTS(details, '$.aiAnalysis')
                       AND last_submitted_at < SYSTIMESTAMP - INTERVAL '60' DAY`
                );
                console.log(`✅ AI analysis cleaned from ${result.rowsAffected || 0} submissions`);
            } catch (error) {
                console.error('❌ AI analysis cleanup failed:', error.message);
            }
        });
        console.log('⏰ AI analysis cleanup scheduled for 3:30 AM daily');
    }
}

startServer();

module.exports = app;
