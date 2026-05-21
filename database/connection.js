const oracledb = require('oracledb');
const logger = require('../utils/logger');
const path = require('path');

// Optimize for low-memory OCI free tier (1GB RAM)
oracledb.poolMax = 4;
oracledb.poolMin = 1;
oracledb.poolIncrement = 1;
oracledb.poolTimeout = 60;
oracledb.fetchAsString = [oracledb.CLOB];

let pool;

async function getPool() {
    if (pool) return pool;

    // Determine Instant Client library directory
    // On Render: /opt/render/project/src/instantclient/instantclient_23_4
    // On OCI VM: /opt/oracle/instantclient_23_4
    // Also settable via ORACLE_CLIENT_DIR env var
    const fs = require('fs');
    const candidates = [
        process.env.ORACLE_CLIENT_DIR,
        '/opt/oracle/instantclient_23_4',
        '/opt/render/project/src/instantclient/instantclient_23_4'
    ];
    let libDir = candidates.find(dir => {
        if (!dir) return false;
        try { return fs.existsSync(path.join(dir, 'libclntsh.so')); } catch { return false; }
    });
    if (!libDir) {
        libDir = candidates[0]; // fallback: let it fail with a clear error
    }
    
    // CRITICAL: configDir must point to the wallet directory so the Oracle Client
    // can find sqlnet.ora, tnsnames.ora, and the wallet files (cwallet.sso, ewallet.p12).
    // Without this, ORA-28759 "failure to open file" occurs.
    const configDir = process.env.TNS_ADMIN || path.join(__dirname, '..', 'wallet');
    
    logger.info('Initializing Oracle Client', { libDir, configDir });

    try {
        oracledb.initOracleClient({ libDir, configDir });
        logger.info('Oracle Client initialized successfully');
    } catch (err) {
        // If already initialized (e.g., by another module), that's fine
        if (err.message && err.message.includes('already been initialized')) {
            logger.info('Oracle Client already initialized, continuing');
        } else {
            logger.error('Failed to initialize Oracle Client', { error: err.message });
            throw err;
        }
    }

    pool = await oracledb.createPool({
        user: process.env.DB_USER || 'IELTS_APP',
        password: process.env.DB_PASSWORD || 'IeltsApp@2026#Secure',
        connectString: process.env.DB_CONNECT_STRING || 'testplatform_high',
        poolMax: 4,
        poolMin: 1,
        poolIncrement: 1,
        poolTimeout: 60,
        queueTimeout: 10000  // Fail fast (10s) instead of hanging 60s if pool exhausted
    });

    logger.info('Oracle DB connection pool created (max 4 connections)');
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
