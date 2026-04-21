require('dotenv').config(); 
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs'); 
const session = require('express-session'); 
const { S3Client } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");
const { generateHTMLFromTest } = require('./utils/htmlExporter');
const app = express();

// --- 1. DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to the Cloud Database! 🚀"))
  .catch(err => console.log("Database connection error:", err));

// --- 2. MODELS ---
const User = require('./models/User');
const Test = require('./models/Test');
const Group = require('./models/Group');

// --- 3. MIDDLEWARE & SETTINGS ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true })); 
app.use(express.json()); 
app.use(express.static('public')); 

// --- STORAGE CONFIGURATION (Cloudflare R2) ---
const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.R2_BUCKET_NAME,
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.mp3';
    // Теперь имя будет: listening-part1-1713712345678.mp3
    cb(null, `listening-${file.fieldname}-${Date.now()}${ext}`);
        }
    })
});

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
        const tests = await Test.find({});
        const teachers = await User.find({ role: 'teacher' });
        res.render('admin', { tests: tests, teachers: teachers }); 
    } catch (err) {
        res.status(500).send("Error loading dashboard data.");
    }
});

app.get('/create-test', isAdmin, (req, res) => {
    res.render('create-test-hub'); 
});

app.get('/create-test/reading', isAdmin, (req, res) => { res.render('create-test-reading'); });
app.get('/create-test/listening', isAdmin, (req, res) => { res.render('create-test-listening'); });
app.get('/create-test/writing', isAdmin, (req, res) => { res.render('create-test-writing'); });

// --- GENERIC FILE UPLOAD ---
app.post('/upload-test', isAdmin, upload.single('audioFile'), async (req, res) => {
    try {
        const fileUrl = req.file ? req.file.location : null;
        res.json({ success: true, url: fileUrl });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- LISTENING TEST UPLOAD (Direct to R2) ---
app.post('/create-test/listening', isAdmin, upload.any(), async (req, res) => {
    try {
        let audioUrls = {};
        
        // Перебираем все загруженные файлы и сохраняем их ссылки
        if (req.files) {
            req.files.forEach(file => {
                // file.fieldname будет 'audioFile' или 'part1', 'part2' и т.д.
                audioUrls[file.fieldname] = file.location;
            });
        }
        
        const contentObj = {
            // Если есть целое аудио — берем его, если нет — берем по частям
            audioUrl: audioUrls['audioFile'] || null,
            partUrls: [
                audioUrls['part1'] || null,
                audioUrls['part2'] || null,
                audioUrls['part3'] || null,
                audioUrls['part4'] || null
            ],
            parts: JSON.parse(req.body.parts || '[]'),
            answerKey: JSON.parse(req.body.answerKey || '{}'),
            usePause: req.body.usePause === 'true'
        };

        const newTest = new Test({
            title: req.body.title,
            type: 'listening',
            teacherName: req.session.username,
            createdBy: req.session.userId,
            readingPassage: JSON.stringify(contentObj)
        });

        await newTest.save();
        res.json({ success: true, message: "Test with multiple audios saved!" });
    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- THE UPGRADED "SAVE" ROUTE ---
app.post('/create-test/:type', isAdmin, async (req, res) => {
    try {
        const { title, content } = req.body;
        const testType = req.params.type; 

        // Ensure we are saving a clean stringified version of the content
        const testDataToSave = typeof content === 'string' ? content : JSON.stringify(content);

        const newTest = new Test({
            title: title,
            type: testType,
            teacherName: req.session.username,
            createdBy: req.session.userId, // Add reference to the teacher/admin who created it
            readingPassage: testDataToSave 
        });

        await newTest.save();
        res.json({ success: true, message: `Saved ${testType} test successfully.` });
    } catch (err) {
        console.error("Save Error:", err);
        res.status(500).json({ success: false, error: "Database save failed." });
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
        const teacher = await User.findById(req.session.userId).populate('assignedTests');
        const groups = await Group.find({ teacherId: req.session.userId }).populate('students assignedTests');
        const allStudents = await User.find({ teacherId: req.session.userId, role: 'student' });
        
        res.render('teacher-dashboard', { 
            teacher: teacher, 
            tests: teacher.assignedTests, 
            allStudents: allStudents, 
            groups: groups 
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
        const hashedPassword = await bcrypt.hash(password, 10);
        const newStudent = new User({
            username: username,
            password: hashedPassword,
            role: 'student',
            teacherId: req.session.userId 
        });
        await newStudent.save();
        res.send(`<h1>Student '${username}' Created!</h1><a href='/teacher-dashboard'>Back</a>`);
    } catch (err) {
        res.status(500).send("Error creating student.");
    }
});

app.post('/teacher/create-group', isTeacher, async (req, res) => {
    try {
        const { groupName } = req.body;
        const newGroup = new Group({ name: groupName, teacherId: req.session.userId });
        await newGroup.save();
        res.redirect('/teacher-dashboard');
    } catch (err) {
        res.status(500).send("Error creating group.");
    }
});

app.post('/teacher/assign-to-group', isTeacher, async (req, res) => {
    const { studentId, groupId } = req.body;
    try {
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
        await Group.findByIdAndUpdate(groupId, { $addToSet: { assignedTests: testId } });
        res.redirect('/teacher-dashboard');
    } catch (err) {
        res.status(500).send("Error assigning test.");
    }
});

// --- THE ULTIMATE STUDENT VIEWER (BUILDER-MATCHED HTML) ---
app.get('/view-test/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const test = await Test.findById(req.params.id);
        if (!test) return res.status(404).send("Test not found.");
        
        if (test.type === 'reading' || test.type === 'listening') {
            try {
                const html = generateHTMLFromTest(test);
                return res.send(html);
            } catch (generatorErr) {
                console.error('HTML generation error:', generatorErr);
                console.error('Test data:', test);
                return res.status(500).send(`Error generating test HTML: ${generatorErr.message}`);
            }
        }

        res.send(`<h1>${test.title}</h1><p>Test type ${test.type} viewer is coming soon.</p>`);
    } catch (err) {
        console.error('View test error:', err);
        res.status(500).send(`Error loading test: ${err.message}`);
    }
});

// --- DOWNLOAD STANDALONE HTML TEST ---

app.get('/download-test/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const test = await Test.findById(req.params.id);
        if (!test) return res.status(404).send("Test not found.");
        
        try {
            // Generate HTML using the exporter module
            const html = generateHTMLFromTest(test);
            const safeTitle = test.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.html"`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        } catch (generatorErr) {
            console.error('HTML generation error for download:', generatorErr);
            console.error('Test data:', test);
            return res.status(500).send(`Error generating test HTML: ${generatorErr.message}`);
        }
    } catch (err) {
        console.error('Download test error:', err);
        res.status(500).send(`Error downloading test: ${err.message}`);
    }
});

// --- STUDENT DASHBOARD ---

app.get('/student-dashboard', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const student = await User.findById(req.session.userId).populate({
            path: 'groupId',
            populate: { path: 'assignedTests' }
        });
        const tests = student.groupId ? student.groupId.assignedTests : [];
        const groupName = student.groupId ? student.groupId.name : "No Group Assigned";
        res.render('student-dashboard', { student, tests, groupName });
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
        
        // Remove test from all groups
        await Group.updateMany({ assignedTests: test._id }, { $pull: { assignedTests: test._id } });
        
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
        
        // Check authorization: only admin or teacher in the same group can delete a student
        if (user.role !== 'admin') {
            if (user.role !== 'teacher' || !user.groupId) {
                return res.status(403).json({ success: false, message: "Not authorized to delete this student" });
            }
            if (student.groupId.toString() !== user.groupId.toString()) {
                return res.status(403).json({ success: false, message: "Cannot delete students from other groups" });
            }
        }
        
        // Remove student from group if they belong to one
        if (student.groupId) {
            await Group.findByIdAndUpdate(student.groupId, { $pull: { students: student._id } });
        }
        
        // Delete the student account
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
        }
        
        // Delete all tests created by this teacher
        await Test.deleteMany({ createdBy: teacher._id });
        
        // Find group managed by this teacher and remove reference
        await Group.updateOne({ teacherId: teacher._id }, { $unset: { teacherId: 1 } });
        
        // Delete the teacher account
        await User.findByIdAndDelete(req.params.id);
        
        res.json({ success: true, message: "Teacher account and associated tests deleted successfully", redirect: req.body.redirect || '/admin-dashboard' });
    } catch (err) {
        console.error('Delete teacher error:', err);
        res.status(500).json({ success: false, message: "Error deleting teacher: " + err.message });
    }
});

// Delete a group (admin only)
app.post('/delete-group/:id', async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    try {
        const group = await Group.findById(req.params.id);
        if (!group) return res.status(404).json({ success: false, message: "Group not found" });
        
        const user = await User.findById(req.session.userId);
        
        // Check authorization: only admin can delete groups
        if (user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Only admins can delete groups" });
        }
        
        // Remove group reference from all students
        await User.updateMany({ groupId: group._id }, { $unset: { groupId: 1 } });
        
        // Delete the group
        await Group.findByIdAndDelete(req.params.id);
        
        res.json({ success: true, message: "Group deleted successfully", redirect: req.body.redirect || '/admin-dashboard' });
    } catch (err) {
        console.error('Delete group error:', err);
        res.status(500).json({ success: false, message: "Error deleting group: " + err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is cooking at http://localhost:${PORT} 🍲`);
});
