# Post-Oracle Migration Bug Fix Plan

## Summary of Root Causes

After switching from MongoDB to OracleDB, five categories of bugs emerged. Below are
the root causes and the exact code changes needed for each.

---

## Bug 1: CSRF Token / 404 Errors "Almost Everywhere"

### Root Cause

`csurf` is configured as `csrf({ cookie: true })` at [`server-oracle.js:217`](../server-oracle.js:217).
This stores the CSRF secret in a separate `_csrf` cookie that is ONLY set when a route
with `csrfProtection` middleware renders. Many routes lack `csrfProtection`:

- **No CSRF cookie set on**: `/create-test` hub, `/settings`, `/ai-chat`,
  `/student-dashboard`, `/teacher-progress`, `/export-*`, `/api/*`, etc.
- **No CSRF validation on POST**: `/teacher/delete-test/:id`, `/teacher/delete-group/:id`,
  `/teacher/delete-student/:id`, `/teacher/remove-student-from-group/*`,
  `/teacher/remove-test-from-group/*`, `/teacher/bulk-delete-students`,
  `/teacher/add-student-to-group`, `/submit-test`, `/submit-writing`

When a user navigates to a page without `csrfProtection`, no `_csrf` cookie is set.
When they then submit a form to a route WITH `csrfProtection`, csurf throws
`EBADCSRFTOKEN` → `csrfErrorHandler` returns 403 "Invalid CSRF token".

Additionally, POST routes without `csrfProtection` are vulnerable to CSRF attacks
despite EJS templates sending `x-csrf-token` headers (which are ignored).

### Fix

**Step 1:** Switch from cookie-based to session-based CSRF at `server-oracle.js:217`:

```javascript
// OLD:
const csrfProtection = csrf({ cookie: true });

// NEW:
const csrfProtection = csrf({ sessionKey: 'csrfSecret' });
```

This stores the CSRF secret in the express-session instead of a separate cookie.
No template changes needed — `req.csrfToken()` and `_csrf`/`x-csrf-token` usage
remain identical.

**Step 2:** Add `csrfProtection` middleware to all state-changing POST routes that
currently lack it:

| Route | File & Line |
|---|---|
| `POST /teacher/delete-test/:id` | [`server-oracle.js:1983`](../server-oracle.js:1983) |
| `POST /teacher/delete-group/:id` | [`server-oracle.js:2004`](../server-oracle.js:2004) |
| `POST /teacher/delete-student/:id` | [`server-oracle.js:2025`](../server-oracle.js:2025) |
| `POST /teacher/remove-student-from-group/:groupId/:studentId` | [`server-oracle.js:2092`](../server-oracle.js:2092) |
| `POST /teacher/remove-test-from-group/:groupId/:testId` | [`server-oracle.js:2144`](../server-oracle.js:2144) |
| `POST /teacher/bulk-delete-students` | [`server-oracle.js:2280`](../server-oracle.js:2280) |
| `POST /teacher/add-student-to-group` | [`server-oracle.js:1274`](../server-oracle.js:1274) |
| `POST /submit-test` | [`server-oracle.js:1441`](../server-oracle.js:1441) |
| `POST /submit-writing` | [`server-oracle.js:1460`](../server-oracle.js:1460) |
| `POST /settings/change-password` | [`server-oracle.js:2765`](../server-oracle.js:2765) |

---

## Bug 2: Teacher Dashboard Not Loading

### Status

Already fixed in prior commits (`aabf15e` for `.id`→`._id` and `440fc22` for
pagination). If still failing after deploy, the cause is the CSRF issue from
Bug 1 since the teacher-dashboard route includes `csrfProtection` on GET at
[line 1144](../server-oracle.js:1144). Fixing Bug 1 should resolve this.

### Verification

After Bug 1 fix, test: log in as teacher → navigate to `/teacher-dashboard`
→ page should load with tests, pagination, and CSRF token populated.

---

## Bug 3: "Invalid test document: missing readingPassage"

### Root Cause

Oracle schema defines `reading_passage CLOB DEFAULT ''` (empty string).
In JavaScript, `!''` is `true`, so [`parseStoredContent` at line 39](../utils/htmlExporter.js:39)
throws when Oracle returns an empty CLOB:

```javascript
// utils/htmlExporter.js:38-42
function parseStoredContent(raw, fieldName) {
    if (!raw) {  // ← empty string '' is falsy, triggers this!
        throw new Error(`Invalid test document: missing ${fieldName}`);
    }
```

MongoDB stored `readingPassage` only for reading/listening tests.
Writing tests had their content in a separate `content` field.
Oracle merges both into `reading_passage`, which defaults to `''` for
writing tests.

### Fix

**File 1:** [`utils/htmlExporter.js:39`](../utils/htmlExporter.js:39) — Change falsy check to null check:

```javascript
// OLD:
if (!raw) {
    throw new Error(`Invalid test document: missing ${fieldName}`);
}

// NEW:
if (raw === null || raw === undefined) {
    throw new Error(`Invalid test document: missing ${fieldName}`);
}
// Add empty string handling:
if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
        return {};  // Empty content is valid for writing tests
    }
    // ... rest of existing string handling
}
```

**File 2:** [`utils/htmlExporter.js:3017`](../utils/htmlExporter.js:3017) — Add fallback:

```javascript
// OLD:
const rawContent = plainTest.readingPassage ?? plainTest.content;

// NEW:
const rawContent = plainTest.readingPassage || plainTest.content || '{}';
```

---

## Bug 4: Test Assignment Shows Success But Doesn't Persist

### Root Cause

The INSERT into `user_assigned_tests` succeeds, and the verification at
[line 761](../server-oracle.js:761) confirms it with `includes()`.
However, the teacher dashboard at [line 1164](../server-oracle.js:1164)
computes pagination from `Test.countDocuments({ createdBy: userId })` —
only the teacher's OWN tests, NOT including admin-assigned tests.

If the teacher has 20+ created tests, pagination shows only page 1 of
created tests. The assigned test is appended to the `tests` array (line 1180)
but may be hidden if the template paginates strictly or the teacher doesn't
scroll.

### Fix

**File 1:** [`server-oracle.js:1164`](../server-oracle.js:1164) — Include assigned tests in total count:

```javascript
// OLD:
const totalTests = await Test.countDocuments({ createdBy: userId });

// NEW:
const teacherUser = await User.findById(userId);
const assignedTestIds = (teacherUser && teacherUser.assignedTests) || [];
const createdCount = await Test.countDocuments({ createdBy: userId });
const totalTests = createdCount + assignedTestIds.length;
```

**File 2:** [`server-oracle.js:761`](../server-oracle.js:761) — Add String() for type safety:

```javascript
// OLD:
const assigned = updatedUser && updatedUser.assignedTests && updatedUser.assignedTests.includes(testId);

// NEW:
const assigned = updatedUser && updatedUser.assignedTests &&
    updatedUser.assignedTests.some(id => String(id) === String(testId));
```

---

## Bug 5: Listening Test Download — Audio to Base64 for Offline Use

### Root Cause

The code already exists at [`inlineListeningAudio` (lines 1825-1846)](../server-oracle.js:1825)
and [`fileUrlToDataUri` (lines 1789-1823)](../server-oracle.js:1789).

However, `inlineListeningAudio` checks `if (!raw || typeof raw !== 'string')` at
line 1827. When Oracle returns empty string `''` for `readingPassage`, `!''` is
`true` and it returns early without inlining audio. This is caused by the same
Oracle empty-string behavior as Bug 3.

### Fix

**File 1:** [`server-oracle.js:1825-1846`](../server-oracle.js:1825) — Add fallback to `builderJson`

```javascript
async function inlineListeningAudio(testDoc) {
    let raw = testDoc.readingPassage;
    // If readingPassage is empty, try builderJson for listening audio
    if (!raw || typeof raw !== 'string') {
        if (String(testDoc.type || '').toLowerCase() === 'listening' && testDoc.builderJson) {
            raw = typeof testDoc.builderJson === 'string' ? testDoc.builderJson : JSON.stringify(testDoc.builderJson);
        } else {
            return testDoc;
        }
    }
    // ... rest of existing logic
}
```

**File 2:** Fixing Bug 3 (`parseStoredContent` empty string) will also prevent the
cascading "missing readingPassage" error in the download flow.

---

## Comprehensive Audit: Additional Issues Found

### Routes Missing CSRF Protection (Security)

All POST routes listed in Bug 1 Step 2 need `csrfProtection` added.

### Potential ID Type Mismatches

Several places use `String(id) === String(testId)` for comparison while others
use direct `includes()` with numbers. This is not currently causing bugs since
JavaScript's `===` works correctly with same-type numbers, but should be
standardized for safety.

**File:** [`database/models/user.js:295`](../database/models/user.js) — `getAccessibleTest` uses
`String(id) === String(testId)` — consistent with the fix approach in Bug 4.

### Oracle NULL vs MongoDB Behavior

The fundamental pattern: Oracle CLOBs default to `''` (empty string) while
MongoDB fields were optionally undefined. This affects:
- `readingPassage` → Bug 3, Bug 5
- `builderJson` → may be `''` instead of `undefined`
- `questions` → defaults to `'[]'` in Oracle (already handled)

All model queries should add `NVL(column, '')` or handle null/empty at the
application layer.

---

## Execution Order

1. **Bug 1 Step 1** — Switch to session-based CSRF (critical, affects everything)
2. **Bug 1 Step 2** — Add csrfProtection to all missing POST routes
3. **Bug 3** — Fix parseStoredContent + generateHTMLFromTest
4. **Bug 5** — Fix inlineListeningAudio + builderJson fallback
5. **Bug 4** — Fix teacher dashboard pagination + assignment verification
6. **Bug 2** — Verify teacher dashboard loads (should be resolved by Bug 1)
7. **Final audit** — Test login → admin → teacher dashboard → student dashboard → test taking → test review → download flow
