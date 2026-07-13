const oracledb = require('oracledb');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

// Optimize for low-memory OCI free tier (1GB RAM)
oracledb.poolMax = 20;
oracledb.poolMin = 2;
oracledb.poolIncrement = 2;
oracledb.poolTimeout = 60;
oracledb.fetchAsString = [oracledb.CLOB];

let pool;
let useThin = false; // Track whether we fell back to Thin mode

// Detect if native Oracle Client library is available
function detectNativeClient() {
    const candidates = [
        process.env.ORACLE_CLIENT_DIR,
        '/opt/oracle/instantclient_23_4',
        '/opt/render/project/src/instantclient/instantclient_23_4'
    ];
    return candidates.find(dir => {
        if (!dir) return false;
        try { return fs.existsSync(path.join(dir, 'libclntsh.so')) || fs.existsSync(path.join(dir, 'libclntsh.dll')); } catch { return false; }
    }) || null;
}

async function getPool() {
    if (pool) return pool;

    // Determine configDir (wallet path) regardless of mode
    const configDir = process.env.TNS_ADMIN || path.join(__dirname, '..', 'wallet');
    
    // Auto-patch sqlnet.ora WALLET_LOCATION to match actual configDir
    const sqlnetPath = path.join(configDir, 'sqlnet.ora');
    if (fs.existsSync(sqlnetPath)) {
        try {
            let content = fs.readFileSync(sqlnetPath, 'utf8');
            const patched = content.replace(
                /DIRECTORY\s*=\s*"([^"]*)"/,
                `DIRECTORY="${configDir}"`
            );
            if (patched !== content) {
                fs.writeFileSync(sqlnetPath, patched, 'utf8');
                logger.info('sqlnet.ora wallet path auto-patched', { configDir });
            }
        } catch (e) {
            logger.warn('sqlnet.ora auto-patch failed (non-fatal)', { error: e.message });
        }
    }

    // ---- Decide: Thin mode or Native mode ----
    const forceThin = process.env.ORACLE_USE_THIN === 'true';
    const nativeLibDir = detectNativeClient();

    if (forceThin || !nativeLibDir) {
        // Thin mode (pure JavaScript driver - works everywhere, no native client needed)
        oracledb.defaultDriver = 'thin';
        useThin = true;
        
        if (forceThin) {
            logger.info('Oracle: Thin mode forced via ORACLE_USE_THIN=true');
        } else {
            logger.info('Oracle: No native client found, falling back to Thin mode');
        }
    } else {
        // Native mode (production on Render/OCI with Instant Client installed)
        logger.info('Initializing Oracle Client (native)', { libDir: nativeLibDir, configDir });
        
        try {
            oracledb.initOracleClient({ libDir: nativeLibDir, configDir });
            logger.info('Oracle Client initialized successfully (native)');
        } catch (err) {
            if (err.message && err.message.includes('already been initialized')) {
                logger.info('Oracle Client already initialized, continuing');
            } else {
                logger.error('Failed to initialize Oracle Client', { error: err.message });
                throw err;
            }
        }
    }

    // Build pool config — Thin mode needs configDir in pool params
    const poolConfig = {
        user: process.env.DB_USER || 'IELTS_APP',
        password: process.env.DB_PASSWORD || 'IeltsApp@2026#Secure',
        connectString: process.env.DB_CONNECT_STRING || 'testplatform_high',
        poolMax: 20,         // Admin dashboard fires 7+ parallel queries
        poolMin: 2,
        poolIncrement: 2,
        poolTimeout: 60,
        queueTimeout: 60000  // 60s grace period before rejecting queued requests
    };
    
    // In Thin mode, pass configDir explicitly for wallet/mTLS
    if (useThin) {
        poolConfig.configDir = configDir;
    }

    pool = await oracledb.createPool(poolConfig);
    
    const modeLabel = useThin ? 'Thin mode (pure JS)' : 'Native mode';
    logger.info(`Oracle DB connection pool created - ${modeLabel} (max 10 connections)`);
    return pool;
}

async function getConnection() {
    const p = await getPool();
    return p.getConnection();
}

async function execute(sql, binds = {}, opts = {}) {
    const conn = await getConnection();
    try {
        const result = await conn.execute(sql, binds, {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit: true,
            ...opts
        });
        return result;
    } finally {
        await conn.close();
    }
}

async function executeMany(sql, bindsArray = [], opts = {}) {
    const conn = await getConnection();
    try {
        const result = await conn.executeMany(sql, bindsArray, {
            autoCommit: true,
            ...opts
        });
        return result;
    } finally {
        await conn.close();
    }
}

function isDatabaseReady() {
    return pool !== undefined && pool.connectionsInUse !== undefined;
}

async function closePool() {
    if (pool) {
        await pool.close();
        pool = null;
        logger.info('Oracle DB connection pool closed');
    }
}

module.exports = { getPool, getConnection, execute, executeMany, isDatabaseReady, closePool };
