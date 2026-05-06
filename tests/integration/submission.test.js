const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../../models/User');
const Test = require('../../models/Test');
const Group = require('../../models/Group');
const Submission = require('../../models/Submission');

let app;

describe('Test Submission Integration Tests', () => {
    let student;
    let teacher;
    let test;
    let group;
    let agent;

    beforeAll(async () => {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/test-platform-test');
        app = require('../../server');
    });

    afterAll(async () => {
        await User.deleteMany({});
        await Test.deleteMany({});
        await Group.deleteMany({});
        await Submission.deleteMany({});
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        // Clean database
        await User.deleteMany({});
        await Test.deleteMany({});
        await Group.deleteMany({});
        await Submission.deleteMany({});

        // Create teacher
        const hashedPassword = await bcrypt.hash('teacher123', 10);
        teacher = await User.create({
            username: 'teacher1',
            password: hashedPassword,
            role: 'teacher'
        });

        // Create test
        test = await Test.create({
            title: 'IELTS Reading Test 1',
            type: 'reading',
            createdBy: teacher._id,
            readingPassage: JSON.stringify({ content: 'Test content' })
        });

        // Create group
        group = await Group.create({
            name: 'Group A',
            teacherId: teacher._id,
            assignedTests: [test._id]
        });

        // Create student
        student = await User.create({
            username: 'student1',
            password: hashedPassword,
            role: 'student',
            teacherId: teacher._id,
            groupId: group._id
        });

        // Update group with student
        await Group.findByIdAndUpdate(group._id, {
            $push: { students: student._id }
        });

        // Create authenticated agent
        agent = request.agent(app);
        await agent
            .post('/login')
            .send({
                username: 'student1',
                password: 'teacher123'
            });
    });

    describe('POST /api/test-submissions', () => {
        test('should submit test successfully', async () => {
            const submissionData = {
                testId: test._id.toString(),
                type: 'reading',
                studentName: 'student1',
                score: 35,
                totalQuestions: 40,
                percentage: 87.5,
                resultSignature: 'reading:test1:student1:35:40'
            };

            const response = await agent
                .post('/api/test-submissions')
                .send(submissionData);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.submissionId).toBeDefined();

            // Verify submission in database
            const submission = await Submission.findOne({
                testId: test._id,
                studentId: student._id
            });

            expect(submission).toBeDefined();
            expect(submission.score).toBe(35);
            expect(submission.percentage).toBe(87.5);
        });

        test('should reject submission without login', async () => {
            const response = await request(app)
                .post('/api/test-submissions')
                .send({
                    testId: test._id.toString(),
                    type: 'reading',
                    score: 35
                });

            expect(response.status).toBe(401);
        });

        test('should reject submission for unauthorized test', async () => {
            // Create test not assigned to student's group
            const unauthorizedTest = await Test.create({
                title: 'Unauthorized Test',
                type: 'reading',
                createdBy: teacher._id,
                readingPassage: JSON.stringify({ content: 'Test' })
            });

            const response = await agent
                .post('/api/test-submissions')
                .send({
                    testId: unauthorizedTest._id.toString(),
                    type: 'reading',
                    score: 35
                });

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
        });

        test('should update existing submission', async () => {
            // First submission
            await agent
                .post('/api/test-submissions')
                .send({
                    testId: test._id.toString(),
                    type: 'reading',
                    studentName: 'student1',
                    score: 30,
                    totalQuestions: 40,
                    percentage: 75,
                    resultSignature: 'sig1'
                });

            // Second submission (different signature)
            const response = await agent
                .post('/api/test-submissions')
                .send({
                    testId: test._id.toString(),
                    type: 'reading',
                    studentName: 'student1',
                    score: 35,
                    totalQuestions: 40,
                    percentage: 87.5,
                    resultSignature: 'sig2'
                });

            expect(response.status).toBe(200);

            // Verify only one submission exists with updated score
            const submissions = await Submission.find({
                testId: test._id,
                studentId: student._id
            });

            expect(submissions).toHaveLength(1);
            expect(submissions[0].score).toBe(35);
            expect(submissions[0].attemptCount).toBe(2);
        });

        test('should not increment attempt count for same signature', async () => {
            const submissionData = {
                testId: test._id.toString(),
                type: 'reading',
                studentName: 'student1',
                score: 35,
                totalQuestions: 40,
                percentage: 87.5,
                resultSignature: 'same-sig'
            };

            // Submit twice with same signature
            await agent.post('/api/test-submissions').send(submissionData);
            await agent.post('/api/test-submissions').send(submissionData);

            const submission = await Submission.findOne({
                testId: test._id,
                studentId: student._id
            });

            expect(submission.attemptCount).toBe(1);
        });
    });

    describe('POST /submit-writing-test', () => {
        test('should submit writing test successfully', async () => {
            const writingData = {
                testId: test._id.toString(),
                studentName: 'student1',
                task1: 'This is my task 1 response...',
                task2: 'This is my task 2 essay...',
                wordCount1: 180,
                wordCount2: 280,
                timeTaken: '55:30'
            };

            const response = await agent
                .post('/submit-writing-test')
                .send(writingData);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            // Verify submission
            const submission = await Submission.findOne({
                testId: test._id,
                studentId: student._id
            });

            expect(submission).toBeDefined();
            expect(submission.type).toBe('writing');
            expect(submission.wordCount1).toBe(180);
            expect(submission.wordCount2).toBe(280);
            expect(submission.details.task1).toBe('This is my task 1 response...');
        });
    });
});
