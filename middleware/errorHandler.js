const logger = require('../utils/logger');
const CONSTANTS = require('../utils/constants');
const { sendErrorResponse } = require('../utils/errorUtils');

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
            || String(req.headers['content-type'] || '').includes('application/json')
            || req.headers['x-csrf-token'];

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

// Multer / body-parser upload errors
function multerErrorHandler(err, req, res, next) {
    if (!err || (err.name !== 'MulterError' && !String(err.code || '').startsWith('LIMIT_'))) {
        return next(err);
    }

    const maxMb = Math.round(CONSTANTS.FILE_UPLOAD.MAX_FILE_SIZE / (1024 * 1024));
    const messages = {
        LIMIT_FILE_SIZE: `Uploaded file is too large. Maximum size is ${maxMb} MB per audio file.`,
        LIMIT_FIELD_VALUE: 'Test content field is too large. Try shortening question HTML or split the upload.',
        LIMIT_FILE_COUNT: 'Too many files uploaded.',
        LIMIT_UNEXPECTED_FILE: 'Unexpected file field in upload.',
        LIMIT_PART_COUNT: 'Upload contains too many parts.'
    };

    const message = messages[err.code] || err.message || 'Upload failed';

    logger.warn('Upload rejected', {
        code: err.code,
        field: err.field,
        path: req.path,
        userId: req.session?.userId
    });

    const wantsJson = req.xhr
        || String(req.headers.accept || '').includes('application/json')
        || req.headers['x-csrf-token'];

    if (wantsJson) {
        return res.status(CONSTANTS.STATUS.PAYLOAD_TOO_LARGE).json({
            success: false,
            message,
            error: err.code
        });
    }

    return res.status(CONSTANTS.STATUS.PAYLOAD_TOO_LARGE).send(message);
}

// Generic error handler
function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    if (err.type === 'entity.too.large') {
        err.statusCode = CONSTANTS.STATUS.PAYLOAD_TOO_LARGE;
        err.message = 'Request body is too large. For listening tests, use smaller audio files or upload one part at a time.';
    }

    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

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
    multerErrorHandler,
    errorHandler,
    notFoundHandler
};
