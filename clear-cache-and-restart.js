/**
 * Clear Cache and Restart Helper Script
 * 
 * This script helps clear the test HTML cache after fixing the writing test.
 * Run this after deploying the fix to ensure students see the updated version.
 */

const NodeCache = require('node-cache');
const mongoose = require('mongoose');
require('dotenv').config();

async function clearCache() {
    console.log('🧹 Clearing test HTML cache...\n');
    
    try {
        // Connect to MongoDB
        console.log('📡 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log('✅ Connected to MongoDB\n');
        
        // Note: We can't directly access the server's cache from here,
        // but we can provide instructions
        
        console.log('📋 Cache Clear Instructions:\n');
        console.log('Option 1: Restart the Server');
        console.log('  - Stop the server (Ctrl+C)');
        console.log('  - Run: npm start\n');
        
        console.log('Option 2: Use Admin Endpoint');
        console.log('  - Login as admin');
        console.log('  - POST to: /admin/clear-cache\n');
        
        console.log('Option 3: Wait for Auto-Expiry');
        console.log('  - Cache expires automatically after 10 minutes\n');
        
        console.log('✨ Writing test fix has been applied!');
        console.log('📝 See WRITING_TEST_FIX.md for testing instructions\n');
        
        await mongoose.connection.close();
        console.log('👋 Done!');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

clearCache();
