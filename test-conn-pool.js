require('dotenv').config();
const { execute } = require('./database/connection');
(async () => {
    try {
        const r = await execute("SELECT COUNT(*) AS CNT FROM users");
        console.log('OK: users table has', r.rows[0].CNT, 'rows');
    } catch (e) {
        console.log('FAIL:', e.message);
    }
    process.exit();
})();
