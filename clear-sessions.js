require('dotenv').config();
const mongoose = require('mongoose');

async function clearSessions() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const db = mongoose.connection.db;
        const sessionsCollection = db.collection('sessions');

        console.log('🗑️  Clearing all sessions...');
        const result = await sessionsCollection.deleteMany({});
        console.log(`✅ Deleted ${result.deletedCount} sessions`);

        console.log('👥 All users will need to log in again after deployment');
        
        await mongoose.connection.close();
        console.log('✅ Database connection closed');
        console.log('🚀 Ready to deploy!');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing sessions:', error.message);
        process.exit(1);
    }
}

clearSessions();
