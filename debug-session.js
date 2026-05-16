require('dotenv').config();
const { execute } = require('./database/connection');

(async () => {
    try {
        const r = await execute('SELECT COUNT(*) AS cnt FROM sessions');
        console.log('Sessions:', r.rows[0].CNT);
        
        const u = await execute('SELECT id, username, role FROM users WHERE username = :u', { u: 'admin' });
        console.log('Admin user:', JSON.stringify(u.rows));
        
        const cu = await execute('SELECT COUNT(*) AS cnt FROM users');
        console.log('Total users:', cu.rows[0].CNT);
        
        // Check recent sessions
        const sess = await execute('SELECT sid, SUBSTR(data, 1, 200) AS data_preview, expires FROM sessions ORDER BY created_at DESC FETCH FIRST 3 ROWS ONLY');
        console.log('Recent sessions:', JSON.stringify(sess.rows, null, 2));
    } catch(e) {
        console.error(e.message);
    }
})();
