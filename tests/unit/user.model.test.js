const mongoose = require('mongoose');
const User = require('../../models/User');

describe('User Model', () => {
    beforeAll(async () => {
        // Connect to test database
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/test-platform-test');
    });

    afterAll(async () => {
        // Clean up and close connection
        await User.deleteMany({});
        await mongoose.connection.close();
    });

    afterEach(async () => {
        // Clean up after each test
        await User.deleteMany({});
    });

    describe('User Creation', () => {
        test('should create a valid user', async () => {
            const userData = {
                username: 'testuser',
                password: 'password123',
                role: 'student'
            };

            const user = new User(userData);
            const savedUser = await user.save();

            expect(savedUser._id).toBeDefined();
            expect(savedUser.username).toBe('testuser');
            expect(savedUser.role).toBe('student');
            expect(savedUser.createdAt).toBeDefined();
        });

        test('should fail without required username', async () => {
            const user = new User({
                password: 'password123',
                role: 'student'
            });

            await expect(user.save()).rejects.toThrow();
        });

        test('should fail without required password', async () => {
            const user = new User({
                username: 'testuser',
                role: 'student'
            });

            await expect(user.save()).rejects.toThrow();
        });

        test('should default to student role', async () => {
            const user = new User({
                username: 'testuser',
                password: 'password123'
            });

            const savedUser = await user.save();
            expect(savedUser.role).toBe('student');
        });

        test('should enforce unique username', async () => {
            const userData = {
                username: 'testuser',
                password: 'password123',
                role: 'student'
            };

            await new User(userData).save();
            
            const duplicateUser = new User(userData);
            await expect(duplicateUser.save()).rejects.toThrow();
        });

        test('should trim username', async () => {
            const user = new User({
                username: '  testuser  ',
                password: 'password123',
                role: 'student'
            });

            const savedUser = await user.save();
            expect(savedUser.username).toBe('testuser');
        });

        test('should enforce username length constraints', async () => {
            const shortUser = new User({
                username: 'ab',
                password: 'password123',
                role: 'student'
            });

            await expect(shortUser.save()).rejects.toThrow();

            const longUser = new User({
                username: 'a'.repeat(51),
                password: 'password123',
                role: 'student'
            });

            await expect(longUser.save()).rejects.toThrow();
        });

        test('should enforce password length constraint', async () => {
            const user = new User({
                username: 'testuser',
                password: '12345',
                role: 'student'
            });

            await expect(user.save()).rejects.toThrow();
        });

        test('should only allow valid roles', async () => {
            const user = new User({
                username: 'testuser',
                password: 'password123',
                role: 'invalid_role'
            });

            await expect(user.save()).rejects.toThrow();
        });
    });

    describe('User Relationships', () => {
        test('should allow teacher to have assigned tests', async () => {
            const testId = new mongoose.Types.ObjectId();
            
            const teacher = new User({
                username: 'teacher1',
                password: 'password123',
                role: 'teacher',
                assignedTests: [testId]
            });

            const savedTeacher = await teacher.save();
            expect(savedTeacher.assignedTests).toHaveLength(1);
            expect(savedTeacher.assignedTests[0]).toEqual(testId);
        });

        test('should allow student to have teacherId', async () => {
            const teacherId = new mongoose.Types.ObjectId();
            
            const student = new User({
                username: 'student1',
                password: 'password123',
                role: 'student',
                teacherId: teacherId
            });

            const savedStudent = await student.save();
            expect(savedStudent.teacherId).toEqual(teacherId);
        });

        test('should allow student to have groupId', async () => {
            const groupId = new mongoose.Types.ObjectId();
            
            const student = new User({
                username: 'student1',
                password: 'password123',
                role: 'student',
                groupId: groupId
            });

            const savedStudent = await student.save();
            expect(savedStudent.groupId).toEqual(groupId);
        });
    });

    describe('User Queries', () => {
        test('should find user by username', async () => {
            await new User({
                username: 'findme',
                password: 'password123',
                role: 'student'
            }).save();

            const found = await User.findOne({ username: 'findme' });
            expect(found).toBeDefined();
            expect(found.username).toBe('findme');
        });

        test('should find users by role', async () => {
            await User.insertMany([
                { username: 'teacher1', password: 'pass123', role: 'teacher' },
                { username: 'teacher2', password: 'pass123', role: 'teacher' },
                { username: 'student1', password: 'pass123', role: 'student' }
            ]);

            const teachers = await User.find({ role: 'teacher' });
            expect(teachers).toHaveLength(2);
        });

        test('should find students by teacherId', async () => {
            const teacherId = new mongoose.Types.ObjectId();
            
            await User.insertMany([
                { username: 'student1', password: 'pass123', role: 'student', teacherId },
                { username: 'student2', password: 'pass123', role: 'student', teacherId },
                { username: 'student3', password: 'pass123', role: 'student' }
            ]);

            const students = await User.find({ teacherId });
            expect(students).toHaveLength(2);
        });
    });
});
