const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const logger = require('../utils/logger');
const CONSTANTS = require('../utils/constants');
const { validateUsername, validatePassword } = require('../utils/validation');

// Login page
router.get('/login', (req, res) => {
    if (req.session.userId) {
        const role = req.session.userRole;
        if (role === CONSTANTS.ROLES.ADMIN) return res.redirect('/admin');
        if (role === CONSTANTS.ROLES.TEACHER) return res.redirect('/teacher-dashboard');
        if (role === CONSTANTS.ROLES.STUDENT) return res.redirect('/student-dashboard');
    }
    res.render('login');
});

// Login POST
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate input
        const usernameValidation = validateUsername(username);
        if (!usernameValidation.valid) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).send(usernameValidation.error);
        }

        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).send(passwordValidation.error);
        }

        const user = await User.findOne({ username });
        if (!user) {
            logger.warn('Login attempt with non-existent username', { username });
            return res.status(CONSTANTS.STATUS.UNAUTHORIZED).send('Invalid username or password');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            logger.warn('Login attempt with wrong password', { username, userId: user._id });
            return res.status(CONSTANTS.STATUS.UNAUTHORIZED).send('Invalid username or password');
        }

        req.session.userId = user._id;
        req.session.userRole = user.role;

        logger.info('User logged in', { userId: user._id, role: user.role, username });

        if (user.role === CONSTANTS.ROLES.ADMIN) return res.redirect('/admin');
        if (user.role === CONSTANTS.ROLES.TEACHER) return res.redirect('/teacher-dashboard');
        if (user.role === CONSTANTS.ROLES.STUDENT) return res.redirect('/student-dashboard');

        res.redirect('/');
    } catch (err) {
        logger.error('Login error', { error: err.message, stack: err.stack });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).send('Error during login');
    }
});

// Logout
router.get('/logout', (req, res) => {
    const userId = req.session.userId;
    const role = req.session.userRole;
    
    req.session.destroy(err => {
        if (err) {
            logger.error('Logout error', { error: err.message, userId });
            return res.status(CONSTANTS.STATUS.INTERNAL_ERROR).send('Error logging out');
        }
        
        logger.info('User logged out', { userId, role });
        res.redirect('/login');
    });
});

module.exports = router;
