# Session Management & Deployment Fix

## Problem
When you deploy/restart the server, users stay logged in because sessions are stored in MongoDB (not in memory). This means:
- Sessions persist across server restarts
- Users don't get kicked out on deployment
- Old sessions can accumulate

## Solution Implemented

### 1. Improved Session Configuration ✅

**Updated `server.js` session settings:**

```javascript
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({
        mongoUrl: process.env.MONGO_URI,
        touchAfter: 24 * 3600,
        ttl: 24 * 60 * 60,           // NEW: 24 hour TTL
        autoRemove: 'native'          // NEW: Auto-cleanup expired sessions
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,  // 24 hours
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // NEW: HTTPS in production
        sameSite: 'lax'
    },
    rolling: true,                    // NEW: Reset expiration on activity
    name: 'sessionId'                 // NEW: Custom cookie name
}));
```

**What Changed:**
- `ttl: 24 * 60 * 60` - Sessions expire after 24 hours
- `autoRemove: 'native'` - MongoDB automatically removes expired sessions
- `secure: process.env.NODE_ENV === 'production'` - HTTPS-only cookies in production
- `rolling: true` - Cookie expiration resets on each request (keeps active users logged in)
- `name: 'sessionId'` - Custom cookie name (better than default 'connect.sid')

### 2. Session Clearing Script ✅

**Created `clear-sessions.js`:**

This script connects to MongoDB and deletes all sessions, forcing all users to log in again.

**Usage:**

```bash
# Clear all sessions manually
npm run clear-sessions

# Or run directly
node clear-sessions.js
```

**Output:**
```
🔄 Connecting to MongoDB...
✅ Connected to MongoDB
🗑️  Clearing all sessions...
✅ Deleted 15 sessions
👥 All users will need to log in again after deployment
✅ Database connection closed
🚀 Ready to deploy!
```

### 3. Deployment Workflow

**Option A: Manual (Recommended for now)**
```bash
# Before deploying
npm run clear-sessions

# Then deploy/restart
npm start
```

**Option B: Automatic (Future)**
If you use a deployment platform (Heroku, Render, etc.), add this to your deploy script:
```json
"predeploy": "node clear-sessions.js"
```

---

## How Sessions Work Now

### Before Deployment
1. User logs in → Session created in MongoDB
2. Server restarts → Session still in MongoDB
3. User still logged in (cookie matches session)

### After This Fix
1. User logs in → Session created with 24h TTL
2. Run `npm run clear-sessions` → All sessions deleted
3. Server restarts → Users must log in again
4. Inactive sessions auto-expire after 24h

---

## Session Lifecycle

```
User Login
    ↓
Session Created (24h TTL)
    ↓
User Active → Rolling: true → TTL resets to 24h
    ↓
User Inactive for 24h → MongoDB auto-removes session
    ↓
User tries to access → Redirected to login
```

---

## Deployment Checklist

### Every Deployment:

1. **Clear Sessions** (kicks everyone out)
   ```bash
   npm run clear-sessions
   ```

2. **Deploy/Restart Server**
   ```bash
   npm start
   # or your deployment command
   ```

3. **Notify Users** (optional)
   - "Platform updated, please log in again"

### Why Clear Sessions?

- ✅ Forces users to get fresh session data
- ✅ Clears any corrupted sessions
- ✅ Ensures everyone uses new code/features
- ✅ Security best practice
- ✅ Prevents session-related bugs

---

## Session Storage

Sessions are stored in MongoDB collection: `sessions`

**View sessions in MongoDB:**
```javascript
db.sessions.find().pretty()
```

**Count active sessions:**
```javascript
db.sessions.countDocuments()
```

**Manually delete all sessions:**
```javascript
db.sessions.deleteMany({})
```

---

## Configuration Options

### Change Session Duration

Edit `server.js`:
```javascript
ttl: 12 * 60 * 60,  // 12 hours instead of 24
cookie: {
    maxAge: 1000 * 60 * 60 * 12  // Match TTL
}
```

### Disable Rolling Sessions

If you want sessions to expire exactly after 24h (no reset on activity):
```javascript
rolling: false  // Change to false
```

### Production HTTPS

The `secure` flag is now environment-aware:
- Development: `secure: false` (works with http://localhost)
- Production: `secure: true` (requires HTTPS)

Make sure `NODE_ENV=production` in your production environment.

---

## Troubleshooting

### Users Stay Logged In After Restart

**Cause**: Sessions still in MongoDB  
**Fix**: Run `npm run clear-sessions` before restart

### Sessions Expire Too Quickly

**Cause**: TTL too short or rolling disabled  
**Fix**: Increase TTL or enable `rolling: true`

### "Session not found" Errors

**Cause**: Session expired or cleared  
**Fix**: Normal behavior - user needs to log in again

### Cookie Not Setting in Production

**Cause**: `secure: true` but no HTTPS  
**Fix**: Enable HTTPS or set `NODE_ENV=development` for testing

---

## Security Improvements

1. **HTTPS-only cookies in production** - Prevents session hijacking
2. **httpOnly: true** - Prevents XSS attacks from stealing cookies
3. **sameSite: 'lax'** - Prevents CSRF attacks
4. **Custom cookie name** - Obscures session mechanism
5. **Auto-expiration** - Limits exposure window
6. **Rolling sessions** - Active users stay logged in, inactive users get logged out

---

## Best Practices

### Development
- Keep sessions for convenience
- Clear manually when testing auth changes

### Staging
- Clear sessions before testing
- Verify session expiration works

### Production
- **Always clear sessions on deployment**
- Monitor session count in MongoDB
- Set up alerts for unusual session counts
- Consider shorter TTL for sensitive apps

---

## Quick Commands

```bash
# Clear all sessions (kick everyone out)
npm run clear-sessions

# Start server
npm start

# Development with auto-restart
npm run dev

# Check session count (MongoDB shell)
db.sessions.countDocuments()

# View all sessions (MongoDB shell)
db.sessions.find().pretty()

# Delete expired sessions manually (MongoDB shell)
db.sessions.deleteMany({ expires: { $lt: new Date() } })
```

---

## Summary

✅ **Session configuration improved** - TTL, auto-removal, rolling, HTTPS  
✅ **Clear-sessions script created** - Easy way to kick all users  
✅ **Deployment workflow documented** - Clear sessions before deploy  
✅ **Security enhanced** - HTTPS-only in production, better cookie settings  

**To kick users out on next deployment:**
```bash
npm run clear-sessions && npm start
```

---

**Status**: ✅ Complete  
**Files Modified**: 2 (server.js, package.json)  
**Files Created**: 2 (clear-sessions.js, DEPLOYMENT_SESSION_FIX.md)  
**Breaking Changes**: None (backward compatible)
