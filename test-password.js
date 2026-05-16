require('dotenv').config();
const bcrypt = require('bcryptjs');
const { execute } = require('./database/connection');

(async () => {
    try {
        const r = await execute("SELECT id, username, password FROM users WHERE username = 'jamolbek'");
        if (r.rows.length === 0) {
            console.log('User jamolbek not found');
            return;
        }
        const user = r.rows[0];
        console.log('User found:', user.ID, user.USERNAME);
        console.log('Hash (first 20 chars):', String(user.PASSWORD).substring(0, 20) + '...');
        
        // Test passwords
        const testPasswords = ['admin123', 'password', 'admin', 'Jamolbek0803', 'jamolbek'];
        for (const pw of testPasswords) {
            const valid = await bcrypt.compare(pw, user.PASSWORD);
            console.log(`  "${pw}" => ${valid ? 'MATCH' : 'no'}`);
        }
    } catch(e) {
        console.error(e.message);
    }
})();
