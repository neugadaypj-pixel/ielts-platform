# Deploy to Render with Oracle Database

## ✅ What's Ready:
- `server-oracle.js` is now the main entry point
- Oracle wallet files are in the repository
- Oracle DB has all your data (29 users, 15 tests, 2 groups)
- All dependencies are configured

## 🚀 Deployment Steps:

### Step 1: Go to Render Dashboard
https://dashboard.render.com

### Step 2: Find Your Service
Click on your `ielts-platform` service

### Step 3: Add Environment Variables

Go to **Environment** tab and add these:

```
DB_USER=IELTS_APP
DB_PASSWORD=IeltsApp@2026#Secure
DB_CONNECT_STRING=testplatform_high
TNS_ADMIN=/opt/render/project/src/wallet
```

**Important:** Make sure to use the exact values above!

### Step 4: Trigger Redeploy

1. Go to **Manual Deploy** section
2. Click **"Deploy latest commit"**
3. Wait for deployment to complete (2-5 minutes)

### Step 5: Check Logs

After deployment:
1. Go to **Logs** tab
2. Look for:
   ```
   ✅ Oracle DB connection pool created
   ✅ Oracle database connected successfully
   ✅ Server running on port 3000
   ```

### Step 6: Test the Site

1. Go to your Render URL: `https://ielts-platform-63xw.onrender.com`
2. Try logging in
3. Should work fast now (no more slow loading!)

## 🔧 Troubleshooting:

### If you see "Cannot find module 'oracledb'":
- The deployment should auto-install it from package.json
- Check the build logs for npm install errors

### If you see "Cannot locate Oracle Client library":
- This is normal on first deploy
- Render needs to install Oracle Instant Client
- May need to add a build script (see below)

### If Oracle connection fails:
- Check environment variables are set correctly
- Make sure TNS_ADMIN points to `/opt/render/project/src/wallet`
- Wallet files should be in the repository

## 📝 Build Script (If Needed):

If Render can't find Oracle client, you may need to add a build script.

Create `render-build.sh`:
```bash
#!/bin/bash
# Install Oracle Instant Client
wget https://download.oracle.com/otn_software/linux/instantclient/2340000/instantclient-basic-linux.x64-23.4.0.24.05.zip
unzip instantclient-basic-linux.x64-23.4.0.24.05.zip
export LD_LIBRARY_PATH=/opt/render/project/src/instantclient_23_4:$LD_LIBRARY_PATH

# Install dependencies
npm install
```

Then in Render dashboard:
- Build Command: `./render-build.sh`
- Start Command: `npm start`

## ✅ What Will Happen:

**Before (MongoDB on Render):**
- Slow loading times
- 512MB RAM limit
- Auto-sleep on free tier

**After (Oracle DB):**
- Fast loading (Oracle DB is on dedicated server)
- No RAM issues (database is external)
- Better performance overall

## 🎯 Summary:

1. ✅ Code is ready (server-oracle.js)
2. ✅ Wallet is in repo
3. ✅ Data is in Oracle DB
4. ⏳ Just need to add env vars and redeploy

**Estimated time:** 5-10 minutes

## 🆘 Need Help?

If deployment fails, check:
1. Render logs for error messages
2. Environment variables are correct
3. Wallet files are in the repo
4. Oracle DB is accessible from internet

The Oracle DB should be accessible because your Oracle server (synergyacademy.duckdns.org) can connect to it!
