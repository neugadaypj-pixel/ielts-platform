# Security & Configuration Guide

## ✅ CSRF Protection - NOW ENABLED

**What is CSRF?**
Cross-Site Request Forgery (CSRF) is an attack where a malicious website tricks your browser into making unwanted requests to your platform while you're logged in.

**What we implemented:**
- ✅ CSRF tokens on login form
- ✅ CSRF tokens on feedback submission
- ✅ Cookie-based CSRF protection using `csurf` package

**How it works:**
1. Server generates a unique token for each session
2. Token is embedded in forms as a hidden field: `<input type="hidden" name="_csrf" value="...">`
3. When form is submitted, server validates the token
4. If token is missing or invalid, request is rejected

**Where it's active:**
- `/login` (GET & POST)
- `/student/feedback` (GET & POST)

**To extend CSRF to other forms:**
```javascript
// In server.js route:
app.get('/your-form', csrfProtection, (req, res) => {
    res.render('your-view', { csrfToken: req.csrfToken() });
});

app.post('/your-form', csrfProtection, async (req, res) => {
    // Your logic here
});

// In your EJS view:
<form method="POST">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <!-- rest of form -->
</form>
```

---

## 💾 Database Backups - Options Explained

**Option 1: Automated Script (Already Created)**
- File: `backup-database.js`
- Keeps last 7 days of backups
- Uses MongoDB's `mongodump` utility

**How to use:**
```bash
# Manual backup
node backup-database.js

# Schedule with Windows Task Scheduler:
# 1. Open Task Scheduler
# 2. Create Basic Task
# 3. Set trigger (e.g., Daily at 2 AM)
# 4. Action: Start a program
# 5. Program: node
# 6. Arguments: C:\Users\user\Desktop\web\test-platform\backup-database.js
# 7. Start in: C:\Users\user\Desktop\web\test-platform
```

**Option 2: MongoDB Atlas Automated Backups (Recommended for Production)**
If you're using MongoDB Atlas (cloud):
- Go to your cluster → Backup tab
- Enable "Continuous Cloud Backup"
- Set retention policy (7 days, 30 days, etc.)
- Automatic point-in-time recovery
- No manual scripts needed

**Option 3: Manual Export**
```bash
# Export entire database
mongodump --uri="your_mongodb_connection_string" --out=./backup

# Export specific collection
mongodump --uri="your_mongodb_connection_string" --collection=users --out=./backup

# Restore from backup
mongorestore --uri="your_mongodb_connection_string" ./backup
```

**Backup Strategy Recommendation:**
1. **Development**: Manual backups before major changes
2. **Production**: MongoDB Atlas automated backups + weekly manual exports to external storage
3. **Critical Data**: Daily automated backups + monthly archives

---

## 🔧 NODE_ENV - Simple Explanation

**What is NODE_ENV?**
It's an environment variable that tells your application whether it's running in development or production mode.

**Current setting in `.env`:**
```
NODE_ENV=production
```

**What it does in your platform:**

1. **Session Cookie Security:**
```javascript
cookie: {
    secure: process.env.NODE_ENV === 'production'
}
```
- `NODE_ENV=development` → `secure: false` → Cookies work on HTTP (localhost)
- `NODE_ENV=production` → `secure: true` → Cookies ONLY work on HTTPS (secure websites)

**When to use each:**

| Environment | NODE_ENV Value | Use Case |
|-------------|---------------|----------|
| Local Testing | `development` | Testing on `http://localhost:3000` |
| Production Server | `production` | Live website with HTTPS (e.g., `https://yoursite.com`) |

**How to change it:**

**Option A: Edit `.env` file**
```env
# For local development
NODE_ENV=development

# For production
NODE_ENV=production
```

**Option B: Set temporarily in terminal**
```bash
# Windows CMD
set NODE_ENV=development && node server.js

# Windows PowerShell
$env:NODE_ENV="development"; node server.js

# Linux/Mac
NODE_ENV=development node server.js
```

**Common Issue:**
If you set `NODE_ENV=production` but run on `http://localhost`, login won't work because:
- Browser tries to set secure cookies
- HTTP doesn't support secure cookies
- Session fails

**Solution:**
- Development (localhost): `NODE_ENV=development`
- Production (HTTPS): `NODE_ENV=production`

---

## 🚀 Quick Start After These Changes

1. **Restart your server:**
```bash
npm start
```

2. **Test login:**
- Go to `http://localhost:3000/login`
- Login should now work with CSRF protection

3. **Verify CSRF is working:**
- Right-click on login page → View Source
- Look for: `<input type="hidden" name="_csrf" value="...">` ✅

4. **If login still fails:**
- Check `.env` file: `NODE_ENV=development` (for localhost)
- Clear browser cookies
- Restart server
- Try again

---

## 📋 Security Checklist

- ✅ Session security (httpOnly, secure, sameSite)
- ✅ Rate limiting on login (10 attempts/minute)
- ✅ Input validation on all routes
- ✅ CSRF protection on forms
- ✅ Password hashing (bcrypt)
- ✅ File upload MIME type validation
- ✅ MongoDB injection prevention (Mongoose)
- ✅ Duplicate username prevention
- ⚠️ 2FA - Not implemented (you said no need)
- ⚠️ Email verification - Not implemented

---

## 🆘 Troubleshooting

**Problem: "Cannot login, redirects back to /login"**
- **Cause**: CSRF token mismatch or secure cookie on HTTP
- **Fix**: Set `NODE_ENV=development` in `.env`, restart server

**Problem: "Forbidden" error on form submission**
- **Cause**: Missing CSRF token
- **Fix**: Ensure form has `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`

**Problem: "Session not persisting"**
- **Cause**: Secure cookies on HTTP
- **Fix**: Use `NODE_ENV=development` for localhost

**Problem: Backup script fails**
- **Cause**: `mongodump` not installed
- **Fix**: Install MongoDB Database Tools from https://www.mongodb.com/try/download/database-tools
