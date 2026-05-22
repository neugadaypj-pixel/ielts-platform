/**
 * ============================================================
 * RESTORE / SYNC: MongoDB → OracleDB
 * ============================================================
 * This script properly syncs data from MongoDB to OracleDB,
 * handling MongoDB ObjectId → Oracle NUMBER ID mapping via
 * the id_mapping table. It is IDEMPOTENT — safe to run multiple times.
 * 
 * Usage: node restore-from-mongo.js [--full-reset]
 *   --full-reset  : Clears all Oracle data before migration
 *   (default)     : Only syncs records not yet migrated
 * 
 * Migration order (respects FK constraints):
 *   1. Users      2. Tests      3. Groups
 *   4. Submissions  5. Feedback  6. Notifications
 *   7. Junction tables (user_assigned_tests, group_students, etc.)
 * ============================================================
 */

require('dotenv').config();

// Fallback MONGO_URI for Render environment where it may not be set
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://pulatovjamolbek77_db_user:Sbros0803@cluster0.xue5dod.mongodb.net/testPlatform?retryWrites=true&w=majority';

const mongoose = require('mongoose');
const { execute, getPool, closePool } = require('./database/connection');
const oracledb = require('oracledb');

// MongoDB Models (old system with ObjectIds)
const MongoUser = require('./models/User');
const MongoTest = require('./models/Test');
const MongoGroup = require('./models/Group');
const MongoSubmission = require('./models/Submission');
const MongoFeedback = require('./models/Feedback');
const MongoNotification = require('./models/Notification');

// ============================================================
// ID Mapping Cache
// collection → { mongoId: oracleId }
// ============================================================
const idMap = {
    users: new Map(),
    tests: new Map(),
    groups: new Map(),
    submissions: new Map(),
    feedbacks: new Map(),
    notifications: new Map()
};

// ============================================================
// Helpers
// ============================================================

/** Look up the Oracle NUMBER id for a MongoDB ObjectId string */
function getOId(collection, mongoId) {
    if (!mongoId) return null;
    const id = mongoId.toString ? mongoId.toString() : String(mongoId);
    const mapped = idMap[collection]?.get(id);
    return mapped || null;
}

/** Store MongoDB→Oracle ID mapping in cache + database */
async function storeMapping(collection, mongoId, oracleId) {
    const mid = mongoId.toString ? mongoId.toString() : String(mongoId);
    idMap[collection].set(mid, oracleId);
    // Persist to id_mapping table
    try {
        await execute(
            `MERGE INTO id_mapping im
             USING (SELECT :collection AS coll, :mongo_id AS mid, :oracle_id AS oid FROM dual) src
             ON (im.collection = src.coll AND im.mongo_id = src.mid)
             WHEN NOT MATCHED THEN INSERT (collection, mongo_id, oracle_id) VALUES (src.coll, src.mid, src.oid)`,
            { collection, mongo_id: mid, oracle_id: oracleId }
        );
    } catch (err) {
        console.warn(`   ⚠️  Could not persist mapping ${collection}/${mid} → ${oracleId}: ${err.message}`);
    }
}

/** Load all existing mappings from id_mapping into cache */
async function loadIdMappings() {
    try {
        const result = await execute(`SELECT collection, mongo_id AS "mongo_id", oracle_id AS "oracle_id" FROM id_mapping`);
        for (const row of result.rows) {
            if (idMap[row.COLLECTION]) {
                idMap[row.COLLECTION].set(String(row.mongo_id), row.oracle_id);
            }
        }
        console.log(`\n📋 Loaded existing ID mappings from Oracle:`);
        for (const [coll, map] of Object.entries(idMap)) {
            if (map.size > 0) console.log(`   ${coll}: ${map.size} mappings`);
        }
    } catch (err) {
        if (err.message.includes('table or view does not exist') || err.message.includes('ORA-00942')) {
            console.log('   ⚠️  id_mapping table does not exist yet — will be created during migration');
        } else {
            console.warn('   ⚠️  Could not load id_mappings:', err.message);
        }
    }
}

/** Ensure id_mapping table exists */
async function ensureIdMappingTable() {
    try {
        await execute(`SELECT 1 FROM id_mapping WHERE ROWNUM = 1`);
    } catch {
        console.log('   Creating id_mapping table...');
        await execute(`
            CREATE TABLE id_mapping (
                collection VARCHAR2(50) NOT NULL,
                mongo_id   VARCHAR2(24) NOT NULL,
                oracle_id  NUMBER NOT NULL,
                PRIMARY KEY (collection, mongo_id)
            )
        `);
    }
}

// ============================================================
// Phase 1: USERS
// ============================================================
async function migrateUsers() {
    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│  PHASE 1: Users                          │');
    console.log('└──────────────────────────────────────────┘');
    
    const mongoUsers = await MongoUser.find({});
    console.log(`   MongoDB: ${mongoUsers.length} users`);
    
    let migrated = 0, skipped = 0;
    
    // First pass: migrate users (skip those with existing mapping or duplicate username)
    for (const mUser of mongoUsers) {
        const mongoId = mUser._id.toString();
        
        // Check if already mapped
        if (idMap.users.has(mongoId)) {
            skipped++;
            continue;
        }
        
        // Check if username already exists in Oracle
        const existingOracle = await execute(
            `SELECT id FROM users WHERE username = :uname`,
            { uname: mUser.username }
        );
        
        if (existingOracle.rows.length > 0) {
            // Username exists – store mapping for the existing Oracle user
            const oracleId = existingOracle.rows[0].ID;
            await storeMapping('users', mongoId, oracleId);
            console.log(`   🔗 Linked existing user: ${mUser.username} (OID=${oracleId})`);
            skipped++;
            continue;
        }
        
        // Insert new user into Oracle
        // Note: teacherId FK will be set in the second pass (after all users are migrated)
        const insertResult = await execute(
            `INSERT INTO users (username, password, role)
             VALUES (:username, :password, :role)`,
            {
                username: mUser.username,
                password: mUser.password || '',
                role: mUser.role || 'student'
            }
        );
        
        // Get the Oracle-generated ID
        const idResult = await execute(`SELECT users_seq.CURRVAL AS id FROM dual`);
        const oracleId = idResult.rows[0].ID;
        
        await storeMapping('users', mongoId, oracleId);
        migrated++;
        
        if (migrated % 5 === 0) console.log(`   ✅ Migrated ${migrated} users...`);
    }
    
    console.log(`   📊 Users: ${migrated} migrated, ${skipped} skipped`);
    
    // Second pass: update teacherId FKs and user_assigned_tests
    console.log('\n   🔗 Fixing user FKs and assigned tests...');
    let fkFixed = 0;
    
    for (const mUser of mongoUsers) {
        const oracleId = getOId('users', mUser._id);
        if (!oracleId) continue;
        
        // Update teacherId FK
        if (mUser.teacherId) {
            const teacherOId = getOId('users', mUser.teacherId);
            if (teacherOId) {
                await execute(
                    `UPDATE users SET teacher_id = :tid, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
                    { id: oracleId, tid: teacherOId }
                );
            }
        }
        
        // Update groupId FK
        // (We'll do this after groups are migrated, but set if already mapped)
        if (mUser.groupId) {
            const groupOId = getOId('groups', mUser.groupId);
            if (groupOId) {
                await execute(
                    `UPDATE users SET group_id = :gid, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
                    { id: oracleId, gid: groupOId }
                );
            }
        }
        
        // Populate user_assigned_tests junction
        if (mUser.assignedTests && mUser.assignedTests.length > 0) {
            for (const testMongoId of mUser.assignedTests) {
                const testOId = getOId('tests', testMongoId);
                if (testOId) {
                    try {
                        await execute(
                            `INSERT INTO user_assigned_tests (user_id, test_id)
                             SELECT :uid, :tid FROM dual
                             WHERE NOT EXISTS (
                                 SELECT 1 FROM user_assigned_tests
                                 WHERE user_id = :uid2 AND test_id = :tid2
                             )`,
                            { uid: oracleId, tid: testOId, uid2: oracleId, tid2: testOId }
                        );
                    } catch (err) {
                        if (!err.message.includes('unique constraint') && !err.message.includes('ORA-00001')) {
                            console.warn(`   ⚠️  user_assigned_tests insert failed: ${err.message}`);
                        }
                    }
                }
            }
        }
        fkFixed++;
    }
    console.log(`   ✅ Fixed FKs for ${fkFixed} users`);
}

// ============================================================
// Phase 2: TESTS
// ============================================================
async function migrateTests() {
    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│  PHASE 2: Tests                          │');
    console.log('└──────────────────────────────────────────┘');
    
    const mongoTests = await MongoTest.find({});
    console.log(`   MongoDB: ${mongoTests.length} tests`);
    
    let migrated = 0, skipped = 0;
    
    for (const mTest of mongoTests) {
        const mongoId = mTest._id.toString();
        
        if (idMap.tests.has(mongoId)) { skipped++; continue; }
        
        // Map the creator (createdBy)
        const creatorOId = getOId('users', mTest.createdBy);
        
        const questionsJson = mTest.questions 
            ? (typeof mTest.questions === 'string' ? mTest.questions : JSON.stringify(mTest.questions))
            : '[]';
        
        await execute(
            `INSERT INTO tests (title, type, teacher_name, created_by, reading_passage, builder_json, custom_title, folder, questions)
             VALUES (:title, :type, :teacherName, :createdBy, :readingPassage, :builderJson, :customTitle, :folder, :questions)`,
            {
                title: mTest.title || 'Untitled',
                type: mTest.type || 'reading',
                teacherName: mTest.teacherName || '',
                createdBy: creatorOId,
                readingPassage: mTest.readingPassage || '',
                builderJson: mTest.builderJson || '',
                customTitle: mTest.customTitle || '',
                folder: mTest.folder || '',
                questions: questionsJson
            }
        );
        
        const idResult = await execute(`SELECT tests_seq.CURRVAL AS id FROM dual`);
        const oracleId = idResult.rows[0].ID;
        
        await storeMapping('tests', mongoId, oracleId);
        migrated++;
        
        if (migrated % 10 === 0) console.log(`   ✅ Migrated ${migrated} tests...`);
    }
    
    console.log(`   📊 Tests: ${migrated} migrated, ${skipped} skipped`);
}

// ============================================================
// Phase 3: GROUPS
// ============================================================
async function migrateGroups() {
    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│  PHASE 3: Groups                         │');
    console.log('└──────────────────────────────────────────┘');
    
    const mongoGroups = await MongoGroup.find({});
    console.log(`   MongoDB: ${mongoGroups.length} groups`);
    
    let migrated = 0, skipped = 0;
    
    for (const mGroup of mongoGroups) {
        const mongoId = mGroup._id.toString();
        
        if (idMap.groups.has(mongoId)) { skipped++; continue; }
        
        const teacherOId = getOId('users', mGroup.teacherId);
        
        await execute(
            `INSERT INTO groups (name, teacher_id) VALUES (:name, :teacherId)`,
            { name: mGroup.name, teacherId: teacherOId }
        );
        
        const idResult = await execute(`SELECT groups_seq.CURRVAL AS id FROM dual`);
        const oracleId = idResult.rows[0].ID;
        
        await storeMapping('groups', mongoId, oracleId);
        
        // Populate junction tables
        // group_students
        if (mGroup.students && mGroup.students.length > 0) {
            for (const studentMongoId of mGroup.students) {
                const studentOId = getOId('users', studentMongoId);
                if (studentOId) {
                    try {
                        await execute(
                            `INSERT INTO group_students (group_id, user_id)
                             SELECT :gid, :uid FROM dual
                             WHERE NOT EXISTS (
                                 SELECT 1 FROM group_students WHERE group_id = :gid2 AND user_id = :uid2
                             )`,
                            { gid: oracleId, uid: studentOId, gid2: oracleId, uid2: studentOId }
                        );
                    } catch (err) {
                        if (!err.message.includes('ORA-00001')) {
                            console.warn(`   ⚠️  group_students: ${err.message}`);
                        }
                    }
                }
            }
        }
        
        // group_assigned_tests
        if (mGroup.assignedTests && mGroup.assignedTests.length > 0) {
            for (const testMongoId of mGroup.assignedTests) {
                const testOId = getOId('tests', testMongoId);
                if (testOId) {
                    try {
                        await execute(
                            `INSERT INTO group_assigned_tests (group_id, test_id)
                             SELECT :gid, :tid FROM dual
                             WHERE NOT EXISTS (
                                 SELECT 1 FROM group_assigned_tests WHERE group_id = :gid2 AND test_id = :tid2
                             )`,
                            { gid: oracleId, tid: testOId, gid2: oracleId, tid2: testOId }
                        );
                    } catch (err) {
                        if (!err.message.includes('ORA-00001')) {
                            console.warn(`   ⚠️  group_assigned_tests: ${err.message}`);
                        }
                    }
                }
            }
        }
        
        // group_test_schedule
        if (mGroup.testSchedule && mGroup.testSchedule.length > 0) {
            for (const ts of mGroup.testSchedule) {
                const testOId = getOId('tests', ts.testId);
                if (testOId) {
                    const availFrom = ts.availableFrom 
                        ? (ts.availableFrom instanceof Date 
                            ? ts.availableFrom.toISOString().replace('Z', '') 
                            : String(ts.availableFrom).replace('Z', ''))
                        : null;
                    if (availFrom) {
                        try {
                            await execute(
                                `INSERT INTO group_test_schedule (group_id, test_id, available_from)
                                 VALUES (:gid, :tid, TO_TIMESTAMP_TZ(:avail, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`,
                                { gid: oracleId, tid: testOId, avail: availFrom }
                            );
                        } catch (err) {
                            console.warn(`   ⚠️  group_test_schedule: ${err.message}`);
                        }
                    }
                }
            }
        }
        
        // Now update users with this group's FK
        if (mGroup.students && mGroup.students.length > 0) {
            for (const studentMongoId of mGroup.students) {
                const studentOId = getOId('users', studentMongoId);
                if (studentOId) {
                    await execute(
                        `UPDATE users SET group_id = :gid, updated_at = CURRENT_TIMESTAMP WHERE id = :uid AND group_id IS NULL`,
                        { gid: oracleId, uid: studentOId }
                    );
                }
            }
        }
        
        migrated++;
        console.log(`   ✅ Migrated group: ${mGroup.name}`);
    }
    
    console.log(`   📊 Groups: ${migrated} migrated, ${skipped} skipped`);
}

// ============================================================
// Phase 4: SUBMISSIONS
// ============================================================
async function migrateSubmissions() {
    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│  PHASE 4: Submissions                    │');
    console.log('└──────────────────────────────────────────┘');
    
    const mongoSubmissions = await MongoSubmission.find({});
    console.log(`   MongoDB: ${mongoSubmissions.length} submissions`);
    
    let migrated = 0, skipped = 0;
    
    for (const mSub of mongoSubmissions) {
        const mongoId = mSub._id.toString();
        
        if (idMap.submissions.has(mongoId)) { skipped++; continue; }
        
        const testOId = getOId('tests', mSub.testId);
        const studentOId = getOId('users', mSub.studentId);
        const teacherOId = getOId('users', mSub.teacherId);
        const groupOId = getOId('groups', mSub.groupId);
        
        // Skip if referenced test or student doesn't exist in Oracle
        if (!testOId || !studentOId) {
            console.log(`   ⏭️  Skipping submission (missing FK refs)`);
            skipped++;
            continue;
        }
        
        // Check for unique constraint (test_id + student_id)
        const existing = await execute(
            `SELECT id FROM submissions WHERE test_id = :tid AND student_id = :sid`,
            { tid: testOId, sid: studentOId }
        );
        if (existing.rows.length > 0) {
            await storeMapping('submissions', mongoId, existing.rows[0].ID);
            skipped++;
            continue;
        }
        
        const detailsStr = mSub.details
            ? (typeof mSub.details === 'string' ? mSub.details : JSON.stringify(mSub.details))
            : '{}';
        
        const firstSubmittedAt = mSub.firstSubmittedAt || mSub.createdAt || new Date();
        const lastSubmittedAt = mSub.lastSubmittedAt || mSub.updatedAt || firstSubmittedAt;
        
        await execute(
            `INSERT INTO submissions (test_id, student_id, teacher_id, group_id, type,
                                      student_name, status, attempt_count, score,
                                      total_questions, percentage, band, word_count1,
                                      word_count2, time_remaining_text, details,
                                      first_submitted_at, last_submitted_at)
             VALUES (:testId, :studentId, :teacherId, :groupId, :type,
                     :studentName, :status, :attemptCount, :score,
                     :totalQuestions, :percentage, :band, :wordCount1,
                     :wordCount2, :timeRemainingText, :details,
                     TO_TIMESTAMP_TZ(:firstAt, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                     TO_TIMESTAMP_TZ(:lastAt, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`,
            {
                testId: testOId,
                studentId: studentOId,
                teacherId: teacherOId || null,
                groupId: groupOId || null,
                type: mSub.type || 'reading',
                studentName: mSub.studentName || 'Unknown',
                status: mSub.status || 'completed',
                attemptCount: mSub.attemptCount || 1,
                score: mSub.score || null,
                totalQuestions: mSub.totalQuestions || null,
                percentage: mSub.percentage || null,
                band: mSub.band || null,
                wordCount1: mSub.wordCount1 || null,
                wordCount2: mSub.wordCount2 || null,
                timeRemainingText: mSub.timeRemainingText || '',
                details: detailsStr,
                firstAt: firstSubmittedAt instanceof Date 
                    ? firstSubmittedAt.toISOString().replace('Z', '') 
                    : String(firstSubmittedAt).replace('Z', ''),
                lastAt: lastSubmittedAt instanceof Date 
                    ? lastSubmittedAt.toISOString().replace('Z', '') 
                    : String(lastSubmittedAt).replace('Z', '')
            }
        );
        
        const idResult = await execute(`SELECT submissions_seq.CURRVAL AS id FROM dual`);
        const oracleId = idResult.rows[0].ID;
        
        await storeMapping('submissions', mongoId, oracleId);
        migrated++;
        
        if (migrated % 10 === 0) console.log(`   ✅ Migrated ${migrated} submissions...`);
    }
    
    console.log(`   📊 Submissions: ${migrated} migrated, ${skipped} skipped`);
}

// ============================================================
// Phase 5: FEEDBACK
// ============================================================
async function migrateFeedback() {
    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│  PHASE 5: Feedback                       │');
    console.log('└──────────────────────────────────────────┘');
    
    const mongoFeedback = await MongoFeedback.find({});
    console.log(`   MongoDB: ${mongoFeedback.length} feedback items`);
    
    let migrated = 0, skipped = 0;
    
    for (const mFb of mongoFeedback) {
        const mongoId = mFb._id.toString();
        
        if (idMap.feedbacks.has(mongoId)) { skipped++; continue; }
        
        const studentOId = getOId('users', mFb.studentId);
        if (!studentOId) {
            console.log(`   ⏭️  Skipping feedback (student not mapped)`);
            skipped++;
            continue;
        }
        
        await execute(
            `INSERT INTO feedbacks (student_id, student_name, test_type, question_type, issue_description, status, admin_notes, admin_reply)
             VALUES (:studentId, :studentName, :testType, :questionType, :issueDescription, :status, :adminNotes, :adminReply)`,
            {
                studentId: studentOId,
                studentName: mFb.studentName || 'Unknown',
                testType: mFb.testType || 'general',
                questionType: mFb.questionType || '',
                issueDescription: mFb.issueDescription || '',
                status: mFb.status || 'open',
                adminNotes: mFb.adminNotes || '',
                adminReply: mFb.adminReply || ''
            }
        );
        
        const idResult = await execute(`SELECT feedbacks_seq.CURRVAL AS id FROM dual`);
        const oracleId = idResult.rows[0].ID;
        
        await storeMapping('feedbacks', mongoId, oracleId);
        migrated++;
    }
    
    console.log(`   📊 Feedback: ${migrated} migrated, ${skipped} skipped`);
}

// ============================================================
// Phase 6: NOTIFICATIONS
// ============================================================
async function migrateNotifications() {
    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│  PHASE 6: Notifications                  │');
    console.log('└──────────────────────────────────────────┘');
    
    const mongoNotifications = await MongoNotification.find({});
    console.log(`   MongoDB: ${mongoNotifications.length} notifications`);
    
    let migrated = 0, skipped = 0;
    
    for (const mNotif of mongoNotifications) {
        const mongoId = mNotif._id.toString();
        
        if (idMap.notifications.has(mongoId)) { skipped++; continue; }
        
        const userOId = getOId('users', mNotif.userId);
        if (!userOId) {
            skipped++;
            continue;
        }
        
        // Map relatedId if present
        let relatedOId = null;
        if (mNotif.relatedId) {
            // Try to find the relatedId in various collections
            relatedOId = getOId('tests', mNotif.relatedId) 
                      || getOId('feedbacks', mNotif.relatedId)
                      || getOId('submissions', mNotif.relatedId)
                      || null;
        }
        
        await execute(
            `INSERT INTO notifications (user_id, type, title, message, related_id, is_read)
             VALUES (:userId, :type, :title, :message, :relatedId, :isRead)`,
            {
                userId: userOId,
                type: mNotif.type || 'general',
                title: mNotif.title || '',
                message: mNotif.message || '',
                relatedId: relatedOId,
                isRead: mNotif.isRead ? 1 : 0
            }
        );
        
        const idResult = await execute(`SELECT notifications_seq.CURRVAL AS id FROM dual`);
        const oracleId = idResult.rows[0].ID;
        
        await storeMapping('notifications', mongoId, oracleId);
        migrated++;
        
        if (migrated % 50 === 0) console.log(`   ✅ Migrated ${migrated} notifications...`);
    }
    
    console.log(`   📊 Notifications: ${migrated} migrated, ${skipped} skipped`);
}

// ============================================================
// Final: Fix all remaining FKs after all data is migrated
// ============================================================
async function fixRemainingFKs() {
    console.log('\n┌──────────────────────────────────────────┐');
    console.log('│  FINAL: Fix remaining FKs                │');
    console.log('└──────────────────────────────────────────┘');
    
    // Re-run user FKs (teacherId, groupId) - now all groups are migrated
    console.log('   🔗 Updating user → teacher & group FKs...');
    for (const [mongoId, oracleId] of idMap.users) {
        // We need the original MongoDB user data to get teacherId/groupId
        // Load from mapping - we'll query Oracle for missing FKs and fix from MongoDB
    }
    
    // Actually, let's query MongoDB again and fix all users whose FK might have been missed
    const mongoUsers = await MongoUser.find({});
    let fixedUsers = 0;
    
    for (const mUser of mongoUsers) {
        const oracleId = getOId('users', mUser._id);
        if (!oracleId) continue;
        
        let needsUpdate = false;
        const binds = { id: oracleId };
        const setClauses = [];
        
        if (mUser.teacherId) {
            const teacherOId = getOId('users', mUser.teacherId);
            if (teacherOId) {
                setClauses.push('teacher_id = :tid');
                binds.tid = teacherOId;
                needsUpdate = true;
            }
        }
        if (mUser.groupId) {
            const groupOId = getOId('groups', mUser.groupId);
            if (groupOId) {
                setClauses.push('group_id = :gid');
                binds.gid = groupOId;
                needsUpdate = true;
            }
        }
        
        if (needsUpdate) {
            await execute(
                `UPDATE users SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
                binds
            );
            fixedUsers++;
        }
        
        // Fix user_assigned_tests again (in case tests were just migrated)
        if (mUser.assignedTests && mUser.assignedTests.length > 0) {
            for (const testMongoId of mUser.assignedTests) {
                const testOId = getOId('tests', testMongoId);
                if (testOId) {
                    try {
                        await execute(
                            `INSERT INTO user_assigned_tests (user_id, test_id)
                             SELECT :uid, :tid FROM dual
                             WHERE NOT EXISTS (
                                 SELECT 1 FROM user_assigned_tests
                                 WHERE user_id = :uid2 AND test_id = :tid2
                             )`,
                            { uid: oracleId, tid: testOId, uid2: oracleId, tid2: testOId }
                        );
                    } catch (err) {
                        // Ignore dupes
                    }
                }
            }
        }
    }
    console.log(`   ✅ Fixed ${fixedUsers} user FKs`);
}

// ============================================================
// Summary Report
// ============================================================
async function printSummary() {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║          MIGRATION SUMMARY               ║');
    console.log('╚══════════════════════════════════════════╝');
    
    const counts = await execute(`
        SELECT 
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM tests) AS tests,
            (SELECT COUNT(*) FROM groups) AS groups,
            (SELECT COUNT(*) FROM submissions) AS submissions,
            (SELECT COUNT(*) FROM feedbacks) AS feedbacks,
            (SELECT COUNT(*) FROM notifications) AS notifications,
            (SELECT COUNT(*) FROM id_mapping) AS id_mappings
        FROM dual
    `);
    
    const row = counts.rows[0];
    console.log(`   Oracle users:         ${row.USERS}`);
    console.log(`   Oracle tests:         ${row.TESTS}`);
    console.log(`   Oracle groups:        ${row.GROUPS}`);
    console.log(`   Oracle submissions:   ${row.SUBMISSIONS}`);
    console.log(`   Oracle feedbacks:     ${row.FEEDBACKS}`);
    console.log(`   Oracle notifications: ${row.NOTIFICATIONS}`);
    console.log(`   ID mappings stored:   ${row.ID_MAPPINGS}`);
    
    console.log('\n   MongoDB data is preserved (not deleted).');
    console.log('   You can run this script again safely — it is idempotent.');
}

// ============================================================
// Full Reset (optional)
// ============================================================
async function fullReset() {
    console.log('\n⚠️  FULL RESET: Clearing all Oracle data...');
    
    const tables = [
        'group_test_schedule', 'group_assigned_tests', 'group_students',
        'user_assigned_tests', 'id_mapping',
        'notifications', 'feedbacks', 'submissions',
        'tests', 'users', 'groups'
    ];
    
    for (const table of tables) {
        try {
            await execute(`DELETE FROM ${table}`);
            console.log(`   🗑️  Cleared ${table}`);
        } catch (err) {
            if (!err.message.includes('ORA-00942')) {
                console.warn(`   ⚠️  Could not clear ${table}: ${err.message}`);
            }
        }
    }
    
    // Reset sequences
    const sequences = ['users_seq', 'tests_seq', 'groups_seq', 'submissions_seq', 'feedbacks_seq', 'notifications_seq', 'test_schedule_seq'];
    for (const seq of sequences) {
        try {
            // Drop and recreate to reset
            await execute(`DROP SEQUENCE ${seq}`);
            await execute(`CREATE SEQUENCE ${seq} START WITH 1 INCREMENT BY 1 NOCACHE`);
            console.log(`   🔄 Reset sequence ${seq}`);
        } catch (err) {
            console.warn(`   ⚠️  Could not reset ${seq}: ${err.message}`);
        }
    }
    
    // Clear in-memory cache
    for (const key of Object.keys(idMap)) {
        idMap[key].clear();
    }
    
    console.log('   ✅ Full reset complete\n');
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    const startTime = Date.now();
    
    try {
        const fullResetRequested = process.argv.includes('--full-reset');
        
        console.log('╔══════════════════════════════════════════╗');
        console.log('║  MongoDB → OracleDB Restoration Tool    ║');
        console.log('╚══════════════════════════════════════════╝');
        console.log(`   Mode: ${fullResetRequested ? 'FULL RESET + MIGRATION' : 'SYNC ONLY (idempotent)'}`);
        
        // --- Connect to MongoDB ---
        console.log('\n🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 30000
        });
        console.log('✅ Connected to MongoDB');
        
        // --- Connect to Oracle ---
        console.log('🔌 Connecting to Oracle DB...');
        const pool = await getPool();
        console.log('✅ Connected to Oracle DB');
        
        // --- Ensure id_mapping table exists ---
        await ensureIdMappingTable();
        
        // --- Optional full reset ---
        if (fullResetRequested) {
            await fullReset();
        }
        
        // --- Load existing mappings ---
        await loadIdMappings();
        
        // --- Run migration phases ---
        await migrateUsers();
        await migrateTests();
        await migrateGroups();
        await migrateSubmissions();
        await migrateFeedback();
        await migrateNotifications();
        await fixRemainingFKs();
        
        // --- Summary ---
        await printSummary();
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n⏱️  Total time: ${elapsed}s`);
        console.log('✅ Migration completed successfully!\n');
        
    } catch (err) {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    } finally {
        try {
            if (mongoose.connection.readyState === 1) {
                await mongoose.connection.close();
                console.log('🔌 Disconnected from MongoDB');
            }
        } catch {}
        try {
            await closePool();
            console.log('🔌 Disconnected from Oracle DB');
        } catch {}
        process.exit(0);
    }
}

main();
