const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');

async function runSchema() {
    let conn;
    try {
        oracledb.initOracleClient({ libDir: '/opt/oracle/instantclient_23_4' });

        conn = await oracledb.getConnection({
            user: 'IELTS_APP',
            password: 'IeltsApp@2026#Secure',
            connectString: 'testplatform_high'
        });

        console.log('Connected to Oracle as IELTS_APP');

        const schemaPath = path.join(__dirname, 'schema.sql');
        const rawSql = fs.readFileSync(schemaPath, 'utf8');
        console.log(`Read schema.sql (${rawSql.length} bytes)`);

        // Split by '/' on its own line (PL/SQL terminator)
        // This works because every statement in schema.sql ends with a /
        const statements = rawSql
            .split(/\n\/\s*\n|\n\/\s*$/)
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.split('\n').every(l => l.trim() === '' || l.trim().startsWith('--')));

        let total = 0;
        let ok = 0;
        let fail = 0;
        const skipErrors = ['ORA-00955', 'ORA-02275', 'ORA-01430', 'ORA-02264', 'ORA-00942', 'ORA-01418'];

        for (const stmt of statements) {
            total++;
            const preview = stmt.substring(0, 80).replace(/\n/g, ' ');
            try {
                await conn.execute(stmt);
                console.log(`  [OK] #${total}: ${preview}...`);
                ok++;
            } catch (err) {
                const msg = err.message || '';
                if (skipErrors.some(code => msg.includes(code))) {
                    console.log(`  [SKIP] #${total}: Already exists — ${preview.substring(0, 55)}...`);
                    ok++;
                } else {
                    console.error(`  [FAIL] #${total}: ${preview}...`);
                    console.error(`         ${msg}`);
                    fail++;
                }
            }
        }

        await conn.commit();
        console.log(`\n=== Summary ===`);
        console.log(`Total: ${total} | OK/Skip: ${ok} | Failed: ${fail}`);

        if (fail > 0) {
            process.exit(1);
        } else {
            console.log('Schema created successfully!');
            process.exit(0);
        }

    } catch (err) {
        console.error('Fatal error:', err.message);
        process.exit(1);
    } finally {
        if (conn) { try { await conn.close(); } catch (e) {} }
    }
}

runSchema();
