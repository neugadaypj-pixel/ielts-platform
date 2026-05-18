require('dotenv').config();
const mongoose = require('mongoose');
const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');

// ============================================================
// MongoDB Models (old — read-only source)
// ============================================================
const UserMongo = require('./models/User');
const TestMongo = require('./models/Test');
const GroupMongo = require('./models/Group');
const SubmissionMongo = require('./models/Submission');
const FeedbackMongo = require('./models/Feedback');
const NotificationMongo = require('./models/Notification');

// ============================================================
// Oracle connection (reuse existing pool)
// ============================================================
const { getPool, execute, executeMany, closePool } = require('./database/connection');

// ============================================================
// Track MongoDB ObjectId → Oracle Number ID
// ============================================================
const idMap = {
    users: new Map(),   // mongoId (string) → oracleId (number)
    tests: new Map(),
    groups: new Map(),
    submissions: new Map(),
    feedbacks: new Map(),
    notifications: new Map()
};

function recordMapping(collection, mongoId, oracleId) {
    const key = String(mongoId);
    idMap[collection].set(key, oracleId);
}

function getOracleId(collection, mongoId) {
    if (!mongoId) return null;
    const key = String(mongoId);
    const id = idMap[collection].get(key);
    return id || null;
}

// ============================================================
// Helper: convert any date value to a JS Date object for oracledb
// ============================================================
function toOracleDate(val) {
    if (!val) return new Date();
    return new Date(val);
}

// ============================================================
// MAIN MIGRATION FUNCTION
// ============================================================
// ============================================================
// Helper: convert any date value to a JS Date object for oracledb
// ============================================================
function toOracleDate(val) {
    if (!val) return new Date();
    return new Date(val);
}

// ============================================================
// Run the schema to ensure all tables exist
// ============================================================
async function runSchema() {
    console.log('[SCHEMA] Running schema.sql...');
    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    const rawSql = fs.readFileSync(schemaPath, 'utf8');
    console.log(`         Read schema.sql (${rawSql.length} bytes)`);

    const statements = rawSql
        .split(/\n\/\s*\n|\n\/\s*$/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.split('\n').every(l => l.trim() === '' || l.trim().startsWith('--')));

    const skipErrors = ['ORA-00955', 'ORA-02275', 'ORA-01430', 'ORA-02264', 'ORA-00942', 'ORA-01418', 'ORA-00904', 'ORA-01408'];

    let total = 0, ok = 0, fail = 0;
    for (const stmt of statements) {
        total++;
        const preview = stmt.substring(0, 75).replace(/\n/g, ' ');
        try {
            await execute(stmt);
            console.log(`  [OK]    #${total}: ${preview}...`);
            ok++;
        } catch (err) {
            const msg = err.message || '';
            if (skipErrors.some(code => msg.includes(code))) {
                console.log(`  [SKIP]  #${total}: Already exists — ${preview.substring(0, 52)}...`);
                ok++;
            } else {
                console.error(`  [FAIL]  #${total}: ${preview}...`);
                console.error(`          ${msg}`);
                fail++;
            }
        }
    }
    console.log(`         Schema: ${total} statements, ${ok} OK/skip, ${fail} failed\n`);
    if (fail > 5) throw new Error('Too many schema errors — aborting');
}

// ============================================================
// Reset id_mapping table for a fresh migration
// ============================================================
async function setupMappingTable() {
    console.log('[SETUP] Preparing id_mapping tracking table...');
    try {
        // Clear existing mappings but keep the table
        await execute(`TRUNCATE TABLE id_mapping`);
        console.log('        id_mapping table truncated');
    } catch (e) {
        // Create if doesn't exist
        try {
            await execute(`
                CREATE TABLE id_mapping (
                    collection VARCHAR2(50) NOT NULL,
                    mongo_id   VARCHAR2(24) NOT NULL,
                    oracle_id  NUMBER NOT NULL,
                    PRIMARY KEY (collection, mongo_id)
                )
            `);
            console.log('        id_mapping table created');
        } catch (e2) {
            console.error('        Could not create id_mapping:', e2.message);
            throw e2;
        }
    }
}

// ============================================================
// Resync sequences after migration
// ============================================================
async function resyncSequences() {
    console.log('[SYNC] Resynchronizing ID sequences...');
    const tables = ['users', 'tests', 'groups', 'submissions', 'feedbacks', 'notifications', 'group_test_schedule'];
    for (const table of tables) {
        try {
            const result = await execute(`SELECT NVL(MAX(id), 0) AS max_id FROM ${table}`);
            const maxId = result.rows[0].MAX_ID;
            await execute(`ALTER SEQUENCE ${table}_seq RESTART START WITH ${maxId + 1}`);
            console.log(`        ${table}_seq → ${maxId + 1}`);
        } catch (e) {
            console.log(`        ${table}_seq: ${e.message}`);
        }
    }
}

// ============================================================
// MAIN MIGRATION FUNCTION
// ============================================================
async function migrate() {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║   MongoDB → Oracle Data Migration Tool v2       ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    // --- Step A: Run schema first ---
    await runSchema();

    // --- Step B: Setup mapping table ---
    await setupMappingTable();

    // --- Step 0: Connect to MongoDB ---
    console.log('[0/10] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000
    });
    console.log('       ✅ Connected to MongoDB');

    // --- Step 0b: Verify Oracle is ready ---
    console.log('[0/10] Connecting to Oracle...');
    const pool = await getPool();
    const testConn = await pool.getConnection();
    await testConn.execute('SELECT 1 FROM dual');
    await testConn.close();
    console.log('       ✅ Connected to Oracle');

    // ========================================================
    // Step 1: Migrate Users (basic fields only)
    // ========================================================
    console.log('\n[1/9] Migrating Users...');
    const users = await UserMongo.find({}).lean();
    console.log(`      Found ${users.length} users in MongoDB`);

    let userCount = 0;
    for (const u of users) {
        try {
            const result = await execute(
                `INSERT INTO users (username, password, role, created_at, updated_at)
                 VALUES (:username, :password, :role, :createdAt, :updatedAt)
                 RETURNING id INTO :out_id`,
                {
                    username: u.username,
                    password: u.password,
                    role: u.role || 'student',
                    createdAt: toOracleDate(u.createdAt),
                    updatedAt: toOracleDate(u.updatedAt),
                    out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );
            const newId = Array.isArray(result.outBinds.out_id) ? result.outBinds.out_id[0] : result.outBinds.out_id;
            recordMapping('users', u._id, newId);
            userCount++;
            if (userCount % 20 === 0) {
                console.log(`      Migrated ${userCount}/${users.length} users...`);
            }
        } catch (err) {
            console.error(`      ⚠️  Failed to migrate user ${u.username}: ${err.message}`);
        }
    }
    console.log(`      ✅ Migrated ${userCount}/${users.length} users`);

    // --- Fix user foreign keys (teacher_id, group_id) ---
    console.log('      Fixing user references (teacher_id, group_id)...');
    let userRefCount = 0;
    for (const u of users) {
        const oracleId = getOracleId('users', u._id);
        if (!oracleId) continue;

        const teacherId = getOracleId('users', u.teacherId);
        const groupId = getOracleId('groups', u.groupId); // groups not migrated yet, will fix later

        if (teacherId || (u.teacherId && !teacherId)) {
            // Only update teacherId
            await execute(
                `UPDATE users SET teacher_id = :teacherId, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
                { teacherId: teacherId || null, id: oracleId }
            );
            userRefCount++;
        }
    }
    console.log(`      ✅ Fixed ${userRefCount} user references`);

    // ========================================================
    // Step 2: Migrate Tests
    // ========================================================
    console.log('\n[2/9] Migrating Tests...');
    const tests = await TestMongo.find({}).lean();
    console.log(`      Found ${tests.length} tests in MongoDB`);

    let testCount = 0;
    for (const t of tests) {
        try {
            const createdBy = getOracleId('users', t.createdBy);
            const questions = t.questions ? JSON.stringify(t.questions) : '[]';

            const result = await execute(
                `INSERT INTO tests (title, type, teacher_name, created_by, reading_passage, builder_json, custom_title, folder, questions, created_at, updated_at)
                 VALUES (:title, :type, :teacherName, :createdBy, :readingPassage, :builderJson, :customTitle, :folder, :questions, :createdAt, :updatedAt)
                 RETURNING id INTO :out_id`,
                {
                    title: t.title || 'Untitled',
                    type: t.type || 'reading',
                    teacherName: t.teacherName || '',
                    createdBy: createdBy || null,
                    readingPassage: t.readingPassage || '',
                    builderJson: t.builderJson || '',
                    customTitle: t.customTitle || null,
                    folder: t.folder || '',
                    questions: questions,
                    createdAt: toOracleDate(t.createdAt),
                    updatedAt: toOracleDate(t.updatedAt),
                    out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );
            const newId = Array.isArray(result.outBinds.out_id) ? result.outBinds.out_id[0] : result.outBinds.out_id;
            recordMapping('tests', t._id, newId);
            testCount++;
            if (testCount % 20 === 0) {
                console.log(`      Migrated ${testCount}/${tests.length} tests...`);
            }
        } catch (err) {
            console.error(`      ⚠️  Failed to migrate test "${t.title}": ${err.message}`);
        }
    }
    console.log(`      ✅ Migrated ${testCount}/${tests.length} tests`);

    // ========================================================
    // Step 3: Migrate Groups
    // ========================================================
    console.log('\n[3/9] Migrating Groups...');
    const groups = await GroupMongo.find({}).lean();
    console.log(`      Found ${groups.length} groups in MongoDB`);

    let groupCount = 0;
    for (const g of groups) {
        try {
            const teacherId = getOracleId('users', g.teacherId);

            const result = await execute(
                `INSERT INTO groups (name, teacher_id, created_at, updated_at)
                 VALUES (:name, :teacherId, :createdAt, :updatedAt)
                 RETURNING id INTO :out_id`,
                {
                    name: g.name || 'Untitled Group',
                    teacherId: teacherId || null,
                    createdAt: toOracleDate(g.createdAt),
                    updatedAt: toOracleDate(g.updatedAt),
                    out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );
            const newId = Array.isArray(result.outBinds.out_id) ? result.outBinds.out_id[0] : result.outBinds.out_id;
            recordMapping('groups', g._id, newId);
            groupCount++;
        } catch (err) {
            console.error(`      ⚠️  Failed to migrate group "${g.name}": ${err.message}`);
        }
    }
    console.log(`      ✅ Migrated ${groupCount}/${groups.length} groups`);

    // ========================================================
    // Step 4: Populate Group Junction Tables
    // ========================================================
    console.log('\n[4/9] Populating Group junction tables...');
    let gsCount = 0;  // group_students
    let gatCount = 0; // group_assigned_tests
    let gtsCount = 0; // group_test_schedule

    for (const g of groups) {
        const groupId = getOracleId('groups', g._id);
        if (!groupId) continue;

        // group_students
        if (g.students && Array.isArray(g.students)) {
            for (const studentId of g.students) {
                const oracleStudentId = getOracleId('users', studentId);
                if (oracleStudentId) {
                    try {
                        await execute(
                            `INSERT INTO group_students (group_id, user_id) VALUES (:groupId, :userId)`,
                            { groupId, userId: oracleStudentId }
                        );
                        gsCount++;
                    } catch (err) {
                        // Ignore duplicates
                    }
                }
            }
        }

        // group_assigned_tests
        if (g.assignedTests && Array.isArray(g.assignedTests)) {
            for (const testId of g.assignedTests) {
                const oracleTestId = getOracleId('tests', testId);
                if (oracleTestId) {
                    try {
                        await execute(
                            `INSERT INTO group_assigned_tests (group_id, test_id) VALUES (:groupId, :testId)`,
                            { groupId, testId: oracleTestId }
                        );
                        gatCount++;
                    } catch (err) {
                        // Ignore duplicates
                    }
                }
            }
        }

        // group_test_schedule
        if (g.testSchedule && Array.isArray(g.testSchedule)) {
            for (const sched of g.testSchedule) {
                if (!sched || !sched.testId) continue;
                const oracleTestId = getOracleId('tests', sched.testId);
                if (oracleTestId) {
                    await execute(
                        `INSERT INTO group_test_schedule (group_id, test_id, available_from)
                         VALUES (:groupId, :testId, :availableFrom)`,
                        {
                            groupId,
                            testId: oracleTestId,
                            availableFrom: sched.availableFrom ? new Date(sched.availableFrom) : null
                        }
                    );
                    gtsCount++;
                }
            }
        }
    }
    console.log(`      ✅ group_students: ${gsCount} rows`);
    console.log(`      ✅ group_assigned_tests: ${gatCount} rows`);
    console.log(`      ✅ group_test_schedule: ${gtsCount} rows`);

    // ========================================================
    // Step 4b: Fix user group_id references (now that groups exist)
    // ========================================================
    console.log('\n[4b] Fixing user group_id references...');
    let groupRefCount = 0;
    for (const u of users) {
        if (!u.groupId) continue;
        const oracleUserId = getOracleId('users', u._id);
        const oracleGroupId = getOracleId('groups', u.groupId);
        if (oracleUserId && oracleGroupId) {
            await execute(
                `UPDATE users SET group_id = :groupId WHERE id = :id`,
                { groupId: oracleGroupId, id: oracleUserId }
            );
            groupRefCount++;
        }
    }
    console.log(`      ✅ Fixed ${groupRefCount} user group references`);

    // ========================================================
    // Step 5: Populate user_assigned_tests
    // ========================================================
    console.log('\n[5/9] Populating user_assigned_tests...');
    let uatCount = 0;
    for (const u of users) {
        const oracleUserId = getOracleId('users', u._id);
        if (!oracleUserId) continue;
        if (u.assignedTests && Array.isArray(u.assignedTests)) {
            for (const testId of u.assignedTests) {
                const oracleTestId = getOracleId('tests', testId);
                if (oracleTestId) {
                    try {
                        await execute(
                            `INSERT INTO user_assigned_tests (user_id, test_id) VALUES (:userId, :testId)`,
                            { userId: oracleUserId, testId: oracleTestId }
                        );
                        uatCount++;
                    } catch (err) {
                        // Ignore duplicates
                    }
                }
            }
        }
    }
    console.log(`      ✅ user_assigned_tests: ${uatCount} rows`);

    // ========================================================
    // Step 6: Migrate Submissions
    // ========================================================
    console.log('\n[6/9] Migrating Submissions...');
    const submissions = await SubmissionMongo.find({}).lean();
    console.log(`      Found ${submissions.length} submissions in MongoDB`);

    let subCount = 0;
    for (const s of submissions) {
        try {
            const testId = getOracleId('tests', s.testId);
            const studentId = getOracleId('users', s.studentId);
            const teacherId = getOracleId('users', s.teacherId);
            const groupId = getOracleId('groups', s.groupId);

            const details = s.details ? JSON.stringify(s.details) : '{}';
            const firstSubAt = s.firstSubmittedAt || s.createdAt;
            const lastSubAt = s.lastSubmittedAt || s.updatedAt;

            const result = await execute(
                `INSERT INTO submissions (test_id, student_id, teacher_id, group_id, type, student_name, status, attempt_count, score, total_questions, percentage, band, word_count1, word_count2, time_remaining_text, details, first_submitted_at, last_submitted_at)
                 VALUES (:testId, :studentId, :teacherId, :groupId, :type, :studentName, :status, :attemptCount, :score, :totalQuestions, :percentage, :band, :wordCount1, :wordCount2, :timeRemainingText, :details, :firstSubmittedAt, :lastSubmittedAt)
                 RETURNING id INTO :out_id`,
                {
                    testId: testId || null,
                    studentId: studentId || null,
                    teacherId: teacherId || null,
                    groupId: groupId || null,
                    type: s.type || 'reading',
                    studentName: s.studentName || 'Unknown',
                    status: s.status || 'completed',
                    attemptCount: s.attemptCount || 1,
                    score: s.score || null,
                    totalQuestions: s.totalQuestions || null,
                    percentage: s.percentage || null,
                    band: s.band || null,
                    wordCount1: s.wordCount1 || null,
                    wordCount2: s.wordCount2 || null,
                    timeRemainingText: s.timeRemainingText || '',
                    details: details,
                    firstSubmittedAt: toOracleDate(firstSubAt),
                    lastSubmittedAt: toOracleDate(lastSubAt),
                    out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );
            const newId = Array.isArray(result.outBinds.out_id) ? result.outBinds.out_id[0] : result.outBinds.out_id;
            recordMapping('submissions', s._id, newId);
            subCount++;
            if (subCount % 50 === 0) {
                console.log(`      Migrated ${subCount}/${submissions.length} submissions...`);
            }
        } catch (err) {
            console.error(`      ⚠️  Failed to migrate submission: ${err.message}`);
        }
    }
    console.log(`      ✅ Migrated ${subCount}/${submissions.length} submissions`);

    // ========================================================
    // Step 7: Migrate Feedback
    // ========================================================
    console.log('\n[7/9] Migrating Feedback...');
    const feedbacks = await FeedbackMongo.find({}).lean();
    console.log(`      Found ${feedbacks.length} feedbacks in MongoDB`);

    let fbCount = 0;
    for (const f of feedbacks) {
        try {
            const studentId = getOracleId('users', f.studentId);
            const result = await execute(
                `INSERT INTO feedbacks (student_id, student_name, test_type, question_type, issue_description, status, admin_notes, admin_reply, created_at, updated_at)
                 VALUES (:studentId, :studentName, :testType, :questionType, :issueDescription, :status, :adminNotes, :adminReply, :createdAt, :updatedAt)
                 RETURNING id INTO :out_id`,
                {
                    studentId: studentId || null,
                    studentName: f.studentName || 'Unknown',
                    testType: f.testType || 'general',
                    questionType: f.questionType || '',
                    issueDescription: f.issueDescription || '',
                    status: f.status || 'open',
                    adminNotes: f.adminNotes || '',
                    adminReply: f.adminReply || '',
                    createdAt: toOracleDate(f.createdAt),
                    updatedAt: toOracleDate(f.updatedAt),
                    out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );
            const newId = Array.isArray(result.outBinds.out_id) ? result.outBinds.out_id[0] : result.outBinds.out_id;
            recordMapping('feedbacks', f._id, newId);
            fbCount++;
        } catch (err) {
            console.error(`      ⚠️  Failed to migrate feedback: ${err.message}`);
        }
    }
    console.log(`      ✅ Migrated ${fbCount}/${feedbacks.length} feedbacks`);

    // ========================================================
    // Step 8: Migrate Notifications
    // ========================================================
    console.log('\n[8/9] Migrating Notifications...');
    const notifications = await NotificationMongo.find({}).lean();
    console.log(`      Found ${notifications.length} notifications in MongoDB`);

    let notifCount = 0;
    for (const n of notifications) {
        try {
            const userId = getOracleId('users', n.userId);
            if (!userId) {
                // Skip orphaned notifications (referencing deleted users)
                continue;
            }
            // relatedId could be a test ID or feedback ID — try both
            let relatedId = getOracleId('tests', n.relatedId) || getOracleId('feedbacks', n.relatedId) || null;

            const result = await execute(
                `INSERT INTO notifications (user_id, type, title, message, related_id, is_read, created_at, updated_at)
                 VALUES (:userId, :type, :title, :message, :relatedId, :isRead, :createdAt, :updatedAt)
                 RETURNING id INTO :out_id`,
                {
                    userId: userId,
                    type: n.type || 'general',
                    title: n.title || 'No Title',
                    message: n.message || '',
                    relatedId: relatedId,
                    isRead: n.isRead ? 1 : 0,
                    createdAt: toOracleDate(n.createdAt),
                    updatedAt: toOracleDate(n.updatedAt),
                    out_id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );
            const newId = Array.isArray(result.outBinds.out_id) ? result.outBinds.out_id[0] : result.outBinds.out_id;
            recordMapping('notifications', n._id, newId);
            notifCount++;
            if (notifCount % 100 === 0) {
                console.log(`      Migrated ${notifCount}/${notifications.length} notifications...`);
            }
        } catch (err) {
            console.error(`      ⚠️  Failed to migrate notification: ${err.message}`);
        }
    }
    console.log(`      ✅ Migrated ${notifCount}/${notifications.length} notifications`);

    // ========================================================
    // Step 9: Verify Row Counts
    // ========================================================
    console.log('\n[9/9] Verifying row counts...\n');

    const oracleCounts = {
        users: (await execute('SELECT COUNT(*) AS cnt FROM users')).rows[0].CNT,
        tests: (await execute('SELECT COUNT(*) AS cnt FROM tests')).rows[0].CNT,
        groups: (await execute('SELECT COUNT(*) AS cnt FROM groups')).rows[0].CNT,
        submissions: (await execute('SELECT COUNT(*) AS cnt FROM submissions')).rows[0].CNT,
        feedbacks: (await execute('SELECT COUNT(*) AS cnt FROM feedbacks')).rows[0].CNT,
        notifications: (await execute('SELECT COUNT(*) AS cnt FROM notifications')).rows[0].CNT,
        group_students: (await execute('SELECT COUNT(*) AS cnt FROM group_students')).rows[0].CNT,
        group_assigned_tests: (await execute('SELECT COUNT(*) AS cnt FROM group_assigned_tests')).rows[0].CNT,
        group_test_schedule: (await execute('SELECT COUNT(*) AS cnt FROM group_test_schedule')).rows[0].CNT,
        user_assigned_tests: (await execute('SELECT COUNT(*) AS cnt FROM user_assigned_tests')).rows[0].CNT,
    };

    console.log('╔══════════════════════╦══════════╦══════════╗');
    console.log('║ Collection           ║ MongoDB  ║ Oracle   ║');
    console.log('╠══════════════════════╬══════════╬══════════╣');
    console.log(`║ users                ║ ${String(users.length).padEnd(8)} ║ ${String(oracleCounts.users).padEnd(8)} ║`);
    console.log(`║ tests                ║ ${String(tests.length).padEnd(8)} ║ ${String(oracleCounts.tests).padEnd(8)} ║`);
    console.log(`║ groups               ║ ${String(groups.length).padEnd(8)} ║ ${String(oracleCounts.groups).padEnd(8)} ║`);
    console.log(`║ submissions          ║ ${String(submissions.length).padEnd(8)} ║ ${String(oracleCounts.submissions).padEnd(8)} ║`);
    console.log(`║ feedbacks            ║ ${String(feedbacks.length).padEnd(8)} ║ ${String(oracleCounts.feedbacks).padEnd(8)} ║`);
    console.log(`║ notifications        ║ ${String(notifications.length).padEnd(8)} ║ ${String(oracleCounts.notifications).padEnd(8)} ║`);
    console.log(`║ group_students       ║          ║ ${String(oracleCounts.group_students).padEnd(8)} ║`);
    console.log(`║ group_assigned_tests ║          ║ ${String(oracleCounts.group_assigned_tests).padEnd(8)} ║`);
    console.log(`║ group_test_schedule  ║          ║ ${String(oracleCounts.group_test_schedule).padEnd(8)} ║`);
    console.log(`║ user_assigned_tests  ║          ║ ${String(oracleCounts.user_assigned_tests).padEnd(8)} ║`);
    console.log('╚══════════════════════╩══════════╩══════════╝');

    // --- Check for mismatches ---
    let hasErrors = false;
    if (userCount !== users.length) { console.log(`⚠️  Users: migrated ${userCount}, expected ${users.length}`); hasErrors = true; }
    if (testCount !== tests.length) { console.log(`⚠️  Tests: migrated ${testCount}, expected ${tests.length}`); hasErrors = true; }
    if (groupCount !== groups.length) { console.log(`⚠️  Groups: migrated ${groupCount}, expected ${groups.length}`); hasErrors = true; }
    if (subCount !== submissions.length) { console.log(`⚠️  Submissions: migrated ${subCount}, expected ${submissions.length}`); hasErrors = true; }
    if (fbCount !== feedbacks.length) { console.log(`⚠️  Feedback: migrated ${fbCount}, expected ${feedbacks.length}`); hasErrors = true; }
    if (notifCount !== notifications.length) { console.log(`⚠️  Notifications: migrated ${notifCount}, expected ${notifications.length}`); hasErrors = true; }

    if (hasErrors) {
        console.log('\n⚠️  Some records failed to migrate. Check the errors above.');
    } else {
        console.log('\n✅ All collections migrated successfully with matching row counts!');
    }

    // --- Step 10: Resync sequences ---
    console.log('\n[10/10] Resynchronizing ID sequences...');
    await resyncSequences();

    // --- Cleanup ---
    await mongoose.disconnect();
    console.log('✅ MongoDB connection closed');
    await closePool();
    console.log('✅ Oracle pool closed');
    console.log('\n✅ Migration complete!\n');
}

// ============================================================
// Run migration
// ============================================================
migrate()
    .then(() => {
        console.log('Exiting successfully.');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    });
