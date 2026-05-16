require('dotenv').config();
const { execute } = require('./database/connection');

(async () => {
    try {
        // Find admin user
        const admins = await execute("SELECT id, username, role FROM users WHERE UPPER(role) = 'ADMIN' OR UPPER(role) = 'admin'");
        console.log('Admin users:', JSON.stringify(admins.rows, null, 2));
        
        // Find user with username containing 'admin'
        const likeAdmin = await execute("SELECT id, username, role FROM users WHERE LOWER(username) LIKE '%admin%'");
        console.log('Users with admin in name:', JSON.stringify(likeAdmin.rows, null, 2));
        
        // Show first 5 users
        const first5 = await execute("SELECT id, username, role FROM users FETCH FIRST 5 ROWS ONLY");
        console.log('First 5 users:', JSON.stringify(first5.rows, null, 2));
    } catch(e) {
        console.error(e.message);
    }
})();
