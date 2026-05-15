# Oracle Cloud Migration Plan — $0/Month Setup

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Target Architecture ($0/month)](#2-target-architecture-0month)
3. [Data Model: MongoDB → Oracle SQL](#3-data-model-mongodb--oracle-sql)
4. [Complete Oracle SQL Schema](#4-complete-oracle-sql-schema)
5. [Code Rewrite: Mongoose → node-oracledb + SQL](#5-code-rewrite-mongoose--node-oracledb--sql)
6. [Query Translation Reference](#6-query-translation-reference)
7. [Data Migration: MongoDB → Oracle](#7-data-migration-mongodb--oracle)
8. [OCI Infrastructure Setup](#8-oci-infrastructure-setup)
9. [Phased Implementation Roadmap](#9-phased-implementation-roadmap)
10. [Risk Assessment & Rollback](#10-risk-assessment--rollback)

---

## 1. Executive Summary

**Goal:** Deploy the IELTS Test Platform on Oracle Cloud at **$0/month total cost** by using only Always Free Tier services:

| Service | Resource | Cost |
|---|---|---|
| OCI Compute | AMD VM, 1/8 OCPU, 1GB RAM, Ubuntu 22.04 | **$0** |
| Oracle Autonomous Database (ATP) | 1 OCPU, 20GB storage | **$0** |
| Backblaze B2 | Existing (audio files + backups) | **$0** |
| **Total** | | **$0/month** |

**What changes:**
- Database: MongoDB → Oracle Autonomous Database (ATP)
- Driver/ORM: Mongoose → `node-oracledb` + raw SQL
- Session store: `connect-mongo` → custom Oracle-backed session store
- Server hosting: Render/Railway → OCI Compute VM

**What stays the same:**
- Node.js + Express 5 framework
- All 24 EJS view templates
- DeepSeek + Gemini AI integrations
- Backblaze B2 for file storage
- Sentry error monitoring
- NodeCache (in-memory caching)

---

## 2. Target Architecture ($0/month)

```mermaid
graph TB
    subgraph OCI["Oracle Cloud Infrastructure - Always Free"]
        subgraph Compute["AMD VM - 1GB RAM, 1/8 OCPU"]
            APP["Node.js + Express"]
            CACHE["NodeCache - in-memory"]
            PM2["PM2 - process manager"]
        end
        subgraph DB["Autonomous Database - 20GB"]
            ATP[("Oracle ATP<br/>7 tables<br/>+ sequences + indexes")]
        end
    end

    subgraph External["External Services"]
        B2["Backblaze B2<br/>Audio files + Backups"]
        DEEPSEEK["DeepSeek API"]
        GEMINI["Google Gemini"]
        SENTRY["Sentry"]
    end

    USERS["Students / Teachers / Admins"] -->|HTTPS| NGINX["nginx + Let's Encrypt SSL"]
    NGINX --> APP
    APP --> CACHE
    APP -->|node-oracledb| ATP
    APP -->|aws-sdk S3| B2
    APP --> DEEPSEEK
    APP --> GEMINI
    APP --> SENTRY

    style OCI fill:#c1121f,stroke:#780000,color:#fff
    style DB fill:#003049,stroke:#f77f00,color:#fff
    style Compute fill:#669bbc,stroke:#003049,color:#fff
```

### Resource Reality Check (1GB RAM)

| Process | Est. Memory |
|---|---|
| Node.js app (with oracledb pool) | ~250-400 MB |
| nginx | ~50 MB |
| OS (Ubuntu minimal) | ~200 MB |
| **Remaining free** | ~350-550 MB |

This is tight but workable. Key optimizations:
- Set `UV_THREADPOOL_SIZE=4` (default, no extra threads)
- oracledb connection pool: max 4 connections
- NodeCache: cap at 500 entries
- Disable any non-essential cron jobs during peak hours

---

## 3. Data Model: MongoDB → Oracle SQL

### 3.1 ID Strategy

MongoDB uses 24-character hex ObjectIds. Oracle uses auto-incrementing numbers via sequences.

**Migration mapping:**
```
MongoDB ObjectId: "507f1f77bcf86cd799439011"
    ↓
Oracle NUMBER:   42
```

A mapping table tracks the relationship during migration, then is discarded.

### 3.2 Array Fields → Junction Tables

| MongoDB Field | Oracle Solution |
|---|---|
| `User.assignedTests[]` | `user_assigned_tests` junction table |
| `Group.students[]` | `group_students` junction table |
| `Group.assignedTests[]` | `group_assigned_tests` junction table |
| `Group.testSchedule[]` | `group_test_schedule` table |
| `Test.questions[]` | `test_questions` table (or JSON column) |

### 3.3 Mixed/Free-form Fields

| MongoDB Field | Oracle Column Type |
|---|---|
| `Submission.details` | `CLOB` with `CHECK (details IS JSON)` |
| `Test.readingPassage` | `CLOB` (JSON string) |
| `Test.builderJson` | `CLOB` (JSON string) |
| `Test.questions` | `CLOB` (JSON array) |

Oracle 19c+ has native JSON support via `JSON_VALUE()`, `JSON_QUERY()`, `JSON_EXISTS()`.

### 3.4 Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ USER_ASSIGNED_TESTS : has
    USERS ||--o{ GROUP_STUDENTS : belongs_to
    USERS ||--o{ SUBMISSIONS : submits
    USERS ||--o{ FEEDBACKS : creates
    USERS ||--o{ NOTIFICATIONS : receives
    USERS }o--|| USERS : taught_by
    USERS }o--|| GROUPS : grouped_in

    TESTS ||--o{ USER_ASSIGNED_TESTS : assigned_to
    TESTS ||--o{ GROUP_ASSIGNED_TESTS : assigned_to
    TESTS ||--o{ GROUP_TEST_SCHEDULE : scheduled_in
    TESTS ||--o{ SUBMISSIONS : has

    GROUPS ||--o{ GROUP_STUDENTS : contains
    GROUPS ||--o{ GROUP_ASSIGNED_TESTS : has
    GROUPS ||--o{ GROUP_TEST_SCHEDULE : schedules
    GROUPS ||--o{ SUBMISSIONS : receives
```

---

## 4. Complete Oracle SQL Schema

### 4.1 Sequences (for auto-increment IDs)

```sql
CREATE SEQUENCE users_seq       START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE tests_seq       START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE groups_seq      START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE submissions_seq START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE feedbacks_seq   START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE notifications_seq START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE test_schedule_seq START WITH 1 INCREMENT BY 1 NOCACHE;
```

### 4.2 Tables

```sql
-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id            NUMBER PRIMARY KEY,
    username      VARCHAR2(50) NOT NULL UNIQUE,
    password      VARCHAR2(255) NOT NULL,
    role          VARCHAR2(10) NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
    teacher_id    NUMBER,
    group_id      NUMBER,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_user_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
    CONSTRAINT fk_user_group    FOREIGN KEY (group_id)    REFERENCES groups(id)
);
CREATE INDEX idx_users_role_teacher ON users(role, teacher_id);

-- ============================================================
-- TESTS
-- ============================================================
CREATE TABLE tests (
    id              NUMBER PRIMARY KEY,
    title           VARCHAR2(200) NOT NULL,
    type            VARCHAR2(10) NOT NULL CHECK (type IN ('reading', 'listening', 'writing')),
    teacher_name    VARCHAR2(100),
    created_by      NUMBER NOT NULL,
    reading_passage CLOB DEFAULT '' CHECK (reading_passage IS JSON),
    builder_json    CLOB DEFAULT '',
    custom_title    VARCHAR2(200),
    folder          VARCHAR2(255) DEFAULT '',
    questions       CLOB DEFAULT '[]' CHECK (questions IS JSON),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_test_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_tests_created_type ON tests(created_by, type);
CREATE INDEX idx_tests_type_created ON tests(type, created_at);

-- ============================================================
-- GROUPS
-- ============================================================
CREATE TABLE groups (
    id         NUMBER PRIMARY KEY,
    name       VARCHAR2(100) NOT NULL,
    teacher_id NUMBER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_group_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_groups_teacher ON groups(teacher_id);

-- ============================================================
-- USER_ASSIGNED_TESTS (junction: User.assignedTests[])
-- ============================================================
CREATE TABLE user_assigned_tests (
    user_id NUMBER NOT NULL,
    test_id NUMBER NOT NULL,
    PRIMARY KEY (user_id, test_id),
    CONSTRAINT fk_uat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_uat_test FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
);

-- ============================================================
-- GROUP_STUDENTS (junction: Group.students[])
-- ============================================================
CREATE TABLE group_students (
    group_id NUMBER NOT NULL,
    user_id  NUMBER NOT NULL,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT fk_gs_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_gs_user  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- GROUP_ASSIGNED_TESTS (junction: Group.assignedTests[])
-- ============================================================
CREATE TABLE group_assigned_tests (
    group_id NUMBER NOT NULL,
    test_id  NUMBER NOT NULL,
    PRIMARY KEY (group_id, test_id),
    CONSTRAINT fk_gat_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_gat_test  FOREIGN KEY (test_id)  REFERENCES tests(id) ON DELETE CASCADE
);

-- ============================================================
-- GROUP_TEST_SCHEDULE (replaces Group.testSchedule[])
-- ============================================================
CREATE TABLE group_test_schedule (
    id             NUMBER PRIMARY KEY,
    group_id       NUMBER NOT NULL,
    test_id        NUMBER NOT NULL,
    available_from TIMESTAMP,
    CONSTRAINT fk_gts_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_gts_test  FOREIGN KEY (test_id)  REFERENCES tests(id) ON DELETE CASCADE
);
CREATE INDEX idx_gts_group_available ON group_test_schedule(group_id, available_from);

-- ============================================================
-- SUBMISSIONS
-- ============================================================
CREATE TABLE submissions (
    id                  NUMBER PRIMARY KEY,
    test_id             NUMBER NOT NULL,
    student_id          NUMBER NOT NULL,
    teacher_id          NUMBER,
    group_id            NUMBER,
    type                VARCHAR2(10) NOT NULL CHECK (type IN ('reading', 'listening', 'writing')),
    student_name        VARCHAR2(100) NOT NULL,
    status              VARCHAR2(20) DEFAULT 'completed' NOT NULL,
    attempt_count       NUMBER DEFAULT 1 NOT NULL,
    score               NUMBER,
    total_questions     NUMBER,
    percentage          NUMBER,
    band                VARCHAR2(10),
    word_count1         NUMBER,
    word_count2         NUMBER,
    time_remaining_text VARCHAR2(50) DEFAULT '',
    details             CLOB DEFAULT '{}' CHECK (details IS JSON),
    first_submitted_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_submitted_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_sub_test    FOREIGN KEY (test_id)    REFERENCES tests(id) ON DELETE CASCADE,
    CONSTRAINT fk_sub_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_sub_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_sub_group   FOREIGN KEY (group_id)   REFERENCES groups(id) ON DELETE SET NULL,
    CONSTRAINT uk_test_student UNIQUE (test_id, student_id)
);
CREATE INDEX idx_sub_teacher_type    ON submissions(teacher_id, type);
CREATE INDEX idx_sub_student_test    ON submissions(student_id, test_id);
CREATE INDEX idx_sub_teacher_created ON submissions(teacher_id, first_submitted_at);
CREATE INDEX idx_sub_group_test      ON submissions(group_id, test_id);
CREATE INDEX idx_sub_test_pct        ON submissions(test_id, percentage DESC);

-- ============================================================
-- FEEDBACKS
-- ============================================================
CREATE TABLE feedbacks (
    id               NUMBER PRIMARY KEY,
    student_id       NUMBER NOT NULL,
    student_name     VARCHAR2(100) NOT NULL,
    test_type        VARCHAR2(10) NOT NULL CHECK (test_type IN ('reading', 'listening', 'writing', 'general')),
    question_type    VARCHAR2(255) DEFAULT '',
    issue_description CLOB NOT NULL,
    status           VARCHAR2(10) DEFAULT 'open' NOT NULL CHECK (status IN ('open', 'resolved')),
    admin_notes      CLOB DEFAULT '',
    admin_reply      CLOB DEFAULT '',
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_fb_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_fb_student_created ON feedbacks(student_id, created_at);
CREATE INDEX idx_fb_status ON feedbacks(status);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
    id         NUMBER PRIMARY KEY,
    user_id    NUMBER NOT NULL,
    type       VARCHAR2(20) NOT NULL CHECK (type IN (
                   'test_available', 'admin_reply', 'test_assigned', 'general',
                   'test_submitted', 'group_completed', 'low_score_alert'
               )),
    title      VARCHAR2(255) NOT NULL,
    message    CLOB NOT NULL,
    related_id NUMBER,
    is_read    NUMBER(1) DEFAULT 0 NOT NULL CHECK (is_read IN (0, 1)),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_notif_user_read_created ON notifications(user_id, is_read, created_at);

-- ============================================================
-- SESSIONS (for express-session with Oracle store)
-- ============================================================
CREATE TABLE sessions (
    sid        VARCHAR2(128) PRIMARY KEY,
    expires    TIMESTAMP,
    data       CLOB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires);

-- ============================================================
-- ID MAPPING (temporary — used only during migration)
-- ============================================================
CREATE TABLE id_mapping (
    collection   VARCHAR2(50) NOT NULL,
    mongo_id     VARCHAR2(24) NOT NULL,
    oracle_id    NUMBER NOT NULL,
    PRIMARY KEY (collection, mongo_id)
);
```

### 4.3 Triggers for Auto-Increment IDs

```sql
CREATE OR REPLACE TRIGGER trg_users_id BEFORE INSERT ON users
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := users_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_tests_id BEFORE INSERT ON tests
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := tests_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_groups_id BEFORE INSERT ON groups
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := groups_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_submissions_id BEFORE INSERT ON submissions
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := submissions_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_feedbacks_id BEFORE INSERT ON feedbacks
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := feedbacks_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_notifications_id BEFORE INSERT ON notifications
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := notifications_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_test_schedule_id BEFORE INSERT ON group_test_schedule
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := test_schedule_seq.NEXTVAL; END IF; END;
/
```

### 4.4 Scheduled Cleanup Jobs

Oracle doesn't have MongoDB's TTL indexes. Instead, use `DBMS_SCHEDULER`:

```sql
-- Auto-delete notifications older than 30 days
BEGIN
    DBMS_SCHEDULER.CREATE_JOB (
        job_name        => 'cleanup_old_notifications',
        job_type        => 'PLSQL_BLOCK',
        job_action      => 'BEGIN DELETE FROM notifications WHERE created_at < SYSTIMESTAMP - INTERVAL ''30'' DAY; COMMIT; END;',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ=DAILY; BYHOUR=3',
        enabled         => TRUE
    );
END;
/

-- Auto-delete expired sessions (older than 1 day)
BEGIN
    DBMS_SCHEDULER.CREATE_JOB (
        job_name        => 'cleanup_expired_sessions',
        job_type        => 'PLSQL_BLOCK',
        job_action      => 'BEGIN DELETE FROM sessions WHERE expires < SYSTIMESTAMP; COMMIT; END;',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ=HOURLY',
        enabled         => TRUE
    );
END;
/
```

---

## 5. Code Rewrite: Mongoose → node-oracledb + SQL

### 5.1 New Dependencies

Changes to [`package.json`](package.json:20):

```diff
- "mongoose": "^9.4.1",
- "connect-mongo": "^6.0.0",
+ "oracledb": "^6.7.0",
+ "express-oracle-session": "^3.0.0",
```

`oracledb` is Oracle's official Node.js driver. Works natively on Linux. On Windows (your dev machine), install Oracle Instant Client.

### 5.2 New Project Structure

```
project/
├── database/
│   ├── connection.js      # Oracle connection pool
│   ├── session-store.js   # Custom Oracle session store
│   └── schema.sql         # Full DDL
├── models/
│   ├── user.js            # User queries
│   ├── test.js            # Test queries
│   ├── group.js           # Group queries
│   ├── submission.js      # Submission queries
│   ├── feedback.js        # Feedback queries
│   └── notification.js    # Notification queries
├── server.js              # Rewritten Express routes
├── migrate.js             # MongoDB → Oracle data migration
└── ...
```

### 5.3 Database Connection Layer

New file [`database/connection.js`](database/connection.js):

```javascript
const oracledb = require('oracledb');
const logger = require('../utils/logger');

// Optimize for low-memory OCI free tier
oracledb.poolMax = 4;           // Max connections
oracledb.poolMin = 1;           // Min idle connections
oracledb.poolIncrement = 1;     // Increment by 1
oracledb.poolTimeout = 60;      // Idle pool close after 60s
oracledb.fetchAsString = [oracledb.CLOB]; // Return CLOBs as strings

let pool;

async function getPool() {
    if (pool) return pool;

    pool = await oracledb.createPool({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectString: process.env.DB_CONNECT_STRING,
        poolMax: 4,
        poolMin: 1,
        poolIncrement: 1,
        poolTimeout: 60
    });

    logger.info('Oracle DB connection pool created');
    return pool;
}

async function getConnection() {
    const p = await getPool();
    return p.getConnection();
}

async function execute(sql, binds = {}, opts = {}) {
    const conn = await getConnection();
    try {
        const result = await conn.execute(sql, binds, {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit: true,
            ...opts
        });
        return result;
    } finally {
        await conn.close();
    }
}

async function executeMany(sql, bindsArray = [], opts = {}) {
    const conn = await getConnection();
    try {
        const result = await conn.executeMany(sql, bindsArray, {
            autoCommit: true,
            ...opts
        });
        return result;
    } finally {
        await conn.close();
    }
}

function isDatabaseReady() {
    return pool !== undefined && pool.connectionsInUse !== undefined;
}

module.exports = { getPool, getConnection, execute, executeMany, isDatabaseReady };
```

### 5.4 Model Pattern (example: User)

New file [`models/user.js`](models/user.js):

```javascript
const { execute, executeMany } = require('../database/connection');

const User = {
    async findById(id) {
        const result = await execute(
            `SELECT id, username, role, teacher_id AS "teacherId", group_id AS "groupId",
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
             FROM users WHERE id = :id`,
            { id }
        );
        if (result.rows.length === 0) return null;
        const user = result.rows[0];
        // Load assigned tests
        const tests = await execute(
            `SELECT test_id FROM user_assigned_tests WHERE user_id = :id`, { id }
        );
        user.assignedTests = tests.rows.map(r => r.TEST_ID);
        return user;
    },

    async findOne(filter) {
        let sql = `SELECT id, username, password, role, teacher_id AS "teacherId",
                          group_id AS "groupId"
                   FROM users WHERE 1=1`;
        const binds = {};
        if (filter.username) {
            sql += ` AND username = :username`;
            binds.username = filter.username;
        }
        if (filter._id) {
            sql += ` AND id = :id`;
            binds.id = filter._id;
        }
        const result = await execute(sql, binds);
        return result.rows[0] || null;
    },

    async find(filter) {
        let sql = `SELECT id, username, role, teacher_id AS "teacherId",
                          group_id AS "groupId"
                   FROM users WHERE 1=1`;
        const binds = {};
        if (filter.role) {
            sql += ` AND role = :role`;
            binds.role = filter.role;
        }
        if (filter.teacherId) {
            sql += ` AND teacher_id = :teacherId`;
            binds.teacherId = filter.teacherId;
        }
        // Handle $in
        if (filter._id && filter._id.$in) {
            // Oracle doesn't support array binds easily; use IN list
            const ids = filter._id.$in.map((id, i) => {
                binds[`id${i}`] = id;
                return `:id${i}`;
            }).join(',');
            sql += ` AND id IN (${ids})`;
        }
        const result = await execute(sql, binds);
        return result.rows;
    },

    async create(data) {
        const result = await execute(
            `INSERT INTO users (username, password, role, teacher_id, group_id)
             VALUES (:username, :password, :role, :teacherId, :groupId)
             RETURNING id INTO :out_id`,
            {
                username: data.username,
                password: data.password,
                role: data.role || 'student',
                teacherId: data.teacherId || null,
                groupId: data.groupId || null,
                out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
            }
        );
        return { ...data, _id: result.outBinds.out_id[0] };
    },

    async findByIdAndUpdate(id, update) {
        // Handle $addToSet (array push → insert into junction table)
        if (update.$addToSet && update.$addToSet.assignedTests) {
            await execute(
                `MERGE INTO user_assigned_tests uat
                 USING dual ON (uat.user_id = :userId AND uat.test_id = :testId)
                 WHEN NOT MATCHED THEN INSERT (user_id, test_id) VALUES (:userId, :testId)`,
                { userId: id, testId: update.$addToSet.assignedTests }
            );
        }
        // Handle $pull (array remove → delete from junction table)
        if (update.$pull && update.$pull.assignedTests) {
            await execute(
                `DELETE FROM user_assigned_tests
                 WHERE user_id = :userId AND test_id = :testId`,
                { userId: id, testId: update.$pull.assignedTests }
            );
        }
        // Handle $unset
        if (update.$unset && update.$unset.groupId !== undefined) {
            await execute(
                `UPDATE users SET group_id = NULL WHERE id = :id`, { id }
            );
        }
        // Handle direct field updates
        const setClauses = [];
        const binds = { id };
        if (update.password) {
            setClauses.push("password = :password");
            binds.password = update.password;
        }
        if (update.groupId !== undefined) {
            setClauses.push("group_id = :groupId");
            binds.groupId = update.groupId;
        }
        if (setClauses.length > 0) {
            await execute(
                `UPDATE users SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id`, binds
            );
        }
        return User.findById(id);
    },

    async deleteMany(filter) {
        let sql = `DELETE FROM users WHERE 1=1`;
        const binds = {};
        if (filter._id && filter._id.$in) {
            const ids = filter._id.$in.map((id, i) => {
                binds[`id${i}`] = id;
                return `:id${i}`;
            }).join(',');
            sql += ` AND id IN (${ids})`;
        }
        if (filter.role) {
            sql += ` AND role = :role`;
            binds.role = filter.role;
        }
        await execute(sql, binds);
    },

    async countDocuments(filter = {}) {
        let sql = `SELECT COUNT(*) AS cnt FROM users WHERE 1=1`;
        const binds = {};
        if (filter.role) {
            sql += ` AND role = :role`;
            binds.role = filter.role;
        }
        if (filter.teacherId) {
            sql += ` AND teacher_id = :teacherId`;
            binds.teacherId = filter.teacherId;
        }
        const result = await execute(sql, binds);
        return result.rows[0].CNT;
    },

    // Populate-like: find user with group and assigned tests in one call
    async findByIdWithGroup(id) {
        const result = await execute(
            `SELECT u.id, u.username, u.role,
                    u.teacher_id AS "teacherId", u.group_id AS "groupId",
                    g.name AS "groupName"
             FROM users u
             LEFT JOIN groups g ON u.group_id = g.id
             WHERE u.id = :id`, { id }
        );
        if (result.rows.length === 0) return null;
        const user = result.rows[0];
        user.groupId = user.groupId ? { _id: user.groupId, name: user.groupName } : null;
        delete user.groupName;
        return user;
    }
};

module.exports = User;
```

### 5.5 Session Store

New file [`database/session-store.js`](database/session-store.js):

```javascript
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
```

In [`server.js`](server.js:242), replace the `connect-mongo` block with:

```javascript
const sessionStore = require('./database/session-store');
const session = require('express-session');

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: {
        get: (sid, cb) => sessionStore.get(sid).then(data => cb(null, data)).catch(cb),
        set: (sid, data, cb) => sessionStore.set(sid, data, 86400000).then(() => cb(null)).catch(cb),
        destroy: (sid, cb) => sessionStore.destroy(sid).then(() => cb(null)).catch(cb),
        touch: (sid, data, cb) => sessionStore.touch(sid, 86400000).then(() => cb(null)).catch(cb)
    },
    cookie: {
        maxAge: 86400000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    },
    rolling: true,
    name: 'sessionId'
}));
```

### 5.6 Files That Need Complete Rewrites

| File | Lines | Complexity | Key Changes |
|---|---|---|---|
| [`server.js`](server.js:1) | 3207 | **Very High** | ~200 queries: `.findById()` → `execute(SELECT)`, `.populate()` → `JOIN`, `$addToSet` → `MERGE`, `$pull` → `DELETE`, `$regex` → `REGEXP_LIKE`, `ObjectId`s → numbers |
| [`models/User.js`](models/User.js:1) | 48 | **Medium** | Already shown above |
| [`models/Test.js`](models/Test.js:1) | 64 | **Medium** | FIND with text search → `CONTAINS` or `REGEXP_LIKE` |
| [`models/Submission.js`](models/Submission.js:1) | 34 | **Medium** | JSON details handling with `JSON_VALUE` |
| [`models/Group.js`](models/Group.js:1) | 41 | **Medium** | Junction tables for students, assignedTests, testSchedule |
| [`models/Feedback.js`](models/Feedback.js:1) | 19 | **Low** | Straightforward SQL |
| [`models/Notification.js`](models/Notification.js:1) | 24 | **Low** | Straightforward SQL, TTL via scheduler |
| [`backup-database.js`](backup-database.js:1) | 323 | **High** | `mysqldump` equivalent → Oracle Data Pump or EXP |
| [`utils/config.js`](utils/config.js:1) | 152 | **Low** | `MONGO_URI` → `DB_USER/DB_PASSWORD/DB_CONNECT_STRING` |
| [`middleware/auth.js`](middleware/auth.js:1) | Unknown | **Low** | If it touches DB, update query style |

### 5.7 Environment Variable Changes

Current `.env` → New `.env`:

```diff
# DATABASE
- MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
+ DB_USER=ADMIN
+ DB_PASSWORD=your_atp_password
+ DB_CONNECT_STRING=(description=(retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1522)(host=adb.region.oraclecloud.com))(connect_data=(service_name=yourdb_high.adb.oraclecloud.com))(security=(ssl_server_dn_match=yes)))

# SESSION
  SESSION_SECRET=your-64-char-random-secret...

# B2 STORAGE (UNCHANGED)
  B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
  B2_BUCKET=your-bucket
  B2_KEY_ID=xxx
  B2_APP_KEY=xxx
  B2_PUBLIC_URL=https://...

# AI (UNCHANGED)
  DEEPSEEK_API_KEY=sk-...
  GROQ_API_KEY=gsk_...

# ORACLE WALLET (required for ATP)
+ TNS_ADMIN=/home/ubuntu/oracle-wallet
```

---

## 6. Query Translation Reference

### Common Mongoose → Oracle SQL Patterns

```sql
-- ============================================================
-- findById with populate
-- ============================================================
-- Mongoose: await Test.findById(id).populate('createdBy')
-- Oracle:
SELECT t.*, u.username AS creator_name
FROM tests t
LEFT JOIN users u ON t.created_by = u.id
WHERE t.id = :id;

-- ============================================================
-- find with sort, skip, limit
-- ============================================================
-- Mongoose: await Submission.find({ teacherId }).sort({ createdAt: -1 }).skip(20).limit(10)
-- Oracle:
SELECT s.*
FROM submissions s
WHERE s.teacher_id = :teacherId
ORDER BY s.first_submitted_at DESC
OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY;

-- ============================================================
-- countDocuments
-- ============================================================
-- Mongoose: await Submission.countDocuments({ testId, groupId })
-- Oracle:
SELECT COUNT(*) AS cnt
FROM submissions
WHERE test_id = :testId AND group_id = :groupId;

-- ============================================================
-- $in (array filter)
-- ============================================================
-- Mongoose: await Test.find({ _id: { $in: assignedTestIds } })
-- Oracle (with dynamic binds):
SELECT * FROM tests WHERE id IN (:id0, :id1, :id2, ...);

-- ============================================================
-- $regex search
-- ============================================================
-- Mongoose: await Test.find({ title: { $regex: query, $options: 'i' } })
-- Oracle:
SELECT * FROM tests WHERE REGEXP_LIKE(title, :query, 'i');

-- ============================================================
-- $addToSet (array push)
-- ============================================================
-- Mongoose: await User.findByIdAndUpdate(id, { $addToSet: { assignedTests: testId } })
-- Oracle:
MERGE INTO user_assigned_tests uat
USING dual ON (uat.user_id = :userId AND uat.test_id = :testId)
WHEN NOT MATCHED THEN INSERT (user_id, test_id) VALUES (:userId, :testId);

-- ============================================================
-- $pull (array remove)
-- ============================================================
-- Mongoose: await Group.findByIdAndUpdate(id, { $pull: { students: studentId } })
-- Oracle:
DELETE FROM group_students WHERE group_id = :groupId AND user_id = :studentId;

-- ============================================================
-- $unset
-- ============================================================
-- Mongoose: await User.findByIdAndUpdate(id, { $unset: { groupId: 1 } })
-- Oracle:
UPDATE users SET group_id = NULL WHERE id = :id;

-- ============================================================
-- insertMany
-- ============================================================
-- Mongoose: await Notification.insertMany(notificationsArray)
-- Oracle (using executeMany for batch):
INSERT INTO notifications (user_id, type, title, message, related_id)
VALUES (:userId, :type, :title, :message, :relatedId);

-- ============================================================
-- updateMany with filter
-- ============================================================
-- Mongoose: await Group.updateMany({ assignedTests: testId }, { $pull: { assignedTests: testId } })
-- Oracle:
DELETE FROM group_assigned_tests WHERE test_id = :testId;

-- ============================================================
-- JSON field access (details column)
-- ============================================================
-- Mongoose: submission.details.aiAnalysis
-- Oracle:
SELECT JSON_VALUE(details, '$.aiAnalysis') AS ai_analysis FROM submissions WHERE id = :id;

-- Mongoose: await Submission.updateOne({ _id: id }, { $set: { 'details.aiAnalysis': result } })
-- Oracle:
UPDATE submissions
SET details = JSON_MERGEPATCH(details, JSON_OBJECT('aiAnalysis' VALUE :analysis))
WHERE id = :id;
```

---

## 7. Data Migration: MongoDB → Oracle

### 7.1 Migration Script Overview

The script (`migrate.js`) does the following in order:

```mermaid
flowchart TD
    A["Connect to BOTH MongoDB + Oracle"] --> B["Create Oracle schema (tables, sequences, triggers)"]
    B --> C["Migrate users (keep original passwords)"]
    C --> D["Migrate tests"]
    D --> E["Migrate groups"]
    E --> F["Migrate submissions"]
    F --> G["Migrate feedbacks"]
    G --> H["Migrate notifications"]
    H --> I["Create junction tables from arrays"]
    I --> J["Verify row counts match"]
    J --> K["Run sample queries to validate"]
```

### 7.2 Migration Script Concept

```javascript
// migrate.js
require('dotenv').config();
const mongoose = require('mongoose');
const oracledb = require('oracledb');

// Models (MongoDB — old)
const UserMongo = require('./models/User');
const TestMongo = require('./models/Test');
const GroupMongo = require('./models/Group');
const SubmissionMongo = require('./models/Submission');
const FeedbackMongo = require('./models/Feedback');
const NotificationMongo = require('./models/Notification');

// Oracle connection
let oradb;

async function migrate() {
    // 1. Connect to both databases
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    oradb = await oracledb.createPool({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectString: process.env.DB_CONNECT_STRING
    });
    console.log('✅ Connected to Oracle');

    // 2. Create schema
    await createSchema();

    // 3. Migrate users
    const users = await UserMongo.find({}).lean();
    console.log(`Migrating ${users.length} users...`);
    for (const u of users) {
        const result = await execute(
            `INSERT INTO users (id, username, password, role, created_at)
             VALUES (users_seq.NEXTVAL, :u, :p, :r, :c)
             RETURNING id INTO :out_id`,
            { u: u.username, p: u.password, r: u.role, c: u.createdAt, out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT } }
        );
        const newId = result.outBinds.out_id[0];
        await recordMapping('users', u._id.toString(), newId);
    }

    // 4. Migrate tests
    const tests = await TestMongo.find({}).lean();
    console.log(`Migrating ${tests.length} tests...`);
    for (const t of tests) {
        const createdBy = await getOracleId('users', t.createdBy?.toString());
        const result = await execute(
            `INSERT INTO tests (id, title, type, teacher_name, created_by, reading_passage, builder_json, custom_title, folder, created_at)
             VALUES (tests_seq.NEXTVAL, :title, :type, :tn, :cb, :rp, :bj, :ct, :f, :ca)
             RETURNING id INTO :out_id`,
            { title: t.title, type: t.type, tn: t.teacherName, cb: createdBy, rp: t.readingPassage, bj: t.builderJson, ct: t.customTitle, f: t.folder || '', ca: t.createdAt, out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT } }
        );
        await recordMapping('tests', t._id.toString(), result.outBinds.out_id[0]);
    }

    // 5. Migrate groups
    const groups = await GroupMongo.find({}).lean();
    console.log(`Migrating ${groups.length} groups...`);
    for (const g of groups) {
        const teacherId = await getOracleId('users', g.teacherId?.toString());
        const result = await execute(
            `INSERT INTO groups (id, name, teacher_id, created_at)
             VALUES (groups_seq.NEXTVAL, :name, :tid, :ca)
             RETURNING id INTO :out_id`,
            { name: g.name, tid: teacherId, ca: g.createdAt, out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT } }
        );
        const newGroupId = result.outBinds.out_id[0];
        await recordMapping('groups', g._id.toString(), newGroupId);

        // Junction: group_students
        for (const sid of (g.students || [])) {
            const oracleStudentId = await getOracleId('users', sid.toString());
            if (oracleStudentId) {
                await execute(
                    `INSERT INTO group_students (group_id, user_id) VALUES (:gid, :uid)`,
                    { gid: newGroupId, uid: oracleStudentId }
                );
            }
        }
        // Junction: group_assigned_tests
        for (const tid of (g.assignedTests || [])) {
            const oracleTestId = await getOracleId('tests', tid.toString());
            if (oracleTestId) {
                await execute(
                    `INSERT INTO group_assigned_tests (group_id, test_id) VALUES (:gid, :tid)`,
                    { gid: newGroupId, tid: oracleTestId }
                );
            }
        }
        // group_test_schedule
        for (const sched of (g.testSchedule || [])) {
            const oracleTestId = await getOracleId('tests', sched.testId?.toString());
            if (oracleTestId) {
                await execute(
                    `INSERT INTO group_test_schedule (id, group_id, test_id, available_from)
                     VALUES (test_schedule_seq.NEXTVAL, :gid, :tid, :af)`,
                    { gid: newGroupId, tid: oracleTestId, af: sched.availableFrom }
                );
            }
        }
    }

    // 6. Migrate submissions
    // 7. Migrate feedbacks
    // 8. Migrate notifications
    // 9. Fix user references (teacherId, groupId → oracle IDs)
    // 10. Junction: user_assigned_tests from User.assignedTests[]

    // 11. Verify counts
    const counts = {
        users: { mongo: await UserMongo.countDocuments(), oracle: (await execute('SELECT COUNT(*) AS cnt FROM users')).rows[0].CNT },
        tests: { mongo: await TestMongo.countDocuments(), oracle: (await execute('SELECT COUNT(*) AS cnt FROM tests')).rows[0].CNT },
        // ... etc
    };
    console.log('Count verification:', counts);

    await mongoose.disconnect();
    await oradb.close();
    console.log('✅ Migration complete');
}

async function recordMapping(collection, mongoId, oracleId) {
    await execute(
        `INSERT INTO id_mapping (collection, mongo_id, oracle_id) VALUES (:c, :m, :o)`,
        { c: collection, m: mongoId, o: oracleId }
    );
}

async function getOracleId(collection, mongoId) {
    if (!mongoId) return null;
    const result = await execute(
        `SELECT oracle_id FROM id_mapping WHERE collection = :c AND mongo_id = :m`,
        { c: collection, m: mongoId }
    );
    return result.rows[0]?.ORACLE_ID || null;
}

migrate().catch(err => { console.error(err); process.exit(1); });
```

---

## 8. OCI Infrastructure Setup

### 8.1 Step-by-Step OCI Console Setup

1. **Sign up** at [cloud.oracle.com](https://cloud.oracle.com) (credit card required for verification, but never charged)
2. **Create Compartment**: `test-platform`
3. **Provision Autonomous Database (ATP)**:
   - Database name: `TESTPLATFORM`
   - Workload: Transaction Processing
   - Always Free: ✅ Toggle ON
   - Admin password: set a strong one
   - Download the Wallet (ZIP file with connection strings)
4. **Provision Compute VM**:
   - Image: Ubuntu 22.04
   - Shape: AMD VM.Standard.E2.1.Micro (Always Free)
   - Add SSH key
   - Boot volume: 50GB (within 200GB free limit)
   - Assign public IPv4 address

### 8.2 VM Setup Commands

```bash
# SSH into the VM
ssh ubuntu@<public-ip>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install Oracle Instant Client (required for node-oracledb)
cd /tmp
wget https://download.oracle.com/otn_software/linux/instantclient/instantclient-basic-linuxx64.zip
sudo mkdir -p /opt/oracle
sudo unzip instantclient-basic-linuxx64.zip -d /opt/oracle
sudo sh -c 'echo /opt/oracle/instantclient_21_* > /etc/ld.so.conf.d/oracle-instantclient.conf'
sudo ldconfig

# Install nginx
sudo apt install -y nginx certbot python3-certbot-nginx

# Install PM2 (process manager)
sudo npm install -g pm2

# Clone project
git clone <your-repo-url> /home/ubuntu/test-platform
cd /home/ubuntu/test-platform
npm install

# Upload Oracle Wallet to /home/ubuntu/oracle-wallet/
# Copy .env file with production settings

# Start with PM2
pm2 start server.js --name test-platform
pm2 save
pm2 startup

# Set up nginx reverse proxy + SSL
sudo certbot --nginx -d your-domain.com
```

### 8.3 nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Increase body size for file uploads
    client_max_body_size 100M;
}
```

---

## 9. Phased Implementation Roadmap

### Phase 0: Preparation
- [ ] Create OCI account (free tier)
- [ ] Provision OCI Compute VM (AMD Micro, Ubuntu 22.04)
- [ ] Provision Oracle Autonomous Database (ATP, Always Free)
- [ ] Download ATP wallet, upload to VM
- [ ] Set up SSH, nginx, Node.js, PM2 on VM
- [ ] Install Oracle Instant Client on VM
- [ ] Create Oracle schema (run schema.sql)
- [ ] Update `.env` with Oracle credentials

### Phase 1: Data Migration (offline)
- [ ] Run full MongoDB backup (`node backup-database.js backup`)
- [ ] Run migration script (`node migrate.js`)
- [ ] Verify all row counts match MongoDB → Oracle
- [ ] Run sample queries to validate relationships
- [ ] Fix any migration errors

### Phase 2: Code Rewrite — Models
- [ ] Create [`database/connection.js`](database/connection.js)
- [ ] Create [`database/session-store.js`](database/session-store.js)
- [ ] Rewrite [`models/User.js`](models/User.js:1)
- [ ] Rewrite [`models/Test.js`](models/Test.js:1)
- [ ] Rewrite [`models/Submission.js`](models/Submission.js:1)
- [ ] Rewrite [`models/Group.js`](models/Group.js:1)
- [ ] Rewrite [`models/Feedback.js`](models/Feedback.js:1)
- [ ] Rewrite [`models/Notification.js`](models/Notification.js:1)

### Phase 3: Code Rewrite — Server
- [ ] Rewrite [`utils/config.js`](utils/config.js:1) — env var changes
- [ ] Rewrite MongoDB connection block → Oracle pool
- [ ] Rewrite session middleware → Oracle store
- [ ] Rewrite `isDatabaseReady()` → Oracle check
- [ ] Rewrite all route handlers (login, CRUD, dashboard, etc.)
- [ ] Rewrite `saveStudentSubmission()` — JSON merge for details
- [ ] Rewrite `saveValidatedTest()`
- [ ] Rewrite `handleDelete()` and all delete routes
- [ ] Rewrite live monitor (SSE stays, queries change)
- [ ] Rewrite AI chat context builder
- [ ] Rewrite analytics + export routes
- [ ] Rewrite search/filter endpoints
- [ ] Rewrite `backup-database.js` (MongoDB export → Oracle Data Pump)

### Phase 4: Testing
- [ ] Unit tests: update test DB connection, run `npm run test:unit`
- [ ] Integration tests: run `npm run test:integration`
- [ ] Manual testing:
  - [ ] Login (admin, teacher, student)
  - [ ] Create reading/listening/writing tests
  - [ ] Student takes tests, submits
  - [ ] Teacher progress view, live monitor SSE
  - [ ] Admin dashboard, bulk operations
  - [ ] Feedback system (student → admin reply)
  - [ ] Notifications
  - [ ] AI chat
  - [ ] Settings (password change, export)
  - [ ] Backup job

### Phase 5: Cutover
- [ ] Point DNS to OCI VM public IP
- [ ] Enable nginx + Let's Encrypt SSL
- [ ] Monitor Sentry for 48 hours
- [ ] Keep old MongoDB read-only for 30 days
- [ ] After 30 days, decommission old setup

---

## 10. Risk Assessment & Rollback

### 10.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 1GB RAM insufficient under load | Medium | High | Monitor with `htop`; add swap; optimize pool size |
| Oracle ATP cold-start latency | Medium | Low | ATP stays warm if queried regularly; first query may take 5-10s |
| node-oracledb CLOB handling edge cases | Medium | Medium | Test deeply nested JSON in `details` field |
| ObjectId → Number ID bugs in relationships | High | High | Thorough migration script testing; junction table row count validation |
| `$regex` → `REGEXP_LIKE` differences | Low | Low | Test all search endpoints with real data |
| Windows dev environment (Oracle Instant Client) | Medium | Low | Use Oracle's free Docker image for local dev |

### 10.2 Rollback Plan

If the Oracle deployment fails:

1. **Switch DNS back** to Render/Railway deployment
2. Point to MongoDB (never deleted — kept as read-only backup)
3. Users may lose submissions made during the Oracle window (acceptable for short cutover)
4. Keep Oracle deployment as a staging environment to debug issues

### 10.3 Memory Pressure Mitigations

If the 1GB VM struggles:

```bash
# Add 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Reduce Node.js memory
export NODE_OPTIONS="--max-old-space-size=384"

# Limit Oracle connection pool aggressively
# In database/connection.js: poolMax = 2, poolMin = 1
```

---

## Summary

| Decision | Choice |
|---|---|
| **Database** | Oracle Autonomous Database (ATP) — Always Free |
| **Driver** | node-oracledb 6.x |
| **ORM** | None — raw SQL with a lightweight query helper |
| **File Storage** | Backblaze B2 (unchanged) |
| **Session Store** | Custom Oracle-backed store |
| **Hosting** | OCI Compute AMD Micro VM |
| **Monthly Cost** | **$0** |
| **Data Preservation** | Full MongoDB → Oracle migration via mapping table |
| **Code to Rewrite** | ~3,500 lines across 9 files |
| **Risk** | Medium — primarily 1GB RAM ceiling and ID mapping complexity |
