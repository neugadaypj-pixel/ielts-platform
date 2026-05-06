const { validateUsername, validatePassword, validateTestTitle, validateObjectId } = require('../../utils/validation');

describe('Validation Utils', () => {
    describe('validateUsername', () => {
        test('should accept valid username', () => {
            const result = validateUsername('teacher123');
            expect(result.valid).toBe(true);
        });

        test('should reject username shorter than 3 characters', () => {
            const result = validateUsername('ab');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('at least 3 characters');
        });

        test('should reject username longer than 50 characters', () => {
            const result = validateUsername('a'.repeat(51));
            expect(result.valid).toBe(false);
            expect(result.error).toContain('maximum 50 characters');
        });

        test('should reject empty username', () => {
            const result = validateUsername('');
            expect(result.valid).toBe(false);
        });

        test('should reject null username', () => {
            const result = validateUsername(null);
            expect(result.valid).toBe(false);
        });
    });

    describe('validatePassword', () => {
        test('should accept valid password', () => {
            const result = validatePassword('password123');
            expect(result.valid).toBe(true);
        });

        test('should reject password shorter than 6 characters', () => {
            const result = validatePassword('12345');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('at least 6 characters');
        });

        test('should reject empty password', () => {
            const result = validatePassword('');
            expect(result.valid).toBe(false);
        });

        test('should reject null password', () => {
            const result = validatePassword(null);
            expect(result.valid).toBe(false);
        });
    });

    describe('validateTestTitle', () => {
        test('should accept valid test title', () => {
            const result = validateTestTitle('IELTS Reading Test 1');
            expect(result.valid).toBe(true);
        });

        test('should reject empty title', () => {
            const result = validateTestTitle('');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('required');
        });

        test('should reject title longer than 200 characters', () => {
            const result = validateTestTitle('a'.repeat(201));
            expect(result.valid).toBe(false);
            expect(result.error).toContain('maximum 200 characters');
        });

        test('should trim whitespace', () => {
            const result = validateTestTitle('  Test Title  ');
            expect(result.valid).toBe(true);
        });
    });

    describe('validateObjectId', () => {
        test('should accept valid MongoDB ObjectId', () => {
            const result = validateObjectId('507f1f77bcf86cd799439011');
            expect(result.valid).toBe(true);
        });

        test('should reject invalid ObjectId format', () => {
            const result = validateObjectId('invalid-id');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid ID format');
        });

        test('should reject empty ObjectId', () => {
            const result = validateObjectId('');
            expect(result.valid).toBe(false);
        });

        test('should reject null ObjectId', () => {
            const result = validateObjectId(null);
            expect(result.valid).toBe(false);
        });
    });
});
