#!/usr/bin/env node
/**
 * MongoDB Backup Script
 * 
 * Usage:
 *   node backup-database.js
 * 
 * Creates a backup in ./backups/ folder with timestamp
 * 
 * To schedule daily backups on Windows:
 *   1. Open Task Scheduler
 *   2. Create Basic Task
 *   3. Set trigger to Daily at 2 AM
 *   4. Action: Start a program
 *   5. Program: node
 *   6. Arguments: backup-database.js
 *   7. Start in: C:\Users\user\Desktop\web\test-platform
 */

require('dotenv').config();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, 'backups');
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ MONGO_URI not found in .env file');
    process.exit(1);
}

// Create backups directory if it doesn't exist
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}`);

console.log('🔄 Starting MongoDB backup...');
console.log(`📁 Backup location: ${backupPath}`);

// Extract database name from URI
const dbMatch = MONGO_URI.match(/\/([^/?]+)(\?|$)/);
const dbName = dbMatch ? dbMatch[1] : 'testPlatform';

const command = `mongodump --uri="${MONGO_URI}" --out="${backupPath}"`;

exec(command, (error, stdout, stderr) => {
    if (error) {
        console.error('❌ Backup failed:', error.message);
        console.error('💡 Make sure MongoDB tools are installed: https://www.mongodb.com/try/download/database-tools');
        process.exit(1);
    }

    if (stderr) {
        console.log('⚠️  Warnings:', stderr);
    }

    console.log('✅ Backup completed successfully!');
    console.log(`📦 Backup saved to: ${backupPath}`);
    
    // Clean up old backups (keep last 7 days)
    const files = fs.readdirSync(BACKUP_DIR);
    const backupFolders = files
        .filter(f => f.startsWith('backup-'))
        .map(f => ({ name: f, path: path.join(BACKUP_DIR, f), time: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
        .sort((a, b) => b.time - a.time);

    if (backupFolders.length > 7) {
        console.log('🧹 Cleaning up old backups...');
        backupFolders.slice(7).forEach(folder => {
            fs.rmSync(folder.path, { recursive: true, force: true });
            console.log(`   Deleted: ${folder.name}`);
        });
    }

    console.log('✨ Done!');
});
