const { execute } = require('./database/connection');

(async () => {
    try {
        await execute('DELETE FROM group_test_schedule');
        await execute('DELETE FROM group_assigned_tests');
        await execute('DELETE FROM group_students');
        await execute('DELETE FROM user_assigned_tests');
        await execute('DELETE FROM notifications');
        await execute('DELETE FROM feedbacks');
        await execute('DELETE FROM submissions');
        await execute('DELETE FROM tests');
        await execute('DELETE FROM groups');
        await execute('DELETE FROM users');
        console.log('All Oracle tables cleared.');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
