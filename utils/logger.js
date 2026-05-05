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

function writeLog(level, message, data = {}) {
    const logMessage = formatLogMessage(level, message, data);
    const logFile = path.join(LOG_DIR, `${level.toLowerCase()}.log`);
    
    // Write to file (async, non-blocking)
    fs.appendFile(logFile, logMessage + '\n', (err) => {
        if (err) console.error('Error writing to log file:', err);
    });

    // Also log to console in development
    console.log(logMessage);
}

module.exports = {
    info: (message, data = {}) => writeLog(LOG_LEVELS.INFO, message, data),
    warn: (message, data = {}) => writeLog(LOG_LEVELS.WARN, message, data),
    error: (message, data = {}) => writeLog(LOG_LEVELS.ERROR, message, data),
    debug: (message, data = {}) => writeLog(LOG_LEVELS.DEBUG, message, data)
};
