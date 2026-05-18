const { execute } = require('../connection');

const Group = {
    async findById(id) {
        const result = await execute(
            `SELECT id AS "_id", name AS "name", teacher_id AS "teacherId",
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                    TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
             FROM groups WHERE id = :id`,
            { id }
        );
        if (result.rows.length === 0) return null;
        const group = result.rows[0];

        // Load students
        const students = await execute(
            `SELECT user_id FROM group_students WHERE group_id = :id`, { id }
        );
        group.students = students.rows.map(r => r.USER_ID);

        // Load assigned tests
        const tests = await execute(
            `SELECT test_id FROM group_assigned_tests WHERE group_id = :id`, { id }
        );
        group.assignedTests = tests.rows.map(r => r.TEST_ID);

        // Load test schedule
        const schedule = await execute(
            `SELECT test_id AS "testId",
                    TO_CHAR(available_from, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "availableFrom"
             FROM group_test_schedule WHERE group_id = :id`, { id }
        );
        group.testSchedule = schedule.rows;

        return group;
    },

    // Populate: find group with student user objects (not just IDs)
    async findByIdWithStudents(id) {
        const group = await Group.findById(id);
        if (!group || !group.students || group.students.length === 0) return group || null;

        const studentIds = group.students;
        if (studentIds.length === 0) return group;

        const placeholders = studentIds.map((_, i) => `:sid${i}`).join(',');
        const binds = {};
        studentIds.forEach((sid, i) => { binds[`sid${i}`] = sid; });

        const result = await execute(
            `SELECT id AS "_id", username AS "username", role AS "role", group_id AS "groupId",
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
             FROM users WHERE id IN (${placeholders})`,
            binds
        );
        group.students = result.rows;
        return group;
    },

    async findOne(filter) {
        let sql = `SELECT id AS "_id", name AS "name", teacher_id AS "teacherId",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                   FROM groups WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.name) { sql += ` AND name = :name`; binds.name = filter.name; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows[0] || null;
    },

    async find(filter) {
        let sql = `SELECT id AS "_id", name AS "name", teacher_id AS "teacherId",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                   FROM groups WHERE 1=1`;
        const binds = {};
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }

        // $in
        if (filter._id && filter._id.$in) {
            const ids = filter._id.$in.map((x, i) => {
                binds[`id${i}`] = x;
                return `:id${i}`;
            });
            if (ids.length > 0) sql += ` AND id IN (${ids.join(',')})`;
        }

        sql += ` ORDER BY created_at DESC`;
        const result = await execute(sql, binds);
        return result.rows;
    },

    async create(data) {
        await execute(
            `INSERT INTO groups (name, teacher_id) VALUES (:name, :teacherId)`,
            { name: data.name, teacherId: data.teacherId }
        );
        const idResult = await execute(`SELECT groups_seq.CURRVAL AS id FROM dual`);
        const id = idResult.rows[0].ID;
        return Group.findById(id);
    },

    async findByIdAndUpdate(id, update) {
        const setClauses = [];
        const binds = { id };

        if (update.name) { setClauses.push("name = :name"); binds.name = update.name; }
        if (update.teacherId) { setClauses.push("teacher_id = :teacherId"); binds.teacherId = update.teacherId; }

        if (setClauses.length > 0) {
            await execute(
                `UPDATE groups SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`, binds
            );
        }

        // $addToSet: students
        if (update.$addToSet && update.$addToSet.students) {
            await execute(
                `MERGE INTO group_students gs
                 USING dual ON (gs.group_id = :gid AND gs.user_id = :uid)
                 WHEN NOT MATCHED THEN INSERT (group_id, user_id) VALUES (:gid, :uid)`,
                { gid: id, uid: update.$addToSet.students }
            );
        }
        // $addToSet: assignedTests
        if (update.$addToSet && update.$addToSet.assignedTests) {
            await execute(
                `MERGE INTO group_assigned_tests gat
                 USING dual ON (gat.group_id = :gid AND gat.test_id = :tid)
                 WHEN NOT MATCHED THEN INSERT (group_id, test_id) VALUES (:gid, :tid)`,
                { gid: id, tid: update.$addToSet.assignedTests }
            );
        }

        // $push: testSchedule
        if (update.$push && update.$push.testSchedule) {
            const sched = update.$push.testSchedule;
            await execute(
                `INSERT INTO group_test_schedule (id, group_id, test_id, available_from)
                 VALUES (test_schedule_seq.NEXTVAL, :gid, :tid, :af)`,
                { gid: id, tid: sched.testId, af: sched.availableFrom || null }
            );
        }

        // $pull: students
        if (update.$pull && update.$pull.students) {
            await execute(
                `DELETE FROM group_students WHERE group_id = :gid AND user_id = :uid`,
                { gid: id, uid: update.$pull.students }
            );
        }
        // $pull: assignedTests
        if (update.$pull && update.$pull.assignedTests) {
            await execute(
                `DELETE FROM group_assigned_tests WHERE group_id = :gid AND test_id = :tid`,
                { gid: id, tid: update.$pull.assignedTests }
            );
        }
        // $pull: testSchedule (object with testId)
        if (update.$pull && update.$pull.testSchedule) {
            if (update.$pull.testSchedule.testId) {
                await execute(
                    `DELETE FROM group_test_schedule WHERE group_id = :gid AND test_id = :tid`,
                    { gid: id, tid: update.$pull.testSchedule.testId }
                );
            }
        }

        return Group.findById(id);
    },

    async findByIdAndDelete(id) {
        const doc = await Group.findById(id);
        if (doc) {
            await execute(`DELETE FROM groups WHERE id = :id`, { id });
        }
        return doc;
    },

    async deleteMany(filter) {
        let sql = `DELETE FROM groups WHERE 1=1`;
        const binds = {};
        if (filter._id && filter._id.$in) {
            const ids = filter._id.$in.map((x, i) => {
                binds[`id${i}`] = x;
                return `:id${i}`;
            });
            if (ids.length > 0) sql += ` AND id IN (${ids.join(',')})`;
        }
        if (filter.teacherId) { sql += ` AND teacher_id = :tid`; binds.tid = filter.teacherId; }
        await execute(sql, binds);
    },

    async countDocuments(filter = {}) {
        let sql = `SELECT COUNT(*) AS cnt FROM groups WHERE 1=1`;
        const binds = {};
        if (filter.teacherId) { sql += ` AND teacher_id = :tid`; binds.tid = filter.teacherId; }
        const result = await execute(sql, binds);
        return result.rows[0].CNT;
    },

    async exists(filter) {
        let sql = `SELECT id FROM groups WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.name) { sql += ` AND name = :name`; binds.name = filter.name; }
        if (filter.teacherId) { sql += ` AND teacher_id = :tid`; binds.tid = filter.teacherId; }
        // Check for $in on students or assignedTests
        if (filter.students && filter.students.$in) {
            const ids = filter.students.$in.map((x, i) => {
                binds[`sid${i}`] = x;
                return `:sid${i}`;
            });
            if (ids.length > 0) {
                sql += ` AND id IN (SELECT group_id FROM group_students WHERE user_id IN (${ids.join(',')}))`;
            }
        }
        if (filter.assignedTests && filter.assignedTests.$in) {
            const ids = filter.assignedTests.$in.map((x, i) => {
                binds[`atid${i}`] = x;
                return `:atid${i}`;
            });
            if (ids.length > 0) {
                sql += ` AND id IN (SELECT group_id FROM group_assigned_tests WHERE test_id IN (${ids.join(',')}))`;
            }
        }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows.length > 0;
    },

    async updateMany(filter, update) {
        // For bulk $pull with $in (delete many items from many groups), use direct SQL
        if (update.$pull && update.$pull.assignedTests) {
            if (update.$pull.assignedTests.$in) {
                const ids = update.$pull.assignedTests.$in;
                const placeholders = ids.map((_, i) => `:tid${i}`).join(',');
                const binds = {};
                ids.forEach((id, i) => { binds[`tid${i}`] = id; });
                await execute(`DELETE FROM group_assigned_tests WHERE test_id IN (${placeholders})`, binds);
            } else {
                const groups = await Group.find(filter);
                for (const g of groups) {
                    await execute(`DELETE FROM group_assigned_tests WHERE group_id = :gid AND test_id = :tid`, { gid: g._id, tid: update.$pull.assignedTests });
                }
            }
        }
        if (update.$pull && update.$pull.testSchedule) {
            if (update.$pull.testSchedule.testId) {
                if (update.$pull.testSchedule.testId.$in) {
                    const ids = update.$pull.testSchedule.testId.$in;
                    const placeholders = ids.map((_, i) => `:tid${i}`).join(',');
                    const binds = {};
                    ids.forEach((id, i) => { binds[`tid${i}`] = id; });
                    await execute(`DELETE FROM group_test_schedule WHERE test_id IN (${placeholders})`, binds);
                } else {
                    const groups = await Group.find(filter);
                    for (const g of groups) {
                        await execute(`DELETE FROM group_test_schedule WHERE group_id = :gid AND test_id = :tid`, { gid: g._id, tid: update.$pull.testSchedule.testId });
                    }
                }
            }
        }
    }
};

module.exports = Group;
