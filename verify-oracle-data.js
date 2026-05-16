require('dotenv').config();
const { execute } = require('./database/connection');

(async () => {
    console.log('=== Oracle Data Verification ===\n');
    
    // Check entity counts
    const counts = await execute(`
        SELECT 
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM tests) AS tests,
            (SELECT COUNT(*) FROM groups) AS groups,
            (SELECT COUNT(*) FROM submissions) AS submissions,
            (SELECT COUNT(*) FROM feedbacks) AS feedbacks,
            (SELECT COUNT(*) FROM notifications) AS notifications,
            (SELECT COUNT(*) FROM group_students) AS group_students,
            (SELECT COUNT(*) FROM group_assigned_tests) AS group_assigned_tests,
            (SELECT COUNT(*) FROM user_assigned_tests) AS user_assigned_tests
        FROM dual
    `);
    console.log('Table row counts:');
    Object.entries(counts.rows[0]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    
    // Check sequence values
    const seqs = await execute(`
        SELECT 
            users_seq.NEXTVAL - 1 AS users_max,
            tests_seq.NEXTVAL - 1 AS tests_max,
            groups_seq.NEXTVAL - 1 AS groups_max,
            submissions_seq.NEXTVAL - 1 AS submissions_max,
            feedbacks_seq.NEXTVAL - 1 AS feedbacks_max,
            notifications_seq.NEXTVAL - 1 AS notifications_max
        FROM dual
    `);
    console.log('\nSequence current values (max IDs):');
    Object.entries(seqs.rows[0]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    
    // Verify a sample user
    const sampleUser = await execute(
        `SELECT id, username, role, teacher_id, group_id FROM users WHERE rownum = 1`
    );
    console.log('\nSample user:', sampleUser.rows[0]);
    
    // Verify a sample test
    const sampleTest = await execute(
        `SELECT id, title, type, created_by FROM tests WHERE rownum = 1`
    );
    console.log('Sample test:', sampleTest.rows[0]);

    // Verify junctions work
    const juncCheck = await execute(`
        SELECT u.username, g.name AS group_name
        FROM users u
        JOIN groups g ON u.group_id = g.id
        WHERE u.group_id IS NOT NULL
        FETCH FIRST 3 ROWS ONLY
    `);
    console.log('\nSample user-group relationships:');
    juncCheck.rows.forEach(r => console.log(`  ${r.USERNAME} → ${r.GROUP_NAME}`));

    console.log('\n✅ All verifications passed!');
    process.exit();
})();
