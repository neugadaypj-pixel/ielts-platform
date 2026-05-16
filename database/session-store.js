const { execute } = require('./connection');
const session = require('express-session');
const crypto = require('crypto');
const EventEmitter = require('events');

function ts() { return new Date().toISOString(); }

class OracleSessionStore extends EventEmitter {
    // Required by express-session v1.18+ — creates a Session instance from
    // raw deserialized store data.
    createSession(req, data) {
        const Session = session.Session;
        const sess = new Session(req, data);
        console.log(`[SessionStore CREATE] ${ts()} created session`);
        return sess;
    }

    // Required by express-session v1.18+ — generates a new session ID.
    // Uses the same uid generator express-session uses internally.
    generate(req) {
        req.sessionID = crypto.randomBytes(32).toString('hex');
        console.log(`[SessionStore GEN] ${ts()} new sid=${req.sessionID.substring(0,20)}`);
        req.session = this.createSession(req, {});
        req.session.cookie = new session.Cookie();
    }

    async get(sid, cb) {
        console.log(`[SessionStore GET] ${ts()} sid=${sid ? sid.substring(0,20) : 'null'}`);
        try {
            const result = await execute(
                `SELECT data FROM sessions WHERE sid = :sid AND expires > SYSTIMESTAMP`,
                { sid }
            );
            if (result.rows.length === 0) {
                console.log(`[SessionStore GET] ${ts()} → null (no rows)`);
                if (typeof cb === 'function') return cb(null, null);
                return null;
            }
            const row = result.rows[0];
            if (!row || !row.DATA) {
                console.log(`[SessionStore GET] ${ts()} → null (no DATA)`);
                if (typeof cb === 'function') return cb(null, null);
                return null;
            }
            const data = JSON.parse(row.DATA);
            console.log(`[SessionStore GET] ${ts()} → found, keys: ${Object.keys(data).join(',')}`);
            if (typeof cb === 'function') return cb(null, data);
            return data;
        } catch (err) {
            console.error(`[SessionStore GET] ${ts()} ERROR:`, err.message);
            if (typeof cb === 'function') return cb(err);
            throw err;
        }
    }

    async set(sid, data, cb) {
        console.log(`[SessionStore SET] ${ts()} sid=${sid ? sid.substring(0,20) : 'null'} keys=${data ? Object.keys(data).join(',') : 'null'}`);
        try {
            const maxAge = (data && data.cookie && typeof data.cookie.maxAge === 'number')
                ? data.cookie.maxAge
                : (24 * 60 * 60 * 1000);
            const expires = new Date(Date.now() + maxAge);
            await execute(
                `MERGE INTO sessions s
                 USING dual ON (s.sid = :sid)
                 WHEN MATCHED THEN UPDATE SET data = :data, expires = TO_TIMESTAMP(:expires, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'), updated_at = CURRENT_TIMESTAMP
                 WHEN NOT MATCHED THEN INSERT (sid, data, expires) VALUES (:sid, :data, TO_TIMESTAMP(:expires, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'))`,
                { sid, data: JSON.stringify(data), expires: expires.toISOString() }
            );
            console.log(`[SessionStore SET] ${ts()} → saved OK`);
            if (typeof cb === 'function') return cb(null);
        } catch (err) {
            console.error(`[SessionStore SET] ${ts()} ERROR:`, err.message);
            if (typeof cb === 'function') return cb(err);
            throw err;
        }
    }

    async destroy(sid, cb) {
        console.log(`[SessionStore DESTROY] ${ts()} sid=${sid ? sid.substring(0,20) : 'null'}`);
        try {
            await execute(`DELETE FROM sessions WHERE sid = :sid`, { sid });
            console.log(`[SessionStore DESTROY] ${ts()} → done`);
            if (typeof cb === 'function') return cb(null);
        } catch (err) {
            console.error(`[SessionStore DESTROY] ${ts()} ERROR:`, err.message);
            if (typeof cb === 'function') return cb(err);
            throw err;
        }
    }

    async touch(sid, data, cb) {
        console.log(`[SessionStore TOUCH] ${ts()} sid=${sid ? sid.substring(0,20) : 'null'}`);
        try {
            const maxAge = (data && data.cookie && typeof data.cookie.maxAge === 'number')
                ? data.cookie.maxAge
                : (24 * 60 * 60 * 1000);
            const expires = new Date(Date.now() + maxAge);
            await execute(
                `UPDATE sessions SET expires = TO_TIMESTAMP(:expires, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'), updated_at = CURRENT_TIMESTAMP WHERE sid = :sid`,
                { sid, expires: expires.toISOString() }
            );
            console.log(`[SessionStore TOUCH] ${ts()} → done`);
            if (typeof cb === 'function') return cb(null);
        } catch (err) {
            console.error(`[SessionStore TOUCH] ${ts()} ERROR:`, err.message);
            if (typeof cb === 'function') return cb(err);
            throw err;
        }
    }
}

module.exports = OracleSessionStore;
