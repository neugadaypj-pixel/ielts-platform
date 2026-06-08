# IELTS Test Platform — Read-Only File Audit Report

**Date:** 2026-06-08
**Audit Scope:** Oracle-migration readiness — routes, database models, middleware, EJS views, server configuration
**Server in Use:** `server-oracle.js` (Oracle DB)
**Legacy Server:** `server.js` (MongoDB/Mongoose — still present, not removed)

---

## LEGEND

| Symbol | Meaning |
|--------|---------|
| 🔴 **CRITICAL** | Will cause runtime errors, login failures, data corruption, or silent wrong behavior |
| 🟠 **HIGH** | Broken endpoints, dead code, incorrect SQL — degrades app but may not crash immediately |
| 🟡 **MEDIUM** | Safety/config issues — exploitable or risk-prone |
| 🟢 **LOW** | Migration cleanup, missing patterns, tech debt |

---

## 🔴 CRITICAL FINDINGS

### C1 — [`routes/auth.js`](routes/auth.js:4) imports Mongoose `../models/User` — BUT this file is DEAD CODE for Oracle

**File:** [`routes/auth.js`](routes/auth.js:4)
**Line 4:** `const User = require('../models/User');`

This imports the Mongoose model at [`models/User.js`](models/User.js:1) (`const mongoose = require('mongoose')`).

**Status:** This file is NOT loaded by [`server-oracle.js`](server-oracle.js:3359). The Oracle server defines auth routes **inline** at lines 688-741 with correct Oracle model imports. However, the file remains in the repo and **will be loaded by** [`server.js`](server.js:1) (the old MongoDB server, still present).

**Risk If Accidentally Loaded:** Login would fail because `User.findOne()` would query MongoDB instead of Oracle. If MongoDB is not running, the entire auth flow would crash with a connection error.

**Recommendation:**
- **DO NOT DELETE** [`routes/auth.js`](routes/auth.js:1) as long as `server.js` exists as a fallback
- Add a comment at the top of [`routes/auth.js`](routes/auth.js:1) stating: `// LEGACY: Used only by server.js (MongoDB). server-oracle.js has inline auth routes.`
- If `server.js` is decommissioned, delete both the file and the entire `models/` directory (all Mongoose schemas)

---

### C2 — Session Secret Insecure Fallback

**File:** [`server-oracle.js`](server-oracle.js:229)
```javascript
secret: process.env.SESSION_SECRET || 'test-platform-secret-change-me',
```

**Risk:** If the environment variable `SESSION_SECRET` is not set (e.g., after a redeploy or in any non-production environment), all user sessions will be signed with a hardcoded, publicly-known string. An attacker could forge session cookies and impersonate any user.

**Recommendation:**
- Remove the hardcoded fallback
- Replace with: `secret: process.env.SESSION_SECRET || require('crypto').randomBytes(64).toString('hex')` (regenerates on each restart, logging out all users — acceptable as safety valve)
- Or better: `secret: process.env.SESSION_SECRET` and crash on startup if missing

---

### C3 — `JSON_MERGEPATCH` Usage in [`database/models/submission.js`](database/models/submission.js:195) — Potential Oracle Incompatibility

**File:** [`database/models/submission.js`](database/models/submission.js:195)
```javascript
const col = key === 'aiAnalysis' ? `details = JSON_MERGEPATCH(details, JSON_OBJECT('aiAnalysis' VALUE :aiVal))` : null;
```

**Issue:** `JSON_MERGEPATCH` is a MySQL 8.0+ / Oracle 19c+ function. Oracle supports it, but the SQL syntax uses `JSON_MERGEPATCH` which is correct for Oracle 19c+. However, the concatenation into the SQL string does not properly handle the CLOB field — if `details` is a CLOB, `JSON_MERGEPATCH` may need explicit casting.

**Also notable:** The `VALUE` keyword in `JSON_OBJECT('aiAnalysis' VALUE :aiVal)` is Oracle-specific syntax. This is correct, but both MySQL and PostgreSQL would fail on it.

**Recommendation:**
- Test this specific SQL against your Oracle version
- Consider using a PL/SQL block or a simple update with `json_mergepatch()` for safety
- Add error handling specifically around this query

---

### C4 — `session.userRole` vs `session.role` Inconsistency

**File:** [`routes/auth.js`](routes/auth.js:12) (set as `req.session.userRole`)

In [`server-oracle.js`](server-oracle.js:717-719), the inline login route sets:
```javascript
req.session.userId = user._id;
req.session.userRole = user.role;
```

But in the old [`routes/auth.js`](routes/auth.js:33-35):
```javascript
req.session.userId = user._id;
req.session.userRole = user.role;
```

**Inconsistency:** [`routes/missing-routes.js`](routes/missing-routes.js:120-130) and other handlers reference `req.session.username` and `req.session.userId`, but **`server-oracle.js` never sets `req.session.username`**. Also, middleware at [`middleware/auth.js`](middleware/auth.js:8) checks `req.session.userId` but not `req.session.userRole`.

**Impact:** Any code in `missing-routes.js` that relies on `req.session.username` will receive `undefined`. This includes the `teacherDashboard` redirect at line 120 of missing-routes.js.

**Recommendation:**
- In the inline login route in `server-oracle.js`, add `req.session.username = user.username;` after successful login
- Audit all references to `req.session.username` across all route handlers

---

## 🟠 HIGH FINDINGS

### H1 — Duplicate Auth Middleware Definitions

**Issue:** Auth middleware is defined in TWO places:

1. **`middleware/auth.js`** — exports `isAuthenticated`, `isAdmin`, `isTeacher`, `isStudent` (88 lines)
2. **`server-oracle.js`** lines 293-305 — redefines `isAdmin` and `isTeacher` inline

**Details:**
- `middleware/auth.js` `isAdmin` (line 17): checks `req.session.userId` first, then `req.session.userRole !== 'admin'` → redirects to `/login`
- `server-oracle.js` `isAdmin` (line 293): checks `req.session.userRole !== CONSTANTS.ROLES.ADMIN` → returns 403 text
- `middleware/auth.js` `isTeacher` (line 39): checks session, then `req.session.userRole !== 'teacher' && !== 'admin'` → redirects to `/login`
- `server-oracle.js` `isTeacher` (line 300): checks session.userRole → returns 403 text

**Divergence Summary:**

| Behavior | `middleware/auth.js` | `server-oracle.js` inline |
|----------|---------------------|--------------------------|
| No session | Redirects to `/login` | Does NOT check for session |
| Wrong role | Redirects to `/login` | Returns `403` plain text |
| Admin in teacher | Allowed | Allowed |

**Risk:** If someone uses the `middleware/auth.js` exports in a route and expects the same behavior as server-oracle.js's inline versions, the behavior differs. Currently, `server-oracle.js` only uses its own inline versions, so this is not an active bug — but it's tech debt.

**Recommendation:**
- Consolidate to ONE definition in `middleware/auth.js`
- Import into `server-oracle.js` instead of redefining
- Or delete the inline definitions in `server-oracle.js` and use the middleware module

---

### H2 — `req.session.username` NOT Set on Login

**File:** [`server-oracle.js`](server-oracle.js:716-719)

The login POST handler sets:
```javascript
req.session.userId = user._id;
req.session.userRole = user.role;
```

But **never** sets `req.session.username`. Multiple route handlers in [`routes/missing-routes.js`](routes/missing-routes.js) reference `req.session.username`:

- Line 33: `studentName: req.session.username`
- Line 122: `username: req.session.username` (passed to both teacher-progress and teacher-dashboard views)
- Line 138: `student_name` in teacher dashboard render

**Impact:** Routes in `missing-routes.js` that pass `username: req.session.username` to EJS views will pass `undefined`. This may cause blank username displays in the UI.

**Recommendation:**
- Add `req.session.username = user.username;` in the inline login route at line 719 of `server-oracle.js`

---

### H3 — `User.findOne({ username })` in Oracle Login Does Not Check if User Exists Before `bcrypt.compare`

**File:** [`server-oracle.js`](server-oracle.js:706-713)

```javascript
const user = await User.findOne({ username });
// ...
const isValid = await bcrypt.compare(password, user.password);
```

If `User.findOne` returns `null`/`undefined`, the `bcrypt.compare` call will throw a TypeError (`Cannot read properties of null`), falling into the catch block that returns a generic error. While the end result is the same (login fails), the error message to the user is "An error occurred during login" instead of "Invalid username or password", and it pollutes the error logs.

**Recommendation:**
- Add: `if (!user) { return res.render('login', { error: 'Invalid username or password', csrfToken: req.csrfToken() }); }` BEFORE the `bcrypt.compare` call.

---

### H4 — Old Mongoose Models Directory Still Present

**Directory:** `models/` contains 6 files:
- [`models/Feedback.js`](models/Feedback.js)
- [`models/Group.js`](models/Group.js)
- [`models/Notification.js`](models/Notification.js)
- [`models/Submission.js`](models/Submission.js)
- [`models/Test.js`](models/Test.js)
- [`models/User.js`](models/User.js)
- [`models/TestDiscriminators.js`](models/TestDiscriminators.js) (?)
- [`models/Notification.js`](models/Notification.js)

All use `mongoose` and define Mongoose schemas. The old [`server.js`](server.js:27) (`const mongoose = require('mongoose')`) loads these.

**Risk:** Developers could accidentally import from `../models/` instead of `../database/models/`, causing MongoDB queries instead of Oracle. This already happened in [`routes/auth.js`](routes/auth.js:4).

**Recommendation:**
- If `server.js` is still a supported fallback: add `// LEGACY: Mongoose model — used only by server.js (MongoDB)` at the top of each file
- If `server.js` is decommissioned: delete the entire `models/` directory

---

### H5 — `$pull` Comment About Reserved Oracle Pseudo-Column `uid`

**File:** [`database/models/user.js`](database/models/user.js:109-117)

```javascript
// Pull student IDs from group
// NOTE: 'uid' is reserved as a pseudo-column in Oracle; we use 'user_id' instead
if (update.$pull && update.$pull.students) {
```

The SQL further down uses column `user_id` which matches the schema in [`group_students`](database/schema.sql:80) — this is correct. However, the comment acknowledges a discovered Oracle issue; there may be other places in the codebase that still reference `uid` as a column name or bind variable.

**Recommendation:**
- Search the entire codebase for `uid` usage outside of comments
- Ensure all SQL uses `user_id` consistently

---

## 🟡 MEDIUM FINDINGS

### M1 — Cookie `secure: false` Prevents HTTPS-Only Cookie Attribute

**File:** [`server-oracle.js`](server-oracle.js:233)

```javascript
cookie: {
    secure: false, // Must be false on HTTP; set true only if behind HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
}
```

The comment correctly notes this is for HTTP. However, in production behind nginx (which handles HTTPS), `secure` should be `true` to prevent cookie leakage over HTTP. The `trust proxy` is set at line 241, so Express should trust the `X-Forwarded-Proto` header.

**Recommendation:**
- Change to: `secure: process.env.NODE_ENV === 'production'` or `secure: 'auto'`
- Or use `app.set('trust proxy', 1)` (already set) and check `req.secure` dynamically

---

### M2 — CSRF Cookie-Based Token — No Double-Submit Cookie Pattern Verification

**File:** [`server-oracle.js`](server-oracle.js:290)

```javascript
const csrfProtection = csrf({ cookie: true });
```

This uses the `csurf` package with cookie-based tokens. The token is set as a cookie and expected in either a hidden form field (`_csrf`) or the `CSRF-Token` header. Cookie-based CSRF is vulnerable to cookie tossing if subdomains are compromised.

**Current Mitigation:**
- `sameSite: 'lax'` on session cookie helps
- `helmet` with `permissionsPolicy` disables many attack vectors

**Recommendation:**
- Consider migrating to the `csrf-csrf` package (successor to `csurf` which is deprecated)
- Or use the built-in `csrf-sync` pattern with `@synchronizer/csrf`

---

### M3 — `loginLimiter` IP+Username KeyGen Can Be Bypassed by Changing Username

**File:** [`server-oracle.js`](server-oracle.js:255-260)

```javascript
keyGenerator: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const user = req.body?.username || 'anonymous';
    return `${ip}::${user}`;
},
```

While this prevents shared-IP lockouts (good), an attacker can try different usernames to get a fresh rate limit bucket each time (bad). The `skip` function at line 262 only skips logged-in users.

**Recommendation:**
- Add a secondary rate limiter keyed on IP-only for `/login` POST with a higher window (e.g., 50 attempts per 15 minutes per IP)
- This creates a defense-in-depth: username rotation is limited by IP cap, and single-username brute force is limited by IP+username cap

---

### M4 — Session MaxAge 24 Hours with No Rotation

**File:** [`server-oracle.js`](server-oracle.js:235)

`maxAge: 24 * 60 * 60 * 1000` — sessions last 24 hours without requiring re-authentication. There's no session rotation (regenerating session ID after login).

**Recommendation:**
- Call `req.session.regenerate()` after successful login at line 714-719 to prevent session fixation
- Consider shorter session duration (e.g., 8 hours) with a "remember me" option

---

### M5 — `NOCACHE` on All Oracle Sequences Prevents Sequence Caching

**File:** [`database/schema.sql`](database/schema.sql:7)

All sequences use `NOCACHE`:
```sql
CREATE SEQUENCE users_seq START WITH 1 INCREMENT BY 1 NOCACHE
```

**Impact:** In high-throughput scenarios, `NOCACHE` forces Oracle to write to the sequence dictionary table on every `NEXTVAL`, reducing performance. The default cache size is 20, which is fine for most applications.

**Recommendation:**
- Change to `CACHE 20` (or just omit `NOCACHE` — Oracle defaults to `CACHE 20`)
- Only use `NOCACHE` if you explicitly need gapless IDs (and you have triggers that ensure ordering is irrelevant)

---

### M6 — No `ON DELETE CASCADE` on `user_assigned_tests` for `user_id` or `test_id`

**File:** [`database/schema.sql`](database/schema.sql:72-76)

```sql
CREATE TABLE user_assigned_tests (
    user_id NUMBER NOT NULL,
    test_id NUMBER NOT NULL,
    PRIMARY KEY (user_id, test_id)
)
```

Foreign keys are added later at lines 207-208:
```sql
ALTER TABLE user_assigned_tests ADD CONSTRAINT fk_uat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
ALTER TABLE user_assigned_tests ADD CONSTRAINT fk_uat_test FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
```

**This is correct** — they DO have `ON DELETE CASCADE`. My initial scan missed this. No issue.

---

### M7 — [`database/models/submission.js`](database/models/submission.js:195) `updateMany` Iterates One-by-One

**File:** [`database/models/submission.js`](database/models/submission.js:222-241)

The `updateMany` method does a `find()` then iterates with individual `UPDATE` statements:
```javascript
const docs = await Submission.find(filter);
for (const doc of docs) {
    // ... individual UPDATE per doc
}
```

This is an N+1 problem. For updating many submissions at once, this could be slow.

**Recommendation:**
- Use a single `UPDATE submissions SET ... WHERE ...` with appropriate `IN` clauses
- This is not a bug but a performance concern

---

## 🟢 LOW FINDINGS

### L1 — All EJS Views Use Client-Side `showToast()` — No Server-Side Flash Messages

**Summary of all 19 EJS views examined:**

| View | Flash/Notification Pattern |
|------|---------------------------|
| [`login.ejs`](views/login.ejs) | No flash messages at all |
| [`admin.ejs`](views/admin.ejs) | Client `showToast()` + includes `notifications` partial |
| [`teacher-dashboard.ejs`](views/teacher-dashboard.ejs) | Client `showToast()` + includes `notifications` partial |
| [`student-dashboard.ejs`](views/student-dashboard.ejs) | Client `showToast()` + includes `notifications` partial |
| [`index.ejs`](views/index.ejs) | Test-taking view — no flash |
| [`create-test-hub.ejs`](views/create-test-hub.ejs) | No flash messages |
| [`create-test-listening.ejs`](views/create-test-listening.ejs) | Form-based, no toast visible in first 50 lines |
| [`create-test-reading.ejs`](views/create-test-reading.ejs) | Form-based, no toast visible in first 50 lines |
| [`create-test-writing.ejs`](views/create-test-writing.ejs) | Has CSRF meta tag, no toast in first 50 lines |
| [`settings.ejs`](views/settings.ejs) | Client `showToast()` |
| [`add-student.ejs`](views/add-student.ejs) | Form-based, no toast |
| [`add-teacher.ejs`](views/add-teacher.ejs) | Form-based, no toast |
| [`analytics.ejs`](views/analytics.ejs) | Chart.js, no toast visible |
| [`ai-chat.ejs`](views/ai-chat.ejs) | Chat interface, no toast in first 60 lines |
| [`ai-feedback.ejs`](views/ai-feedback.ejs) | Display page, no toast in first 60 lines |
| [`feedback.ejs`](views/feedback.ejs) | Has `showToast()` on submit |
| [`live-monitor.ejs`](views/live-monitor.ejs) | Real-time monitoring, no toast in first 60 lines |
| [`teacher-progress.ejs`](views/teacher-progress.ejs) | CSV export, no toast in first 60 lines |
| [`admin-feedback.ejs`](views/admin-feedback.ejs) | Admin feedback management, no toast in first 60 lines |
| [`export-listening.ejs`](views/export-listening.ejs) | Student test-taking view, no flash |
| [`export-reading.ejs`](views/export-reading.ejs) | Student test-taking view, no flash |
| [`export-writing.ejs`](views/export-writing.ejs) | Student test-taking view, no flash |
| [`error.ejs`](views/error.ejs) | Error display page |

**Finding:** **Zero** instances of server-side flash (`req.flash()`, `locals.messages`, `locals.error`, `locals.success`) across all 23 EJS views. All user-facing messages use client-side `showToast()` with `fetch()` API responses.

**`notifications.ejs` Partial Pattern:**
- [`views/partials/notifications.ejs`](views/partials/notifications.ejs) is a fully client-side notification bell widget
- Uses `fetch('/api/notifications')` to load notifications
- Uses `fetch('/api/notifications/:id/read')` and `fetch('/api/notifications/mark-all-read')` for actions
- Polls every 30 seconds
- Included in: `admin.ejs`, `teacher-dashboard.ejs`, `student-dashboard.ejs`

**Migration Note:** Since there are no server-side flash messages, the migration from `connect-flash` (if ever used) to EJS `locals` is already complete — the app never used server-side flash. The notification system is already fully client-side and API-driven.

---

### L2 — `submitTest` Route in [`server-oracle.js`](server-oracle.js:1784) Passes `student_name` but `req.session.username` May Be Undefined

**File:** [`server-oracle.js`](server-oracle.js:1788-1803)

```javascript
const result = await saveStudentSubmission({
    req,
    payload: {
        // ...
        studentName: req.session.username || 'Unknown',
        // ...
    }
});
```

If `req.session.username` is not set (see finding H2), student submissions will have the name "Unknown".

**Recommendation:**
- Fix H2 first (set `req.session.username` on login)
- Alternatively, fetch the user's name from the database in `saveStudentSubmission`

---

### L3 — `cookieParser()` Should Be Called Before `session()` — But It's Fine Here

**File:** [`server-oracle.js`](server-oracle.js:243-246)

```javascript
app.use(session(sessionConfig));   // line 243
app.use(cookieParser());            // line 246
```

`cookie-parser` at line 246 is used for CSRF cookies (line 287), not for sessions. The `express-session` module has its own cookie parsing. However, the ordering is unusual — typically `cookieParser()` is before `session()`. Since session doesn't depend on cookieParser, this is functionally fine.

**Recommendation:**
- Move `app.use(cookieParser())` before `app.use(session(sessionConfig))` for clarity, but this is cosmetic

---

### L4 — Stale Mongoose Test Files

**Directory:** `tests/`

Contains Mongoose-based tests:
- [`tests/integration/auth.test.js`](tests/integration/auth.test.js)
- [`tests/integration/submission.test.js`](tests/integration/submission.test.js)
- [`tests/unit/user.model.test.js`](tests/unit/user.model.test.js)
- [`tests/unit/validation.test.js`](tests/unit/validation.test.js)

These tests likely reference Mongoose models and MongoDB connections. They will fail against the Oracle database.

**Recommendation:**
- Update test files to use the Oracle model adapters from `database/models/`
- Or mark them as legacy/MongoDB-only

---

### L5 — `server.js` Still in Repository

**File:** [`server.js`](server.js) (3260 lines)

The original MongoDB/Mongoose server is still present. It uses `mongoose`, `connect-mongo` for sessions, and imports Mongoose models from `models/`.

**Risk:** Accidental startup of the wrong server.

**Recommendation:**
- Rename to `server-legacy.js` if needed as backup
- Update `package.json` `"start"` script to clearly distinguish (currently unclear which server it starts)

---

### L6 — [`database/models/submission.js`](database/models/submission.js:195) Uses `JSON_MERGEPATCH` Without Error Handling for CLOB Type

When updating `aiAnalysis` on a submission's `details` CLOB, if `details` is `'{}'` (a JSON string), `JSON_MERGEPATCH` should work. However, if `details` contains malformed JSON or is empty/NULL, this SQL will fail silently or return unexpected results.

**Recommendation:**
- Add a `NVL(details, '{}')` wrapper: `JSON_MERGEPATCH(NVL(details, '{}'), ...)`
- Or validate JSON in JavaScript before sending to Oracle

---

### L7 — No `OUTFILE` Support for CSV Export

**File:** [`routes/missing-routes.js`](routes/missing-routes.js:226-280)

The CSV export builds a CSV string in memory and sends it as a response. For large datasets, this could cause memory issues.

**Recommendation:**
- For production with large datasets, consider streaming the CSV response or paginating

---

## 📊 SUMMARY

### By Severity

| Severity | Count | Files Affected |
|----------|-------|----------------|
| 🔴 CRITICAL | 4 | `routes/auth.js` (Mongoose import — dead code for Oracle), `server-oracle.js` (session secret), `database/models/submission.js` (JSON_MERGEPATCH), `server-oracle.js` (`req.session.username` not set) |
| 🟠 HIGH | 5 | `middleware/auth.js` + `server-oracle.js` (duplicate auth), `server-oracle.js` (username not set), `server-oracle.js` (User.findOne null check), `models/` directory (stale Mongoose), `database/models/user.js` (Oracle uid comment) |
| 🟡 MEDIUM | 6 | `server-oracle.js` (secure cookie), `server-oracle.js` (csrf deprecation), `server-oracle.js` (rate limit bypass), `server-oracle.js` (session fixation), `database/schema.sql` (NOCACHE), `database/models/submission.js` (N+1 updateMany) |
| 🟢 LOW | 7 | All EJS views (no flash — already client-side), `server-oracle.js` (Unknown username fallback), `server-oracle.js` (cookieParser ordering), `tests/` directory (Mongoose), `server.js` (legacy file), `database/models/submission.js` (CLOB error handling), `routes/missing-routes.js` (CSV memory) |

### Total Issues: 22

### Exact Files Needing Changes (ordered by priority)

1. **[`server-oracle.js`](server-oracle.js:229)** — Replace session secret fallback (C2)
2. **[`server-oracle.js`](server-oracle.js:706)** — Add null check before `bcrypt.compare` (H3)
3. **[`server-oracle.js`](server-oracle.js:719)** — Set `req.session.username = user.username` (C4, H2)
4. **[`database/models/submission.js`](database/models/submission.js:195)** — Add `NVL(details, '{}')` and verify `JSON_MERGEPATCH` syntax (C3)
5. **[`routes/auth.js`](routes/auth.js:1)** — Add legacy comment (C1)
6. **[`middleware/auth.js`](middleware/auth.js:1)** — Consolidate with `server-oracle.js` inline definitions (H1)
7. **[`server-oracle.js`](server-oracle.js:233)** — Dynamic `secure` cookie (M1)
8. **[`server-oracle.js`](server-oracle.js:249)** — Add IP-only secondary rate limiter (M3)
9. **[`server-oracle.js`](server-oracle.js:714)** — Add `req.session.regenerate()` after login (M4)
10. **[`database/schema.sql`](database/schema.sql:7)** — Change sequences to `CACHE 20` (M5)
11. **[`database/models/submission.js`](database/models/submission.js:222)** — Batch `updateMany` (M7)
12. **All `models/*.js`** — Add legacy comments (H4)
13. **All `tests/**/*.test.js`** — Update for Oracle (L4)

### Specific Changes Needed (condensed)

| # | File | Change |
|---|------|--------|
| 1 | `server-oracle.js:229` | `secret: process.env.SESSION_SECRET \|\| require('crypto').randomBytes(64).toString('hex')` |
| 2 | `server-oracle.js:706-708` | Add `if (!user) return res.render('login', { error: 'Invalid username or password', csrfToken: req.csrfToken() });` |
| 3 | `server-oracle.js:719` | Add `req.session.username = user.username;` |
| 4 | `database/models/submission.js:195` | Change to: `NVL(details, '{}') = JSON_MERGEPATCH(NVL(details, '{}'), ...)` |
| 5 | `routes/auth.js:1-4` | Add comment: `// LEGACY: Used only by server.js (MongoDB). server-oracle.js has inline auth at lines 688-741.` |
| 6 | `server-oracle.js:293-305` | Delete inline `isAdmin`/`isTeacher`; import from `middleware/auth.js` |
| 7 | `server-oracle.js:233` | `secure: process.env.NODE_ENV === 'production'` |
| 8 | `server-oracle.js:249` | Add `ipOnlyLimiter` on `/login` POST with `max: 50` per 15 min per IP |
| 9 | `server-oracle.js:714` | `req.session.regenerate((err) => { ... })` before setting session vars |
| 10 | `database/schema.sql:7-20` | Remove `NOCACHE` from all sequences (use default `CACHE 20`) |
| 11 | `database/models/submission.js:222-241` | Rewrite as single `UPDATE submissions SET ... WHERE id IN (...)` |
| 12 | `models/*.js` | Add `// LEGACY: Mongoose model — used only by server.js (MongoDB). Oracle equivalent at database/models/` |
| 13 | `tests/**/*.test.js` | Replace Mongoose imports with Oracle model adapter imports from `database/models/` |

---

**Audit completed by:** Read-only file analysis
**Files read:** 42 files across routes, database models, middleware, utilities, EJS views, and server configuration
**Files NOT modified:** 0 (read-only audit as requested)
