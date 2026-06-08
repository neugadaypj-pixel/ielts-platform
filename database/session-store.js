const { execute } = require('./connection');
const session = require('express-session');
const crypto = require('crypto');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class OracleSessionStore extends EventEmitter {
    createSession(req, data) {
        const Session = session.Session;
        req.session = new Session(req, data);
        return req.session;
    }

    generate(req) {
        req.sessionID = crypto.randomBytes(32).toString('hex');
        req.session = this.createSession(req, {});
        req.session.cookie = new session.Cookie();
    }

    // express-session v1.17+ supports Promise-based stores.
    // We also explicitly invoke the callback for maximum compatibility
    // and to avoid edge cases where an unhandled Promise rejection
    // causes express-session to hang (leading to 502 Bad Gateway).

    async get(sid, cb) {
        try {
            const result = await execute(
                `SELECT data FROM sessions WHERE sid = :sid AND expires > SYSTIMESTAMP`,
                { sid }
            );
            if (result.rows.length === 0) { if (cb) cb(null, null); return null; }
            const row = result.rows[0];
            if (!row || !row.DATA) { if (cb) cb(null, null); return null; }
            const data = JSON.parse(row.DATA);
            if (cb) cb(null, data);
            return data;
        } catch (err) {
            logger.error('Session store get error', { error: err.message });
            if (cb) cb(err);
            else throw err;
        }
    }

    async set(sid, data, cb) {
        try {
            const maxAgeMs = (data && data.cookie && typeof data.cookie.maxAge === 'number')
                ? data.cookie.maxAge
                : (24 * 60 * 60 * 1000);
            const maxAgeSeconds = Math.round(maxAgeMs / 1000);

            // Use CURRENT_TIMESTAMP + interval arithmetic instead of TO_TIMESTAMP
            // to avoid timezone/format parsing issues (was: 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"').
            const jsonData = JSON.stringify(data);

            await execute(
                `MERGE INTO sessions s
                 USING dual ON (s.sid = :sid)
                 WHEN MATCHED THEN UPDATE SET data = :data, expires = CURRENT_TIMESTAMP + NUMTODSINTERVAL(:maxAgeSec, 'SECOND'), updated_at = CURRENT_TIMESTAMP
                 WHEN NOT MATCHED THEN INSERT (sid, data, expires) VALUES (:sid, :data, CURRENT_TIMESTAMP + NUMTODSINTERVAL(:maxAgeSec, 'SECOND'))`,
                { sid, data: jsonData, maxAgeSec: maxAgeSeconds }
            );

            if (cb) cb(null);
        } catch (err) {
            logger.error('Session store set error', { error: err.message, stack: err.stack });
            if (cb) cb(err);
            else throw err;
        }
    }

    regenerate(req, fn) {
        const self = this;
        this.destroy(req.sessionID, (err) => {
            if (err) return fn(err);
            self.generate(req);
            fn(null);
        });
    }

    async destroy(sid, cb) {
        try {
            await execute(`DELETE FROM sessions WHERE sid = :sid`, { sid });
            if (cb) cb(null);
        } catch (err) {
            logger.error('Session store destroy error', { error: err.message });
            if (cb) cb(err);
            else throw err;
        }
    }

    async touch(sid, data, cb) {
        try {
            const maxAgeMs = (data && data.cookie && typeof data.cookie.maxAge === 'number')
                ? data.cookie.maxAge
                : (24 * 60 * 60 * 1000);
            const maxAgeSeconds = Math.round(maxAgeMs / 1000);

            await execute(
                `UPDATE sessions SET expires = CURRENT_TIMESTAMP + NUMTODSINTERVAL(:maxAgeSec, 'SECOND'), updated_at = CURRENT_TIMESTAMP WHERE sid = :sid`,
                { sid, maxAgeSec: maxAgeSeconds }
            );

            if (cb) cb(null);
        } catch (err) {
            logger.error('Session store touch error', { error: err.message });
            if (cb) cb(err);
            else throw err;
        }
    }
}

module.exports = OracleSessionStore;
