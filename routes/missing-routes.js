// Oracle-missing routes — add these before the 404 handler in server-oracle.js
// Require this file with: require('./routes/missing-routes')(app, { doubleCsrfProtection, apiLimiter, isTeacher, isAdmin });
const User = require('../database/models/user');
const Test = require('../database/models/test');
const Submission = require('../database/models/submission');
const Group = require('../database/models/group');
const Feedback = require('../database/models/feedback');
const Notification = require('../database/models/notification');
const logger = require('../utils/logger');
const { detectPatterns } = require('../utils/aiAnalysis');
module.exports = function(app, { doubleCsrfProtection, apiLimiter, isTeacher, isAdmin, canEditTest, getAccessibleTest, saveStudentSubmission }) {

    // === ALIAS ROUTES (templates use /student/ prefix, but routes are unprefixed) ===
    app.get('/student/ai-chat', (req, res) => { if (!req.session.userId) return res.redirect('/login'); res.redirect('/ai-chat'); });
    app.get('/student/ai-feedback/:submissionId', (req, res) => { if (!req.session.userId) return res.redirect('/login'); res.redirect('/ai-feedback/' + req.params.submissionId); });
    app.get('/student/feedback', doubleCsrfProtection, (req, res) => { if (!req.session.userId) return res.redirect('/login'); res.redirect('/feedback'); });
    app.post('/student/feedback', doubleCsrfProtection, async (req, res) => {
        if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
        try {
            const { testType, questionType, issueDescription } = req.body;
            const student = await User.findById(req.session.userId);
            await Feedback.create({
                studentId: req.session.userId,
                studentName: student ? student.username : 'Unknown',
                testType: testType || 'general',
                questionType: questionType || '',
                issueDescription: issueDescription || ''
            });
            logger.info('Feedback submitted', { studentId: req.session.userId, testType });
            res.json({ success: true, message: 'Feedback submitted successfully' });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
    app.get('/teacher/analytics', isTeacher, (req, res) => { res.redirect('/analytics'); });

    // === TEACHER: PROGRESS BY TEST ===
    app.get('/teacher/progress/:id', isTeacher, async (req, res) => {
        try {
            const access = await getAccessibleTest(req, req.params.id);
            if (!access.test) return res.status(404).send('Test not found.');
            if (!access.isAllowed) return res.status(403).send('Not authorized to view this test.');

            const testId = access.test._id;
            const userId = req.session.userId;

            const groups = await Group.find({ teacherId: userId });
            const submissions = await Submission.find({
                testId,
                $or: [{ teacherId: userId }, { teacherId: null }]
            });
            const students = await User.find({ role: 'student', teacherId: userId });

            const studentRows = new Map();
            students.forEach(s => {
                studentRows.set(String(s._id), {
                    studentId: s._id,
                    studentName: s.username,
                    groupName: 'Ungrouped',
                    submission: null,
                    isAssigned: false
                });
            });

            groups.forEach(group => {
                const hasTest = (group.assignedTests || []).some(t => {
                    const tid = typeof t === 'object' ? String(t._id || t.testId) : String(t);
                    return tid === String(testId);
                });
                if (hasTest) {
                    (group.students || []).forEach(student => {
                        const sid = typeof student === 'object' ? String(student._id || student) : String(student);
                        const row = studentRows.get(sid);
                        if (row) row.isAssigned = true;
                    });
                }
            });

            submissions.forEach(sub => {
                const key = String(sub.studentId);
                const existing = studentRows.get(key) || {
                    studentId: sub.studentId,
                    studentName: sub.studentName || 'Unknown',
                    groupName: 'Ungrouped',
                    submission: null,
                    isAssigned: false
                };
                existing.studentName = existing.studentName || sub.studentName;
                existing.submission = sub;
                studentRows.set(key, existing);
            });

            const rows = [...studentRows.values()].sort((a, b) => {
                if (a.groupName !== b.groupName) return a.groupName.localeCompare(b.groupName);
                return a.studentName.localeCompare(b.studentName);
            });

            const scoredSubmissions = submissions.filter(s => typeof s.score === 'number' && isFinite(s.score));
            const averageScore = scoredSubmissions.length
                ? (scoredSubmissions.reduce((sum, s) => sum + s.score, 0) / scoredSubmissions.length)
                : null;
            const averagePercentage = scoredSubmissions.length
                ? Math.round(scoredSubmissions.reduce((sum, s) => sum + (s.percentage || 0), 0) / scoredSubmissions.length)
                : null;

            res.render('teacher-progress', {
                currentUser: req.session.username,
                currentRole: req.session.userRole,
                test: access.test,
                groups,
                rows,
                summary: {
                    assignedStudents: rows.filter(r => r.isAssigned).length,
                    completedStudents: rows.filter(r => r.submission).length,
                    pendingStudents: rows.filter(r => r.isAssigned && !r.submission).length,
                    averageScore,
                    averagePercentage
                }
            });
        } catch (err) {
            logger.error('Teacher progress error', { error: err.message, stack: err.stack, userId: req.session.userId });
            res.status(500).send('Error loading test progress.');
        }
    });

    // === TEACHER: AI PATTERN ANALYSIS FOR STUDENT ===
    app.get('/teacher/student-patterns/:studentId', isTeacher, async (req, res) => {
        try {
            const student = await User.findById(req.params.studentId);
            if (!student) return res.status(404).send('Student not found');

            if (req.session.userRole !== 'admin' && String(student.teacherId) !== String(req.session.userId)) {
                return res.status(403).send('Not authorized');
            }

            const submissions = await Submission.find({ studentId: req.params.studentId });
            const recentSubs = (submissions || []).slice(-5);

            if (recentSubs.length < 2) {
                return res.send(`<!DOCTYPE html><html><head><title>Pattern Analysis</title></head><body style="font-family:sans-serif;padding:40px;text-align:center;"><h1>Not Enough Data</h1><p>Student needs at least 2 test submissions for pattern analysis.</p><a href="/teacher-dashboard" style="color:#667eea;">Back to Dashboard</a></body></html>`);
            }

            const patternResult = await detectPatterns(req.params.studentId, recentSubs);

            res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Student Pattern Analysis</title><style>body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%);padding:40px}.container{max-width:900px;margin:0 auto}.header{background:white;padding:30px;border-radius:20px;margin-bottom:24px;box-shadow:0 10px 30px rgba(0,0,0,0.1)}.header h1{font-size:2rem;font-weight:900;color:#1f2937;margin-bottom:10px}.content{background:white;padding:32px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.1);line-height:1.8;white-space:pre-wrap}.back-btn{display:inline-block;padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:12px;font-weight:700;margin-bottom:20px}</style></head><body><div class="container"><a href="/teacher-dashboard" class="back-btn">← Back to Dashboard</a><div class="header"><h1>🔍 Pattern Analysis: ${student.username}</h1><p style="color:#64748b;">AI-powered analysis of ${recentSubs.length} recent test submissions</p></div><div class="content">${patternResult.success ? patternResult.patterns : 'Pattern analysis unavailable at this time.'}</div></div></body></html>`);
        } catch (err) {
            logger.error('Pattern analysis error', { error: err.message });
            res.status(500).send('Error generating pattern analysis.');
        }
    });

    // === TEACHER: UPDATE TEST META (RENAME / FOLDER) ===
    app.post('/teacher/update-test-meta/:id', isTeacher, doubleCsrfProtection, async (req, res) => {
        try {
            const test = await Test.findById(req.params.id);
            if (!test) return res.status(404).json({ success: false, message: 'Test not found' });

            const allowed = await canEditTest(req, req.params.id);
            if (!allowed && req.session.userRole !== 'admin') {
                const user = await User.findById(req.session.userId);
                const hasAssigned = (user && user.assignedTests || []).some(
                    tid => String(tid) === String(req.params.id)
                );
                if (!hasAssigned) return res.status(403).json({ success: false, message: 'Not authorized' });
            }

            const updateFields = {};
            if (req.body.customTitle !== undefined) updateFields.customTitle = String(req.body.customTitle).trim();
            if (req.body.folder !== undefined) updateFields.folder = String(req.body.folder).trim();
            await Test.findByIdAndUpdate(req.params.id, updateFields);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // === ADMIN: FEEDBACK MANAGEMENT ===
    app.get('/admin/feedback', isAdmin, async (req, res) => {
        try {
            const status = req.query.status || 'open';
            const feedback = await Feedback.find({ status });
            res.render('admin-feedback', { feedback, status });
        } catch (err) {
            res.status(500).send('Error loading feedback');
        }
    });

    app.post('/admin/feedback/:id/resolve', isAdmin, doubleCsrfProtection, async (req, res) => {
        try {
            const { adminNotes, adminReply } = req.body;
            await Feedback.findByIdAndUpdate(req.params.id, {
                status: 'resolved',
                adminNotes: adminNotes || null,
                adminReply: adminReply || null,
                resolvedAt: new Date()
            });
            logger.info('Feedback resolved', { feedbackId: req.params.id, adminId: req.session.userId });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/admin/feedback/:id/reply', isAdmin, doubleCsrfProtection, async (req, res) => {
        try {
            const { reply, studentId } = req.body;
            if (!reply || !reply.trim()) {
                return res.status(400).json({ success: false, message: 'Reply message is required' });
            }
            await Feedback.findByIdAndUpdate(req.params.id, { adminReply: reply.trim() });
            if (studentId) {
                await Notification.create({
                    userId: studentId, type: 'admin_reply', title: 'Admin replied to your feedback',
                    message: reply.trim(), relatedId: req.params.id, isRead: 0
                });
            }
            logger.info('Reply sent to student', { feedbackId: req.params.id, studentId, adminId: req.session.userId });
            res.json({ success: true, message: 'Reply sent successfully' });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // === SETTINGS: STUDENT EXPORT HISTORY (CSV) ===
    app.get('/settings/export-history', async (req, res) => {
        if (!req.session.userId) return res.redirect('/login');
        try {
            const user = await User.findById(req.session.userId);
            const submissions = await Submission.find({ studentId: req.session.userId });
            const history = (submissions || []).map(sub => ({
                testTitle: sub.testTitle || 'Unknown Test', testType: sub.type || 'N/A',
                score: sub.score || 'N/A', totalQuestions: sub.totalQuestions || 'N/A',
                percentage: sub.percentage || 'N/A', band: sub.band || 'N/A',
                submittedAt: sub.lastSubmittedAt || sub.firstSubmittedAt || 'N/A',
                attemptCount: sub.attemptCount || 1
            }));
            const csv = [
                'Test Title,Type,Score,Total Questions,Percentage,Band,Submitted At,Attempts',
                ...history.map(h => `"${h.testTitle}",${h.testType},${h.score},${h.totalQuestions},${h.percentage},${h.band},"${h.submittedAt}",${h.attemptCount}`)
            ].join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${(user && user.username) || 'student'}_test_history.csv"`);
            res.send(csv);
        } catch (err) {
            res.status(500).send('Error exporting history');
        }
    });

    // === REMOVE STUDENT FROM GROUP (unprefixed alias matching template) ===
    app.post('/remove-student-from-group/:groupId/:studentId', doubleCsrfProtection, async (req, res) => {
        if (!req.session.userId) return res.status(401).json({ success: false, message: 'Not logged in' });
        try {
            const { groupId, studentId } = req.params;
            const group = await Group.findById(groupId);
            if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
            if (req.session.userRole !== 'admin' && String(group.teacherId) !== String(req.session.userId)) {
                return res.status(403).json({ success: false, message: 'Not authorized' });
            }
            await Group.findByIdAndUpdate(groupId, { $pull: { students: studentId } });
            await User.findByIdAndUpdate(studentId, { $unset: { groupId: 1 } });
            logger.info('Student removed from group', { groupId, studentId, by: req.session.userId });
            res.json({ success: true, message: 'Student removed from group successfully', redirect: req.body.redirect || '/teacher-dashboard' });
        } catch (err) {
            logger.error('Remove student from group error', { error: err.message });
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // === SUBMIT WRITING TEST (alias matching export-writing template) ===
    app.post('/submit-writing-test', apiLimiter, doubleCsrfProtection, async (req, res) => {
        if (!req.session.userId) return res.status(401).json({ success: false, message: 'Not logged in' });
        try {
            const payload = req.body;
            const result = await saveStudentSubmission({
                req,
                payload: {
                    type: payload.type || 'writing',
                    testId: payload.testId,
                    score: payload.score || 0,
                    totalQuestions: payload.totalQuestions || 0,
                    percentage: payload.percentage || 0,
                    details: { task1: payload.task1 || '', task2: payload.task2 || '' }
                }
            });
            res.json({ success: true, submission: result, message: 'Writing submission saved' });
        } catch (err) {
            logger.error('Submit writing test error', { error: err.message });
            res.status(500).json({ success: false, message: err.message });
        }
    });

};
