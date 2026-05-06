const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../../models/User');

// Mock server setup
let app;
let server;

describe('Authentication Integration Tests', () => {
    beforeAll(async () => {
        // Connect to test database
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/test-platform-test');
        
        // Import app after database connection
        app = require('../../server');
    });

    afterAll(async () => {
        // Clean up
        await User.deleteMany({});
        await mongoose.connection.close();
        if (server) server.close();
    });

    beforeEach(async () => {
        // Clean database before each test
        await User.deleteMany({});
    });

    describe('POST /login', () => {
        test('should login with valid credentials', async () => {
            // Create test user
            const hashedPassword = await bcrypt.hash('password123', 10);
            await User.create({
                username: 'testuser',
                password: hashedPassword,
                role: 'student'
            });

            const response = await request(app)
                .post('/login')
                .send({
                    username: 'testuser',
                    password: 'password123'
                });

            expect(response.status).toBe(302); // Redirect after login
            expect(response.headers['set-cookie']).toBeDefined();
        });

        test('should reject invalid username', async () => {
            const response = await request(app)
                .post('/login')
                .send({
                    username: 'nonexistent',
                    password: 'password123'
                });

            expect(response.status).toBe(200);
            expect(response.text).toContain('Invalid username or password');
        });

        test('should reject invalid password', async () => {
            const hashedPassword = await bcrypt.hash('password123', 10);
            await User.create({
                username: 'testuser',
                password: hashedPassword,
                role: 'student'
            });

            const response = await request(app)
                .post('/login')
                .send({
                    username: 'testuser',
                    password: 'wrongpassword'
                });

            expect(response.status).toBe(200);
            expect(response.text).toContain('Invalid username or password');
        });

        test('should redirect admin to /admin', async () => {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await User.create({
                username: 'admin',
                password: hashedPassword,
                role: 'admin'
            });

            const response = await request(app)
                .post('/login')
                .send({
                    username: 'admin',
                    password: 'admin123'
                });

            expect(response.status).toBe(302);
            expect(response.headers.location).toBe('/admin');
        });

        test('should redirect teacher to /teacher-dashboard', async () => {
            const hashedPassword = await bcrypt.hash('teacher123', 10);
            await User.create({
                username: 'teacher',
                password: hashedPassword,
                role: 'teacher'
            });

            const response = await request(app)
                .post('/login')
                .send({
                    username: 'teacher',
                    password: 'teacher123'
                });

            expect(response.status).toBe(302);
            expect(response.headers.location).toBe('/teacher-dashboard');
        });

        test('should redirect student to /student-dashboard', async () => {
            const hashedPassword = await bcrypt.hash('student123', 10);
            await User.create({
                username: 'student',
                password: hashedPassword,
                role: 'student'
            });

            const response = await request(app)
                .post('/login')
                .send({
                    username: 'student',
                    password: 'student123'
                });

            expect(response.status).toBe(302);
            expect(response.headers.location).toBe('/student-dashboard');
        });
    });

    describe('GET /logout', () => {
        test('should logout and redirect to home', async () => {
            const response = await request(app)
                .get('/logout');

            expect(response.status).toBe(302);
            expect(response.headers.location).toBe('/');
        });
    });

    describe('Rate Limiting', () => {
        test('should block after too many login attempts', async () => {
            const loginAttempts = [];
            
            // Make 11 login attempts (limit is 10)
            for (let i = 0; i < 11; i++) {
                loginAttempts.push(
                    request(app)
                        .post('/login')
                        .send({
                            username: 'testuser',
                            password: 'wrongpassword'
                        })
                );
            }

            const responses = await Promise.all(loginAttempts);
            const lastResponse = responses[responses.length - 1];

            expect(lastResponse.status).toBe(429); // Too Many Requests
            expect(lastResponse.text).toContain('Too many');
        }, 10000); // Increase timeout for this test
    });
});
