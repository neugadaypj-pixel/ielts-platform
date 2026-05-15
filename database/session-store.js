const { execute } = require('./connection');

const sessionStore = {
    async get(sid) {
        const result = await execute(
            `SELECT data FROM sessions WHERE sid = :sid AND expires > SYSTIMESTAMP`,
            { sid }
        );
        return result.rows[0] ? JSON.parse(result.rows[0].DATA) : null;
    },

    async set(sid, data, maxAge) {
        const expires = new Date(Date.now() + maxAge);
        await execute(
            `MERGE INTO sessions s
             USING dual ON (s.sid = :sid)
             WHEN MATCHED THEN UPDATE SET data = :data, expires = :expires, updated_at = CURRENT_TIMESTAMP
             WHEN NOT MATCHED THEN INSERT (sid, data, expires) VALUES (:sid, :data, :expires)`,
            { sid, data: JSON.stringify(data), expires }
        );
    },

    async destroy(sid) {
        await execute(`DELETE FROM sessions WHERE sid = :sid`, { sid });
    },

    async touch(sid, maxAge) {
        const expires = new Date(Date.now() + maxAge);
        await execute(
            `UPDATE sessions SET expires = :expires, updated_at = CURRENT_TIMESTAMP WHERE sid = :sid`,
            { sid, expires }
        );
    }
};

module.exports = sessionStore;
