const { execute } = require('../connection');

const Test = {
    async findById(id) {
        const result = await execute(
            `SELECT id AS "_id", title AS "title", type AS "type", teacher_name AS "teacherName",
                    created_by AS "createdBy", reading_passage AS "readingPassage",
                    builder_json AS "builderJson", custom_title AS "customTitle",
                    folder AS "folder", questions AS "questions",
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                    TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
             FROM tests WHERE id = :id`,
            { id }
        );
        return result.rows[0] || null;
    },

    async findOne(filter) {
        let sql = `SELECT id AS "_id", title AS "title", type AS "type", teacher_name AS "teacherName",
                          created_by AS "createdBy", reading_passage AS "readingPassage",
                          builder_json AS "builderJson", custom_title AS "customTitle",
                          folder AS "folder", questions AS "questions",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                   FROM tests WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.title) { sql += ` AND title = :title`; binds.title = filter.title; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        if (filter.createdBy) { sql += ` AND created_by = :createdBy`; binds.createdBy = filter.createdBy; }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows[0] || null;
    },

    async find(filter) {
        let sql = `SELECT id AS "_id", title AS "title", type AS "type", teacher_name AS "teacherName",
                          created_by AS "createdBy", reading_passage AS "readingPassage",
                          builder_json AS "builderJson", custom_title AS "customTitle",
                          folder AS "folder", questions AS "questions",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                          TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
                   FROM tests WHERE 1=1`;
        const binds = {};

        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        if (filter.createdBy) { sql += ` AND created_by = :createdBy`; binds.createdBy = filter.createdBy; }
        if (filter.folder) { sql += ` AND folder = :folder`; binds.folder = filter.folder; }

        // $in
        if (filter._id && filter._id.$in) {
            const ids = filter._id.$in.map((x, i) => {
                binds[`id${i}`] = x;
                return `:id${i}`;
            });
            if (ids.length > 0) sql += ` AND id IN (${ids.join(',')})`;
        }
        if (filter.createdBy && filter.createdBy.$in) {
            const ids = filter.createdBy.$in.map((x, i) => {
                binds[`cb${i}`] = x;
                return `:cb${i}`;
            });
            if (ids.length > 0) sql += ` AND created_by IN (${ids.join(',')})`;
        }

        // $regex on title
        if (filter.title && filter.title.$regex) {
            sql += ` AND REGEXP_LIKE(title, :titleRegex, 'i')`;
            binds.titleRegex = filter.title.$regex;
        }
        // $or
        if (filter.$or) {
            const orClauses = [];
            filter.$or.forEach((cond, i) => {
                if (cond.title && cond.title.$regex) {
                    orClauses.push(`REGEXP_LIKE(title, :orTitle${i}, 'i')`);
                    binds[`orTitle${i}`] = cond.title.$regex;
                }
            });
            if (orClauses.length > 0) sql += ` AND (${orClauses.join(' OR ')})`;
        }

        // Sort
        if (filter.$sort) {
            const sortEntries = Object.entries(filter.$sort);
            if (sortEntries.length > 0) {
                sql += ` ORDER BY ` + sortEntries.map(([key, dir]) => {
                    const col = key === 'createdAt' ? 'created_at' : key === 'createdBy' ? 'created_by' : key;
                    return `${col} ${dir === -1 ? 'DESC' : 'ASC'}`;
                }).join(', ');
            }
        } else {
            sql += ` ORDER BY created_at DESC`;
        }

        // Pagination
        if (filter.$skip !== undefined && filter.$limit !== undefined) {
            sql += ` OFFSET :skip ROWS FETCH NEXT :lim ROWS ONLY`;
            binds.skip = filter.$skip;
            binds.lim = filter.$limit;
        } else if (filter.$limit !== undefined) {
            sql += ` FETCH FIRST :lim ROWS ONLY`;
            binds.lim = filter.$limit;
        }

        const result = await execute(sql, binds);
        return result.rows;
    },

    async create(data) {
        // Oracle doesn't support RETURNING INTO with CLOB easily, so do two-step
        await execute(
            `INSERT INTO tests (title, type, teacher_name, created_by, reading_passage,
                               builder_json, custom_title, folder, questions)
             VALUES (:title, :type, :teacherName, :createdBy, :readingPassage,
                     :builderJson, :customTitle, :folder, :questions)`,
            {
                title: data.title,
                type: data.type || 'reading',
                teacherName: data.teacherName || '',
                createdBy: data.createdBy,
                readingPassage: data.readingPassage || '',
                builderJson: data.builderJson || '',
                customTitle: data.customTitle || '',
                folder: data.folder || '',
                questions: data.questions ? (typeof data.questions === 'string' ? data.questions : JSON.stringify(data.questions)) : '[]'
            }
        );
        // Get the last inserted ID (safe for single-user)
        const idResult = await execute(`SELECT tests_seq.CURRVAL AS id FROM dual`);
        const id = idResult.rows[0].ID;
        return Test.findById(id);
    },

    async findByIdAndUpdate(id, update) {
        const setClauses = [];
        const binds = { id };

        if (update.title !== undefined) { setClauses.push("title = :title"); binds.title = update.title; }
        if (update.type !== undefined) { setClauses.push("type = :type"); binds.type = update.type; }
        if (update.teacherName !== undefined) { setClauses.push("teacher_name = :tn"); binds.tn = update.teacherName; }
        if (update.folder !== undefined) { setClauses.push("folder = :folder"); binds.folder = update.folder; }
        if (update.customTitle !== undefined) { setClauses.push("custom_title = :ct"); binds.ct = update.customTitle; }
        if (update.readingPassage !== undefined) { setClauses.push("reading_passage = :rp"); binds.rp = update.readingPassage; }
        if (update.builderJson !== undefined) { setClauses.push("builder_json = :bj"); binds.bj = update.builderJson; }
        if (update.questions !== undefined) {
            setClauses.push("questions = :q");
            binds.q = typeof update.questions === 'string' ? update.questions : JSON.stringify(update.questions);
        }

        if (setClauses.length > 0) {
            await execute(
                `UPDATE tests SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`, binds
            );
        }
        return Test.findById(id);
    },

    async findByIdAndDelete(id) {
        const doc = await Test.findById(id);
        if (doc) {
            await execute(`DELETE FROM tests WHERE id = :id`, { id });
        }
        return doc;
    },

    async deleteMany(filter) {
        let sql = `DELETE FROM tests WHERE 1=1`;
        const binds = {};
        if (filter._id && filter._id.$in) {
            const ids = filter._id.$in.map((x, i) => {
                binds[`id${i}`] = x;
                return `:id${i}`;
            });
            if (ids.length > 0) sql += ` AND id IN (${ids.join(',')})`;
        }
        if (filter.createdBy) { sql += ` AND created_by = :cb`; binds.cb = filter.createdBy; }
        await execute(sql, binds);
    },

    async countDocuments(filter = {}) {
        let sql = `SELECT COUNT(*) AS cnt FROM tests WHERE 1=1`;
        const binds = {};
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        if (filter.createdBy) { sql += ` AND created_by = :cb`; binds.cb = filter.createdBy; }
        const result = await execute(sql, binds);
        return result.rows[0].CNT;
    },

    async exists(filter) {
        let sql = `SELECT id FROM tests WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows.length > 0;
    },

    // Populate: test with creator info
    async findByIdWithCreator(id) {
        const result = await execute(
            `SELECT t.id AS "_id", t.title AS "title", t.type AS "type", t.teacher_name AS "teacherName",
                    t.created_by AS "createdBy", t.reading_passage AS "readingPassage",
                    t.builder_json AS "builderJson", t.custom_title AS "customTitle",
                    t.folder AS "folder", t.questions AS "questions",
                    u.username AS "creatorUsername", u.role AS "creatorRole",
                    TO_CHAR(t.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
             FROM tests t
             JOIN users u ON t.created_by = u.id
             WHERE t.id = :id`, { id }
        );
        if (result.rows.length === 0) return null;
        const test = result.rows[0];
        test.createdBy = {
            _id: test.createdBy,
            username: test.creatorUsername,
            role: test.creatorRole
        };
        delete test.creatorUsername;
        delete test.creatorRole;
        return test;
    }
};

module.exports = Test;
