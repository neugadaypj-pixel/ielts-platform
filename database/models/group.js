const { execute, executeMany } = require('../connection');
const oracledb = require('oracledb');

/**
 * Helper: load related data for a group (students, assignedTests, testSchedule).
 * Call this after fetching a row from the groups table to populate sub-collections.
 */
async function populateGroup(groupRow) {
    const gid = groupRow._id;
    const [studentsRes, testsRes, scheduleRes] = await Promise.all([
        execute(`SELECT user_id AS "userId" FROM group_students WHERE group_id = :gid`, { gid }),
        execute(`SELECT test_id AS "testId" FROM group_assigned_tests WHERE group_id = :gid`, { gid }),
        execute(
            `SELECT test_id AS "testId", TO_CHAR(available_from, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "availableFrom"
             FROM group_test_schedule WHERE group_id = :gid ORDER BY available_from`, { gid }
        )
    ]);
    groupRow.students = studentsRes.rows.map(r => r.userId);
    groupRow.assignedTests = testsRes.rows.map(r => r.testId);
    groupRow.testSchedule = scheduleRes.rows;
    return groupRow;
}

/**
 * Helper: populate multiple groups in bulk (avoids N+1 queries).
 */
async function populateGroups(groupRows) {
    if (groupRows.length === 0) return groupRows;
    const gids = groupRows.map(g => g._id);
    const placeholders = gids.map((_, i) => `:gid${i}`);
    const binds = {};
    gids.forEach((g, i) => { binds[`gid${i}`] = g; });

    // Create index map for fast lookup
    const groupMap = new Map(groupRows.map(g => [String(g._id), g]));

    // Load students
    if (placeholders.length > 0) {
        const studentsRes = await execute(
            `SELECT group_id AS "groupId", user_id AS "userId" FROM group_students WHERE group_id IN (${placeholders.join(',')})`,
            binds
        );
        studentsRes.rows.forEach(r => {
            const g = groupMap.get(String(r.groupId));
            if (g) {
                if (!g.students) g.students = [];
                g.students.push(r.userId);
            }
        });
    }

    // Load assignedTests
    if (placeholders.length > 0) {
        const testsRes = await execute(
            `SELECT group_id AS "groupId", test_id AS "testId" FROM group_assigned_tests WHERE group_id IN (${placeholders.join(',')})`,
            binds
        );
        testsRes.rows.forEach(r => {
            const g = groupMap.get(String(r.groupId));
            if (g) {
                if (!g.assignedTests) g.assignedTests = [];
                g.assignedTests.push(r.testId);
            }
        });
    }

    // Load testSchedule
    if (placeholders.length > 0) {
        const scheduleRes = await execute(
            `SELECT group_id AS "groupId", test_id AS "testId",
                    TO_CHAR(available_from, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "availableFrom"
             FROM group_test_schedule WHERE group_id IN (${placeholders.join(',')}) ORDER BY available_from`,
            binds
        );
        scheduleRes.rows.forEach(r => {
            const g = groupMap.get(String(r.groupId));
            if (g) {
                if (!g.testSchedule) g.testSchedule = [];
                g.testSchedule.push({ testId: r.testId, availableFrom: r.availableFrom });
            }
        });
    }

    // Ensure all groups have these arrays
    groupRows.forEach(g => {
        if (!g.students) g.students = [];
        if (!g.assignedTests) g.assignedTests = [];
        if (!g.testSchedule) g.testSchedule = [];
    });

    return groupRows;
}

const Group = {
    async findById(id) {
        const result = await execute(
            `SELECT id AS "_id", name AS "name", teacher_id AS "teacherId",
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                    TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
             FROM groups WHERE id = :id`, { id }
        );
        if (result.rows.length === 0) return null;
        return populateGroup(result.rows[0]);
    },

    async findByIdWithStudents(id) {
        // Same as findById — students are always populated
        return Group.findById(id);
    },

    async findOne(filter) {
        let sql = `SELECT id AS "_id", name AS "name", teacher_id AS "teacherId",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                          TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
                   FROM groups WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.name) { sql += ` AND name = :name`; binds.name = filter.name; }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        if (result.rows.length === 0) return null;
        return populateGroup(result.rows[0]);
    },

    async find(filter) {
        let sql = `SELECT id AS "_id", name AS "name", teacher_id AS "teacherId",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                          TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
                   FROM groups WHERE 1=1`;
        const binds = {};

        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.name) { sql += ` AND name = :name`; binds.name = filter.name; }

        sql += ` ORDER BY created_at DESC`;

        const result = await execute(sql, binds);
        return populateGroups(result.rows);
    },

    async create(data) {
        // Use RETURNING INTO to get the new ID
        await execute(
            `INSERT INTO groups (name, teacher_id)
             VALUES (:name, :teacherId)`,
            {
                name: data.name,
                teacherId: data.teacherId
            }
        );
        const idResult = await execute(`SELECT groups_seq.CURRVAL AS id FROM dual`);
        const id = idResult.rows[0].ID;
        return Group.findById(id);
    },

    async findByIdAndUpdate(id, update) {
        // $addToSet: students
        if (update.$addToSet && update.$addToSet.students) {
            await execute(
                `INSERT INTO group_students (group_id, user_id)
                 SELECT :p_gid, :p_uid FROM dual
                 WHERE NOT EXISTS (
                     SELECT 1 FROM group_students WHERE group_id = :p_gid2 AND user_id = :p_uid2
                 )`,
                { p_gid: id, p_uid: update.$addToSet.students, p_gid2: id, p_uid2: update.$addToSet.students }
            );
        }
        // $addToSet: assignedTests
        if (update.$addToSet && update.$addToSet.assignedTests) {
            await execute(
                `INSERT INTO group_assigned_tests (group_id, test_id)
                 SELECT :p_gid, :p_tid FROM dual
                 WHERE NOT EXISTS (
                     SELECT 1 FROM group_assigned_tests WHERE group_id = :p_gid2 AND test_id = :p_tid2
                 )`,
                { p_gid: id, p_tid: update.$addToSet.assignedTests, p_gid2: id, p_tid2: update.$addToSet.assignedTests }
            );
        }

        // $push: testSchedule
        if (update.$push && update.$push.testSchedule) {
            const ts = update.$push.testSchedule;
            await execute(
                `INSERT INTO group_test_schedule (group_id, test_id, available_from)
                 VALUES (:p_gid, :p_tid, TO_TIMESTAMP_TZ(:p_avail, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`,
                {
                    p_gid: id,
                    p_tid: ts.testId,
                    p_avail: ts.availableFrom instanceof Date
                        ? ts.availableFrom.toISOString().replace('Z', '')
                        : String(ts.availableFrom).replace('Z', '')
                }
            );
        }

        // $pull: students (scalar)
        if (update.$pull && update.$pull.students !== undefined && !update.$pull.students.$in) {
            await execute(
                `DELETE FROM group_students WHERE group_id = :p_gid AND user_id = :p_uid`,
                { p_gid: id, p_uid: update.$pull.students }
            );
        }
        // $pull: students with $in
        if (update.$pull && update.$pull.students && update.$pull.students.$in) {
            const ids = update.$pull.students.$in.map((x, i) => { return { k: `suid${i}`, v: x }; });
            if (ids.length > 0) {
                const inBinds = Object.fromEntries(ids.map(d => [d.k, d.v]));
                await execute(
                    `DELETE FROM group_students WHERE group_id = :p_gid AND user_id IN (${ids.map(d => `:${d.k}`).join(',')})`,
                    Object.assign({ p_gid: id }, inBinds)
                );
            }
        }

        // $pull: assignedTests (scalar)
        if (update.$pull && update.$pull.assignedTests !== undefined && typeof update.$pull.assignedTests !== 'object') {
            await execute(
                `DELETE FROM group_assigned_tests WHERE group_id = :p_gid AND test_id = :p_tid`,
                { p_gid: id, p_tid: update.$pull.assignedTests }
            );
        }
        // $pull: assignedTests with $in
        if (update.$pull && update.$pull.assignedTests && update.$pull.assignedTests.$in) {
            const ids = update.$pull.assignedTests.$in.map((x, i) => { return { k: `atid${i}`, v: x }; });
            if (ids.length > 0) {
                const inBinds = Object.fromEntries(ids.map(d => [d.k, d.v]));
                await execute(
                    `DELETE FROM group_assigned_tests WHERE group_id = :p_gid AND test_id IN (${ids.map(d => `:${d.k}`).join(',')})`,
                    Object.assign({ p_gid: id }, inBinds)
                );
            }
        }

        // $pull: testSchedule with testId
        // Pattern 1: { testSchedule: { testId: testId } } — scalar
        if (update.$pull && update.$pull.testSchedule && update.$pull.testSchedule.testId !== undefined &&
            !update.$pull.testSchedule.testId.$in) {
            await execute(
                `DELETE FROM group_test_schedule WHERE group_id = :p_gid AND test_id = :p_tid`,
                { p_gid: id, p_tid: update.$pull.testSchedule.testId }
            );
        }
        // Pattern 2: { testSchedule: { testId: { $in: ids } } } — bulk
        if (update.$pull && update.$pull.testSchedule && update.$pull.testSchedule.testId &&
            update.$pull.testSchedule.testId.$in) {
            const ids = update.$pull.testSchedule.testId.$in.map((x, i) => { return { k: `tsid${i}`, v: x }; });
            if (ids.length > 0) {
                const inBinds = Object.fromEntries(ids.map(d => [d.k, d.v]));
                await execute(
                    `DELETE FROM group_test_schedule WHERE group_id = :p_gid AND test_id IN (${ids.map(d => `:${d.k}`).join(',')})`,
                    Object.assign({ p_gid: id }, inBinds)
                );
            }
        }

        // Update group-level fields (name)
        const setClauses = [];
        const binds = { id };
        if (update.name !== undefined) { setClauses.push("name = :name"); binds.name = update.name; }
        if (setClauses.length > 0) {
            await execute(
                `UPDATE groups SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`, binds
            );
        }

        return Group.findById(id);
    },

    async updateMany(filter, update) {
        // Find all matching groups
        const groups = await Group.find(filter);

        // For each group, apply the update (reuse findByIdAndUpdate logic)
        for (const group of groups) {
            // Handle $pull: assignedTests with $in
            if (update.$pull && update.$pull.assignedTests && update.$pull.assignedTests.$in) {
                const ids = update.$pull.assignedTests.$in.map((x, i) => { return { k: `atid${i}`, v: x }; });
                if (ids.length > 0) {
                    const inBinds = Object.fromEntries(ids.map(d => [d.k, d.v]));
                    await execute(
                        `DELETE FROM group_assigned_tests WHERE group_id = :p_gid AND test_id IN (${ids.map(d => `:${d.k}`).join(',')})`,
                        Object.assign({ p_gid: group._id }, inBinds)
                    );
                }
            }
            // Handle $pull: testSchedule with testId $in
            if (update.$pull && update.$pull.testSchedule && update.$pull.testSchedule.testId) {
                if (update.$pull.testSchedule.testId.$in) {
                    const ids = update.$pull.testSchedule.testId.$in.map((x, i) => { return { k: `tsid${i}`, v: x }; });
                    if (ids.length > 0) {
                        const inBinds = Object.fromEntries(ids.map(d => [d.k, d.v]));
                        await execute(
                            `DELETE FROM group_test_schedule WHERE group_id = :p_gid AND test_id IN (${ids.map(d => `:${d.k}`).join(',')})`,
                            Object.assign({ p_gid: group._id }, inBinds)
                        );
                    }
                } else {
                    // Scalar testId in testSchedule pull
                    await execute(
                        `DELETE FROM group_test_schedule WHERE group_id = :p_gid AND test_id = :p_tid`,
                        { p_gid: group._id, p_tid: update.$pull.testSchedule.testId }
                    );
                }
            }
            // Handle $pull: assignedTests scalar (single test removal from bulk)
            if (update.$pull && update.$pull.assignedTests !== undefined &&
                typeof update.$pull.assignedTests !== 'object') {
                await execute(
                    `DELETE FROM group_assigned_tests WHERE group_id = :p_gid AND test_id = :p_tid`,
                    { p_gid: group._id, p_tid: update.$pull.assignedTests }
                );
            }
        }
    },

    async exists(filter) {
        // For simple existence checks
        if (filter._id && filter.assignedTests && filter.assignedTests.$in) {
            // Check if group has a specific test assigned
            const testIds = filter.assignedTests.$in.map((x, i) => { return { k: `tid${i}`, v: x }; });
            if (testIds.length === 0) return false;
            const inBinds = Object.fromEntries(testIds.map(d => [d.k, d.v]));
            const result = await execute(
                `SELECT 1 FROM group_assigned_tests
                 WHERE group_id = :gid AND test_id IN (${testIds.map(d => `:${d.k}`).join(',')})
                 AND ROWNUM = 1`,
                Object.assign({ gid: filter._id }, inBinds)
            );
            return result.rows.length > 0;
        }

        // Generic existence check
        let sql = `SELECT id FROM groups WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.name) { sql += ` AND name = :name`; binds.name = filter.name; }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows.length > 0;
    },

    async findByIdAndDelete(id) {
        const group = await Group.findById(id);
        if (group) {
            // Cascade: delete students, assignedTests, testSchedule
            await execute(`DELETE FROM group_test_schedule WHERE group_id = :id`, { id });
            await execute(`DELETE FROM group_assigned_tests WHERE group_id = :id`, { id });
            await execute(`DELETE FROM group_students WHERE group_id = :id`, { id });
            await execute(`DELETE FROM groups WHERE id = :id`, { id });
        }
        return group;
    },

    async deleteMany(filter) {
        const groups = await Group.find(filter);
        for (const group of groups) {
            await Group.findByIdAndDelete(group._id);
        }
    },

    async countDocuments(filter = {}) {
        let sql = `SELECT COUNT(*) AS cnt FROM groups WHERE 1=1`;
        const binds = {};
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        const result = await execute(sql, binds);
        return result.rows[0].CNT;
    }
};

module.exports = Group;
