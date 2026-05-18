/**
 * Migrate data from MongoDB to Oracle DB
 * Run this script to copy all data from MongoDB to Oracle
 */

require('dotenv').config();
const mongoose = require('mongoose');
const oracledb = require('oracledb');

// MongoDB Models
const MongoUser = require('./models/User');
const MongoTest = require('./models/Test');
const MongoGroup = require('./models/Group');
const MongoSubmission = require('./models/Submission');
const MongoFeedback = require('./models/Feedback');
const MongoNotification = require('./models/Notification');

// Oracle Models
const OracleUser = require('./database/models/user');
const OracleTest = require('./database/models/test');
const OracleGroup = require('./database/models/group');
const OracleSubmission = require('./database/models/submission');
const OracleFeedback = require('./database/models/feedback');
const OracleNotification = require('./database/models/notification');

let oraclePool = null;

async function connectMongoDB() {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000
    });
    console.log('✅ Connected to MongoDB');
}

async function connectOracle() {
    console.log('🔌 Connecting to Oracle DB...');
    
    try {
        oracledb.initOracleClient();
    } catch (err) {
        if (!err.message.includes('already been initialized')) {
            throw err;
        }
    }
    
    oraclePool = await oracledb.createPool({
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
        connectString: process.env.ORACLE_CONNECT_STRING,
        poolMin: 2,
        poolMax: 10
    });
    
    console.log('✅ Connected to Oracle DB');
}

async function migrateUsers() {
    console.log('\n📦 Migrating Users...');
    const mongoUsers = await MongoUser.find({});
    console.log(`   Found ${mongoUsers.length} users in MongoDB`);
    
    let migrated = 0;
    let skipped = 0;
    
    for (const user of mongoUsers) {
        try {
            // Check if user already exists in Oracle
            const existing = await OracleUser.findById(user._id.toString());
            if (existing) {
                console.log(`   ⏭️  Skipping user ${user.username} (already exists)`);
                skipped++;
                continue;
            }
            
            // Create user in Oracle
            await OracleUser.create({
                _id: user._id.toString(),
                username: user.username,
                password: user.password,
                role: user.role,
                teacherId: user.teacherId ? user.teacherId.toString() : null,
                assignedTests: user.assignedTests ? user.assignedTests.map(id => id.toString()) : [],
                groupId: user.groupId ? user.groupId.toString() : null,
                createdAt: user.createdAt || new Date(),
                updatedAt: user.updatedAt || new Date()
            });
            
            migrated++;
            console.log(`   ✅ Migrated user: ${user.username}`);
        } catch (err) {
            console.error(`   ❌ Failed to migrate user ${user.username}:`, err.message);
        }
    }
    
    console.log(`   📊 Users: ${migrated} migrated, ${skipped} skipped`);
}

async function migrateTests() {
    console.log('\n📦 Migrating Tests...');
    const mongoTests = await MongoTest.find({});
    console.log(`   Found ${mongoTests.length} tests in MongoDB`);
    
    let migrated = 0;
    let skipped = 0;
    
    for (const test of mongoTests) {
        try {
            const existing = await OracleTest.findById(test._id.toString());
            if (existing) {
                console.log(`   ⏭️  Skipping test ${test.title} (already exists)`);
                skipped++;
                continue;
            }
            
            await OracleTest.create({
                _id: test._id.toString(),
                title: test.title,
                type: test.type,
                readingPassage: test.readingPassage || '',
                questions: test.questions || '',
                answerKey: test.answerKey || '',
                createdBy: test.createdBy ? test.createdBy.toString() : null,
                timeLimit: test.timeLimit || 60,
                createdAt: test.createdAt || new Date(),
                updatedAt: test.updatedAt || new Date()
            });
            
            migrated++;
            console.log(`   ✅ Migrated test: ${test.title}`);
        } catch (err) {
            console.error(`   ❌ Failed to migrate test ${test.title}:`, err.message);
        }
    }
    
    console.log(`   📊 Tests: ${migrated} migrated, ${skipped} skipped`);
}

async function migrateGroups() {
    console.log('\n📦 Migrating Groups...');
    const mongoGroups = await MongoGroup.find({});
    console.log(`   Found ${mongoGroups.length} groups in MongoDB`);
    
    let migrated = 0;
    let skipped = 0;
    
    for (const group of mongoGroups) {
        try {
            const existing = await OracleGroup.findById(group._id.toString());
            if (existing) {
                console.log(`   ⏭️  Skipping group ${group.name} (already exists)`);
                skipped++;
                continue;
            }
            
            await OracleGroup.create({
                _id: group._id.toString(),
                name: group.name,
                teacherId: group.teacherId ? group.teacherId.toString() : null,
                assignedTests: group.assignedTests ? group.assignedTests.map(id => id.toString()) : [],
                testSchedule: group.testSchedule || [],
                createdAt: group.createdAt || new Date(),
                updatedAt: group.updatedAt || new Date()
            });
            
            migrated++;
            console.log(`   ✅ Migrated group: ${group.name}`);
        } catch (err) {
            console.error(`   ❌ Failed to migrate group ${group.name}:`, err.message);
        }
    }
    
    console.log(`   📊 Groups: ${migrated} migrated, ${skipped} skipped`);
}

async function migrateSubmissions() {
    console.log('\n📦 Migrating Submissions...');
    const mongoSubmissions = await MongoSubmission.find({});
    console.log(`   Found ${mongoSubmissions.length} submissions in MongoDB`);
    
    let migrated = 0;
    let skipped = 0;
    
    for (const submission of mongoSubmissions) {
        try {
            const existing = await OracleSubmission.findById(submission._id.toString());
            if (existing) {
                skipped++;
                continue;
            }
            
            await OracleSubmission.create({
                _id: submission._id.toString(),
                testId: submission.testId ? submission.testId.toString() : null,
                studentId: submission.studentId ? submission.studentId.toString() : null,
                studentName: submission.studentName || '',
                answers: submission.answers || '',
                score: submission.score || 0,
                totalQuestions: submission.totalQuestions || 0,
                timeTaken: submission.timeTaken || 0,
                aiAnalysis: submission.aiAnalysis || null,
                submittedAt: submission.submittedAt || new Date()
            });
            
            migrated++;
            if (migrated % 10 === 0) {
                console.log(`   ✅ Migrated ${migrated} submissions...`);
            }
        } catch (err) {
            console.error(`   ❌ Failed to migrate submission:`, err.message);
        }
    }
    
    console.log(`   📊 Submissions: ${migrated} migrated, ${skipped} skipped`);
}

async function migrateFeedback() {
    console.log('\n📦 Migrating Feedback...');
    const mongoFeedback = await MongoFeedback.find({});
    console.log(`   Found ${mongoFeedback.length} feedback items in MongoDB`);
    
    let migrated = 0;
    let skipped = 0;
    
    for (const feedback of mongoFeedback) {
        try {
            const existing = await OracleFeedback.findById(feedback._id.toString());
            if (existing) {
                skipped++;
                continue;
            }
            
            await OracleFeedback.create({
                _id: feedback._id.toString(),
                submissionId: feedback.submissionId ? feedback.submissionId.toString() : null,
                teacherId: feedback.teacherId ? feedback.teacherId.toString() : null,
                comments: feedback.comments || '',
                createdAt: feedback.createdAt || new Date()
            });
            
            migrated++;
            console.log(`   ✅ Migrated feedback item`);
        } catch (err) {
            console.error(`   ❌ Failed to migrate feedback:`, err.message);
        }
    }
    
    console.log(`   📊 Feedback: ${migrated} migrated, ${skipped} skipped`);
}

async function migrateNotifications() {
    console.log('\n📦 Migrating Notifications...');
    const mongoNotifications = await MongoNotification.find({});
    console.log(`   Found ${mongoNotifications.length} notifications in MongoDB`);
    
    let migrated = 0;
    let skipped = 0;
    
    for (const notification of mongoNotifications) {
        try {
            const existing = await OracleNotification.findById(notification._id.toString());
            if (existing) {
                skipped++;
                continue;
            }
            
            await OracleNotification.create({
                _id: notification._id.toString(),
                userId: notification.userId ? notification.userId.toString() : null,
                message: notification.message || '',
                type: notification.type || 'info',
                isRead: notification.isRead || false,
                createdAt: notification.createdAt || new Date()
            });
            
            migrated++;
            if (migrated % 50 === 0) {
                console.log(`   ✅ Migrated ${migrated} notifications...`);
            }
        } catch (err) {
            console.error(`   ❌ Failed to migrate notification:`, err.message);
        }
    }
    
    console.log(`   📊 Notifications: ${migrated} migrated, ${skipped} skipped`);
}

async function main() {
    try {
        console.log('🚀 Starting MongoDB to Oracle DB migration...\n');
        
        await connectMongoDB();
        await connectOracle();
        
        // Migrate in order (respecting foreign key relationships)
        await migrateUsers();
        await migrateTests();
        await migrateGroups();
        await migrateSubmissions();
        await migrateFeedback();
        await migrateNotifications();
        
        console.log('\n✅ Migration completed successfully!');
        console.log('\n📊 Summary:');
        console.log('   - All data has been copied from MongoDB to Oracle DB');
        console.log('   - MongoDB data is still intact (not deleted)');
        console.log('   - You can now deploy server-oracle.js to Render');
        
    } catch (err) {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    } finally {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
            console.log('\n🔌 Disconnected from MongoDB');
        }
        if (oraclePool) {
            await oraclePool.close(10);
            console.log('🔌 Disconnected from Oracle DB');
        }
        process.exit(0);
    }
}

main();
