const { execute, executeMany } = require('../connection');

const Notification = {
    async findById(id) {
        const result = await execute(
            `SELECT id AS "_id", user_id AS "userId", type, title, message,
                    related_id AS "relatedId", is_read AS "isRead",
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                    TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
             FROM notifications WHERE id = :id`,
            { id }
        );
        return result.rows[0] || null;
    },

    async findOne(filter) {
        let sql = `SELECT id AS "_id", user_id AS "userId", type, title, message,
                          related_id AS "relatedId", is_read AS "isRead",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                   FROM notifications WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.userId) { sql += ` AND user_id = :userId`; binds.userId = filter.userId; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        if (filter.isRead !== undefined) { sql += ` AND is_read = :isRead`; binds.isRead = filter.isRead ? 1 : 0; }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows[0] || null;
    },

    async find(filter) {
        let sql = `SELECT id AS "_id", user_id AS "userId", type, title, message,
                          related_id AS "relatedId", is_read AS "isRead",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                   FROM notifications WHERE 1=1`;
        const binds = {};

        if (filter.userId) { sql += ` AND user_id = :userId`; binds.userId = filter.userId; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        if (filter.isRead !== undefined) { sql += ` AND is_read = :isRead`; binds.isRead = filter.isRead ? 1 : 0; }
        if (filter.relatedId) { sql += ` AND related_id = :relatedId`; binds.relatedId = filter.relatedId; }

        // $in
        if (filter.userId && filter.userId.$in) {
            const ids = filter.userId.$in.map((x, i) => {
                binds[`uid${i}`] = x;
                return `:uid${i}`;
            });
            if (ids.length > 0) sql += ` AND user_id IN (${ids.join(',')})`;
        }

        // Sort
        if (filter.$sort) {
            const entries = Object.entries(filter.$sort);
            sql += ` ORDER BY ` + entries.map(([key, dir]) => {
                const col = key === 'createdAt' ? 'created_at' :
                            key === 'isRead' ? 'is_read' : key;
                return `${col} ${dir === -1 ? 'DESC' : 'ASC'}`;
            }).join(', ');
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
        await execute(
            `INSERT INTO notifications (user_id, type, title, message, related_id, is_read)
             VALUES (:userId, :type, :title, :message, :relatedId, :isRead)`,
            {
                userId: data.userId,
                type: data.type,
                title: data.title,
                message: data.message,
                relatedId: data.relatedId || null,
                isRead: data.isRead ? 1 : 0
            }
        );
        const idResult = await execute(`SELECT notifications_seq.CURRVAL AS id FROM dual`);
        return Notification.findById(idResult.rows[0].ID);
    },

    async insertMany(notifications) {
        const bindsArray = notifications.map(n => ({
            userId: n.userId,
            type: n.type,
            title: n.title,
            message: n.message,
            relatedId: n.relatedId || null,
            isRead: n.isRead ? 1 : 0
        }));
        await executeMany(
            `INSERT INTO notifications (user_id, type, title, message, related_id, is_read)
             VALUES (:userId, :type, :title, :message, :relatedId, :isRead)`,
            bindsArray
        );
    },

    async findByIdAndUpdate(id, update) {
        const setClauses = [];
        const binds = { id };

        if (update.isRead !== undefined) {
            setClauses.push("is_read = :isRead");
            binds.isRead = update.isRead ? 1 : 0;
        }
        if (update.type) { setClauses.push("type = :type"); binds.type = update.type; }
        if (update.title) { setClauses.push("title = :title"); binds.title = update.title; }
        if (update.message) { setClauses.push("message = :message"); binds.message = update.message; }

        if (setClauses.length > 0) {
            await execute(
                `UPDATE notifications SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`, binds
            );
        }

        return Notification.findById(id);
    },

    async updateMany(filter, update) {
        let sql = `UPDATE notifications SET `;
        const setClauses = [];
        const binds = {};

        // Handle both { $set: { isRead: 1 } } and { isRead: 1 } patterns
        const data = update.$set || update;
        if (data.isRead !== undefined) {
            setClauses.push("is_read = :isRead");
            binds.isRead = data.isRead ? 1 : 0;
        }
        if (data.type !== undefined) { setClauses.push("type = :type"); binds.type = data.type; }
        if (data.title !== undefined) { setClauses.push("title = :title"); binds.title = data.title; }
        if (data.message !== undefined) { setClauses.push("message = :message"); binds.message = data.message; }
        if (setClauses.length === 0) return;

        setClauses.push("updated_at = CURRENT_TIMESTAMP");
        sql += setClauses.join(', ');
        sql += ` WHERE 1=1`;

        if (filter.userId) { sql += ` AND user_id = :userId`; binds.userId = filter.userId; }
        if (filter.isRead !== undefined) { sql += ` AND is_read = :fIsRead`; binds.fIsRead = filter.isRead ? 1 : 0; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }

        await execute(sql, binds);
    },

    async deleteMany(filter) {
        let sql = `DELETE FROM notifications WHERE 1=1`;
        const binds = {};
        if (filter.userId) { sql += ` AND user_id = :userId`; binds.userId = filter.userId; }
        if (filter.isRead !== undefined) { sql += ` AND is_read = :isRead`; binds.isRead = filter.isRead ? 1 : 0; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        await execute(sql, binds);
    },

    async countDocuments(filter = {}) {
        let sql = `SELECT COUNT(*) AS cnt FROM notifications WHERE 1=1`;
        const binds = {};
        if (filter.userId) { sql += ` AND user_id = :userId`; binds.userId = filter.userId; }
        if (filter.isRead !== undefined) { sql += ` AND is_read = :isRead`; binds.isRead = filter.isRead ? 1 : 0; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        const result = await execute(sql, binds);
        return result.rows[0].CNT;
    }
};

module.exports = Notification;
