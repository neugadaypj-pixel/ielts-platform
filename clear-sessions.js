require('dotenv').config();
const { getPool } = require('./database/connection');

async function clearSessions() {
    let conn;
    try {
        console.log('🔄 Connecting to Oracle...');
        const pool = await getPool();
        conn = await pool.getConnection();
        console.log('✅ Connected to Oracle');

        console.log('🗑️  Clearing all sessions...');
        const result = await conn.execute('DELETE FROM sessions');
        await conn.commit();
        console.log(`✅ Deleted ${result.rowsAffected} sessions`);

        console.log('👥 All users will need to log in again after deployment');

        await conn.close();
        console.log('✅ Database connection closed');
        console.log('🚀 Ready to deploy!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing sessions:', error.message);
        if (conn) {
            try { await conn.close(); } catch (e) { /* ignore */ }
        }
        process.exit(1);
    }
}

clearSessions();
