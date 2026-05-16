require('dotenv').config();
const oracledb = require('oracledb');
oracledb.initOracleClient({ libDir: '/opt/oracle/instantclient_23_4' });

(async () => {
    // Step 1: Reset ADMIN expired password using newPassword option
    try {
        const conn = await oracledb.getConnection({
            user: 'ADMIN',
            password: 'Jamolbek0803',
            connectString: 'testplatform_high',
            newPassword: 'Jamolbek0803#2026'
        });
        console.log('ADMIN password reset successfully');

        await conn.execute("ALTER USER IELTS_APP QUOTA UNLIMITED ON DATA");
        console.log('Granted UNLIMITED QUOTA on DATA to IELTS_APP');

        await conn.commit();
        await conn.close();
    } catch (e) {
        console.log('ADMIN connection failed:', e.message);
        
        // Try with OCI wallet if direct connect failed
        try {
            const conn2 = await oracledb.getConnection({
                user: 'ADMIN',
                password: 'Jamolbek0803',
                connectString: 'testplatform_high',
                newPassword: 'Jamolbek0803#2026'
            });
            console.log('ADMIN password reset (retry) successfully');
            await conn2.execute("ALTER USER IELTS_APP QUOTA UNLIMITED ON DATA");
            console.log('Granted UNLIMITED QUOTA on DATA to IELTS_APP (retry)');
            await conn2.commit();
            await conn2.close();
        } catch (e2) {
            console.log('ADMIN retry also failed:', e2.message);
        }
    }
    process.exit();
})();
