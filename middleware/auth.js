const logger = require('../utils/logger');
const CONSTANTS = require('../utils/constants');

// Check if user is logged in
function isAuthenticated(req, res, next) {
    if (!req.session.userId) {
        logger.warn('Unauthorized access attempt', { 
            path: req.path, 
            ip: req.ip 
        });
        return res.redirect('/login');
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
        return res.redirect('/login');
    }
    
    if (req.session.userRole !== CONSTANTS.ROLES.ADMIN) {
        logger.warn('Non-admin tried to access admin route', { 
            userId: req.session.userId, 
            role: req.session.userRole,
            path: req.path 
        });
        return res.status(CONSTANTS.STATUS.FORBIDDEN).send('Access denied. Admin only.');
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
        return res.redirect('/login');
    }
    
    if (req.session.userRole !== CONSTANTS.ROLES.TEACHER && req.session.userRole !== CONSTANTS.ROLES.ADMIN) {
        logger.warn('Non-teacher tried to access teacher route', { 
            userId: req.session.userId, 
            role: req.session.userRole,
            path: req.path 
        });
        return res.status(CONSTANTS.STATUS.FORBIDDEN).send('Access denied. Teacher only.');
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
        return res.redirect('/login');
    }
    
    if (req.session.userRole !== CONSTANTS.ROLES.STUDENT) {
        logger.warn('Non-student tried to access student route', { 
            userId: req.session.userId, 
            role: req.session.userRole,
            path: req.path 
        });
        return res.status(CONSTANTS.STATUS.FORBIDDEN).send('Access denied. Student only.');
    }
    
    next();
}

module.exports = {
    isAuthenticated,
    isAdmin,
    isTeacher,
    isStudent
};
