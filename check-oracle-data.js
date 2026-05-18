require('dotenv').config();
const User = require('./database/models/user');
const Test = require('./database/models/test');
const Group = require('./database/models/group');

async function checkData() {
    try {
        const users = await User.find({});
        const tests = await Test.find({});
        const groups = await Group.find({});
        
        console.log('📊 Oracle DB Data Count:');
        console.log(`   Users: ${users.length}`);
        console.log(`   Tests: ${tests.length}`);
        console.log(`   Groups: ${groups.length}`);
        
        if (users.length > 0) {
            console.log('\n✅ Oracle DB has data! Ready to deploy to Render.');
        } else {
            console.log('\n⚠️  Oracle DB is empty. Need to migrate from MongoDB.');
        }
        
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

checkData();
