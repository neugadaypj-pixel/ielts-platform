require('dotenv').config();
const oracledb = require('oracledb');

oracledb.initOracleClient({ libDir: '/opt/oracle/instantclient_23_4' });

(async () => {
    // Test IELTS_APP user
    try {
        const c = await oracledb.getConnection({
            user: 'IELTS_APP',
            password: 'IeltsApp@2026#Secure',
            connectString: 'testplatform_high'
        });
        console.log('✅ IELTS_APP connected OK');
        const r = await c.execute('SELECT COUNT(*) AS CNT FROM users');
        console.log(`   users table has ${r.rows[0].CNT} rows`);
        await c.close();
    } catch (e) {
        console.log('❌ IELTS_APP FAIL:', e.message);
    }

    // Test ADMIN user
    try {
        const c2 = await oracledb.getConnection({
            user: 'ADMIN',
            password: 'Jamolbek0803',
            connectString: 'testplatform_high'
        });
        console.log('✅ ADMIN connected OK');
        await c2.close();
    } catch (e2) {
        console.log('❌ ADMIN FAIL:', e2.message);
    }

    process.exit(0);
})();
