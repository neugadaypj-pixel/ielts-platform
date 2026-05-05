# 📖 NEW UTILITIES GUIDE

## Quick Reference for Using New Utilities

### 1. **CONSTANTS** - Use everywhere instead of hardcoded strings

```javascript
// Import at top of file
const CONSTANTS = require('./utils/constants');

// Use in code
if (user.role === CONSTANTS.ROLES.ADMIN) { ... }
if (test.type === CONSTANTS.TEST_TYPES.READING) { ... }
res.status(CONSTANTS.STATUS.FORBIDDEN).json({ ... })
```

**Available Constants:**
- `CONSTANTS.ROLES.ADMIN`
- `CONSTANTS.ROLES.TEACHER`
- `CONSTANTS.ROLES.STUDENT`
- `CONSTANTS.TEST_TYPES.READING`
- `CONSTANTS.TEST_TYPES.LISTENING`
- `CONSTANTS.TEST_TYPES.WRITING`
- `CONSTANTS.MESSAGES.*` (all message strings)
- `CONSTANTS.STATUS.*` (HTTP status codes)

---

### 2. **VALIDATION** - Validate user input

```javascript
// Import at top
const { validateUsername, validatePassword, validateTestTitle, safeJSONParse } = require('./utils/validation');

// Validate input
const result = validateUsername(req.body.username);
if (!result.valid) {
    return res.status(400).json({ error: result.error });
}

// Safe JSON parsing (won't crash on malformed JSON)
const parts = safeJSONParse(req.body.parts, {});
```

**Available Validators:**
- `validateUsername(username)` → { valid, error }
- `validatePassword(password)` → { valid, error }
- `validateTestTitle(title)` → { valid, error }
- `validateTestType(type)` → { valid, error }
- `validateObjectId(id)` → { valid, error }
- `validateRole(role)` → { valid, error }
- `safeJSONParse(json, default)` → object
- `sanitizeString(str)` → string

---

### 3. **LOGGER** - Track important events

```javascript
// Import at top
const logger = require('./utils/logger');

// Log events (goes to logs/ directory + console)
logger.info('User logged in', { userId: user._id, username: user.username });
logger.warn('Suspicious activity', { userId: req.session.userId });
logger.error('Database error', { error: err.message });
logger.debug('Processing test', { testId: req.params.id });
```

**Logs are saved to:**
- `logs/info.log` - Normal operations
- `logs/warn.log` - Warnings
- `logs/error.log` - Errors
- `logs/debug.log` - Debug info

Each log entry includes:
- Timestamp
- Level
- Message
- Additional data (as JSON)

---

## Example: Using All Three Together

```javascript
const CONSTANTS = require('./utils/constants');
const { validateUsername, safeJSONParse } = require('./utils/validation');
const logger = require('./utils/logger');

app.post('/create-test', isAdmin, async (req, res) => {
    try {
        // 1. Validate title
        const titleValidation = validateTestTitle(req.body.title);
        if (!titleValidation.valid) {
            logger.warn('Invalid test title', { userId: req.session.userId, title: req.body.title });
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).json({ 
                error: titleValidation.error 
            });
        }

        // 2. Safe JSON parsing
        const parts = safeJSONParse(req.body.parts, {});

        // 3. Use constants for types
        if (![CONSTANTS.TEST_TYPES.READING, CONSTANTS.TEST_TYPES.LISTENING].includes(req.body.type)) {
            return res.status(CONSTANTS.STATUS.BAD_REQUEST).json({ 
                error: 'Invalid test type' 
            });
        }

        // Create test...
        logger.info('Test created', { userId: req.session.userId, testId: test._id });
        
        res.json({ 
            success: true, 
            message: CONSTANTS.MESSAGES.TEST_CREATED 
        });
    } catch (err) {
        logger.error('Error creating test', { error: err.message, userId: req.session.userId });
        res.status(CONSTANTS.STATUS.INTERNAL_ERROR).json({ 
            error: err.message 
        });
    }
});
```

---

## File Upload Limits

The platform now has upload protection:

```javascript
// Maximum file size: 100MB
// Maximum files per request: 10
// Configured in server.js with multer

// If user tries to upload larger file:
// → Error: "File size exceeds maximum limit"
// → No server crash
// → Logged automatically
```

---

## Generic Delete Handler

For creating new delete routes, use the pattern:

```javascript
app.post('/delete-something/:id', async (req, res) => {
    await handleDelete(req, res, {
        model: SomeModel,                    // The database model
        modelName: 'Something',              // For error messages
        idParam: 'id',                       // URL parameter name
        authCheck: async (req, doc) => {     // Authorization logic
            const user = await User.findById(req.session.userId);
            return {
                allowed: user.role === CONSTANTS.ROLES.ADMIN,
                message: 'Not authorized'
            };
        },
        preDelete: async (doc) => {          // Cleanup before deletion
            // Remove references, etc.
            await Group.updateMany({ somethingId: doc._id }, { $pull: { ... } });
        }
    });
});
```

---

## Best Practices Going Forward

1. **Always use CONSTANTS** instead of hardcoded strings
   - ❌ `if (user.role === 'admin')`
   - ✅ `if (user.role === CONSTANTS.ROLES.ADMIN)`

2. **Always validate input** before using it
   - ❌ `const username = req.body.username`
   - ✅ `const validation = validateUsername(req.body.username); if (!validation.valid) return error;`

3. **Always log important events**
   - ❌ `console.log('user deleted')`
   - ✅ `logger.info('User deleted', { userId: req.session.userId, deletedId: req.params.id })`

4. **Always use safe JSON parsing**
   - ❌ `JSON.parse(req.body.data)`
   - ✅ `safeJSONParse(req.body.data, {})`

5. **Always use CONSTANTS for HTTP status**
   - ❌ `res.status(403).json(...)`
   - ✅ `res.status(CONSTANTS.STATUS.FORBIDDEN).json(...)`

---

## Checking Logs

All platform activity is now logged. To check:

```bash
# View error logs
cat c:\Users\user\Desktop\web\test-platform\logs\error.log

# View info logs
cat c:\Users\user\Desktop\web\test-platform\logs\info.log

# Search for specific user activity
grep "userId: 12345" c:\Users\user\Desktop\web\test-platform\logs\info.log
```

Each log entry is JSON formatted for easy parsing and analysis.

---

**All improvements are backward compatible - no changes to API or functionality!**
