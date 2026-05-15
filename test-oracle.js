const oracledb = require('oracledb');

async function test() {
    try {
        oracledb.initOracleClient({ libDir: '/opt/oracle/instantclient_23_4' });
        const conn = await oracledb.getConnection({
            user: 'IELTS_APP',
            password: 'IeltsApp@2026#Secure',
            connectString: 'testplatform_high'
        });
        console.log('Oracle DB connected successfully!');
        const result = await conn.execute('SELECT SYSDATE FROM DUAL');
        console.log('Server time:', result.rows[0][0]);
        await conn.close();
        process.exit(0);
    } catch(e) {
        console.error('Connection failed:', e.message);
        process.exit(1);
    }
}

test();
