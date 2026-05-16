const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { execute, getConnection, getPool, closePool } = require('./database/connection');
require('dotenv').config();

// Initialize B2 client
const s3 = new S3Client({
    endpoint: process.env.B2_ENDPOINT,
    region: 'us-west-004',
    credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APP_KEY
    },
    forcePathStyle: true
});

/**
 * BACKUP FUNCTION
 * Exports all Oracle tables to JSON and uploads to Backblaze B2
 */
async function backupDatabase(options = {}) {
    try {
        console.log('🔄 Starting Oracle database backup...');

        // Fetch all tables in parallel
        const [
            users, tests, groups, submissions, feedbacks, notifications,
            userAssignedTests, groupStudents, groupAssignedTests, groupTestSchedule,
            userCount, testCount, groupCount, submissionCount, feedbackCount, notificationCount
        ] = await Promise.all([
            execute('SELECT * FROM users').then(r => r.rows),
            execute('SELECT * FROM tests').then(r => r.rows),
            execute('SELECT * FROM groups').then(r => r.rows),
            execute('SELECT * FROM submissions').then(r => r.rows),
            execute('SELECT * FROM feedbacks').then(r => r.rows),
            execute('SELECT * FROM notifications').then(r => r.rows),
            execute('SELECT * FROM user_assigned_tests').then(r => r.rows),
            execute('SELECT * FROM group_students').then(r => r.rows),
            execute('SELECT * FROM group_assigned_tests').then(r => r.rows),
            execute('SELECT * FROM group_test_schedule').then(r => r.rows),
            execute('SELECT COUNT(*) AS cnt FROM users').then(r => r.rows[0].CNT),
            execute('SELECT COUNT(*) AS cnt FROM tests').then(r => r.rows[0].CNT),
            execute('SELECT COUNT(*) AS cnt FROM groups').then(r => r.rows[0].CNT),
            execute('SELECT COUNT(*) AS cnt FROM submissions').then(r => r.rows[0].CNT),
            execute('SELECT COUNT(*) AS cnt FROM feedbacks').then(r => r.rows[0].CNT),
            execute('SELECT COUNT(*) AS cnt FROM notifications').then(r => r.rows[0].CNT),
        ]);

        // Build backup data
        const backupData = {
            timestamp: new Date().toISOString(),
            version: '2.0-oracle',
            collections: {
                users,
                tests,
                groups,
                submissions,
                feedbacks,
                notifications,
                user_assigned_tests: userAssignedTests,
                group_students: groupStudents,
                group_assigned_tests: groupAssignedTests,
                group_test_schedule: groupTestSchedule
            },
            stats: {
                users: userCount,
                tests: testCount,
                groups: groupCount,
                submissions: submissionCount,
                feedbacks: feedbackCount,
                notifications: notificationCount
            }
        };

        console.log('📊 Backup statistics:');
        console.log(`   Users: ${userCount}`);
        console.log(`   Tests: ${testCount}`);
        console.log(`   Groups: ${groupCount}`);
        console.log(`   Submissions: ${submissionCount}`);
        console.log(`   Feedback: ${feedbackCount}`);
        console.log(`   Notifications: ${notificationCount}`);

        // Convert to JSON
        const jsonData = JSON.stringify(backupData, null, 2);
        const buffer = Buffer.from(jsonData, 'utf-8');

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backups/database-backup-${timestamp}.json`;

        // Upload to Backblaze B2
        await s3.send(new PutObjectCommand({
            Bucket: process.env.B2_BUCKET,
            Key: filename,
            Body: buffer,
            ContentType: 'application/json'
        }));

        console.log(`✅ Backup uploaded to B2: ${filename}`);
        console.log(`📦 Backup size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

        // Clean up old backups (keep last 7 days)
        await cleanupOldBackups();

        console.log('✅ Backup completed successfully!');

        return { success: true, filename, size: buffer.length };
    } catch (error) {
        console.error('❌ Backup failed:', error.message);
        throw error;
    }
}

/**
 * CLEANUP OLD BACKUPS
 * Keeps only the last 7 backups, deletes older ones
 */
async function cleanupOldBackups() {
    try {
        console.log('🧹 Cleaning up old backups...');

        const response = await s3.send(new ListObjectsV2Command({
            Bucket: process.env.B2_BUCKET,
            Prefix: 'backups/database-backup-'
        }));

        if (!response.Contents || response.Contents.length <= 7) {
            console.log('✅ No old backups to delete');
            return;
        }

        // Sort by date (oldest first)
        const backups = response.Contents.sort((a, b) =>
            new Date(a.LastModified) - new Date(b.LastModified)
        );

        // Keep last 7, delete the rest
        const toDelete = backups.slice(0, -7);

        console.log(`🗑️  Deleting ${toDelete.length} old backups...`);

        // Delete old backups one by one
        for (const backup of toDelete) {
            try {
                await s3.send(new DeleteObjectCommand({
                    Bucket: process.env.B2_BUCKET,
                    Key: backup.Key
                }));
                console.log(`   ✅ Deleted: ${backup.Key}`);
            } catch (delErr) {
                console.error(`   ⚠️  Failed to delete ${backup.Key}:`, delErr.message);
            }
        }

        console.log('✅ Cleanup completed');
    } catch (error) {
        console.error('⚠️  Cleanup warning:', error.message);
    }
}

/**
 * RESTORE FUNCTION
 * Downloads backup from B2 and restores to Oracle
 *
 * USAGE:
 * node backup-database-oracle.js restore database-backup-2024-01-15T10-30-00-000Z.json
 */
async function restoreDatabase(backupFilename) {
    try {
        console.log('🔄 Starting database restore...');
        console.log(`📥 Downloading backup: ${backupFilename}`);

        // Download backup from B2
        const response = await s3.send(new GetObjectCommand({
            Bucket: process.env.B2_BUCKET,
            Key: `backups/${backupFilename}`
        }));

        // Read the stream
        const chunks = [];
        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }
        const jsonData = Buffer.concat(chunks).toString('utf-8');
        const backupData = JSON.parse(jsonData);

        console.log('✅ Backup downloaded successfully');
        console.log(`📅 Backup date: ${backupData.timestamp}`);

        // WARNING: This will DELETE all existing data!
        console.log('⚠️  WARNING: This will DELETE all existing data!');
        console.log('⚠️  Press Ctrl+C within 5 seconds to cancel...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        const conn = await getConnection();
        try {
            // Clear existing data in reverse dependency order (child tables first)
            console.log('🗑️  Clearing existing data...');
            await conn.execute('DELETE FROM group_test_schedule');
            await conn.execute('DELETE FROM group_assigned_tests');
            await conn.execute('DELETE FROM group_students');
            await conn.execute('DELETE FROM user_assigned_tests');
            await conn.execute('DELETE FROM notifications');
            await conn.execute('DELETE FROM feedbacks');
            await conn.execute('DELETE FROM submissions');
            await conn.execute('DELETE FROM tests');
            await conn.execute('DELETE FROM groups');
            await conn.execute('DELETE FROM users');
            await conn.execute('COMMIT');

            console.log('📥 Restoring data...');

            // Helper: insert rows preserving original IDs
            async function restoreTable(tableName, rows, idColumn = 'ID') {
                if (!rows || rows.length === 0) return 0;

                for (const row of rows) {
                    const columns = Object.keys(row);
                    const bindNames = columns.map(c => `:${c}`);
                    const colNames = columns.map(c => `"${c}"`);
                    const binds = {};
                    for (const c of columns) {
                        // Oracle bind names can't have dots or special chars in keys
                        // Use sanitized key names
                        const bindKey = c.replace(/[^a-zA-Z0-9_]/g, '_');
                        binds[bindKey] = row[c];
                    }
                    // Rebuild the SQL with proper bind references
                    const bindRefs = columns.map(c => `:${c.replace(/[^a-zA-Z0-9_]/g, '_')}`);
                    const sql = `INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${bindRefs.join(', ')})`;
                    try {
                        await conn.execute(sql, binds);
                    } catch (insertErr) {
                        console.error(`   ⚠️  Failed to insert row into ${tableName}:`, insertErr.message);
                    }
                }
                await conn.execute('COMMIT');
                return rows.length;
            }

            let count = 0;
            count += await restoreTable('users', backupData.collections.users);
            console.log(`   ✅ Users: ${count}`);

            const testCount = await restoreTable('tests', backupData.collections.tests);
            console.log(`   ✅ Tests: ${testCount}`);

            const groupCount = await restoreTable('groups', backupData.collections.groups);
            console.log(`   ✅ Groups: ${groupCount}`);

            const subCount = await restoreTable('submissions', backupData.collections.submissions);
            console.log(`   ✅ Submissions: ${subCount}`);

            const fbCount = await restoreTable('feedbacks', backupData.collections.feedbacks);
            console.log(`   ✅ Feedback: ${fbCount}`);

            const notifCount = await restoreTable('notifications', backupData.collections.notifications);
            console.log(`   ✅ Notifications: ${notifCount}`);

            if (backupData.collections.user_assigned_tests) {
                await restoreTable('user_assigned_tests', backupData.collections.user_assigned_tests);
                console.log(`   ✅ user_assigned_tests`);
            }
            if (backupData.collections.group_students) {
                await restoreTable('group_students', backupData.collections.group_students);
                console.log(`   ✅ group_students`);
            }
            if (backupData.collections.group_assigned_tests) {
                await restoreTable('group_assigned_tests', backupData.collections.group_assigned_tests);
                console.log(`   ✅ group_assigned_tests`);
            }
            if (backupData.collections.group_test_schedule) {
                await restoreTable('group_test_schedule', backupData.collections.group_test_schedule);
                console.log(`   ✅ group_test_schedule`);
            }

            await conn.execute('COMMIT');
        } finally {
            await conn.close();
        }

        console.log('✅ Restore completed successfully!');
        return { success: true };
    } catch (error) {
        console.error('❌ Restore failed:', error.message);
        throw error;
    }
}

/**
 * LIST AVAILABLE BACKUPS
 * Shows all backups stored in B2
 */
async function listBackups() {
    try {
        console.log('📋 Listing available backups...\n');

        const response = await s3.send(new ListObjectsV2Command({
            Bucket: process.env.B2_BUCKET,
            Prefix: 'backups/database-backup-'
        }));

        if (!response.Contents || response.Contents.length === 0) {
            console.log('No backups found.');
            return;
        }

        // Sort by date (newest first)
        const backups = response.Contents.sort((a, b) =>
            new Date(b.LastModified) - new Date(a.LastModified)
        );

        console.log('Available backups:\n');
        backups.forEach((backup, index) => {
            const filename = backup.Key.replace('backups/', '');
            const date = new Date(backup.LastModified).toLocaleString();
            const size = (backup.Size / 1024 / 1024).toFixed(2);
            console.log(`${index + 1}. ${filename}`);
            console.log(`   Date: ${date}`);
            console.log(`   Size: ${size} MB\n`);
        });

        console.log(`Total backups: ${backups.length}`);
    } catch (error) {
        console.error('❌ Failed to list backups:', error.message);
    }
}

// Command line interface
if (require.main === module) {
    const command = process.argv[2];
    const argument = process.argv[3];

    if (command === 'backup') {
        backupDatabase()
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    } else if (command === 'restore' && argument) {
        restoreDatabase(argument)
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    } else if (command === 'list') {
        listBackups()
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    } else {
        console.log(`
📦 Oracle Database Backup & Restore Tool

USAGE:
  node backup-database-oracle.js backup              - Create a new backup
  node backup-database-oracle.js list                - List all available backups
  node backup-database-oracle.js restore <filename>  - Restore from backup

EXAMPLES:
  node backup-database-oracle.js backup
  node backup-database-oracle.js list
  node backup-database-oracle.js restore database-backup-2024-01-15T10-30-00-000Z.json

AUTOMATED BACKUPS:
  Backups run automatically every day at 2 AM (configured in server-oracle.js)
  Last 7 backups are kept, older ones are deleted automatically

BACKUP LOCATION:
  Backups are stored in Backblaze B2: ${process.env.B2_BUCKET}/backups/
    `);
        process.exit(0);
    }
}

module.exports = { backupDatabase, restoreDatabase, listBackups };
