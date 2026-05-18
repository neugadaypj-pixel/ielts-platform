# Deploy to Oracle Server - Step by Step Guide

## Prerequisites
- SSH access to your Oracle server
- Server address: synergyacademy.duckdns.org
- Your SSH username and password/key

## Deployment Steps

### Step 1: Connect to Your Server

**Using Windows Terminal or PowerShell:**
```bash
ssh your-username@synergyacademy.duckdns.org
```

**Using PuTTY (if you prefer GUI):**
1. Open PuTTY
2. Host Name: `synergyacademy.duckdns.org`
3. Port: `22`
4. Click "Open"
5. Enter your username and password when prompted

### Step 2: Navigate to Your Application Directory

```bash
# Find where your app is located (common locations):
cd ~/test-platform
# OR
cd /home/your-username/test-platform
# OR
cd /var/www/test-platform

# Verify you're in the right place:
ls -la
# You should see: server-oracle.js, package.json, etc.
```

### Step 3: Pull the Latest Code

```bash
# Pull the latest changes from GitHub
git pull origin main
```

Expected output:
```
Updating 690a4a7..abc1234
Fast-forward
 server-oracle.js | 25 ++++++++++++++++++++-----
 server.js        | 35 +++++++++++++++++++++++++----------
 FIXES_SUMMARY.md | 150 ++++++++++++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 195 insertions(+), 15 deletions(-)
 create mode 100644 FIXES_SUMMARY.md
```

### Step 4: Install Dependencies (if needed)

```bash
# Only if package.json changed (it didn't in this case, but good practice):
npm install
```

### Step 5: Restart the Application

```bash
# Restart using PM2
pm2 restart server-oracle
```

Expected output:
```
[PM2] Applying action restartProcessId on app [server-oracle](ids: [ 0 ])
[PM2] [server-oracle](0) ✓
```

### Step 6: Verify It's Running

```bash
# Check PM2 status
pm2 status
```

You should see:
```
┌─────┬──────────────────┬─────────────┬─────────┬─────────┬──────────┐
│ id  │ name             │ mode        │ ↺       │ status  │ cpu      │
├─────┼──────────────────┼─────────────┼─────────┼─────────┼──────────┤
│ 0   │ server-oracle    │ fork        │ 15      │ online  │ 0%       │
└─────┴──────────────────┴─────────────┴─────────┴─────────┴──────────┘
```

### Step 7: Watch the Logs

```bash
# View real-time logs
pm2 logs server-oracle --lines 50
```

Look for:
```
✅ Oracle database connected successfully
✅ Server running on port 3000
```

### Step 8: Test the Login Fix

1. Open your browser
2. Go to: `http://synergyacademy.duckdns.org/login`
3. Try logging in with correct credentials
4. Should redirect to dashboard successfully!

## Troubleshooting

### If git pull fails:
```bash
# Check if you have uncommitted changes
git status

# If you have local changes, stash them:
git stash
git pull origin main
git stash pop
```

### If PM2 restart fails:
```bash
# Check PM2 processes
pm2 list

# If server-oracle doesn't exist, start it:
pm2 start server-oracle.js --name server-oracle

# Save PM2 configuration
pm2 save
```

### If you see errors in logs:
```bash
# View detailed error logs
pm2 logs server-oracle --err --lines 100

# Check if database is connected
pm2 logs server-oracle | grep -i "database"
```

### If port 3000 is already in use:
```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process if needed
pm2 delete server-oracle
pm2 start server-oracle.js --name server-oracle
```

## Quick Reference Commands

```bash
# Connect to server
ssh username@synergyacademy.duckdns.org

# Navigate to app
cd ~/test-platform  # or wherever your app is

# Deploy
git pull origin main
pm2 restart server-oracle

# Check status
pm2 status
pm2 logs server-oracle

# Disconnect from server
exit
```

## What Was Fixed

1. **Login Session Persistence** - Sessions now save properly before redirect
2. **Base64 Audio for Downloads** - Listening tests can be downloaded with embedded audio for offline use

## Testing the Fixes

### Test Login:
1. Go to: http://synergyacademy.duckdns.org/login
2. Try wrong password → Should show error message
3. Try correct password → Should login and redirect properly

### Test Audio Download:
1. Login as teacher/admin
2. Go to a listening test
3. Click download
4. Open the downloaded HTML file offline
5. Audio should play without internet!

## Need Help?

If you get stuck, check the logs:
```bash
pm2 logs server-oracle --lines 100
```

Or check nginx logs:
```bash
sudo tail -f /var/log/nginx/error.log
```
