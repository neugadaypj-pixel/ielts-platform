require('dotenv').config();
const { execute } = require('./database/connection');

(async () => {
    try {
        // Clear sessions first
        await execute('DELETE FROM sessions');
        console.log('Sessions cleared');
        
        console.log('\nNow manually login via curl:');
        console.log('curl -c /tmp/c.txt -b /tmp/c.txt -s -o /dev/null -w "HTTP:%{http_code}" -L -X POST http://localhost:3000/login -d "username=jamolbek&password=admin123&_csrf=FROM_GET" -H "Content-Type: application/x-www-form-urlencoded"');
        
        // Wait and check sessions
        setTimeout(async () => {
            const r = await execute('SELECT COUNT(*) AS cnt FROM sessions');
            console.log('After login - Sessions count:', r.rows[0].CNT);
        }, 3000);
    } catch(e) {
        console.error(e.message);
    }
})();
