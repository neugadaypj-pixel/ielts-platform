const oracledb = require('oracledb');
const logger = require('../utils/logger');

// Optimize for low-memory OCI free tier (1GB RAM)
oracledb.poolMax = 4;
oracledb.poolMin = 1;
oracledb.poolIncrement = 1;
oracledb.poolTimeout = 60;
oracledb.fetchAsString = [oracledb.CLOB];

let pool;

async function getPool() {
    if (pool) return pool;

    const libDir = process.env.LD_LIBRARY_PATH || '/opt/render/project/src/instantclient/instantclient_23_4';
    oracledb.initOracleClient({ libDir });

    pool = await oracledb.createPool({
        user: process.env.DB_USER || 'IELTS_APP',
        password: process.env.DB_PASSWORD || 'IeltsApp@2026#Secure',
        connectString: process.env.DB_CONNECT_STRING || 'testplatform_high',
        poolMax: 4,
        poolMin: 1,
        poolIncrement: 1,
        poolTimeout: 60
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
