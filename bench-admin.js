const { execute } = require('./database/connection');

(async () => {
    const t0 = Date.now();
    try {
        const [users, tests, groups, teacherCount, studentCount, testCount] = await Promise.all([
            execute('SELECT id, username, role FROM users'),
            execute('SELECT id, title, type FROM tests'),
            execute('SELECT id, name FROM student_groups'),
            execute("SELECT COUNT(*) AS cnt FROM users WHERE role = 'teacher'"),
            execute("SELECT COUNT(*) AS cnt FROM users WHERE role = 'student'"),
            execute('SELECT COUNT(*) AS cnt FROM tests')
        ]);
        const elapsed = Date.now() - t0;
        console.log(`Admin queries completed in ${elapsed}ms`);
        console.log(`Users: ${users.rows.length}, Tests: ${tests.rows.length}, Groups: ${groups.rows.length}`);
        console.log(`Teachers: ${teacherCount.rows[0].CNT}, Students: ${studentCount.rows[0].CNT}`);
    } catch(e) {
        console.error(`Error after ${Date.now()-t0}ms:`, e.message);
    }
    process.exit(0);
})();
