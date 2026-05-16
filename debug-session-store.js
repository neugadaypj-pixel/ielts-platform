require('dotenv').config();
const { execute, getPool } = require('./database/connection');

(async () => {
    try {
        // Check sessions table exists and structure
        const cols = await execute(`SELECT column_name, data_type FROM user_tab_columns WHERE table_name = 'SESSIONS' ORDER BY column_id`);
        console.log('Sessions columns:', JSON.stringify(cols.rows, null, 2));
        
        // Try to manually insert a session
        const testSid = 'test-session-123';
        const testData = JSON.stringify({ userId: 1, userRole: 'admin' });
        const expires = new Date(Date.now() + 86400000);
        
        await execute(
            `MERGE INTO sessions s
             USING dual ON (s.sid = :sid)
             WHEN MATCHED THEN UPDATE SET data = :data, expires = :expires, updated_at = CURRENT_TIMESTAMP
             WHEN NOT MATCHED THEN INSERT (sid, data, expires) VALUES (:sid, :data, :expires)`,
            { sid: testSid, data: testData, expires }
        );
        console.log('Session insert attempted');
        
        // Verify
        const check = await execute("SELECT sid, SUBSTR(data,1,100) AS d, expires FROM sessions WHERE sid = :sid", { sid: testSid });
        console.log('Session check:', JSON.stringify(check.rows, null, 2));
        
        // Check if jamolbek exists with password
        const admin = await execute("SELECT id, username, role, LENGTH(password) AS pw_len FROM users WHERE username = 'jamolbek'");
        console.log('Admin user:', JSON.stringify(admin.rows, null, 2));
    } catch(e) {
        console.error('ERROR:', e.message);
    }
})();
