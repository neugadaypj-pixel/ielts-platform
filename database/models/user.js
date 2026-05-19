const { execute, executeMany } = require('../connection');

const User = {
    async findById(id) {
        const result = await execute(
            `SELECT id AS "_id", username AS "username", password AS "password", role AS "role",
                    teacher_id AS "teacherId", group_id AS "groupId",
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                    TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
             FROM users WHERE id = :id`,
            { id }
        );
        if (result.rows.length === 0) return null;
        const user = result.rows[0];
        // Load assigned tests
        const tests = await execute(
            `SELECT test_id AS "testId" FROM user_assigned_tests WHERE user_id = :id`, { id }
        );
        user.assignedTests = tests.rows.map(r => r.testId);
        return user;
    },

    async findOne(filter) {
        let sql = `SELECT id AS "_id", username AS "username", password AS "password", role AS "role",
                          teacher_id AS "teacherId", group_id AS "groupId",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                          TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
                   FROM users WHERE 1=1`;
        const binds = {};
        if (filter.username) { sql += ` AND username = :username`; binds.username = filter.username; }
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.role) { sql += ` AND role = :role`; binds.role = filter.role; }
        const result = await execute(sql, binds);
        return result.rows[0] || null;
    },

    async find(filter) {
        let sql = `SELECT id AS "_id", username AS "username", role AS "role",
                          teacher_id AS "teacherId", group_id AS "groupId",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                   FROM users WHERE 1=1`;
        const binds = {};
        if (filter.role) { sql += ` AND role = :role`; binds.role = filter.role; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.groupId) { sql += ` AND group_id = :groupId`; binds.groupId = filter.groupId; }
        // Handle $in on _id
        if (filter._id && filter._id.$in) {
            const ids = filter._id.$in.map((id, i) => {
                binds[`id${i}`] = id;
                return `:id${i}`;
            });
            if (ids.length > 0) sql += ` AND id IN (${ids.join(',')})`;
        }
        const result = await execute(sql, binds);
        return result.rows;
    },

    async create(data) {
        const result = await execute(
            `INSERT INTO users (username, password, role, teacher_id, group_id)
             VALUES (:username, :password, :role, :teacherId, :groupId)
             RETURNING id, TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt" INTO :out_id, :out_created`,
            {
                username: data.username,
                password: data.password,
                role: data.role || 'student',
                teacherId: data.teacherId || null,
                groupId: data.groupId || null,
                out_id: { type: require('oracledb').NUMBER, dir: require('oracledb').BIND_OUT },
                out_created: { type: require('oracledb').STRING, dir: require('oracledb').BIND_OUT, maxSize: 30 }
            }
        );
        const newId = Array.isArray(result.outBinds.out_id) ? result.outBinds.out_id[0] : result.outBinds.out_id;
        const createdAt = Array.isArray(result.outBinds.out_created) ? result.outBinds.out_created[0] : result.outBinds.out_created;
        return { _id: newId, username: data.username, password: data.password, role: data.role || 'student', teacherId: data.teacherId || null, groupId: data.groupId || null, createdAt, assignedTests: [] };
    },

    async findByIdAndUpdate(id, update) {
        // $addToSet: assignedTests
        // NOTE: 'uid' is a reserved Oracle pseudo-column, must use different bind names
        if (update.$addToSet && update.$addToSet.assignedTests) {
            await execute(
                `INSERT INTO user_assigned_tests (user_id, test_id)
                 SELECT :p_user_id, :p_test_id FROM dual
                 WHERE NOT EXISTS (
                     SELECT 1 FROM user_assigned_tests 
                     WHERE user_id = :p_user_id2 AND test_id = :p_test_id2
                 )`,
                { 
                    p_user_id: id, 
                    p_test_id: update.$addToSet.assignedTests,
                    p_user_id2: id,
                    p_test_id2: update.$addToSet.assignedTests
                }
            );
        }
        // $pull: assignedTests
        if (update.$pull && update.$pull.assignedTests) {
            await execute(`DELETE FROM user_assigned_tests WHERE user_id = :p_user_id AND test_id = :p_test_id`, { p_user_id: id, p_test_id: update.$pull.assignedTests });
        }
        // $pull: assignedTests with $in (for bulk delete)
        if (update.$pull && update.$pull.assignedTests && update.$pull.assignedTests.$in) {
            const ids = update.$pull.assignedTests.$in.map((x, i) => { return { k: `p_tid${i}`, v: x }; });
            if (ids.length > 0) {
                await execute(`DELETE FROM user_assigned_tests WHERE user_id = :p_user_id AND test_id IN (${ids.map(d => `:${d.k}`).join(',')})`, Object.assign({ p_user_id: id }, Object.fromEntries(ids.map(d => [d.k, d.v]))));
            }
        }
        // Direct field updates
        const setClauses = [];
        const binds = { id };
        if (update.password) { setClauses.push("password = :password"); binds.password = update.password; }
        if (update.groupId !== undefined) { setClauses.push("group_id = :groupId"); binds.groupId = update.groupId; }
        if (update.teacherId !== undefined) { setClauses.push("teacher_id = :teacherId"); binds.teacherId = update.teacherId; }
        if (update.role) { setClauses.push("role = :role"); binds.role = update.role; }
        if (setClauses.length > 0) {
            await execute(`UPDATE users SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`, binds);
        }
        // $unset
        if (update.$unset && update.$unset.groupId === 1) {
            await execute(`UPDATE users SET group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = :id`, { id });
        }
        if (update.$unset && update.$unset.teacherId === 1) {
            await execute(`UPDATE users SET teacher_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = :id`, { id });
        }
        return User.findById(id);
    },

    // updateMany: for bulk operations ($pull assignedTests)
    async updateMany(filter, update) {
        const users = await User.find(filter);
        for (const user of users) {
            await User.findByIdAndUpdate(user.id, update);
        }
    },

    async deleteMany(filter) {
        let sql = `DELETE FROM users WHERE 1=1`;
        const binds = {};
        if (filter._id && filter._id.$in) {
            const ids = filter._id.$in.map((x, i) => { binds[`id${i}`] = x; return `:id${i}`; });
            if (ids.length > 0) sql += ` AND id IN (${ids.join(',')})`;
        }
        if (filter.role) { sql += ` AND role = :role`; binds.role = filter.role; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        await execute(sql, binds);
    },

    async countDocuments(filter = {}) {
        let sql = `SELECT COUNT(*) AS cnt FROM users WHERE 1=1`;
        const binds = {};
        if (filter.role) { sql += ` AND role = :role`; binds.role = filter.role; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.groupId) { sql += ` AND group_id = :groupId`; binds.groupId = filter.groupId; }
        const result = await execute(sql, binds);
        return result.rows[0].CNT;
    },

    async exists(filter) {
        let sql = `SELECT id FROM users WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.username) { sql += ` AND username = :username`; binds.username = filter.username; }
        if (filter.role) { sql += ` AND role = :role`; binds.role = filter.role; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.groupId) { sql += ` AND group_id = :groupId`; binds.groupId = filter.groupId; }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows.length > 0;
    },

    // Populate-like: find user with group and assigned tests (for student dashboard)
    async findByIdWithGroupAndTests(id) {
        const userResult = await execute(
            `SELECT u.id AS "_id", u.username AS "username", u.role AS "role", u.teacher_id AS "teacherId", u.group_id AS "groupId", g.name AS "groupName",
                    TO_CHAR(u.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
             FROM users u LEFT JOIN groups g ON u.group_id = g.id WHERE u.id = :id`, { id }
        );
        if (userResult.rows.length === 0) return null;
        const user = userResult.rows[0];
        if (user.groupId) {
            const groupId = user.groupId;
            const testsResult = await execute(
                `SELECT t.id AS "_id", t.title, t.type, t.teacher_name AS "teacherName", t.created_by AS "createdBy",
                        t.reading_passage AS "readingPassage", t.builder_json AS "builderJson", t.custom_title AS "customTitle",
                        t.folder, t.questions, TO_CHAR(t.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                 FROM tests t JOIN group_assigned_tests gat ON t.id = gat.test_id WHERE gat.group_id = :gid ORDER BY t.type, t.title`,
                { gid: groupId }
            );
            const testScheduleResult = await execute(
                `SELECT test_id AS "testId", TO_CHAR(available_from, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "availableFrom"
                 FROM group_test_schedule WHERE group_id = :gid`, { gid: groupId }
            );
            user.groupId = { _id: groupId, name: user.groupName, assignedTests: testsResult.rows, testSchedule: testScheduleResult.rows };
        }
        delete user.groupName;
        return user;
    },

    // Populate-like: find user with group name in one call
    async findByIdWithGroup(id) {
        const result = await execute(
            `SELECT u.id AS "_id", u.username AS "username", u.role AS "role", u.teacher_id AS "teacherId", u.group_id AS "groupId", g.name AS "groupName",
                    TO_CHAR(u.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
             FROM users u LEFT JOIN groups g ON u.group_id = g.id WHERE u.id = :id`, { id }
        );
        if (result.rows.length === 0) return null;
        const user = result.rows[0];
        if (user.groupId) { user.groupId = { _id: user.groupId, name: user.groupName }; }
        delete user.groupName;
        return user;
    }
};

module.exports = User;
