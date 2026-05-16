const { execute } = require('./database/connection');

(async () => {
    try {
        // Count users
        const users = await execute('SELECT id, username, role FROM users ORDER BY id');
        console.log('=== USERS IN ORACLE ===');
        console.log('Count:', users.rows.length);
        users.rows.forEach(u => console.log(`  [${u.ID}] ${u.USERNAME} (${u.ROLE})`));

        // Count tests
        const tests = await execute('SELECT COUNT(*) AS cnt FROM tests');
        console.log('\nTests count:', tests.rows[0].CNT);

        // Count submissions
        const subs = await execute('SELECT COUNT(*) AS cnt FROM submissions');
        console.log('Submissions count:', subs.rows[0].CNT);

        // Count groups
        const groups = await execute('SELECT COUNT(*) AS cnt FROM student_groups');
        console.log('Groups count:', groups.rows[0].CNT);

        // Count notifications
        const notifs = await execute('SELECT COUNT(*) AS cnt FROM notifications');
        console.log('Notifications count:', notifs.rows[0].CNT);

        // Count feedback
        const feedback = await execute('SELECT COUNT(*) AS cnt FROM feedback');
        console.log('Feedback count:', feedback.rows[0].CNT);

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
})();
