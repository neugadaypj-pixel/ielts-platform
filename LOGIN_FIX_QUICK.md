# Login & Helmet Fixes

## Issues Fixed

### 1. Permissions-Policy Header Error ✅
**Error**: `Unrecognized feature: 'browsing-topics'`

**Cause**: Helmet's default permissions policy includes experimental features not supported by all browsers.

**Fix**: Disabled permissions policy in helmet
```javascript
app.use(helmet({ 
    contentSecurityPolicy: false,
    permissionsPolicy: false  // ADDED
}));
```

### 2. Cannot Log In (Redirect Loop) ✅
**Problem**: Users already logged in visiting `/login` would see login page again, causing confusion.

**Fix**: Added redirect logic to login GET route
```javascript
app.get('/login', csrfProtection, (req, res) => {
    // NEW: Check if already logged in
    if (req.session.userId) {
        const role = req.session.userRole;
        if (role === 'admin') return res.redirect('/admin');
        if (role === 'teacher') return res.redirect('/teacher-dashboard');
        if (role === 'student') return res.redirect('/student-dashboard');
    }
    res.render('login', { csrfToken: req.csrfToken() });
});
```

## What Changed
- `server.js` - Disabled helmet permissions policy
- `server.js` - Added login redirect for authenticated users

## Testing
✅ Syntax validated
✅ No more permissions-policy errors
✅ Logged-in users redirected to dashboard
✅ Logged-out users see login page

## Status
✅ Complete - Ready to use
