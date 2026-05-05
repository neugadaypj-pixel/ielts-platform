const logger = require('../utils/logger');
const CONSTANTS = require('../utils/constants');

// CSRF error handler
function csrfErrorHandler(err, req, res, next) {
    if (err && err.code === 'EBADCSRFTOKEN') {
        logger.warn('CSRF token validation failed', { 
            userId: req.session?.userId,
            path: req.path,
            ip: req.ip 
        });

        const wantsJson = req.xhr
            || String(req.headers.accept || '').includes('application/json')
            || String(req.headers['content-type'] || '').includes('application/json');

        if (wantsJson) {
            return res.status(CONSTANTS.STATUS.FORBIDDEN).json({ 
                success: false, 
                message: 'Invalid CSRF token' 
            });
        }

        return res.status(CONSTANTS.STATUS.FORBIDDEN).send('Invalid CSRF token');
    }
    
    next(err);
}

// Generic error handler
function errorHandler(err, req, res, next) {
    logger.error('Unhandled error', { 
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        userId: req.session?.userId
    });

    const wantsJson = req.xhr
        || String(req.headers.accept || '').includes('application/json')
        || String(req.headers['content-type'] || '').includes('application/json');

    if (wantsJson) {
        return res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({ 
            success: false, 
            message: process.env.NODE_ENV === 'production' 
                ? 'Internal server error' 
                : err.message 
        });
    }

    res.status(CONSTANTS.STATUS.INTERNAL_ERROR).send(
        process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message
    );
}

// 404 handler
function notFoundHandler(req, res) {
    logger.warn('404 Not Found', { 
        path: req.path,
        method: req.method,
        ip: req.ip 
    });

    res.status(CONSTANTS.STATUS.NOT_FOUND).send('Page not found');
}

module.exports = {
    csrfErrorHandler,
    errorHandler,
    notFoundHandler
};
