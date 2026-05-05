// Input validation utilities
const CONSTANTS = require('./constants');

/**
 * Validate required string input
 * @param {string} value - The value to validate
 * @param {string} fieldName - Field name for error message
 * @param {number} minLength - Minimum length
 * @param {number} maxLength - Maximum length
 * @returns {object} - { valid: boolean, error: string | null }
 */
function validateString(value, fieldName, minLength = 1, maxLength = 500) {
    if (!value || typeof value !== 'string') {
        return { valid: false, error: `${fieldName} is required` };
    }

    const trimmed = value.trim();
    
    if (trimmed.length < minLength) {
        return { valid: false, error: `${fieldName} must be at least ${minLength} characters` };
    }

    if (trimmed.length > maxLength) {
        return { valid: false, error: `${fieldName} must not exceed ${maxLength} characters` };
    }

    return { valid: true, error: null };
}

/**
 * Validate username
 */
function validateUsername(username) {
    return validateString(username, 'Username', 3, CONSTANTS.VALIDATION.MAX_USERNAME_LENGTH);
}

/**
 * Validate password
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: 'Password is required' };
    }

    if (password.length < CONSTANTS.VALIDATION.MIN_PASSWORD_LENGTH) {
        return { valid: false, error: `Password must be at least ${CONSTANTS.VALIDATION.MIN_PASSWORD_LENGTH} characters` };
    }

    return { valid: true, error: null };
}

/**
 * Validate test title
 */
function validateTestTitle(title) {
    return validateString(title, 'Test title', 1, CONSTANTS.VALIDATION.MAX_TEST_TITLE_LENGTH);
}

/**
 * Validate test type
 */
function validateTestType(type) {
    const testTypes = Object.values(CONSTANTS.TEST_TYPES);
    if (!testTypes.includes(type)) {
        return { valid: false, error: `Invalid test type. Must be one of: ${testTypes.join(', ')}` };
    }
    return { valid: true, error: null };
}

/**
 * Validate MongoDB ObjectId format
 */
function validateObjectId(id) {
    if (!id || typeof id !== 'string') {
        return { valid: false, error: 'Invalid ID format' };
    }

    // Simple check for MongoDB ObjectId format (24 hex characters)
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
        return { valid: false, error: 'Invalid ID format' };
    }

    return { valid: true, error: null };
}

/**
 * Validate user role
 */
function validateRole(role) {
    const roles = Object.values(CONSTANTS.ROLES);
    if (!roles.includes(role)) {
        return { valid: false, error: `Invalid role. Must be one of: ${roles.join(', ')}` };
    }
    return { valid: true, error: null };
}

/**
 * Sanitize string input (basic XSS prevention)
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    
    return str
        .trim()
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

/**
 * Safe JSON.parse with error handling
 */
function safeJSONParse(jsonString, defaultValue = {}) {
    try {
        if (!jsonString || typeof jsonString !== 'string') {
            return defaultValue;
        }
        return JSON.parse(jsonString);
    } catch (err) {
        console.error('[JSON Parse Error]', err.message);
        return defaultValue;
    }
}

module.exports = {
    validateString,
    validateUsername,
    validatePassword,
    validateTestTitle,
    validateTestType,
    validateObjectId,
    validateRole,
    sanitizeString,
    safeJSONParse
};
