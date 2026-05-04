require('dotenv').config(); 
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs'); 
const session = require('express-session'); 
const multer = require("multer");
const mime = require('mime-types');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { generateHTMLFromTest, stringifyContent } = require('./utils/htmlExporter');
const { getAuthoringPageHtml } = require('./utils/builderAuthoring');

console.log('[B2 Config] ENDPOINT:', process.env.B2_ENDPOINT);
console.log('[B2 Config] BUCKET:', process.env.B2_BUCKET);
console.log('[B2 Config] PUBLIC_URL:', process.env.B2_PUBLIC_URL);
console.log('[B2 Config] KEY_ID:', process.env.B2_KEY_ID ? 'SET' : 'MISSING');
console.log('[B2 Config] APP_KEY:', process.env.B2_APP_KEY ? 'SET' : 'MISSING');

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
const app = express();

// --- 1. DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to the Cloud Database! 🚀"))
  .catch(err => console.log("Database connection error:", err));

// --- 2. MODELS ---
const User = require('./models/User');
const Test = require('./models/Test');
const Group = require('./models/Group');
const Submission = require('./models/Submission');

// --- 3. MIDDLEWARE & SETTINGS ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true })); 
app.use(express.json()); 
app.use(express.static('public')); 

// --- STORAGE CONFIGURATION ---
const fs = require('fs');

// Use memory storage — files go to B2, not local disk
const upload = multer({ storage: multer.memoryStorage() });

app.use(session({
    secret: process.env.SESSION_SECRET, 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } 
}));

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
    const [user, test] = await Promise.all([
        User.findById(req.session.userId).select('role assignedTests groupId teacherId username'),
        Test.findById(testId)
    ]);

    if (!user || !test) {
        return { user, test: null, isAllowed: false };
    }

    if (user.role === 'admin') {
        return { user, test, isAllowed: true };
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

        return {
            user,
            test,
            isAllowed: ownsTest || hasDirectAssignment || hasGroupAssignment
        };
    }

    if (user.role === 'student' && user.groupId) {
        const hasGroupAccess = Boolean(await Group.exists({
            _id: user.groupId,
            assignedTests: test._id
        }));

        return { user, test, isAllowed: hasGroupAccess };
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

    if (existing) {
        Object.assign(existing, submissionPayload);
        await existing.save();
        return { ignored: false, submission: existing };
    }

    const submission = new Submission({
        testId: access.test._id,
        studentId: student._id,
        ...submissionPayload
    });

    await submission.save();
    return { ignored: false, submission };
}

async function saveValidatedTest({ title, type, content, builderJson, req }) {
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

// --- 5. ROUTES ---

app.get('/', (req, res) => {
    res.render('index', { user: req.session.username });
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.userRole = user.role;
            req.session.username = user.username;

            if (user.role === 'admin') return res.redirect('/admin');
            if (user.role === 'teacher') return res.redirect('/teacher-dashboard');
            return res.redirect('/student-dashboard');
        } else {
            res.send("Invalid username or password. <a href='/login'>Try again</a>");
        }
    } catch (err) {
        res.status(500).send("Login error.");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- ADMIN ROUTES ---

app.get('/admin', isAdmin, async (req, res) => {
    try {
        const tests = await Test.find({}).sort({ type: 1, title: 1 });
        const teachers = await User.find({ role: 'teacher' }).populate('assignedTests');
        res.render('admin', {
            tests,
            teachers,
            testsByType: groupTestsByType(tests)
        });
    } catch (err) {
        res.status(500).send("Error loading dashboard data.");
    }
});

app.get('/create-test', isAdmin, (req, res) => {
    res.render('create-test-hub'); 
});

app.get('/create-test/reading', isAdmin, (req, res) => {
    res.send(getAuthoringPageHtml('reading'));
});

app.get('/create-test/listening', isAdmin, (req, res) => {
    res.send(getAuthoringPageHtml('listening'));
});

app.get('/create-test/writing', isAdmin, (req, res) => {
    res.send(getAuthoringPageHtml('writing'));
});

// --- EDIT TEST ROUTES ---
app.get('/edit-test/:id', isTeacher, async (req, res) => {
    try {
        const allowed = await canEditTest(req, req.params.id);
        if (!allowed) {
            return res.status(403).send('Not authorized to edit this test.');
        }

        const test = await Test.findById(req.params.id);
        if (!test) {
            return res.status(404).send("Test not found.");
        }

        // Send builder HTML with the test data pre-loaded
        const builderHtml = getAuthoringPageHtml(test.type, test);
        res.send(builderHtml);
    } catch (err) {
        res.status(500).send("Error loading test for editing: " + err.message);
    }
});

app.post('/update-test/:id', isTeacher, upload.any(), async (req, res) => {
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

        res.json({ success: true, message: "Test updated successfully." });
    } catch (err) {
        console.error("Update test error:", err);
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
app.post('/create-test/listening', isAdmin, upload.any(), async (req, res) => {
    try {
        const audioUrls = {};
        
        // 1. Upload files to B2
        if (req.files && req.files.length > 0) {
            await Promise.all(req.files.map(async (file) => {
                const ext = path.extname(file.originalname || '').toLowerCase() || '.mp3';
                const filename = `listening-${file.fieldname}-${Date.now()}${ext}`;
                audioUrls[file.fieldname] = await uploadToB2(file.buffer, filename, file.mimetype);
            }));
        }

        // 2. Если файл 'audioFile' не загружен, берем ссылку из текстового поля audioUrl
        // Это позволит работать и загрузке, и вставке ссылок
        const finalFullAudio = audioUrls['audioFile'] || req.body.audioUrl || null;

        const partsPayload = JSON.parse(req.body.parts || '{}');
        const parts = {};
        for (let index = 1; index <= 4; index += 1) {
            const source = partsPayload[index] ?? partsPayload[String(index)] ?? '';
            parts[index] = typeof source === 'string'
                ? { finalHtml: source }
                : { ...(source || {}), finalHtml: source?.finalHtml ?? source?.html ?? '' };
        }
        
        const contentObj = {
            // ТЕПЕРЬ ТУТ БУДЕТ ЛИБО ПУТЬ К ФАЙЛУ, ЛИБО ССЫЛКА
            fullAudio: finalFullAudio, 
            audioParts: [
                audioUrls['part1'] || null,
                audioUrls['part2'] || null,
                audioUrls['part3'] || null,
                audioUrls['part4'] || null
            ],
            parts,
            answerKey: JSON.parse(req.body.answerKey || '{}'),
            includePause: req.body.usePause === 'true'
        };

        const newTest = await saveValidatedTest({
            title: req.body.title,
            type: 'listening',
            content: contentObj,
            builderJson: req.body.builderJson || null,
            req
        });

        res.json({
            success: true,
            message: "Listening test saved successfully.",
            testId: newTest._id
        });
    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- READING TEST CREATION ---
app.post('/create-test/reading', isAdmin, async (req, res) => {
    try {
        const newTest = await saveValidatedTest({
            title: req.body.title,
            type: 'reading',
            content: req.body.content,
            builderJson: req.body.builderJson || null,
            req
        });

        res.json({ success: true, message: "Reading test created successfully!", testId: newTest._id });
    } catch (err) {
        console.error("Reading test save error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- WRITING TEST CREATION ---
app.post('/create-test/writing', isAdmin, async (req, res) => {
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

        res.json({ success: true, message: "Writing test created successfully!", testId: newTest._id });
    } catch (err) {
        console.error("Writing test save error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- THE UPGRADED "SAVE" ROUTE ---
app.post('/create-test/:type', isAdmin, async (req, res) => {
    try {
        const { title, content } = req.body;
        const testType = req.params.type; 

        const newTest = await saveValidatedTest({
            title,
            type: testType,
            content,
            req
        });

        res.json({ success: true, message: `Saved ${testType} test successfully.` });
    } catch (err) {
        console.error("Save Error:", err);
        res.status(500).json({ success: false, error: err.message || "Database save failed." });
    }
});

app.get('/admin/add-teacher', isAdmin, (req, res) => {
    res.render('add-teacher');
});

app.post('/admin/add-teacher', isAdmin, async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.send("Username taken. <a href='/admin/add-teacher'>Try again</a>");

        const hashedPassword = await bcrypt.hash(password, 10);
        const newTeacher = new User({
            username: username,
            password: hashedPassword,
            role: 'teacher'
        });

        await newTeacher.save();
        res.send(`<h1>Success!</h1><p>Teacher '${username}' created.</p><a href='/admin'>Back</a>`);
    } catch (err) {
        res.status(500).send("Error creating teacher.");
    }
});

app.post('/admin/assign-test', isAdmin, async (req, res) => {
    const { teacherId, testId } = req.body;
    try {
        await User.findByIdAndUpdate(teacherId, { $addToSet: { assignedTests: testId } });
        res.send("<h1>Success!</h1><p>Test assigned.</p><a href='/admin'>Back</a>");
    } catch (err) {
        res.status(500).send("Error assigning test.");
    }
});

// --- TEACHER ROUTES ---

app.get('/teacher-dashboard', isTeacher, async (req, res) => {
    try {
        const [teacher, groups, allStudents, submissions] = await Promise.all([
            User.findById(req.session.userId).populate({
                path: 'assignedTests',
                options: { sort: { type: 1, title: 1 } }
            }),
            Group.find({ teacherId: req.session.userId })
                .populate('students assignedTests')
                .sort({ name: 1 }),
            User.find({ teacherId: req.session.userId, role: 'student' }).sort({ username: 1 }),
            Submission.find({ teacherId: req.session.userId }).select('testId studentId lastSubmittedAt')
        ]);

        const groupStatsByTestId = new Map();
        groups.forEach((group) => {
            const uniqueStudentIds = [...new Set((group.students || []).map((student) => String(student._id)))];
            (group.assignedTests || []).forEach((test) => {
                const key = String(test._id);
                if (!groupStatsByTestId.has(key)) {
                    groupStatsByTestId.set(key, {
                        groupCount: 0,
                        studentIds: new Set()
                    });
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
                submissionStatsByTestId.set(key, {
                    completedCount: 0,
                    studentIds: new Set(),
                    latestSubmissionAt: null
                });
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

        const tests = (teacher?.assignedTests || [])
            .filter((testDoc) => testDoc != null)
            .map((testDoc) => {
                const test = typeof testDoc.toObject === 'function' ? testDoc.toObject() : { ...testDoc };
                const groupStats = groupStatsByTestId.get(String(test._id));
                const submissionStats = submissionStatsByTestId.get(String(test._id));

                return {
                    ...test,
                    assignedGroupCount: groupStats ? groupStats.groupCount : 0,
                    assignedStudentCount: groupStats ? groupStats.studentIds.size : 0,
                    completedStudentCount: submissionStats ? submissionStats.completedCount : 0,
                    latestSubmissionAt: submissionStats ? submissionStats.latestSubmissionAt : null
                };
            })
            .sort((left, right) => left.title.localeCompare(right.title));

        res.render('teacher-dashboard', {
            teacher,
            tests,
            testsByType: groupTestsByType(tests),
            allStudents,
            groups,
            stats: {
                testsCount: tests.length,
                groupsCount: groups.length,
                studentsCount: allStudents.length
            }
        });
    } catch (err) {
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
        console.error('Add student error:', err);
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

app.post('/teacher/assign-test-group', isTeacher, async (req, res) => {
    const { testId, groupId } = req.body;
    try {
        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).send("Group not found.");
        }

        if (req.session.userRole !== 'admin' && String(group.teacherId) !== String(req.session.userId)) {
            return res.status(403).send("Not authorized to assign tests to this group.");
        }

        const access = await getAccessibleTest(req, testId);
        if (!access.test || !access.isAllowed) {
            return res.status(403).send("You do not have access to this test.");
        }

        await Group.findByIdAndUpdate(groupId, { $addToSet: { assignedTests: testId } });
        res.redirect('/teacher-dashboard');
    } catch (err) {
        res.status(500).send("Error assigning test.");
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
            submissionQuery.teacherId = req.session.userId;
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
        console.error('Teacher progress error:', err);
        res.status(500).send("Error loading test progress.");
    }
});

// --- THE ULTIMATE STUDENT VIEWER (BUILDER-MATCHED HTML) ---
app.get('/view-test/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const access = await getAccessibleTest(req, req.params.id);
        if (!access.test) return res.status(404).send("Test not found.");
        if (!access.isAllowed) return res.status(403).send("Not authorized to view this test.");

        try {
            const html = generateHTMLFromTest(access.test, {
                groqApiKey: process.env.GROQ_API_KEY || ''
            });
            return res.send(html);
        } catch (generatorErr) {
            console.error('HTML generation error:', generatorErr);
            console.error('Test data:', access.test);
            return res.status(500).send(`Error generating test HTML: ${generatorErr.message}`);
        }
    } catch (err) {
        console.error('View test error:', err);
        res.status(500).send(`Error loading test: ${err.message}`);
    }
});

// --- DOWNLOAD STANDALONE HTML TEST ---

app.get('/download-test/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
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
                groqApiKey: process.env.GROQ_API_KEY || ''
            });
            const safeTitle = access.test.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        } catch (generatorErr) {
            console.error('HTML generation error for download:', generatorErr);
            console.error('Test data:', access.test);
            return res.status(500).send(`Error generating test HTML: ${generatorErr.message}`);
        }
    } catch (err) {
        console.error('Download test error:', err);
        res.status(500).send(`Error downloading test: ${err.message}`);
    }
});

// --- SUBMISSION CAPTURE ---
app.post('/api/test-submissions', async (req, res) => {
    if(!req.session.userId) return res.status(401).json({ success: false, message: "Not logged in" });
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
        console.error('Submission error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/submit-writing-test', async (req, res) => {
    if(!req.session.userId) return res.status(401).json({ success: false, message: "Not logged in" });
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
        console.error('Submission error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- STUDENT DASHBOARD ---

app.get('/student-dashboard', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const [student, submissions] = await Promise.all([
            User.findById(req.session.userId).populate({
                path: 'groupId',
                populate: { path: 'assignedTests', options: { sort: { type: 1, title: 1 } } }
            }),
            Submission.find({ studentId: req.session.userId }).select('testId score totalQuestions band percentage lastSubmittedAt')
        ]);

        const submissionsByTestId = new Map(
            submissions.map((submission) => [String(submission.testId), submission])
        );

        const tests = (student.groupId ? student.groupId.assignedTests : []).map((testDoc) => {
            const test = typeof testDoc.toObject === 'function' ? testDoc.toObject() : { ...testDoc };
            return {
                ...test,
                submission: submissionsByTestId.get(String(test._id)) || null
            };
        });
        const groupName = student.groupId ? student.groupId.name : "No Group Assigned";
        res.render('student-dashboard', {
            student,
            tests,
            testsByType: groupTestsByType(tests),
            groupName
        });
    } catch (err) {
        res.status(500).send("Error loading student dashboard.");
    }
});

// --- DELETE ROUTES ---

// Delete a test
app.post('/delete-test/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const test = await Test.findById(req.params.id);
        if (!test) return res.status(404).json({ success: false, message: "Test not found" });
        
        const user = await User.findById(req.session.userId);
        
        // Check authorization: only admin or the teacher who created it can delete
        if (user.role !== 'admin' && (user.role !== 'teacher' || test.createdBy.toString() !== req.session.userId)) {
            return res.status(403).json({ success: false, message: "Not authorized to delete this test" });
        }
        
        // Remove test from all groups and teachers' assigned lists
        await Group.updateMany({ assignedTests: test._id }, { $pull: { assignedTests: test._id } });
        await User.updateMany({ assignedTests: test._id }, { $pull: { assignedTests: test._id } });

        await Submission.deleteMany({ testId: test._id });
        
        // Delete the test
        await Test.findByIdAndDelete(req.params.id);
        
        res.json({ success: true, message: "Test deleted successfully", redirect: req.body.redirect || '/teacher-dashboard' });
    } catch (err) {
        console.error('Delete test error:', err);
        res.status(500).json({ success: false, message: "Error deleting test: " + err.message });
    }
});

// Delete a student account
app.post('/delete-student/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const student = await User.findById(req.params.id);
        if (!student) return res.status(404).json({ success: false, message: "Student not found" });
        
        const user = await User.findById(req.session.userId);
        
        // Check authorization: only admin or the student's teacher can delete a student
        if (user.role !== 'admin') {
            if (user.role !== 'teacher') {
                return res.status(403).json({ success: false, message: "Not authorized to delete this student" });
            }
            if (!student.teacherId || String(student.teacherId) !== String(user._id)) {
                return res.status(403).json({ success: false, message: "Cannot delete students from other teachers" });
            }
        }
        
        // Remove student from group if they belong to one
        if (student.groupId) {
            await Group.findByIdAndUpdate(student.groupId, { $pull: { students: student._id } });
        }
        
        // Delete the student account
        await Submission.deleteMany({ studentId: student._id });
        await User.findByIdAndDelete(req.params.id);
        
        res.json({ success: true, message: "Student account deleted successfully", redirect: req.body.redirect || '/teacher-dashboard' });
    } catch (err) {
        console.error('Delete student error:', err);
        res.status(500).json({ success: false, message: "Error deleting student: " + err.message });
    }
});

// Delete a teacher account
app.post('/delete-teacher/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const teacher = await User.findById(req.params.id);
        if (!teacher) return res.status(404).json({ success: false, message: "Teacher not found" });
        
        const user = await User.findById(req.session.userId);
        
        // Check authorization: only admin can delete teachers
        if (user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Only admins can delete teachers" });
        }
        
        if (teacher.role !== 'teacher') {
            return res.status(400).json({ success: false, message: "User is not a teacher" });
        }
        
        // Find all tests created by this teacher
        const teacherTests = await Test.find({ createdBy: teacher._id });
        const testIds = teacherTests.map(t => t._id);
        
        // Remove tests from all groups
        if (testIds.length > 0) {
            await Group.updateMany({ assignedTests: { $in: testIds } }, { $pull: { assignedTests: { $in: testIds } } });
            await User.updateMany({ assignedTests: { $in: testIds } }, { $pull: { assignedTests: { $in: testIds } } });
        }

        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Teacher account and associated tests deleted successfully", redirect: req.body.redirect || '/admin' });
    } catch (err) {
        console.error('Delete teacher error:', err);
        res.status(500).json({ success: false, message: "Error deleting teacher: " + err.message });
    }
});

// Remove a student from a group (keep account, just remove from group)
app.post('/remove-student-from-group/:groupId/:studentId', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const group = await Group.findById(req.params.groupId);
        if (!group) return res.status(404).json({ success: false, message: "Group not found" });
        
        const user = await User.findById(req.session.userId);
        
        // Check authorization: only teacher who owns the group can remove students
        if (user.role !== 'admin' && (user.role !== 'teacher' || group.teacherId.toString() !== req.session.userId)) {
            return res.status(403).json({ success: false, message: "Not authorized to remove students from this group" });
        }
        
        // Remove student from group
        await Group.findByIdAndUpdate(req.params.groupId, { $pull: { students: req.params.studentId } });
        await User.findByIdAndUpdate(req.params.studentId, { $unset: { groupId: 1 } });
        
        res.json({ success: true, message: "Student removed from group successfully", redirect: req.body.redirect || '/teacher-dashboard' });
    } catch (err) {
        console.error('Remove student from group error:', err);
        res.status(500).json({ success: false, message: "Error removing student: " + err.message });
    }
});

// Delete a group
app.post('/delete-group/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const group = await Group.findById(req.params.id);
        if (!group) return res.status(404).json({ success: false, message: "Group not found" });
        
        const user = await User.findById(req.session.userId);
        
        if (user.role !== 'admin' && (user.role !== 'teacher' || String(group.teacherId) !== String(user._id))) {
            return res.status(403).json({ success: false, message: "Not authorized to delete this group" });
        }
        
        // Remove group reference from all students
        await User.updateMany({ groupId: group._id }, { $unset: { groupId: 1 } });
        
        // Delete the group
        await Group.findByIdAndDelete(req.params.id);
        
        res.json({ success: true, message: "Group deleted successfully", redirect: req.body.redirect || '/teacher-dashboard' });
    } catch (err) {
        console.error('Delete group error:', err);
        res.status(500).json({ success: false, message: "Error deleting group: " + err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is cooking at http://localhost:${PORT} 🍲`);
});
