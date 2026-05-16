require('dotenv').config();
const bcrypt = require('bcryptjs');
const { execute } = require('./database/connection');

(async () => {
    try {
        const newPassword = 'Admin123';
        const hashed = await bcrypt.hash(newPassword, 10);
        await execute('UPDATE users SET password = :pwd WHERE username = :uname', { pwd: hashed, uname: 'jamolbek' });
        console.log('Admin password reset to: Admin123');
    } catch(e) { console.error(e.message); }
})();
