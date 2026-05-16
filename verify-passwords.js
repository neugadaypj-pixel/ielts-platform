require('dotenv').config();
const bcrypt = require('bcryptjs');
const { execute } = require('./database/connection');

(async () => {
    try {
        const result = await execute('SELECT username, password, role FROM users WHERE username = :u', { u: 'jamolbek' });
        console.log('Row count:', result.rows.length);
        const user = result.rows[0];
        console.log('Username:', user.USERNAME);
        console.log('Role:', user.ROLE);
        console.log('Password hash:', user.PASSWORD);
        console.log('Hash length:', user.PASSWORD ? user.PASSWORD.length : 'NULL');
        
        if (user.PASSWORD) {
            const test = await bcrypt.compare('Admin123', user.PASSWORD);
            console.log('bcrypt.compare(Admin123, hash):', test);
            
            const test2 = await bcrypt.compare('admin123', user.PASSWORD);
            console.log('bcrypt.compare(admin123, hash):', test2);
        }
    } catch(e) { console.error(e.message); }
})();
