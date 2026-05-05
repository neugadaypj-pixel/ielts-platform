const logger = require('./logger');

// Required environment variables
const REQUIRED_ENV_VARS = [
    'MONGO_URI',
    'SESSION_SECRET',
    'B2_ENDPOINT',
    'B2_BUCKET',
    'B2_KEY_ID',
    'B2_APP_KEY',
    'B2_PUBLIC_URL'
];

// Optional environment variables with defaults
const OPTIONAL_ENV_VARS = {
    NODE_ENV: 'development',
    PORT: '3000',
    LOG_LEVEL: 'info'
};

// Validate environment variables
function validateEnv() {
    const missing = [];
    const warnings = [];
    
    // Check required variables
    for (const varName of REQUIRED_ENV_VARS) {
        if (!process.env[varName]) {
            missing.push(varName);
        }
    }
    
    if (missing.length > 0) {
        const error = `Missing required environment variables: ${missing.join(', ')}`;
        logger.error('Environment validation failed', { missing });
        throw new Error(error);
    }
    
    // Check optional variables and set defaults
    for (const [varName, defaultValue] of Object.entries(OPTIONAL_ENV_VARS)) {
        if (!process.env[varName]) {
            process.env[varName] = defaultValue;
            warnings.push(`${varName} not set, using default: ${defaultValue}`);
        }
    }
    
    // Validate specific formats
    if (process.env.MONGO_URI && !process.env.MONGO_URI.startsWith('mongodb')) {
        throw new Error('MONGO_URI must start with mongodb:// or mongodb+srv://');
    }
    
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 16) {
        warnings.push('SESSION_SECRET should be at least 16 characters for security');
    }
    
    if (process.env.NODE_ENV === 'production') {
        if (process.env.SESSION_SECRET === 'your-random-secret-key-here') {
            throw new Error('SESSION_SECRET must be changed in production');
        }
    }
    
    // Log warnings
    if (warnings.length > 0) {
        logger.warn('Environment configuration warnings', { warnings });
    }
    
    logger.info('Environment validation successful', {
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT
    });
    
    return true;
}

// Get environment-specific configuration
function getConfig() {
    const isProduction = process.env.NODE_ENV === 'production';
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isTest = process.env.NODE_ENV === 'test';
    
    return {
        // Environment
        env: process.env.NODE_ENV,
        isProduction,
        isDevelopment,
        isTest,
        port: parseInt(process.env.PORT, 10) || 3000,
        
        // Database
        mongoUri: process.env.MONGO_URI,
        
        // Session
        sessionSecret: process.env.SESSION_SECRET,
        sessionMaxAge: 24 * 60 * 60 * 1000, // 24 hours
        
        // Storage
        b2: {
            endpoint: process.env.B2_ENDPOINT,
            bucket: process.env.B2_BUCKET,
            keyId: process.env.B2_KEY_ID,
            appKey: process.env.B2_APP_KEY,
            publicUrl: process.env.B2_PUBLIC_URL
        },
        
        // Security
        bcryptRounds: isProduction ? 12 : 10,
        rateLimitWindow: 60 * 1000, // 1 minute
        rateLimitMax: isProduction ? 5 : 10,
        
        // Logging
        logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
        
        // File uploads
        maxFileSize: 100 * 1024 * 1024, // 100MB
        maxFiles: 10,
        
        // CORS (if needed in future)
        corsOrigin: process.env.CORS_ORIGIN || '*',
        
        // API Keys
        groqApiKey: process.env.GROQ_API_KEY || ''
    };
}

// Log configuration (without sensitive data)
function logConfig() {
    const config = getConfig();
    
    logger.info('Application configuration loaded', {
        env: config.env,
        port: config.port,
        isProduction: config.isProduction,
        mongoUri: config.mongoUri ? 'SET' : 'MISSING',
        sessionSecret: config.sessionSecret ? 'SET' : 'MISSING',
        b2Configured: !!(config.b2.endpoint && config.b2.bucket),
        logLevel: config.logLevel
    });
}

// Mask sensitive values for logging
function maskSensitive(value) {
    if (!value || typeof value !== 'string') return value;
    if (value.length <= 8) return '***';
    return value.substring(0, 4) + '***' + value.substring(value.length - 4);
}

module.exports = {
    validateEnv,
    getConfig,
    logConfig,
    maskSensitive
};
