const logger = require('./logger');
const CONSTANTS = require('./constants');

// Custom error classes for better error handling
class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.timestamp = new Date().toISOString();
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message) {
        super(message, CONSTANTS.STATUS.BAD_REQUEST);
        this.name = 'ValidationError';
    }
}

class AuthenticationError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, CONSTANTS.STATUS.UNAUTHORIZED);
        this.name = 'AuthenticationError';
    }
}

class AuthorizationError extends AppError {
    constructor(message = 'Not authorized') {
        super(message, CONSTANTS.STATUS.FORBIDDEN);
        this.name = 'AuthorizationError';
    }
}

class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, CONSTANTS.STATUS.NOT_FOUND);
        this.name = 'NotFoundError';
    }
}

class DatabaseError extends AppError {
    constructor(message = 'Database operation failed') {
        super(message, CONSTANTS.STATUS.INTERNAL_ERROR);
        this.name = 'DatabaseError';
    }
}

// Async error wrapper to catch errors in async route handlers
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// Standardized error response
function sendErrorResponse(res, error, req) {
    const statusCode = error.statusCode || CONSTANTS.STATUS.INTERNAL_ERROR;
    const message = error.message || 'Internal server error';
    
    // Log error with context
    logger.error('Error response sent', {
        error: message,
        statusCode,
        path: req.path,
        method: req.method,
        userId: req.session?.userId,
        stack: error.stack
    });

    // Check if client wants JSON
    const wantsJson = req.xhr
        || String(req.headers.accept || '').includes('application/json')
        || String(req.headers['content-type'] || '').includes('application/json');

    if (wantsJson) {
        return res.status(statusCode).json({
            success: false,
            error: {
                message: process.env.NODE_ENV === 'production' && statusCode === 500
                    ? 'Internal server error'
                    : message,
                statusCode,
                timestamp: error.timestamp || new Date().toISOString()
            }
        });
    }

    // HTML response
    res.status(statusCode).send(`
        <h1>Error ${statusCode}</h1>
        <p>${process.env.NODE_ENV === 'production' && statusCode === 500 
            ? 'Internal server error' 
            : message}</p>
        <a href="javascript:history.back()">Go Back</a>
    `);
}

// Validate MongoDB ObjectId
function validateObjectId(id, fieldName = 'ID') {
    if (!id || typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) {
        throw new ValidationError(`Invalid ${fieldName} format`);
    }
    return true;
}

// Validate required fields
function validateRequired(fields, data) {
    const missing = [];
    
    for (const field of fields) {
        if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
            missing.push(field);
        }
    }
    
    if (missing.length > 0) {
        throw new ValidationError(`Missing required fields: ${missing.join(', ')}`);
    }
    
    return true;
}

// Handle Mongoose validation errors
function handleMongooseError(error) {
    if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(err => err.message);
        return new ValidationError(messages.join(', '));
    }
    
    if (error.name === 'CastError') {
        return new ValidationError(`Invalid ${error.path}: ${error.value}`);
    }
    
    if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        return new ValidationError(`${field} already exists`);
    }
    
    return new DatabaseError(error.message);
}

// Try-catch wrapper with consistent error handling
async function tryCatch(fn, errorMessage = 'Operation failed') {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        
        if (error.name === 'ValidationError' || error.name === 'CastError' || error.code === 11000) {
            throw handleMongooseError(error);
        }
        
        throw new DatabaseError(errorMessage + ': ' + error.message);
    }
}

module.exports = {
    // Error classes
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    DatabaseError,
    
    // Utilities
    asyncHandler,
    sendErrorResponse,
    validateObjectId,
    validateRequired,
    handleMongooseError,
    tryCatch
};
