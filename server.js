require('dotenv').config();

// Validate environment variables before starting
const { validateEnv, getConfig, logConfig } = require('./utils/config');
try {
    validateEnv();
    logConfig();
} catch (error) {
    console.error('? Environment validation failed:', error.message);
    process.exit(1);
}

const config = getConfig();

// Initialize Sentry for error monitoring
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0,
    });
    console.log('✅ Sentry error monitoring initialized');
}

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const multer = require("multer");
const mime = require('mime-types');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const { generateHTMLFromTest, stringifyContent, injectPersistentStateForDownload } = require('./utils/htmlExporter');
const { getAuthoringPageHtml } = require('./utils/builderAuthoring');
const { backupDatabase } = require('./backup-database');

// Initialize cache (TTL = 10 minutes)
const cache = new NodeCache({
    stdTTL: 600, // 10 minutes
    checkperiod: 120, // Check for expired keys every 2 minutes
    useClones: false // Don't clone objects (faster)
});

// Import utilities
const CONSTANTS = require('./utils/constants');
const { validateUsername, validatePassword, validateTestTitle, validateTestType, validateObjectId, safeJSONParse, sanitizeString } = require('./utils/validation');
const logger = require('./utils/logger');
const xss = require('xss');
const { analyzeReadingTest, analyzeListeningTest, detectPatterns } = require('./utils/aiAnalysis');

if (process.env.NODE_ENV !== 'production') {
    logger.debug('B2 Configuration', {
        endpoint: process.env.B2_ENDPOINT,
        bucket: process.env.B2_BUCKET,
        publicUrl: process.env.B2_PUBLIC_URL,
        keyId: process.env.B2_KEY_ID ? 'SET' : 'MISSING',
        appKey: process.env.B2_APP_KEY ? 'SET' : 'MISSING'
    });
}

const s3 = new S3Client({
    endpoint: process.env.B2_ENDPOINT,
    region: 'us-west-004',
    credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APP_KEY
    },
    forcePathStyle: true
});

async function uploadToB2(buffer, filename, mimetype) {
    await s3.send(new PutObjectCommand({
        Bucket: process.env.B2_BUCKET,
        Key: filename,
        Body: buffer,
        ContentType: mimetype,
        ACL: 'public-read'
    }));
    return `${process.env.B2_PUBLIC_URL}/${filename}`;
}

function extractB2Filename(value) {
    const filename = path.basename(String(value || ''));
    if (!/^listening-[a-zA-Z0-9_-]+-\d+\.[a-zA-Z0-9]+$/.test(filename)) return null;
    return filename;
}
const app = express();

// Trust proxy - required for Render/Heroku/behind reverse proxy
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));

// --- 1. DATABASE CONNECTION ---
// Set mongoose connection options for better stability
mongoose.set('strictQuery', false);
mongoose.set('bufferCommands', true);

const mongoConnectionOptions = {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 60000,
    connectTimeoutMS: 30000,
    heartbeatFrequencyMS: 10000,
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 60000,
    retryWrites: true
};

function isDatabaseReady() {
    return mongoose.connection.readyState === 1;
}

function sendDatabaseUnavailable(res) {
    res.status(503).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="refresh" content="5">
            <title>Database Reconnecting</title>
            <style>
                body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
                .card { background: #fff; border-radius: 20px; padding: 28px; max-width: 520px; box-shadow: 0 18px 50px rgba(15,23,42,0.12); text-align: center; }
                h1 { margin: 0 0 12px; font-size: 24px; }
                p { color: #475569; line-height: 1.5; margin: 0; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Database is reconnecting</h1>
                <p>Please wait a few seconds. This page will refresh automatically.</p>
            </div>
        </body>
        </html>
    `);
}

// Connect to MongoDB with proper error handling
async function connectDatabase() {
    try {
        await mongoose.connect(process.env.MONGO_URI, mongoConnectionOptions);
        logger.info('Connected to MongoDB successfully');
    } catch (err) {
        logger.error('Database connection error', { error: err.message, stack: err.stack });
        process.exit(1);
    }
}

mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected', { readyState: mongoose.connection.readyState }));
mongoose.connection.on('error', err => logger.error('MongoDB connection error', { error: err.message }));
mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

// --- 2. MODELS ---
const User = require('./models/User');
const Test = require('./models/Test');
const Group = require('./models/Group');
const Submission = require('./models/Submission');
const Feedback = require('./models/Feedback');
const Notification = require('./models/Notification');

// --- 3. MIDDLEWARE & SETTINGS ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use(cookieParser());

// --- STORAGE CONFIGURATION ---
const fs = require('fs');

// Use memory storage — files go to B2, not local disk
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: CONSTANTS.FILE_UPLOAD.MAX_FILE_SIZE,
        files: CONSTANTS.FILE_UPLOAD.MAX_FILES
    },
    fileFilter(req, file, cb) {
        if (CONSTANTS.FILE_UPLOAD.ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type: ${file.mimetype}. Only audio files are allowed.`));
        }
    }
});

const sessionStore = MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    mongoOptions: mongoConnectionOptions,
    touchAfter: 24 * 3600,
    ttl: 24 * 60 * 60,
    autoRemove: 'native'
});

sessionStore.on('error', (err) => {
    logger.error('Mongo session store error', { error: err.message, stack: err.stack });
});

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    },
    rolling: true,
    name: 'sessionId'
}));

// Normalize session userId to string (handles legacy sessions stored as ObjectId objects)
app.use((req, res, next) => {
    if (req.session && req.session.userId != null) {
        const raw = req.session.userId;
        if (typeof raw === 'object' && raw._bsontype === 'ObjectId') {
            req.session.userId = raw.toString();
        } else if (Buffer.isBuffer(raw)) {
            req.session.userId = raw.toString('hex');
        } else if (typeof raw !== 'string') {
            req.session.userId = String(raw);
        }
    }
    next();
});

const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: "Too many login attempts. Please wait a minute and try again.",
    standardHeaders: true,
    legacyHeaders: false
});

// Strict limiter for sensitive operations
const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per 15 minutes
    message: "Too many attempts. Please try again later.",
    standardHeaders: true,
    legacyHeaders: false
});

// Moderate limiter for API endpoints
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: "Too many requests. Please slow down.",
    standardHeaders: true,
    legacyHeaders: false
});

// Test creation limiter
const testCreationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 tests per minute
    message: "Too many tests created. Please wait a moment.",
    standardHeaders: true,
    legacyHeaders: false
});

const csrfProtection = csrf({ cookie: true });

// --- 4. AUTHENTICATION GATEKEEPERS ---

function isAdmin(req, res, next) {
    if (req.session.userId && req.session.userRole === 'admin') {
        return next();
    }
    res.redirect('/login');
}

function isTeacher(req, res, next) {
    if (req.session.userId && (req.session.userRole === 'teacher' || req.session.userRole === 'admin')) {
        return next();
    }
    res.redirect('/login');
}

async function canEditTest(req, testId) {
    if (!req.session.userId) return false;
    if (req.session.userRole === 'admin') return true;

    const test = await Test.findById(testId).select('createdBy');
    if (!test) return false;
    return Boolean(test.createdBy && String(test.createdBy) === String(req.session.userId));
}

function groupTestsByType(tests = []) {
    const grouped = {
        reading: [],
        listening: [],
        writing: []
    };

    tests.forEach((test) => {
        const normalizedType = String(test.type || 'reading').toLowerCase();
        if (!grouped[normalizedType]) {
            grouped[normalizedType] = [];
        }
        grouped[normalizedType].push(test);
    });

    return grouped;
}

function roundPercentage(score, totalQuestions) {
    if (!Number.isFinite(score) || !Number.isFinite(totalQuestions) || totalQuestions <= 0) {
        return null;
    }

    return Math.round((score / totalQuestions) * 100);
}

async function getAccessibleTest(req, testId) {
    // Check cache first
    const cacheKey = `test_access_${testId}_${req.session.userId}`;
    let cachedResult = cache.get(cacheKey);

    if (cachedResult) {
        logger.debug('Cache HIT for test access', { testId, userId: req.session.userId });
        return cachedResult;
    }

    const [user, test] = await Promise.all([
        User.findById(req.session.userId).select('role assignedTests groupId teacherId username'),
        Test.findById(testId)
    ]);

    if (!user || !test) {
        return { user, test: null, isAllowed: false };
    }

    if (user.role === 'admin') {
        const result = { user, test, isAllowed: true };
        cache.set(cacheKey, result, 300); // Cache for 5 minutes
        return result;
    }

    if (user.role === 'teacher') {
        const ownsTest = test.createdBy && String(test.createdBy) === String(user._id);
        const hasDirectAssignment = Array.isArray(user.assignedTests)
            && user.assignedTests.some((assignedTestId) => String(assignedTestId) === String(test._id));

        let hasGroupAssignment = false;
        if (!ownsTest && !hasDirectAssignment) {
            hasGroupAssignment = Boolean(await Group.exists({
                teacherId: user._id,
                assignedTests: test._id
            }));
        }

        const result = {
            user,
            test,
            isAllowed: ownsTest || hasDirectAssignment || hasGroupAssignment
        };
        cache.set(cacheKey, result, 300); // Cache for 5 minutes
        return result;
    }

    if (user.role === 'student' && user.groupId) {
        const hasGroupAccess = Boolean(await Group.exists({
            _id: user.groupId,
            assignedTests: test._id
        }));

        const result = { user, test, isAllowed: hasGroupAccess };
        cache.set(cacheKey, result, 300); // Cache for 5 minutes
        return result;
    }

    return { user, test, isAllowed: false };
}

async function saveStudentSubmission({ req, payload }) {
    const student = await User.findById(req.session.userId).select('role username teacherId groupId');
    if (!student || student.role !== 'student') {
        return { ignored: true };
    }

    const access = await getAccessibleTest(req, payload.testId);
    if (!access.test || !access.isAllowed) {
        throw new Error('You are not allowed to submit this test.');
    }

    const normalizedType = String(payload.type || access.test.type || '').toLowerCase();
    const resultSignature = String(payload.resultSignature || '').trim();
    const existing = await Submission.findOne({
        testId: access.test._id,
        studentId: student._id
    });

    const details = {
        ...(existing?.details || {}),
        ...(payload.details || {}),
        resultSignature,
        testTitle: access.test.title
    };

    if (normalizedType === 'reading' || normalizedType === 'listening') {
        details.incorrectSummary = payload.incorrectSummary || '';
        details.summaryText = payload.summaryText || '';
    }

    if (normalizedType === 'writing') {
        details.task1 = payload.task1 || '';
        details.task2 = payload.task2 || '';
    }

    const nextAttemptCount = existing
        ? (existing.details?.resultSignature === resultSignature ? existing.attemptCount : existing.attemptCount + 1)
        : 1;

    const submissionPayload = {
        teacherId: student.teacherId || null,
        groupId: student.groupId || null,
        type: normalizedType,
        studentName: String(payload.studentName || student.username || 'Student').trim(),
        status: 'completed',
        attemptCount: nextAttemptCount,
        score: Number.isFinite(Number(payload.score)) ? Number(payload.score) : null,
        totalQuestions: Number.isFinite(Number(payload.totalQuestions)) ? Number(payload.totalQuestions) : null,
        percentage: Number.isFinite(Number(payload.percentage))
            ? Number(payload.percentage)
            : roundPercentage(Number(payload.score), Number(payload.totalQuestions)),
        band: payload.band ? String(payload.band) : null,
        wordCount1: Number.isFinite(Number(payload.wordCount1)) ? Number(payload.wordCount1) : null,
        wordCount2: Number.isFinite(Number(payload.wordCount2)) ? Number(payload.wordCount2) : null,
        timeRemainingText: String(payload.timeRemainingText || '').trim(),
        details
    };

    let submission;
    const isNewSubmission = !existing;

    if (existing) {
        Object.assign(existing, submissionPayload);
        await existing.save();
        submission = existing;
    } else {
        submission = new Submission({
            testId: access.test._id,
            studentId: student._id,
            ...submissionPayload
        });
        await submission.save();
    }

    // Run AI analysis for Reading and Listening tests (async, don't wait)
    if (isNewSubmission && (normalizedType === 'reading' || normalizedType === 'listening')) {
        setImmediate(async () => {
            try {
                let aiResult;
                if (normalizedType === 'reading') {
                    aiResult = await analyzeReadingTest(submission, access.test);
                } else if (normalizedType === 'listening') {
                    aiResult = await analyzeListeningTest(submission, access.test);
                }

                if (aiResult && aiResult.success) {
                    submission.details.aiAnalysis = aiResult.analysis;
                    submission.details.aiAnalyzedAt = aiResult.analyzedAt;
                    await submission.save();
                    logger.info('AI analysis saved', { submissionId: submission._id });
                }
            } catch (error) {
                logger.error('AI analysis failed', { error: error.message, submissionId: submission._id });
            }
        });
    }

    // NOTIFICATION LOGIC FOR TEACHERS
    if (student.teacherId && isNewSubmission) {
        // 1. Notify teacher about new submission
        await Notification.create({
            userId: student.teacherId,
            type: 'test_submitted',
            title: 'New Test Submission',
            message: `${student.username} completed "${access.test.title}"`,
            relatedId: access.test._id
        });

        // 2. Check if all students in group completed the test
        if (student.groupId) {
            const group = await Group.findById(student.groupId).populate('students');
            if (group) {
                const totalStudents = group.students.length;
                const completedCount = await Submission.countDocuments({
                    testId: access.test._id,
                    groupId: student.groupId
                });

                if (completedCount === totalStudents) {
                    await Notification.create({
                        userId: student.teacherId,
                        type: 'group_completed',
                        title: 'Group Completed Test',
                        message: `All students in "${group.name}" completed "${access.test.title}"`,
                        relatedId: access.test._id
                    });
                }
            }
        }

        // 3. Low score alert (if score is below 50%)
        if (submissionPayload.percentage && submissionPayload.percentage < 50) {
            await Notification.create({
                userId: student.teacherId,
                type: 'low_score_alert',
                title: 'Low Score Alert',
                message: `${student.username} scored ${submissionPayload.percentage}% on "${access.test.title}"`,
                relatedId: access.test._id
            });
        }
    }

    return { ignored: false, submission };
}

async function saveValidatedTest({ title, type, content, builderJson, req }) {
    logger.debug('Saving validated test', {
        title,
        type,
        hasBuilderJson: !!builderJson,
        builderJsonLength: builderJson ? String(builderJson).length : 0
    });
    if (!title || !String(title).trim()) {
        throw new Error('Test title is required.');
    }

    const serializedContent = stringifyContent(content);

    // Validate against the builder-matched renderer before saving.
    generateHTMLFromTest({
        _id: new mongoose.Types.ObjectId(),
        title,
        type,
        readingPassage: serializedContent
    }, {
        groqApiKey: process.env.GROQ_API_KEY || ''
    });

    const newTest = new Test({
        title: String(title).trim(),
        type,
        teacherName: req.session.username,
        createdBy: req.session.userId,
        readingPassage: serializedContent,
        builderJson: builderJson || null
    });

    await newTest.save();
    return newTest;
}

// --- 5. ERROR HANDLER & HELPERS ---

/**
 * Generic delete handler for reducing code duplication
 * Handles deletion of: tests, students, teachers, groups
 */
async function handleDelete(req, res, options) {
    const { model, modelName, idParam, authCheck, preDelete, postDelete } = options;

    if (!req.session.userId) return res.redirect('/login');

    try {
        const id = req.params[idParam];

        // Validate ID format
        const idValidation = validateObjectId(id);
        if (!idValidation.valid) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).json({
                success: false,
                message: idValidation.error
            });
        }

        const doc = await model.findById(id);
        if (!doc) {
            return res.status(CONSTANTS.STATUS.NOT_FOUND).json({
                success: false,
                message: `${modelName} not found`
            });
        }

        // Check authorization
        const authResult = await authCheck(req, doc);
        if (!authResult.allowed) {
            logger.warn(`Unauthorized delete attempt for ${modelName}`, {
                userId: req.session.userId,
                documentId: id
            });
            return res.status(CONSTANTS.STATUS.FORBIDDEN).json({
                success: false,
                message: authResult.message || 'Not authorized'
            });
        }

        // Execute pre-delete operations
        if (preDelete) {
            await preDelete(doc);
        }

        // Delete the document
        await model.findByIdAndDelete(id);

        // Execute post-delete operations
        if (postDelete) {
            await postDelete(doc);
        }

        logger.info(`${modelName} deleted successfully`, {
            userId: req.session.userId,
            documentId: id
        });

        res.json({
            success: true,
            message: `${modelName} deleted successfully`,
            redirect: req.body.redirect || '/teacher-dashboard'
        });
    } catch (err) {
        logger.error(`Error deleting ${modelName}`, {
            error: err.message,
            userId: req.session.userId
        });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: `Error deleting ${modelName}: ${err.message}`
        });
    }
}

// --- 6. ROUTES ---

app.get('/audio-files/:filename', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Login required');

    try {
        const filename = extractB2Filename(req.params.filename);
        logger.debug('Audio proxy request', { 
            requestedFilename: req.params.filename, 
            extractedFilename: filename,
            bucket: process.env.B2_BUCKET
        });
        
        if (!filename) {
            logger.warn('Invalid audio filename', { filename: req.params.filename });
            return res.status(400).send('Invalid audio file');
        }

        const rangeHeader = req.headers.range;
        const object = await s3.send(new GetObjectCommand({
            Bucket: process.env.B2_BUCKET,
            Key: filename,
            Range: rangeHeader
        }));

        const contentType = object.ContentType || mime.lookup(filename) || 'audio/mpeg';
        if (rangeHeader && object.ContentRange) {
            res.status(206);
            res.setHeader('Content-Range', object.ContentRange);
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        if (object.ContentLength) res.setHeader('Content-Length', object.ContentLength);

        object.Body.pipe(res);
    } catch (err) {
        logger.error('Audio proxy error', { error: err.message, filename: req.params.filename });
        res.status(404).send('Audio not found');
    }
});

app.get('/', (req, res) => {
    res.render('index', { user: req.session.username });
});

app.get('/login', csrfProtection, (req, res) => {
    if (req.session.userId) { const role = req.session.userRole; if (role === 'admin') return res.redirect('/admin'); if (role === 'teacher') return res.redirect('/teacher-dashboard'); if (role === 'student') return res.redirect('/student-dashboard'); } res.render('login', { csrfToken: req.csrfToken() });
});

app.post('/login', loginLimiter, csrfProtection, async (req, res) => {
    const { username, password } = req.body;
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const user = await User.findOne({ username });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id.toString();
            req.session.userRole = user.role;
            req.session.username = user.username;

            req.session.save((err) => {
                if (err) {
                    logger.error('Session save error', { error: err.message });
                    return res.status(500).send("Login error. Please try again.");
                }

                if (user.role === 'admin') return res.redirect('/admin');
                if (user.role === 'teacher') return res.redirect('/teacher-dashboard');
                return res.redirect('/student-dashboard');
            });
        } else {
            res.send("Invalid username or password. <a href='/login'>Try again</a>");
        }
    } catch (err) {
        logger.error('Login error', { error: err.message });
        res.status(500).send("Login error.");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- ADMIN ROUTES ---

app.get('/admin', isAdmin, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const tests = await Test.find({}).sort({ type: 1, title: 1 });
        const teachers = await User.find({ role: 'teacher' }).populate('assignedTests');
        res.render('admin', {
            tests,
            teachers,
            testsByType: groupTestsByType(tests),
            csrfToken: req.csrfToken()
        });
    } catch (err) {
        res.status(500).send("Error loading dashboard data.");
    }
});

app.get('/create-test', isAdmin, (req, res) => {
    res.render('create-test-hub');
});

app.get('/create-test/reading', isAdmin, csrfProtection, (req, res) => {
    const html = getAuthoringPageHtml('reading');
    const htmlWithCsrf = html.replace('<head>', `<head>\n<meta name="csrf-token" content="${req.csrfToken()}">`);
    res.send(htmlWithCsrf);
});

app.get('/create-test/listening', isAdmin, csrfProtection, (req, res) => {
    const html = getAuthoringPageHtml('listening');
    const htmlWithCsrf = html.replace('<head>', `<head>\n<meta name="csrf-token" content="${req.csrfToken()}">`);
    res.send(htmlWithCsrf);
});

app.get('/create-test/writing', isAdmin, csrfProtection, (req, res) => {
    const html = getAuthoringPageHtml('writing');
    const htmlWithCsrf = html.replace('<head>', `<head>\n<meta name="csrf-token" content="${req.csrfToken()}">`);
    res.send(htmlWithCsrf);
});

// --- EDIT TEST ROUTES ---
app.get('/edit-test/:id', isTeacher, csrfProtection, async (req, res) => {
    try {
        const allowed = await canEditTest(req, req.params.id);
        if (!allowed) {
            return res.status(403).send('Not authorized to edit this test.');
        }

        const test = await Test.findById(req.params.id);
        if (!test) {
            return res.status(404).send("Test not found.");
        }
        logger.debug('Loading test for editing', {
            testId: test._id,
            hasBuilderJson: !!test.builderJson,
            builderJsonLength: test.builderJson ? String(test.builderJson).length : 0
        });

        // Send builder HTML with the test data pre-loaded
        const builderHtml = getAuthoringPageHtml(test.type, test);
        const htmlWithCsrf = builderHtml.replace('<head>', `<head>\n<meta name="csrf-token" content="${req.csrfToken()}">`);
        res.send(htmlWithCsrf);
    } catch (err) {
        res.status(500).send("Error loading test for editing: " + err.message);
    }
});

app.post('/update-test/:id', isTeacher, csrfProtection, upload.any(), async (req, res) => {
    try {
        const testId = req.params.id;

        const allowed = await canEditTest(req, testId);
        if (!allowed) {
            return res.status(403).json({ success: false, error: 'Not authorized to edit this test.' });
        }

        const existingTest = await Test.findById(testId);
        if (!existingTest) {
            return res.status(404).json({ success: false, error: 'Test not found.' });
        }

        const type = String(req.body.type || existingTest.type || '').toLowerCase();
        const title = String(req.body.title || '').trim();

        if (!title) {
            return res.status(400).json({ success: false, error: 'Test title is required.' });
        }

        let contentObj;
        if (type === 'listening') {
            const audioUrls = {};
            if (req.files && req.files.length > 0) {
                await Promise.all(req.files.map(async (file) => {
                    const ext = path.extname(file.originalname || '').toLowerCase() || '.mp3';
                    const filename = `listening-${file.fieldname}-${Date.now()}${ext}`;
                    audioUrls[file.fieldname] = await uploadToB2(file.buffer, filename, file.mimetype);
                }));
            }

            const previous = existingTest.readingPassage ? JSON.parse(existingTest.readingPassage) : {};
            const finalFullAudio = audioUrls['audioFile'] || req.body.audioUrl || previous.fullAudio || null;

            const partsPayload = JSON.parse(req.body.parts || '{}');
            const parts = {};
            for (let index = 1; index <= 4; index += 1) {
                const source = partsPayload[index] ?? partsPayload[String(index)] ?? '';
                parts[index] = typeof source === 'string'
                    ? { finalHtml: source }
                    : { ...(source || {}), finalHtml: source?.finalHtml ?? source?.html ?? '' };
            }

            const prevAudioParts = Array.isArray(previous.audioParts) ? previous.audioParts : [];
            contentObj = {
                fullAudio: finalFullAudio,
                audioParts: [
                    audioUrls['part1'] || prevAudioParts[0] || null,
                    audioUrls['part2'] || prevAudioParts[1] || null,
                    audioUrls['part3'] || prevAudioParts[2] || null,
                    audioUrls['part4'] || prevAudioParts[3] || null
                ],
                parts,
                answerKey: JSON.parse(req.body.answerKey || '{}'),
                includePause: req.body.usePause === 'true'
            };
        } else {
            contentObj = req.body.content;
        }

        const serializedContent = stringifyContent(contentObj);

        // Validate against the builder-matched renderer before saving.
        generateHTMLFromTest({
            _id: testId,
            title,
            type,
            readingPassage: serializedContent
        }, {
            groqApiKey: process.env.GROQ_API_KEY || ''
        });

        existingTest.title = title;
        existingTest.readingPassage = serializedContent;
        if (req.body.builderJson) existingTest.builderJson = req.body.builderJson;
        await existingTest.save();

        // Clear cache for this test
        cache.keys().forEach(key => {
            if (key.startsWith(`test_html_${testId}_`) || key.startsWith(`test_access_${testId}_`)) {
                cache.del(key);
            }
        });
        logger.debug('Cache cleared for updated test', { testId });

        logger.info('Test updated successfully', { testId, userId: req.session.userId });
        res.json({ success: true, message: "Test updated successfully." });
    } catch (err) {
        logger.error('Update test error', { error: err.message, stack: err.stack, userId: req.session.userId });
        res.status(500).json({ success: false, error: err.message || "Database update failed." });
    }
});

// --- GENERIC FILE UPLOAD ---
app.post('/upload-test', isAdmin, upload.single('audioFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file uploaded" });
        }
        const ext = path.extname(req.file.originalname || '').toLowerCase() || '.mp3';
        const filename = `listening-audioFile-${Date.now()}${ext}`;
        const fileUrl = await uploadToB2(req.file.buffer, filename, req.file.mimetype);
        res.json({ success: true, url: fileUrl });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- LISTENING TEST UPLOAD ---
app.post('/create-test/listening', isAdmin, csrfProtection, testCreationLimiter, upload.any(), async (req, res) => {
    try {
        // Validate input
        const titleValidation = validateTestTitle(req.body.title);
        if (!titleValidation.valid) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).json({
                success: false,
                error: titleValidation.error
            });
        }

        const audioUrls = {};

        // 1. Upload files to B2
        if (req.files && req.files.length > 0) {
            await Promise.all(req.files.map(async (file) => {
                const ext = path.extname(file.originalname || '').toLowerCase() || '.mp3';
                const filename = `listening-${file.fieldname}-${Date.now()}${ext}`;
                audioUrls[file.fieldname] = await uploadToB2(file.buffer, filename, file.mimetype);
            }));
        }

        // 2. If audio file is not uploaded, use URL from audioUrl field
        // This allows both file upload and URL paste options
        const finalFullAudio = audioUrls['audioFile'] || req.body.audioUrl || null;

        const partsPayload = safeJSONParse(req.body.parts, {});
        const parts = {};
        for (let index = 1; index <= 4; index += 1) {
            const source = partsPayload[index] ?? partsPayload[String(index)] ?? '';
            parts[index] = typeof source === 'string'
                ? { finalHtml: source }
                : { ...(source || {}), finalHtml: source?.finalHtml ?? source?.html ?? '' };
        }

        const contentObj = {
            fullAudio: finalFullAudio,
            audioParts: [
                audioUrls['part1'] || null,
                audioUrls['part2'] || null,
                audioUrls['part3'] || null,
                audioUrls['part4'] || null
            ],
            parts,
            answerKey: safeJSONParse(req.body.answerKey, {}),
            includePause: req.body.usePause === 'true'
        };

        const newTest = await saveValidatedTest({
            title: req.body.title,
            type: 'listening',
            content: contentObj,
            builderJson: req.body.builderJson || null,
            req
        });

        logger.info('Listening test created', {
            testId: newTest._id,
            userId: req.session.userId
        });

        res.json({
            success: true,
            message: CONSTANTS.MESSAGES.LISTENING_TEST_SAVED,
            testId: newTest._id
        });
    } catch (err) {
        logger.error('Listening test upload error', {
            error: err.message,
            userId: req.session.userId
        });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            error: err.message
        });
    }
});

// --- READING TEST CREATION ---
app.post('/create-test/reading', isAdmin, csrfProtection, testCreationLimiter, async (req, res) => {
    try {
        const newTest = await saveValidatedTest({
            title: req.body.title,
            type: 'reading',
            content: req.body.content,
            builderJson: req.body.builderJson || null,
            req
        });

        logger.info('Reading test created', { testId: newTest._id, userId: req.session.userId });
        res.json({ success: true, message: "Reading test created successfully!", testId: newTest._id });
    } catch (err) {
        logger.error('Reading test save error', { error: err.message, stack: err.stack, userId: req.session.userId });
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- WRITING TEST CREATION ---
app.post('/create-test/writing', isAdmin, csrfProtection, testCreationLimiter, async (req, res) => {
    try {
        const legacyBody = req.body || {};
        const writingContent = legacyBody.content || {
            timeLimit: legacyBody.timeLimit,
            task1: {
                prompt: legacyBody.task1?.prompt,
                image: legacyBody.task1?.image || null,
                modelAnswer: legacyBody.task1?.modelAnswer
            },
            task2: {
                prompt: legacyBody.task2?.prompt,
                modelAnswer: legacyBody.task2?.modelAnswer
            }
        };

        const newTest = await saveValidatedTest({
            title: legacyBody.title,
            type: 'writing',
            content: writingContent,
            builderJson: legacyBody.builderJson || null,
            req
        });

        logger.info('Writing test created', { testId: newTest._id, userId: req.session.userId });
        res.json({ success: true, message: "Writing test created successfully!", testId: newTest._id });
    } catch (err) {
        logger.error('Writing test save error', { error: err.message, stack: err.stack, userId: req.session.userId });
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- THE UPGRADED "SAVE" ROUTE ---
app.post('/create-test/:type', isAdmin, csrfProtection, async (req, res) => {
    try {
        const { title, content } = req.body;
        const testType = req.params.type;

        const newTest = await saveValidatedTest({
            title,
            type: testType,
            content,
            req
        });

        logger.info('Test saved', { type: testType, userId: req.session.userId });
        res.json({ success: true, message: `Saved ${testType} test successfully.` });
    } catch (err) {
        logger.error('Save error', { error: err.message, stack: err.stack, type: testType, userId: req.session.userId });
        res.status(500).json({ success: false, error: err.message || "Database save failed." });
    }
});

app.get('/admin/add-teacher', isAdmin, (req, res) => {
    res.render('add-teacher');
});

app.post('/admin/add-teacher', isAdmin, strictLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        const usernameValidation = validateUsername(username);
        if (!usernameValidation.valid) return res.status(400).send(usernameValidation.error + " <a href='/admin/add-teacher'>Try again</a>");

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) return res.status(400).send(passwordValidation.error + " <a href='/admin/add-teacher'>Try again</a>");

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.send("Username taken. <a href='/admin/add-teacher'>Try again</a>");

        const hashedPassword = await bcrypt.hash(password, 10);
        const newTeacher = new User({ username, password: hashedPassword, role: 'teacher' });
        await newTeacher.save();
        logger.info('Teacher created', { username, adminId: req.session.userId });
        res.send(`<h1>Success!</h1><p>Teacher '${username}' created.</p><a href='/admin'>Back</a>`);
    } catch (err) {
        res.status(500).send("Error creating teacher.");
    }
});

app.post('/admin/assign-test', isAdmin, strictLimiter, async (req, res) => {
    const { teacherId, testId } = req.body;
    try {
        const teacherValidation = validateObjectId(teacherId);
        const testValidation = validateObjectId(testId);
        if (!teacherValidation.valid) return res.status(400).send('Invalid teacher ID. <a href=\'/admin\'>Back</a>');
        if (!testValidation.valid) return res.status(400).send('Invalid test ID. <a href=\'/admin\'>Back</a>');

        const [teacher, test] = await Promise.all([User.findById(teacherId), Test.findById(testId)]);
        if (!teacher || teacher.role !== 'teacher') return res.status(404).send('Teacher not found. <a href=\'/admin\'>Back</a>');
        if (!test) return res.status(404).send('Test not found. <a href=\'/admin\'>Back</a>');

        await User.findByIdAndUpdate(teacherId, { $addToSet: { assignedTests: testId } });
        logger.info('Test assigned to teacher', { testId, teacherId, adminId: req.session.userId });
        res.send("<h1>Success!</h1><p>Test assigned.</p><a href='/admin'>Back</a>");
    } catch (err) {
        res.status(500).send("Error assigning test.");
    }
});

// --- TEACHER ROUTES ---

app.get('/teacher-dashboard', isTeacher, csrfProtection, async (req, res) => {
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const PAGE_SIZE = 20;
        const skip = (page - 1) * PAGE_SIZE;

        const [teacher, groups, allStudents] = await Promise.all([
            User.findById(req.session.userId).select('_id assignedTests'),
            Group.find({ teacherId: req.session.userId })
                .populate('students assignedTests')
                .sort({ name: 1 }),
            User.find({ teacherId: req.session.userId, role: 'student' }).sort({ username: 1 })
        ]);

        if (!teacher) {
            logger.warn('Teacher dashboard requested with stale session user', { userId: req.session.userId });
            return req.session.destroy(() => res.redirect('/login'));
        }

        const assignedTestIds = Array.isArray(teacher.assignedTests) ? teacher.assignedTests.filter(Boolean) : [];

        const totalTests = await Test.countDocuments({
            _id: { $in: assignedTestIds }
        });
        const totalPages = Math.ceil(totalTests / PAGE_SIZE);

        const tests = await Test.find({
            _id: { $in: assignedTestIds }
        })
            .sort({ title: 1 })
            .skip(skip)
            .limit(PAGE_SIZE)
            .lean();

        const testIds = tests.map(t => t._id);
        const submissions = await Submission.find({
            $or: [
                { teacherId: req.session.userId },
                { teacherId: null, testId: { $in: testIds } }
            ],
            testId: { $in: testIds }
        }).select('testId studentId lastSubmittedAt');

        const groupStatsByTestId = new Map();
        groups.forEach((group) => {
            const uniqueStudentIds = [...new Set((group.students || []).filter(Boolean).map((student) => String(student._id)))];
            (group.assignedTests || []).filter(Boolean).forEach((test) => {
                const key = String(test._id);
                if (!groupStatsByTestId.has(key)) {
                    groupStatsByTestId.set(key, { groupCount: 0, studentIds: new Set() });
                }
                const current = groupStatsByTestId.get(key);
                current.groupCount += 1;
                uniqueStudentIds.forEach((studentId) => current.studentIds.add(studentId));
            });
        });

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
            if (!current.latestSubmissionAt || submission.lastSubmittedAt > current.latestSubmissionAt) {
                current.latestSubmissionAt = submission.lastSubmittedAt;
            }
        });

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

        res.render('teacher-dashboard', {
            teacher: { _id: teacher._id, assignedTests: [] },
            tests: enrichedTests,
            testsByType: groupTestsByType(enrichedTests),
            allStudents,
            groups,
            stats: {
                testsCount: totalTests,
                groupsCount: groups.length,
                studentsCount: allStudents.length
            },
            pagination: { page, totalPages, totalTests, pageSize: PAGE_SIZE },
            csrfToken: req.csrfToken()
        });
    } catch (err) {
        logger.error('Teacher dashboard error', { error: err.message, stack: err.stack, userId: req.session.userId });
        res.status(500).send("Error loading dashboard.");
    }
});

app.get('/teacher/add-student', isTeacher, (req, res) => {
    res.render('add-student');
});

app.post('/teacher/add-student', isTeacher, async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validation
        if (!username || !password) {
            return res.status(400).json({ success: false, message: "Username and password are required." });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
        }

        // Check if username already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "Username already exists. Please choose a different one." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newStudent = new User({
            username: username,
            password: hashedPassword,
            role: 'student',
            teacherId: req.session.userId
        });
        await newStudent.save();

        res.json({
            success: true,
            message: `Student '${username}' created successfully!`,
            redirect: '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Add student error', { error: err.message, stack: err.stack, userId: req.session.userId });
        res.status(500).json({ success: false, message: "Error creating student: " + err.message });
    }
});

app.post('/teacher/assign-student', isTeacher, async (req, res) => {
    const { studentId, groupId } = req.body;
    try {
        const [student, group] = await Promise.all([
            User.findById(studentId),
            Group.findById(groupId)
        ]);

        if (!student || student.role !== 'student') {
            return res.status(404).send("Student not found.");
        }

        if (!group) {
            return res.status(404).send("Group not found.");
        }

        if (req.session.userRole !== 'admin' && String(group.teacherId) !== String(req.session.userId)) {
            return res.status(403).send("Not authorized to manage this group.");
        }

        if (req.session.userRole !== 'admin' && String(student.teacherId) !== String(req.session.userId)) {
            return res.status(403).send("Not authorized to move this student.");
        }

        if (student.groupId && String(student.groupId) !== String(group._id)) {
            await Group.findByIdAndUpdate(student.groupId, { $pull: { students: student._id } });
        }

        await Group.findByIdAndUpdate(groupId, { $addToSet: { students: studentId } });
        await User.findByIdAndUpdate(studentId, { groupId: groupId });
        res.redirect('/teacher-dashboard');
    } catch (err) {
        res.status(500).send("Error assigning student.");
    }
});

// Create a new group
app.post('/teacher/create-group', isTeacher, async (req, res) => {
    try {
        const { groupName } = req.body;

        if (!groupName || !groupName.trim()) {
            return res.status(400).send("Group name is required. <a href='/teacher-dashboard'>Go back</a>");
        }

        const newGroup = new Group({
            name: groupName.trim(),
            teacherId: req.session.userId,
            students: [],
            assignedTests: []
        });

        await newGroup.save();
        logger.info('Group created', { groupId: newGroup._id, groupName: newGroup.name, teacherId: req.session.userId });
        res.redirect('/teacher-dashboard');
    } catch (err) {
        logger.error('Create group error', { error: err.message, stack: err.stack, userId: req.session.userId });
        res.status(500).send("Error creating group: " + err.message);
    }
});

// Assign student to group (alternative endpoint)
app.post('/teacher/assign-to-group', isTeacher, async (req, res) => {
    const { studentId, groupId } = req.body;
    try {
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

        // Remove from old group if exists
        if (student.groupId && String(student.groupId) !== String(group._id)) {
            await Group.findByIdAndUpdate(student.groupId, { $pull: { students: student._id } });
        }

        // Add to new group
        await Group.findByIdAndUpdate(groupId, { $addToSet: { students: studentId } });
        await User.findByIdAndUpdate(studentId, { groupId: groupId });

        logger.info('Student assigned to group', { studentId, groupId, teacherId: req.session.userId });
        res.redirect('/teacher-dashboard');
    } catch (err) {
        logger.error('Assign to group error', { error: err.message, userId: req.session.userId });
        res.status(500).send("Error assigning student to group: " + err.message);
    }
});



app.get('/teacher/progress/:id', isTeacher, async (req, res) => {
    try {
        const access = await getAccessibleTest(req, req.params.id);
        if (!access.test) {
            return res.status(404).send("Test not found.");
        }

        if (!access.isAllowed) {
            return res.status(403).send("Not authorized to view this test.");
        }

        const groupQuery = { assignedTests: access.test._id };
        if (req.session.userRole === 'teacher') {
            groupQuery.teacherId = req.session.userId;
        }

        const submissionQuery = { testId: access.test._id };
        if (req.session.userRole === 'teacher') {
            submissionQuery.$or = [
                { teacherId: req.session.userId },
                { teacherId: null }
            ];
        }

        const [groups, submissions] = await Promise.all([
            Group.find(groupQuery).populate('students').sort({ name: 1 }),
            Submission.find(submissionQuery)
                .populate('studentId groupId')
                .sort({ lastSubmittedAt: -1 })
        ]);

        const studentRows = new Map();
        groups.forEach((group) => {
            (group.students || []).forEach((student) => {
                const key = String(student._id);
                if (!studentRows.has(key)) {
                    studentRows.set(key, {
                        studentId: student._id,
                        studentName: student.username,
                        groupName: group.name,
                        submission: null,
                        isAssigned: true
                    });
                }
            });
        });

        submissions.forEach((submission) => {
            const key = String(submission.studentId?._id || submission.studentId);
            const existing = studentRows.get(key) || {
                studentId: submission.studentId?._id || submission.studentId,
                studentName: submission.studentName,
                groupName: submission.groupId?.name || 'Ungrouped',
                submission: null,
                isAssigned: false
            };

            existing.studentName = existing.studentName || submission.studentName;
            existing.groupName = existing.groupName || submission.groupId?.name || 'Ungrouped';
            existing.submission = submission;
            studentRows.set(key, existing);
        });

        const rows = [...studentRows.values()].sort((left, right) => {
            if (left.groupName !== right.groupName) {
                return left.groupName.localeCompare(right.groupName);
            }
            return left.studentName.localeCompare(right.studentName);
        });

        const scoredSubmissions = submissions.filter((submission) => Number.isFinite(submission.score));
        const averageScore = scoredSubmissions.length
            ? (scoredSubmissions.reduce((sum, submission) => sum + submission.score, 0) / scoredSubmissions.length)
            : null;
        const averagePercentage = scoredSubmissions.length
            ? Math.round(scoredSubmissions.reduce((sum, submission) => sum + (submission.percentage || 0), 0) / scoredSubmissions.length)
            : null;

        res.render('teacher-progress', {
            currentUser: req.session.username,
            currentRole: req.session.userRole,
            test: access.test,
            groups,
            rows,
            summary: {
                assignedStudents: rows.filter((row) => row.isAssigned).length,
                completedStudents: rows.filter((row) => row.submission).length,
                pendingStudents: rows.filter((row) => row.isAssigned && !row.submission).length,
                averageScore,
                averagePercentage
            }
        });
    } catch (err) {
        logger.error('Teacher progress error', { error: err.message, stack: err.stack, userId: req.session.userId });
        res.status(500).send("Error loading test progress.");
    }
});

// --- THE ULTIMATE STUDENT VIEWER (BUILDER-MATCHED HTML) ---
app.get('/view-test/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        // Check cache first
        const isStaffPreview = req.session.userRole === 'teacher' || req.session.userRole === 'admin';
        const cacheKey = `test_html_${req.params.id}_${req.session.userId}_${isStaffPreview ? 'preview' : 'student'}`;
        let html = cache.get(cacheKey);

        if (html) {
            logger.debug('Cache HIT for test', { testId: req.params.id });
            return res.send(html);
        }

        logger.debug('Cache MISS for test', { testId: req.params.id });

        const access = await getAccessibleTest(req, req.params.id);
        if (!access.test) return res.status(404).send("Test not found.");
        if (!access.isAllowed) return res.status(403).send("Not authorized to view this test.");

        try {
            html = generateHTMLFromTest(access.test, {
                deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
                studentName: access.user ? (access.user.username || '') : '',
                previewMode: isStaffPreview,
                useAudioProxy: false
            });

            // Cache the generated HTML
            cache.set(cacheKey, html);
            logger.debug('Cached test HTML', { testId: req.params.id });

            return res.send(html);
        } catch (generatorErr) {
            logger.error('HTML generation error', { error: generatorErr.message, stack: generatorErr.stack });

            return res.status(500).send(`Error generating test HTML: ${generatorErr.message}`);
        }
    } catch (err) {
        logger.error('View test error', { error: err.message, stack: err.stack });
        res.status(500).send(`Error loading test: ${err.message}`);
    }
});

// --- DOWNLOAD STANDALONE HTML TEST ---

app.get('/download-test/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const access = await getAccessibleTest(req, req.params.id);
        if (!access.test) return res.status(404).send("Test not found.");
        if (!access.isAllowed) return res.status(403).send("Not authorized to download this test.");

        async function fileUrlToDataUri(fileUrl) {
            // If it's a public URL (B2 or any https), keep it as-is — no need to inline
            if (!fileUrl || typeof fileUrl !== 'string') return fileUrl;
            if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) return fileUrl;
            // Legacy local path fallback
            if (!fileUrl.startsWith('/uploads/')) return fileUrl;
            const localPath = path.join(__dirname, 'public', fileUrl.replace(/^\/+/, ''));
            try {
                const buffer = await fs.promises.readFile(localPath);
                const contentType = mime.lookup(localPath) || 'application/octet-stream';
                return `data:${contentType};base64,${buffer.toString('base64')}`;
            } catch (err) {
                console.warn('[download-test] Unable to inline audio file:', localPath, err.message);
                return fileUrl;
            }
        }

        async function inlineListeningAudio(testDoc) {
            const raw = testDoc.readingPassage;
            if (!raw || typeof raw !== 'string') return testDoc;
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (err) {
                return testDoc;
            }

            const next = { ...(parsed || {}) };
            next.fullAudio = await fileUrlToDataUri(parsed.fullAudio);

            if (Array.isArray(parsed.audioParts)) {
                next.audioParts = await Promise.all(parsed.audioParts.map((part) => fileUrlToDataUri(part)));
            }

            return {
                ...(typeof testDoc.toObject === 'function' ? testDoc.toObject() : { ...testDoc }),
                readingPassage: JSON.stringify(next)
            };
        }

        try {
            const testForDownload = String(access.test.type || '').toLowerCase() === 'listening'
                ? await inlineListeningAudio(access.test)
                : access.test;

            const html = generateHTMLFromTest(testForDownload, {
                deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
                useAudioProxy: false
            });
            const stableHtml = injectPersistentStateForDownload(html, access.test);
            const safeTitle = access.test.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(stableHtml);
        } catch (generatorErr) {
            console.error('HTML generation error for download:', generatorErr);

            return res.status(500).send(`Error generating test HTML: ${generatorErr.message}`);
        }
    } catch (err) {
        console.error('Download test error:', err);
        res.status(500).send(`Error downloading test: ${err.message}`);
    }
});

// --- SUBMISSION CAPTURE ---
app.post('/api/test-submissions', apiLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: "Not logged in" });
    try {
        const result = await saveStudentSubmission({
            req,
            payload: req.body || {}
        });

        res.json({
            success: true,
            ignored: Boolean(result.ignored),
            submissionId: result.submission?._id || null
        });
    } catch (err) {
        logger.error('Submission error', { error: err.message, stack: err.stack });
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/submit-writing-test', apiLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: "Not logged in" });
    try {
        const { testId, studentName, task1, task2, wordCount1, wordCount2, timeTaken } = req.body;
        const result = await saveStudentSubmission({
            req,
            payload: {
                testId,
                type: 'writing',
                studentName,
                wordCount1,
                wordCount2,
                timeRemainingText: timeTaken,
                task1,
                task2,
                resultSignature: ['writing', testId, studentName, wordCount1, wordCount2, (task1 || '').length, (task2 || '').length].join(':'),
                details: {
                    task1,
                    task2
                }
            }
        });

        res.json({
            success: true,
            ignored: Boolean(result.ignored),
            message: "Writing test submitted successfully"
        });
    } catch (err) {
        logger.error('Submission error', { error: err.message, stack: err.stack });
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- AI CHAT FOR STUDENTS ---
app.get('/student/ai-chat', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const student = await User.findById(req.session.userId).select('username role');
        if (!student || student.role !== 'student') {
            return res.status(403).send('Access denied');
        }

        // Get student stats (all tests for stats, but AI only uses last 10 of each type)
        const submissions = await Submission.find({ studentId: req.session.userId });
        const stats = {
            totalTests: submissions.length,
            readingTests: submissions.filter(s => s.type === 'reading').length,
            listeningTests: submissions.filter(s => s.type === 'listening').length,
            writingTests: submissions.filter(s => s.type === 'writing').length,
            avgScore: submissions.filter(s => s.percentage).length > 0
                ? Math.round(submissions.filter(s => s.percentage).reduce((sum, s) => sum + s.percentage, 0) / submissions.filter(s => s.percentage).length)
                : null
        };

        res.render('ai-chat', {
            studentName: student.username,
            stats
        });
    } catch (err) {
        logger.error('AI chat page error', { error: err.message });
        res.status(500).send('Error loading AI chat.');
    }
});

app.post('/api/ai-chat', apiLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: 'Not logged in' });

    try {
        const student = await User.findById(req.session.userId).select('username role');
        if (!student || student.role !== 'student') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'Message is required' });
        }

        // Get last 10 reading, 10 listening, and 10 writing tests (30 total)
        const [readingSubmissions, listeningSubmissions, writingSubmissions] = await Promise.all([
            Submission.find({ studentId: req.session.userId, type: 'reading' })
                .populate('testId', 'title type')
                .sort({ createdAt: -1 })
                .limit(10),
            Submission.find({ studentId: req.session.userId, type: 'listening' })
                .populate('testId', 'title type')
                .sort({ createdAt: -1 })
                .limit(10),
            Submission.find({ studentId: req.session.userId, type: 'writing' })
                .populate('testId', 'title type')
                .sort({ createdAt: -1 })
                .limit(10)
        ]);

        const submissions = [...readingSubmissions, ...listeningSubmissions, ...writingSubmissions].sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        // Build context for AI (complete detailed information)
        const testHistory = submissions.map((sub, index) => {
            const date = new Date(sub.createdAt).toLocaleDateString();
            let details = `Test ${index + 1}: ${sub.testId?.title || 'Unknown'} (${sub.type})\nScore: ${sub.score}/${sub.totalQuestions} (${sub.percentage}%) - ${date}`;

            // Add time management info
            if (sub.timeRemainingText) {
                details += `\nTime: ${sub.timeRemainingText}`;
            }

            if (sub.type === 'writing') {
                details += `\nWords: Task 1=${sub.wordCount1 || 0}, Task 2=${sub.wordCount2 || 0}`;
                if (sub.details?.task1Preview) {
                    details += `\nTask 1 Preview: ${sub.details.task1Preview.slice(0, 100)}...`;
                }
                if (sub.details?.task2Preview) {
                    details += `\nTask 2 Preview: ${sub.details.task2Preview.slice(0, 100)}...`;
                }
            } else if (sub.type === 'reading' || sub.type === 'listening') {
                // Add complete question type breakdown and mistakes
                if (sub.details?.incorrectSummary) {
                    details += `\n\nMistakes by Question Type:\n${sub.details.incorrectSummary}`;
                }
                // Add summary analysis if available
                if (sub.details?.summaryText) {
                    details += `\n\nDetailed Analysis:\n${sub.details.summaryText}`;
                }
            }

            return details;
        }).join('\n\n---\n\n');

        // Calculate statistics
        const readingTests = submissions.filter(s => s.type === 'reading');
        const listeningTests = submissions.filter(s => s.type === 'listening');
        const writingTests = submissions.filter(s => s.type === 'writing');

        const avgReading = readingTests.filter(s => s.percentage).length > 0
            ? Math.round(readingTests.filter(s => s.percentage).reduce((sum, s) => sum + s.percentage, 0) / readingTests.filter(s => s.percentage).length)
            : null;

        const avgListening = listeningTests.filter(s => s.percentage).length > 0
            ? Math.round(listeningTests.filter(s => s.percentage).reduce((sum, s) => sum + s.percentage, 0) / listeningTests.filter(s => s.percentage).length)
            : null;

        const avgWriting = writingTests.length > 0
            ? Math.round(writingTests.reduce((sum, s) => (sum + (s.wordCount1 || 0) + (s.wordCount2 || 0)), 0) / writingTests.length)
            : null;

        // Build AI prompt (with complete data access)
        const prompt = `You are an expert IELTS Study Coach helping ${student.username}.

IMPORTANT: You are powered by DeepSeek V4 Pro. Only mention this if specifically asked.

Student's Recent Test History (Last 10 Reading + 10 Listening + 10 Writing):
${testHistory}

Performance Summary:
- Total Tests: ${submissions.length}
- Reading: ${readingTests.length} tests (Avg: ${avgReading !== null ? avgReading + '%' : 'N/A'})
- Listening: ${listeningTests.length} tests (Avg: ${avgListening !== null ? avgListening + '%' : 'N/A'})
- Writing: ${writingTests.length} tests (Avg words: ${avgWriting !== null ? avgWriting : 'N/A'})

You have access to:
- Complete question type breakdowns (multiple choice, matching, sentence completion, etc.)
- Time management data (time remaining/spent)
- Detailed mistake analysis for each test
- Writing task previews and word counts
- Performance trends across multiple tests

Student's Question: ${message}

Guidelines:
- Answer only what's asked (max 250 words)
- Be friendly, encouraging, use emojis naturally
- For greetings: warm welcome + ask how to help
- Don't mention model/capabilities unless asked
- Provide specific, actionable advice based on test history
- When analyzing performance, reference specific question types and patterns from the data
- For writing, focus on word count consistency and task completion
- Don't hallucinate or add unrequested information

Response:`;

        // Call DeepSeek AI with retry logic
        let result;
        let retries = 3;
        let delay = 1000;

        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: 'deepseek-v4-pro',
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.7,
                        max_tokens: 1500
                    })
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error?.message || 'DeepSeek API error');
                }

                result = await response.json();
                break;
            } catch (error) {
                if (i === retries - 1) throw error;
                logger.info(`AI chat retry ${i + 1}/${retries} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }

        const reply = result.choices[0].message.content;

        logger.info('AI chat response generated', {
            studentId: req.session.userId,
            messageLength: message.length,
            replyLength: reply.length
        });

        res.json({
            success: true,
            reply: reply
        });
    } catch (err) {
        logger.error('AI chat error', { error: err.message, stack: err.stack });
        res.status(500).json({
            success: false,
            message: 'AI chat error: ' + err.message
        });
    }
});

// --- AI FEEDBACK VIEWER ---
app.get('/student/ai-feedback/:submissionId', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const submission = await Submission.findOne({
            _id: req.params.submissionId,
            studentId: req.session.userId
        }).populate('testId');

        if (!submission) {
            return res.status(404).send('Submission not found or you do not have access.');
        }

        res.render('ai-feedback', { submission, test: submission.testId });
    } catch (err) {
        logger.error('AI feedback view error', { error: err.message });
        res.status(500).send('Error loading AI feedback.');
    }
});

// --- TEACHER: AI PATTERN ANALYSIS FOR STUDENT ---
app.get('/teacher/student-patterns/:studentId', isTeacher, async (req, res) => {
    try {
        const student = await User.findById(req.params.studentId).select('username teacherId');
        if (!student) {
            return res.status(404).send('Student not found');
        }

        // Check authorization
        if (req.session.userRole !== 'admin' && String(student.teacherId) !== String(req.session.userId)) {
            return res.status(403).send('Not authorized');
        }

        // Get last 5 submissions
        const submissions = await Submission.find({ studentId: req.params.studentId })
            .populate('testId', 'title type')
            .sort({ createdAt: -1 })
            .limit(5);

        if (submissions.length < 2) {
            return res.send(`
                <!DOCTYPE html>
                <html><head><title>Pattern Analysis</title></head>
                <body style="font-family:sans-serif;padding:40px;text-align:center;">
                    <h1>Not Enough Data</h1>
                    <p>Student needs at least 2 test submissions for pattern analysis.</p>
                    <a href="/teacher-dashboard" style="color:#667eea;">Back to Dashboard</a>
                </body></html>
            `);
        }

        // Run AI pattern detection
        const patternResult = await detectPatterns(req.params.studentId, submissions);

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Student Pattern Analysis</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); padding: 40px; }
                    .container { max-width: 900px; margin: 0 auto; }
                    .header { background: white; padding: 30px; border-radius: 20px; margin-bottom: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
                    .header h1 { font-size: 2rem; font-weight: 900; color: #1f2937; margin-bottom: 10px; }
                    .content { background: white; padding: 32px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); line-height: 1.8; white-space: pre-wrap; }
                    .back-btn { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 12px; font-weight: 700; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <a href="/teacher-dashboard" class="back-btn">← Back to Dashboard</a>
                    <div class="header">
                        <h1>🔍 Pattern Analysis: ${student.username}</h1>
                        <p style="color:#64748b;">AI-powered analysis of ${submissions.length} recent test submissions</p>
                    </div>
                    <div class="content">
                        ${patternResult.success ? patternResult.patterns : 'Pattern analysis unavailable at this time.'}
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

// --- STUDENT DASHBOARD ---

app.get('/student-dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        if (!isDatabaseReady()) return sendDatabaseUnavailable(res);

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const search = (req.query.search || '').trim();
        const PAGE_SIZE = 10;

        const [student, submissions] = await Promise.all([
            User.findById(req.session.userId).populate({
                path: 'groupId',
                populate: { path: 'assignedTests', options: { sort: { type: 1, title: 1 } } }
            }),
            Submission.find({ studentId: req.session.userId }).select('testId score totalQuestions band percentage lastSubmittedAt details')
        ]);

        if (!student) {
            logger.warn('Student dashboard requested with stale session user', { userId: req.session.userId });
            return req.session.destroy(() => res.redirect('/login'));
        }

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

        // Add submissions and combine with scheduled tests
        const availableTests = allTests.map((testDoc) => {
            const test = typeof testDoc.toObject === 'function' ? testDoc.toObject() : { ...testDoc };
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

// --- LIVE MONITOR ---
const heartbeatStore = new Map();
const sseClients = new Map();

// Cleanup stale heartbeat entries every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - 300000; // 5 minutes
    heartbeatStore.forEach((studentMap, testId) => {
        studentMap.forEach((data, name) => {
            if (data.lastSeen < cutoff) studentMap.delete(name);
        });
        if (studentMap.size === 0) heartbeatStore.delete(testId);
    });
}, 300000);

function getActiveStudents(testId) {
    const students = [];
    const map = heartbeatStore.get(testId);
    if (map) {
        const cutoff = Date.now() - 30000;
        map.forEach((data) => { if (data.lastSeen > cutoff) students.push(data); });
    }
    return students;
}

function pushToTeachers(testId) {
    const clients = sseClients.get(testId);
    if (!clients || clients.size === 0) return;
    const payload = `data: ${JSON.stringify({ students: getActiveStudents(testId) })}\n\n`;
    clients.forEach(res => { try { res.write(payload); } catch (e) { } });
}

app.post('/api/heartbeat', apiLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ ok: false });
    const { testId, studentName, answeredCount, totalCount, currentPart, timeRemaining, type, task1Preview, task2Preview, wordCount1, wordCount2, examGuardViolations, examGuardLastReason } = req.body;
    if (!testId || !studentName) return res.json({ ok: false });

    if (!heartbeatStore.has(testId)) heartbeatStore.set(testId, new Map());
    const studentKey = String(req.session.userId);
    const studentMap = heartbeatStore.get(testId);
    const previous = studentMap.get(studentKey);

    const nextAnswered = Number(answeredCount);
    const nextTotal = Number(totalCount);
    const safeAnswered = Number.isFinite(nextAnswered) ? nextAnswered : 0;
    const safeTotal = Number.isFinite(nextTotal) ? nextTotal : (previous?.totalCount || 0);
    const boundedAnswered = safeTotal > 0
        ? Math.max(0, Math.min(safeAnswered, safeTotal))
        : Math.max(0, safeAnswered);

    studentMap.set(studentKey, {
        studentName,
        answeredCount: boundedAnswered,
        totalCount: safeTotal,
        currentPart: currentPart || (previous?.currentPart || ''),
        timeRemaining: timeRemaining || (previous?.timeRemaining || ''),
        type: type || (previous?.type || ''),
        task1Preview: typeof task1Preview === 'string' ? task1Preview : (previous?.task1Preview || null),
        task2Preview: typeof task2Preview === 'string' ? task2Preview : (previous?.task2Preview || null),
        wordCount1: wordCount1 || (previous?.wordCount1 || null),
        wordCount2: wordCount2 || (previous?.wordCount2 || null),
        examGuardViolations: Number.isFinite(Number(examGuardViolations)) ? Number(examGuardViolations) : (previous?.examGuardViolations || 0),
        examGuardLastReason: typeof examGuardLastReason === 'string' ? examGuardLastReason : (previous?.examGuardLastReason || ''),
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

    const testId = req.params.testId;
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
        res.status(500).send('Error: ' + err.message);
    }
});

app.get('/api/live-data/:testId', isTeacher, async (req, res) => {
    const access = await getAccessibleTest(req, req.params.testId);
    if (!access.test) return res.status(404).json({ students: [] });
    if (!access.isAllowed) return res.status(403).json({ students: [] });
    res.json({ students: getActiveStudents(req.params.testId) });
});

// --- RENAME / FOLDER ROUTE ---
app.post('/teacher/update-test-meta/:id', isTeacher, async (req, res) => {
    try {
        const test = await Test.findById(req.params.id);
        if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

        const allowed = await canEditTest(req, req.params.id);
        if (!allowed && req.session.userRole !== 'admin') {
            const assigned = await User.findOne({ _id: req.session.userId, assignedTests: test._id });
            if (!assigned) return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        if (req.body.customTitle !== undefined) test.customTitle = String(req.body.customTitle).trim();
        if (req.body.folder !== undefined) test.folder = String(req.body.folder).trim();
        await test.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- DELETE ROUTES ---

// Delete a test
app.post('/delete-test/:id', csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: Test,
        modelName: 'Test',
        idParam: 'id',
        authCheck: async (req, test) => {
            const user = await User.findById(req.session.userId);
            const isAllowed = user.role === CONSTANTS.ROLES.ADMIN ||
                (user.role === CONSTANTS.ROLES.TEACHER && test.createdBy.toString() === req.session.userId);
            return {
                allowed: isAllowed,
                message: 'Not authorized to delete this test'
            };
        },
        preDelete: async (test) => {
            // Remove test from all groups and teachers' assigned lists
            await Group.updateMany({ assignedTests: test._id }, { $pull: { assignedTests: test._id } });
            await User.updateMany({ assignedTests: test._id }, { $pull: { assignedTests: test._id } });
            await Submission.deleteMany({ testId: test._id });

            // Clear cache for this test
            cache.keys().forEach(key => {
                if (key.startsWith(`test_html_${test._id}_`) || key.startsWith(`test_access_${test._id}_`)) {
                    cache.del(key);
                }
            });
            logger.debug('Cache cleared for deleted test', { testId: test._id });
        }
    });
});

// Delete a student account
app.post('/delete-student/:id', csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: User,
        modelName: 'Student',
        idParam: 'id',
        authCheck: async (req, student) => {
            if (student.role !== CONSTANTS.ROLES.STUDENT) {
                return { allowed: false, message: 'User is not a student' };
            }

            const user = await User.findById(req.session.userId);

            if (user.role === CONSTANTS.ROLES.ADMIN) {
                return { allowed: true };
            }

            if (user.role !== CONSTANTS.ROLES.TEACHER) {
                return { allowed: false, message: 'Not authorized' };
            }

            if (!student.teacherId || student.teacherId.toString() !== req.session.userId) {
                return {
                    allowed: false,
                    message: CONSTANTS.MESSAGES.CANNOT_DELETE_OTHER_TEACHERS_STUDENTS
                };
            }

            return { allowed: true };
        },
        preDelete: async (student) => {
            // Remove student from group if they belong to one
            if (student.groupId) {
                await Group.findByIdAndUpdate(student.groupId, { $pull: { students: student._id } });
            }
            // Delete student submissions
            await Submission.deleteMany({ studentId: student._id });
        }
    });
});

// Delete a teacher account
app.post('/delete-teacher/:id', csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: User,
        modelName: 'Teacher',
        idParam: 'id',
        authCheck: async (req, teacher) => {
            if (teacher.role !== CONSTANTS.ROLES.TEACHER) {
                return { allowed: false, message: 'User is not a teacher' };
            }

            const user = await User.findById(req.session.userId);
            const isAllowed = user.role === CONSTANTS.ROLES.ADMIN;
            return {
                allowed: isAllowed,
                message: 'Only admins can delete teachers'
            };
        },
        preDelete: async (teacher) => {
            // Find all tests created by this teacher
            const teacherTests = await Test.find({ createdBy: teacher._id });
            const testIds = teacherTests.map(t => t._id);

            // Remove tests from all groups
            if (testIds.length > 0) {
                await Group.updateMany(
                    { assignedTests: { $in: testIds } },
                    { $pull: { assignedTests: { $in: testIds } } }
                );
                await User.updateMany(
                    { assignedTests: { $in: testIds } },
                    { $pull: { assignedTests: { $in: testIds } } }
                );
            }
        }
    });
});

// Delete a group
app.post('/delete-group/:id', csrfProtection, async (req, res) => {
    await handleDelete(req, res, {
        model: Group,
        modelName: 'Group',
        idParam: 'id',
        authCheck: async (req, group) => {
            const user = await User.findById(req.session.userId);

            if (user.role === CONSTANTS.ROLES.ADMIN) {
                return { allowed: true };
            }

            const isTeacherOwner = user.role === CONSTANTS.ROLES.TEACHER &&
                group.teacherId.toString() === req.session.userId;

            return {
                allowed: isTeacherOwner,
                message: 'Not authorized to delete this group'
            };
        },
        preDelete: async (group) => {
            // Remove group reference from all students
            await User.updateMany({ groupId: group._id }, { $unset: { groupId: 1 } });
        }
    });
});

// Remove a student from a group (keep account, just remove from group)
app.post('/remove-student-from-group/:groupId/:studentId', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        // Validate IDs
        const groupValidation = validateObjectId(req.params.groupId);
        const studentValidation = validateObjectId(req.params.studentId);

        if (!groupValidation.valid || !studentValidation.valid) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).json({
                success: false,
                message: 'Invalid ID format'
            });
        }

        const group = await Group.findById(req.params.groupId);
        if (!group) {
            return res.status(CONSTANTS.STATUS.NOT_FOUND).json({
                success: false,
                message: CONSTANTS.MESSAGES.GROUP_NOT_FOUND
            });
        }

        const user = await User.findById(req.session.userId);

        // Check authorization
        if (user.role !== CONSTANTS.ROLES.ADMIN &&
            (user.role !== CONSTANTS.ROLES.TEACHER || group.teacherId.toString() !== req.session.userId)) {
            logger.warn('Unauthorized attempt to remove student from group', {
                userId: req.session.userId
            });
            return res.status(CONSTANTS.STATUS.FORBIDDEN).json({
                success: false,
                message: 'Not authorized to remove students from this group'
            });
        }

        // Remove student from group
        await Group.findByIdAndUpdate(req.params.groupId, { $pull: { students: req.params.studentId } });
        await User.findByIdAndUpdate(req.params.studentId, { $unset: { groupId: 1 } });

        logger.info('Student removed from group', {
            userId: req.session.userId,
            studentId: req.params.studentId
        });

        res.json({
            success: true,
            message: CONSTANTS.MESSAGES.STUDENT_REMOVED_FROM_GROUP,
            redirect: req.body.redirect || '/teacher-dashboard'
        });
    } catch (err) {
        logger.error('Error removing student from group', {
            error: err.message
        });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({
            success: false,
            message: 'Error removing student: ' + err.message
        });
    }
});


// Remove a test from a group
app.post('/teacher/remove-test-from-group/:groupId/:testId', isTeacher, async (req, res) => {
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
        if (req.session.userRole !== CONSTANTS.ROLES.ADMIN && group.teacherId.toString() !== req.session.userId) {
            return res.status(CONSTANTS.STATUS.FORBIDDEN).json({ success: false, message: 'Not authorized' });
        }
        await Group.findByIdAndUpdate(groupId, { $pull: { assignedTests: testId, testSchedule: { testId: testId } } });
        logger.info('Test removed from group', { userId: req.session.userId, groupId, testId });
        res.json({ success: true, message: 'Test removed from group successfully', redirect: req.body.redirect || '/teacher-dashboard' });
    } catch (err) {
        logger.error('Error removing test from group', { error: err.message });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({ success: false, message: 'Error: ' + err.message });
    }
});

// --- ADMIN PASSWORD VIEWER ---
app.get('/admin/view-password/:userId', isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('username role');
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

app.post('/admin/reset-password/:userId', isAdmin, async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();

        logger.info('Password reset by admin', { userId: req.params.userId, adminId: req.session.userId });
        res.json({ success: true, message: 'Password reset successfully', password: newPassword });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- TEACHER PASSWORD VIEWER ---
app.get('/teacher/view-password/:studentId', isTeacher, async (req, res) => {
    try {
        const student = await User.findById(req.params.studentId).select('username role teacherId');
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

app.post('/teacher/reset-password/:studentId', isTeacher, async (req, res) => {
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
        student.password = hashedPassword;
        await student.save();

        logger.info('Password reset by teacher', { studentId: req.params.studentId, teacherId: req.session.userId });
        res.json({ success: true, message: 'Password reset successfully', password: newPassword });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- BULK DELETE ---
app.post('/admin/bulk-delete', isAdmin, async (req, res) => {
    try {
        const { type, ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'No items selected' });

        let deleted = 0;
        if (type === 'test') {
            await Test.deleteMany({ _id: { $in: ids } });
            await Group.updateMany({}, { $pull: { assignedTests: { $in: ids } } });
            await User.updateMany({}, { $pull: { assignedTests: { $in: ids } } });
            await Submission.deleteMany({ testId: { $in: ids } });
            deleted = ids.length;
        } else if (type === 'teacher') {
            const teachers = await User.find({ _id: { $in: ids }, role: 'teacher' });
            for (const teacher of teachers) {
                const tests = await Test.find({ createdBy: teacher._id });
                const testIds = tests.map(t => t._id);
                if (testIds.length > 0) {
                    await Group.updateMany({}, { $pull: { assignedTests: { $in: testIds } } });
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

app.post('/teacher/bulk-delete-students', isTeacher, async (req, res) => {
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

// --- SEARCH/FILTER ---
app.get('/api/search-tests', isTeacher, async (req, res) => {
    try {
        const query = (req.query.q || '').trim();
        const type = req.query.type || '';
        const teacher = await User.findById(req.session.userId).select('assignedTests');

        let filter = { _id: { $in: teacher.assignedTests || [] } };
        if (query) filter.title = { $regex: query, $options: 'i' };
        if (type) filter.type = type;

        const tests = await Test.find(filter).select('_id title type').limit(50);
        res.json({ tests });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ANALYTICS DASHBOARD ---
app.get('/teacher/analytics', isTeacher, async (req, res) => {
    try {
        const [submissions, tests, students] = await Promise.all([
            Submission.find({ teacherId: req.session.userId }).select('type score totalQuestions percentage createdAt testId'),
            Test.find({ createdBy: req.session.userId }).select('title type'),
            User.find({ teacherId: req.session.userId, role: 'student' }).select('username')
        ]);

        res.render('analytics', { submissions, tests, students });
    } catch (err) {
        res.status(500).send('Error loading analytics');
    }
});

// --- FEEDBACK SYSTEM ---
app.get('/student/feedback', csrfProtection, async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('feedback', { csrfToken: req.csrfToken() });
});

app.post('/student/feedback', csrfProtection, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: 'Not logged in' });
    try {
        const { testType, questionType, issueDescription } = req.body;
        const student = await User.findById(req.session.userId).select('username');

        // Sanitize user input to prevent XSS
        const sanitizedDescription = xss(issueDescription);
        const sanitizedQuestionType = xss(questionType || '');

        const feedback = new Feedback({
            studentId: req.session.userId,
            studentName: student.username,
            testType,
            questionType: sanitizedQuestionType,
            issueDescription: sanitizedDescription
        });
        await feedback.save();
        logger.info('Feedback submitted', { studentId: req.session.userId, testType });
        res.json({ success: true, message: 'Feedback submitted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/admin/feedback', isAdmin, async (req, res) => {
    try {
        const status = req.query.status || 'open';
        const feedback = await Feedback.find({ status }).sort({ createdAt: -1 }).limit(100);
        res.render('admin-feedback', { feedback, status });
    } catch (err) {
        res.status(500).send('Error loading feedback');
    }
});

app.post('/admin/feedback/:id/resolve', isAdmin, async (req, res) => {
    try {
        const { adminNotes, adminReply } = req.body;
        await Feedback.findByIdAndUpdate(req.params.id, {
            status: 'resolved',
            adminNotes,
            adminReply: adminReply || null
        });
        logger.info('Feedback resolved', { feedbackId: req.params.id, adminId: req.session.userId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/admin/feedback/:id/reply', isAdmin, async (req, res) => {
    try {
        const { reply, studentId } = req.body;
        if (!reply || !reply.trim()) {
            return res.status(400).json({ success: false, message: 'Reply message is required' });
        }

        // Sanitize admin reply to prevent XSS
        const sanitizedReply = xss(reply.trim());

        const feedback = await Feedback.findByIdAndUpdate(req.params.id, {
            adminReply: sanitizedReply
        });

        // Create notification for student
        await Notification.create({
            userId: studentId,
            type: 'admin_reply',
            title: 'Admin replied to your feedback',
            message: sanitizedReply,
            relatedId: req.params.id
        });

        logger.info('Reply sent to student', {
            feedbackId: req.params.id,
            studentId,
            adminId: req.session.userId
        });
        res.json({ success: true, message: 'Reply sent successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- SETTINGS & DARK MODE ---
app.get('/settings', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId).select('username role createdAt');
        let stats = { totalTests: 0 };

        if (user.role === 'student') {
            const submissions = await Submission.find({ studentId: req.session.userId });
            stats.totalTests = submissions.length;
        }

        res.render('settings', { user, stats });
    } catch (err) {
        res.status(500).send('Error loading settings');
    }
});

app.post('/settings/change-password', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: 'Not logged in' });
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'All fields required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }

        const user = await User.findById(req.session.userId);
        const isMatch = await bcrypt.compare(currentPassword, user.password);

        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await user.save();

        logger.info('Password changed', { userId: req.session.userId });
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        logger.error('Password change error', { error: err.message });
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/settings/export-history', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId).select('username role');
        const submissions = await Submission.find({ studentId: req.session.userId })
            .populate('testId', 'title type')
            .sort({ createdAt: -1 });

        const history = submissions.map(sub => ({
            testTitle: sub.testId?.title || 'Unknown Test',
            testType: sub.testId?.type || 'N/A',
            score: sub.score || 'N/A',
            totalQuestions: sub.totalQuestions || 'N/A',
            percentage: sub.percentage || 'N/A',
            band: sub.band || 'N/A',
            submittedAt: sub.lastSubmittedAt || sub.createdAt,
            attemptCount: sub.attemptCount || 1
        }));

        const csv = [
            'Test Title,Type,Score,Total Questions,Percentage,Band,Submitted At,Attempts',
            ...history.map(h => `"${h.testTitle}",${h.testType},${h.score},${h.totalQuestions},${h.percentage},${h.band},${new Date(h.submittedAt).toLocaleString()},${h.attemptCount}`)
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${user.username}_test_history.csv"`);
        res.send(csv);
    } catch (err) {
        res.status(500).send('Error exporting history');
    }
});

app.get('/settings/export-report', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId).select('username role createdAt');
        const submissions = await Submission.find({ studentId: req.session.userId })
            .populate('testId', 'title type')
            .sort({ createdAt: -1 });

        const totalTests = submissions.length;
        const avgScore = submissions.filter(s => s.percentage).reduce((sum, s) => sum + s.percentage, 0) / (submissions.filter(s => s.percentage).length || 1);

        const html = `
<!DOCTYPE html>
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
                <td>${sub.testId?.title || 'Unknown'}</td>
                <td style="text-transform: capitalize;">${sub.testId?.type || 'N/A'}</td>
                <td>${sub.score || 'N/A'}/${sub.totalQuestions || 'N/A'}</td>
                <td>${sub.percentage || 'N/A'}%</td>
                <td>${new Date(sub.lastSubmittedAt || sub.createdAt).toLocaleDateString()}</td>
            </tr>
            `).join('')}
        </tbody>
    </table>
    
    <div class="footer">
        <p>Generated by IELTS Test Platform</p>
    </div>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="${user.username}_progress_report.html"`);
        res.send(html);
    } catch (err) {
        res.status(500).send('Error generating report');
    }
});

// --- SCHEDULED TEST ACCESS ---
app.post('/teacher/assign-test-group', isTeacher, async (req, res) => {
    const { testId, groupId, scheduleType, availableFrom } = req.body;
    try {
        const group = await Group.findById(groupId).populate('students');
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

            // Notify students about scheduled test
            const notifications = group.students.map(student => ({
                userId: student._id,
                type: 'test_assigned',
                title: 'New test scheduled',
                message: `A new test will be available on ${new Date(availableFrom).toLocaleString()}`,
                relatedId: testId
            }));
            await Notification.insertMany(notifications);

            // Notify teacher about successful scheduling
            await Notification.create({
                userId: req.session.userId,
                type: 'general',
                title: 'Test Scheduled',
                message: `Test "${access.test.title}" scheduled for group "${group.name}" on ${new Date(availableFrom).toLocaleString()}`,
                relatedId: testId
            });
        } else {
            // Notify students about immediate test
            const notifications = group.students.map(student => ({
                userId: student._id,
                type: 'test_assigned',
                title: 'New test assigned',
                message: `A new test "${access.test.title}" has been assigned to your group`,
                relatedId: testId
            }));
            await Notification.insertMany(notifications);

            // Notify teacher about successful assignment
            await Notification.create({
                userId: req.session.userId,
                type: 'general',
                title: 'Test Assigned',
                message: `Test "${access.test.title}" assigned to group "${group.name}" (${group.students.length} students)`,
                relatedId: testId
            });
        }

        logger.info('Test assigned to group', { testId, groupId, scheduleType, teacherId: req.session.userId });
        res.redirect('/teacher-dashboard');
    } catch (err) {
        res.status(500).send("Error assigning test.");
    }
});

// --- ADMIN LOG VIEWER ---
app.get('/admin/logs', isAdmin, async (req, res) => {
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

// --- CACHE STATISTICS (Admin only) ---
app.get('/admin/cache-stats', isAdmin, (req, res) => {
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

// --- CLEAR CACHE (Admin only) ---
app.post('/admin/clear-cache', isAdmin, (req, res) => {
    const keyCount = cache.keys().length;
    cache.flushAll();
    logger.info('Cache cleared by admin', { userId: req.session.userId, keysCleared: keyCount });
    res.json({ success: true, message: `Cleared ${keyCount} cached items` });
});

// --- NOTIFICATIONS ---
app.get('/api/notifications', apiLimiter, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    try {
        const notifications = await Notification.find({ userId: req.session.userId })
            .sort({ createdAt: -1 })
            .limit(50);
        const unreadCount = await Notification.countDocuments({ userId: req.session.userId, isRead: false });
        res.json({ success: true, notifications, unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/notifications/:id/read', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    try {
        await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.session.userId },
            { isRead: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/notifications/mark-all-read', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    try {
        await Notification.updateMany(
            { userId: req.session.userId, isRead: false },
            { isRead: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- MANUAL BACKUP ENDPOINT (Admin only) ---
app.post('/admin/backup-database', isAdmin, async (req, res) => {
    try {
        console.log('🔄 Manual backup triggered by admin:', req.session.username);
        const result = await backupDatabase({ closeConnection: false });
        res.json({
            success: true,
            message: 'Backup completed successfully',
            filename: result.filename,
            size: `${(result.size / 1024 / 1024).toFixed(2)} MB`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Backup failed: ' + error.message
        });
    }
});

// Import error handlers
const { csrfErrorHandler, errorHandler } = require('./middleware/errorHandler');

// Apply Sentry error handler before custom error handlers
if (process.env.SENTRY_DSN) {
    app.use(Sentry.Handlers.errorHandler());
}

// Apply error handlers at the end
app.use(csrfErrorHandler);
app.use(errorHandler);

// --- FORCE CACHE CLEAR (for testing/debugging) ---
app.get('/force-clear-cache', (req, res) => {
    const keyCount = cache.keys().length;
    cache.flushAll();
    logger.info('Cache force cleared', { userId: req.session?.userId, keysCleared: keyCount });
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Cache Cleared</title>
            <style>
                body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 20px; border-radius: 5px; }
                .info { background: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; padding: 15px; border-radius: 5px; margin-top: 20px; }
                a { color: #007bff; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="success">
                <h2>✅ Cache Cleared Successfully!</h2>
                <p><strong>${keyCount}</strong> cached items removed.</p>
            </div>
            <div class="info">
                <h3>Next Steps:</h3>
                <ol>
                    <li>Hard refresh your browser (Ctrl+Shift+R or Cmd+Shift+R)</li>
                    <li>Go to your writing test</li>
                    <li>Timer and buttons should now work!</li>
                </ol>
                <p><a href="/admin">← Back to Admin Dashboard</a></p>
            </div>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;

// Start server only after database connection is established
async function startServer() {
    try {
        // Connect to database first
        await connectDatabase();

        // Then start the server
        app.listen(PORT, () => {
            console.log(`Server is cooking at http://localhost:${PORT} 🍲`);
            logger.info('Server started successfully', { port: PORT });

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
                        const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
                        const result = await Submission.updateMany(
                            {
                                'details.aiAnalysis': { $exists: true, $ne: null },
                                createdAt: { $lt: cutoff }
                            },
                            {
                                $unset: { 'details.aiAnalysis': 1, 'details.aiAnalyzedAt': 1 }
                            }
                        );
                        if (result.modifiedCount > 0) {
                            console.log(`🧹 Trimmed AI analysis from ${result.modifiedCount} old submissions`);
                            logger.info('AI analysis cleanup completed', { trimmedCount: result.modifiedCount });
                        } else {
                            console.log('🧹 No old AI analysis to trim');
                        }
                    } catch (error) {
                        console.error('❌ AI analysis cleanup failed:', error.message);
                        logger.error('AI analysis cleanup failed', { error: error.message });
                    }
                });
                console.log('⏰ AI analysis cleanup scheduled for 3:30 AM daily');
            }
        });
    } catch (error) {
        logger.error('Failed to start server', { error: error.message });
        process.exit(1);
    }
}

// Start the server
startServer();








