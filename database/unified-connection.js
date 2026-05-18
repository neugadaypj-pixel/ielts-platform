/**
 * Unified Database Connection Module
 * Supports both MongoDB and Oracle DB with environment variable switching
 */

const USE_ORACLE = process.env.USE_ORACLE_DB === 'true';

let dbConnection = null;
let sessionStore = null;

// MongoDB setup
if (!USE_ORACLE) {
    const mongoose = require('mongoose');
    
    mongoose.set('strictQuery', false);
    mongoose.set('bufferCommands', true);
    
    const mongoConnectionOptions = {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 2,
        retryWrites: true,
        retryReads: true,
        w: 'majority'
    };
    
    async function connectMongoDB() {
        try {
            await mongoose.connect(process.env.MONGO_URI, mongoConnectionOptions);
            console.log('✅ Connected to MongoDB successfully');
            dbConnection = mongoose.connection;
            
            // Setup session store
            const MongoStore = require('connect-mongo');
            sessionStore = MongoStore.create({
                mongoUrl: process.env.MONGO_URI,
                ttl: 24 * 60 * 60,
                autoRemove: 'native'
            });
            
            // Setup TTL index for sessions
            setImmediate(async () => {
                try {
                    const db = mongoose.connection.db;
                    if (!db) return;
                    const sessionsCollection = db.collection('sessions');
                    const existingIndexes = await sessionsCollection.indexes();
                    const hasExpiresIndex = existingIndexes.some(idx =>
                        idx.key && idx.key.expires && idx.expireAfterSeconds !== undefined
                    );
                    if (!hasExpiresIndex) {
                        await sessionsCollection.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
                        console.log('✅ Created TTL index on sessions.expires');
                    }
                } catch (err) {
                    console.error('❌ Failed to create sessions TTL index:', err.message);
                }
            });
            
            return true;
        } catch (err) {
            console.error('❌ MongoDB connection error:', err.message);
            throw err;
        }
    }
    
    function isDatabaseReady() {
        return mongoose.connection.readyState === 1;
    }
    
    module.exports = {
        connect: connectMongoDB,
        isDatabaseReady,
        getConnection: () => mongoose.connection,
        getSessionStore: () => sessionStore,
        dbType: 'mongodb'
    };
    
} else {
    // Oracle DB setup
    const oracledb = require('oracledb');
    const OracleSessionStore = require('./session-store');
    
    let pool = null;
    
    async function connectOracleDB() {
        try {
            // Initialize Oracle client
            try {
                oracledb.initOracleClient();
            } catch (err) {
                if (!err.message.includes('already been initialized')) {
                    throw err;
                }
            }
            
            // Create connection pool
            pool = await oracledb.createPool({
                user: process.env.ORACLE_USER,
                password: process.env.ORACLE_PASSWORD,
                connectString: process.env.ORACLE_CONNECT_STRING,
                poolMin: 1,
                poolMax: 4,
                poolIncrement: 1,
                poolTimeout: 60,
                queueTimeout: 5000
            });
            
            console.log('✅ Oracle DB connection pool created (max 4 connections)');
            
            // Test connection
            const connection = await pool.getConnection();
            await connection.execute('SELECT 1 FROM DUAL');
            await connection.close();
            
            console.log('✅ Oracle database connected successfully');
            
            // Setup session store
            sessionStore = new OracleSessionStore(pool);
            
            dbConnection = pool;
            return true;
        } catch (err) {
            console.error('❌ Oracle DB connection error:', err.message);
            throw err;
        }
    }
    
    function isDatabaseReady() {
        return pool !== null && pool.status === oracledb.POOL_STATUS_OPEN;
    }
    
    async function closeConnection() {
        if (pool) {
            await pool.close(10);
            console.log('✅ Oracle DB pool closed');
        }
    }
    
    module.exports = {
        connect: connectOracleDB,
        isDatabaseReady,
        getConnection: () => pool,
        getSessionStore: () => sessionStore,
        close: closeConnection,
        dbType: 'oracle'
    };
}
