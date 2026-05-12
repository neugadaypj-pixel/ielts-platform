/**
 * Diagnostic script to check listening test audio URLs
 */

const mongoose = require('mongoose');
require('dotenv').config();

const testSchema = new mongoose.Schema({}, { strict: false });
const Test = mongoose.model('Test', testSchema);

async function diagnose() {
    try {
        console.log('🔍 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected\n');

        console.log('📊 Fetching listening tests...');
        const listeningTests = await Test.find({ type: 'listening' }).limit(5);
        
        console.log(`Found ${listeningTests.length} listening test(s)\n`);
        
        for (const test of listeningTests) {
            console.log('━'.repeat(60));
            console.log(`Test: ${test.title}`);
            console.log(`ID: ${test._id}`);
            console.log(`Type: ${test.type}`);
            
            // Check readingPassage field (where listening audio is stored)
            if (test.readingPassage) {
                console.log('\n📦 Raw readingPassage field:');
                console.log(test.readingPassage.substring(0, 500));
                
                try {
                    const parsed = JSON.parse(test.readingPassage);
                    console.log('\n🎵 Audio URLs:');
                    console.log('  Full Audio:', parsed.fullAudio || 'null');
                    console.log('  Audio Parts:', parsed.audioParts || 'null');
                    
                    if (parsed.audio) {
                        console.log('  Audio Object:', parsed.audio);
                    }
                } catch (e) {
                    console.log('  ⚠️  Could not parse as JSON');
                }
            } else {
                console.log('  ⚠️  No readingPassage field');
            }
            
            // Check content field
            if (test.content) {
                console.log('\n📦 Content field type:', typeof test.content);
                if (typeof test.content === 'string') {
                    try {
                        const parsed = JSON.parse(test.content);
                        if (parsed.fullAudio || parsed.audioParts) {
                            console.log('  Full Audio:', parsed.fullAudio);
                            console.log('  Audio Parts:', parsed.audioParts);
                        }
                    } catch (e) {
                        console.log('  Not JSON');
                    }
                }
            }
            console.log('');
        }
        
        console.log('━'.repeat(60));
        console.log('\n✅ Diagnosis complete!');
        
        await mongoose.connection.close();
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

diagnose();
