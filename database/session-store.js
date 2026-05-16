const { execute } = require('./connection');
const EventEmitter = require('events');

class OracleSessionStore extends EventEmitter {
    async get(sid) {
        const result = await execute(
            `SELECT data FROM sessions WHERE sid = :sid AND expires > SYSTIMESTAMP`,
            { sid }
        );
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        if (!row || !row.DATA) return null;
        return JSON.parse(row.DATA);
    }

    async set(sid, data, maxAge) {
        const expires = new Date(Date.now() + maxAge);
        await execute(
            `MERGE INTO sessions s
             USING dual ON (s.sid = :sid)
             WHEN MATCHED THEN UPDATE SET data = :data, expires = :expires, updated_at = CURRENT_TIMESTAMP
             WHEN NOT MATCHED THEN INSERT (sid, data, expires) VALUES (:sid, :data, :expires)`,
            { sid, data: JSON.stringify(data), expires }
        );
    }

    async destroy(sid) {
        await execute(`DELETE FROM sessions WHERE sid = :sid`, { sid });
    }

    async touch(sid, maxAge) {
        const expires = new Date(Date.now() + maxAge);
        await execute(
            `UPDATE sessions SET expires = :expires, updated_at = CURRENT_TIMESTAMP WHERE sid = :sid`,
            { sid, expires }
        );
    }
}

module.exports = OracleSessionStore;
