// Application Constants
module.exports = {
    // User roles
    ROLES: {
        ADMIN: 'admin',
        TEACHER: 'teacher',
        STUDENT: 'student'
    },

    // Test types
    TEST_TYPES: {
        READING: 'reading',
        LISTENING: 'listening',
        WRITING: 'writing'
    },

    // HTTP status codes
    STATUS: {
        OK: 200,
        CREATED: 201,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        PAYLOAD_TOO_LARGE: 413,
        INTERNAL_ERROR: 500
    },

    // File upload
    FILE_UPLOAD: {
        MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB per audio file
        MAX_FIELD_SIZE: 25 * 1024 * 1024, // 25MB for builderJson / parts text fields
        MAX_FILES: 10,
        MAX_BODY_SIZE: '100mb', // express.json / urlencoded
        ALLOWED_AUDIO_TYPES: [
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
            'audio/aac', 'audio/x-aac', 'audio/mp4', 'audio/x-m4a',
            'audio/flac', 'audio/x-flac', 'audio/webm', 'audio/opus',
            'audio/x-wav', 'audio/vnd.wav'
        ]
    },

    // Validation rules
    VALIDATION: {
        MIN_PASSWORD_LENGTH: 6,
        MAX_USERNAME_LENGTH: 50,
        MAX_TEST_TITLE_LENGTH: 200,
        HEARTBEAT_TIMEOUT: 30000 // 30 seconds
    },

    // Messages
    MESSAGES: {
        // Success
        TEST_DELETED: 'Test deleted successfully',
        STUDENT_DELETED: 'Student account deleted successfully',
        TEACHER_DELETED: 'Teacher account and associated tests deleted successfully',
        GROUP_DELETED: 'Group deleted successfully',
        STUDENT_REMOVED_FROM_GROUP: 'Student removed from group successfully',
        TEST_UPDATED: 'Test updated successfully',
        TEST_CREATED: 'Test created successfully',
        LISTENING_TEST_SAVED: 'Listening test saved successfully',
        READING_TEST_SAVED: 'Reading test created successfully',
        WRITING_TEST_SAVED: 'Writing test created successfully',
        STUDENT_CREATED: 'Student created successfully',

        // Errors
        UNAUTHORIZED: 'Not authorized',
        TEST_NOT_FOUND: 'Test not found',
        STUDENT_NOT_FOUND: 'Student not found',
        TEACHER_NOT_FOUND: 'Teacher not found',
        GROUP_NOT_FOUND: 'Group not found',
        NOT_LOGGED_IN: 'Not logged in',
        INVALID_ROLE: 'Invalid role',
        NO_FILE_UPLOADED: 'No file uploaded',
        FILE_TOO_LARGE: 'File size exceeds maximum limit',
        TITLE_REQUIRED: 'Test title is required',
        USERNAME_REQUIRED: 'Username is required',
        PASSWORD_REQUIRED: 'Password is required',
        PASSWORD_TOO_SHORT: 'Password must be at least 6 characters',
        USERNAME_EXISTS: 'Username already exists',
        CANNOT_DELETE_OTHER_TEACHERS_STUDENTS: 'Cannot delete students from other teachers'
    }
};
