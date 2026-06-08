const logger = require('../utils/logger');
const CONSTANTS = require('../utils/constants');

// Unified auth middleware — used by both server-oracle.js and server.js.
// Returns 403 JSON (not redirect) so API consumers get a machine-readable response
// and page routes fail closed with a clear status.

// Check if user is logged in
function isAuthenticated(req, res, next) {
    if (!req.session.userId) {
        logger.warn('Unauthorized access attempt', {
            path: req.path,
            ip: req.ip
        });
        return res.status(CONSTANTS.STATUS.UNAUTHORIZED).json({
            success: false,
            message: 'Not logged in'
        });
    }
    next();
}

// Check if user is admin
function isAdmin(req, res, next) {
    if (!req.session.userId) {
        logger.warn('Unauthorized admin access attempt', {
            path: req.path,
            ip: req.ip
        });
        return res.status(CONSTANTS.STATUS.UNAUTHORIZED).json({
            success: false,
            message: 'Not logged in'
        });
    }
    
    if (req.session.userRole !== CONSTANTS.ROLES.ADMIN) {
        logger.warn('Non-admin tried to access admin route', {
            userId: req.session.userId,
            role: req.session.userRole,
            path: req.path
        });
        return res.status(CONSTANTS.STATUS.FORBIDDEN).json({
            success: false,
            message: 'Access denied. Admin only.'
        });
    }
    
    next();
}

// Check if user is teacher
function isTeacher(req, res, next) {
    if (!req.session.userId) {
        logger.warn('Unauthorized teacher access attempt', {
            path: req.path,
            ip: req.ip
        });
        return res.status(CONSTANTS.STATUS.UNAUTHORIZED).json({
            success: false,
            message: 'Not logged in'
        });
    }
    
    if (req.session.userRole !== CONSTANTS.ROLES.TEACHER && req.session.userRole !== CONSTANTS.ROLES.ADMIN) {
        logger.warn('Non-teacher tried to access teacher route', {
            userId: req.session.userId,
            role: req.session.userRole,
            path: req.path
        });
        return res.status(CONSTANTS.STATUS.FORBIDDEN).json({
            success: false,
            message: 'Access denied. Teacher only.'
        });
    }
    
    next();
}

// Check if user is student
function isStudent(req, res, next) {
    if (!req.session.userId) {
        logger.warn('Unauthorized student access attempt', {
            path: req.path,
            ip: req.ip
        });
        return res.status(CONSTANTS.STATUS.UNAUTHORIZED).json({
            success: false,
            message: 'Not logged in'
        });
    }
    
    if (req.session.userRole !== CONSTANTS.ROLES.STUDENT) {
        logger.warn('Non-student tried to access student route', {
            userId: req.session.userId,
            role: req.session.userRole,
            path: req.path
        });
        return res.status(CONSTANTS.STATUS.FORBIDDEN).json({
            success: false,
            message: 'Access denied. Student only.'
        });
    }
    
    next();
}

module.exports = {
    isAuthenticated,
    isAdmin,
    isTeacher,
    isStudent
};
