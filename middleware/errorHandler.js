const logger = require('../utils/logger');
const CONSTANTS = require('../utils/constants');
const { sendErrorResponse, AppError } = require('../utils/errorUtils');

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
    // If headers already sent, delegate to default Express error handler
    if (res.headersSent) {
        return next(err);
    }

    // Use custom error response utility
    sendErrorResponse(res, err, req);
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
