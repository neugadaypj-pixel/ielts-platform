// Simple structured logging
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs');
const LOG_LEVELS = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    DEBUG: 'DEBUG'
};

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function formatTimestamp() {
    return new Date().toISOString();
}

function formatLogMessage(level, message, data = {}) {
    return JSON.stringify({
        timestamp: formatTimestamp(),
        level,
        message,
        ...data
    });
}

// === LOG ROTATION SETTINGS ===
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB per file
const MAX_ROTATED_FILES = 3;          // Keep 3 rotated copies per level

function rotateLogFile(filePath) {
    try {
        // Delete oldest rotation if it exists
        const oldestFile = `${filePath}.${MAX_ROTATED_FILES}`;
        if (fs.existsSync(oldestFile)) {
            fs.unlinkSync(oldestFile);
        }
        // Shift rotations: .2 → .3, .1 → .2, current → .1
        for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
            const src = `${filePath}.${i}`;
            const dst = `${filePath}.${i + 1}`;
            if (fs.existsSync(src)) {
                fs.renameSync(src, dst);
            }
        }
        // Rotate current file to .1
        if (fs.existsSync(filePath)) {
            fs.renameSync(filePath, `${filePath}.1`);
        }
    } catch (err) {
        console.error('Error rotating log file:', err.message);
    }
}

function writeLog(level, message, data = {}) {
    const logMessage = formatLogMessage(level, message, data);
    const logFile = path.join(LOG_DIR, `${level.toLowerCase()}.log`);
    
    // Check if rotation is needed before writing
    try {
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            if (stats.size > MAX_LOG_SIZE) {
                rotateLogFile(logFile);
            }
        }
    } catch (err) {
        // Ignore stat errors — just write
    }

    // Write to file (async, non-blocking)
    fs.appendFile(logFile, logMessage + '\n', (err) => {
        if (err) console.error('Error writing to log file:', err);
    });

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production' || level === LOG_LEVELS.ERROR || level === LOG_LEVELS.WARN) {
        console.log(logMessage);
    }
}

module.exports = {
    info: (message, data = {}) => writeLog(LOG_LEVELS.INFO, message, data),
    warn: (message, data = {}) => writeLog(LOG_LEVELS.WARN, message, data),
    error: (message, data = {}) => writeLog(LOG_LEVELS.ERROR, message, data),
    debug: (message, data = {}) => writeLog(LOG_LEVELS.DEBUG, message, data)
};
