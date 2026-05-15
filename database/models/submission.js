const { execute, executeMany } = require('../connection');

const Submission = {
    async findById(id) {
        const result = await execute(
            `SELECT id AS "_id", test_id AS "testId", student_id AS "studentId",
                    teacher_id AS "teacherId", group_id AS "groupId",
                    type, student_name AS "studentName", status,
                    attempt_count AS "attemptCount", score, total_questions AS "totalQuestions",
                    percentage, band, word_count1 AS "wordCount1", word_count2 AS "wordCount2",
                    time_remaining_text AS "timeRemainingText", details,
                    TO_CHAR(first_submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "firstSubmittedAt",
                    TO_CHAR(last_submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSubmittedAt"
             FROM submissions WHERE id = :id`,
            { id }
        );
        return result.rows[0] || null;
    },

    async findOne(filter) {
        let sql = `SELECT id AS "_id", test_id AS "testId", student_id AS "studentId",
                          teacher_id AS "teacherId", group_id AS "groupId",
                          type, student_name AS "studentName", status,
                          attempt_count AS "attemptCount", score, total_questions AS "totalQuestions",
                          percentage, band, word_count1 AS "wordCount1", word_count2 AS "wordCount2",
                          time_remaining_text AS "timeRemainingText", details,
                          TO_CHAR(first_submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "firstSubmittedAt",
                          TO_CHAR(last_submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSubmittedAt"
                   FROM submissions WHERE 1=1`;
        const binds = {};

        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.testId) { sql += ` AND test_id = :testId`; binds.testId = filter.testId; }
        if (filter.studentId) { sql += ` AND student_id = :studentId`; binds.studentId = filter.studentId; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }

        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows[0] || null;
    },

    async find(filter) {
        let sql = `SELECT id AS "_id", test_id AS "testId", student_id AS "studentId",
                          teacher_id AS "teacherId", group_id AS "groupId",
                          type, student_name AS "studentName", status,
                          attempt_count AS "attemptCount", score, total_questions AS "totalQuestions",
                          percentage, band, word_count1 AS "wordCount1", word_count2 AS "wordCount2",
                          time_remaining_text AS "timeRemainingText", details,
                          TO_CHAR(first_submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "firstSubmittedAt",
                          TO_CHAR(last_submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSubmittedAt"
                   FROM submissions WHERE 1=1`;
        const binds = {};

        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.studentId) { sql += ` AND student_id = :studentId`; binds.studentId = filter.studentId; }
        if (filter.testId) { sql += ` AND test_id = :testId`; binds.testId = filter.testId; }
        if (filter.groupId) { sql += ` AND group_id = :groupId`; binds.groupId = filter.groupId; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        if (filter.status) { sql += ` AND status = :status`; binds.status = filter.status; }

        // $in
        if (filter.testId && filter.testId.$in) {
            const ids = filter.testId.$in.map((x, i) => {
                binds[`tid${i}`] = x;
                return `:tid${i}`;
            });
            if (ids.length > 0) sql += ` AND test_id IN (${ids.join(',')})`;
        }
        if (filter.studentId && filter.studentId.$in) {
            const ids = filter.studentId.$in.map((x, i) => {
                binds[`sid${i}`] = x;
                return `:sid${i}`;
            });
            if (ids.length > 0) sql += ` AND student_id IN (${ids.join(',')})`;
        }
        if (filter.groupId && filter.groupId.$in) {
            const ids = filter.groupId.$in.map((x, i) => {
                binds[`gid${i}`] = x;
                return `:gid${i}`;
            });
            if (ids.length > 0) sql += ` AND group_id IN (${ids.join(',')})`;
        }

        // $or
        if (filter.$or) {
            const orClauses = [];
            filter.$or.forEach((cond, i) => {
                const parts = [];
                if (cond.studentName && cond.studentName.$regex) {
                    parts.push(`REGEXP_LIKE(student_name, :orname${i}, 'i')`);
                    binds[`orname${i}`] = cond.studentName.$regex;
                }
                if (cond.testId && cond.testId.$in) {
                    const innerIds = cond.testId.$in.map((x, j) => {
                        binds[`ortid${i}_${j}`] = x;
                        return `:ortid${i}_${j}`;
                    });
                    parts.push(`test_id IN (${innerIds.join(',')})`);
                }
                if (cond.teacherId) {
                    parts.push(`teacher_id = :orteach${i}`);
                    binds[`orteach${i}`] = cond.teacherId;
                }
                if (cond.studentId && cond.studentId.$in) {
                    const innerIds = cond.studentId.$in.map((x, j) => {
                        binds[`orsid${i}_${j}`] = x;
                        return `:orsid${i}_${j}`;
                    });
                    parts.push(`student_id IN (${innerIds.join(',')})`);
                }
                if (parts.length > 0) orClauses.push(`(${parts.join(' AND ')})`);
            });
            if (orClauses.length > 0) sql += ` AND (${orClauses.join(' OR ')})`;
        }

        // Sort (default: firstSubmittedAt DESC)
        if (filter.$sort) {
            const entries = Object.entries(filter.$sort);
            sql += ` ORDER BY ` + entries.map(([key, dir]) => {
                const col = key === 'firstSubmittedAt' ? 'first_submitted_at' :
                            key === 'lastSubmittedAt' ? 'last_submitted_at' :
                            key === 'createdAt' ? 'first_submitted_at' :
                            key === 'studentId' ? 'student_id' :
                            key === 'testId' ? 'test_id' :
                            key === 'teacherId' ? 'teacher_id' :
                            key === 'percentage' ? 'percentage' : key;
                return `${col} ${dir === -1 ? 'DESC' : 'ASC'}`;
            }).join(', ');
        } else {
            sql += ` ORDER BY first_submitted_at DESC`;
        }

        // Pagination
        if (filter.$skip !== undefined && filter.$limit !== undefined) {
            sql += ` OFFSET :skip ROWS FETCH NEXT :lim ROWS ONLY`;
            binds.skip = filter.$skip;
            binds.lim = filter.$limit;
        } else if (filter.$limit !== undefined) {
            sql += ` FETCH FIRST :lim ROWS ONLY`;
            binds.lim = filter.$limit;
        }

        const result = await execute(sql, binds);
        return result.rows;
    },

    async create(data) {
        const detailsStr = data.details
            ? (typeof data.details === 'string' ? data.details : JSON.stringify(data.details))
            : '{}';
        await execute(
            `INSERT INTO submissions (test_id, student_id, teacher_id, group_id, type,
                                      student_name, status, attempt_count, score,
                                      total_questions, percentage, band, word_count1,
                                      word_count2, time_remaining_text, details)
             VALUES (:testId, :studentId, :teacherId, :groupId, :type,
                     :studentName, :status, :attemptCount, :score,
                     :totalQuestions, :percentage, :band, :wordCount1,
                     :wordCount2, :timeRemainingText, :details)`,
            {
                testId: data.testId,
                studentId: data.studentId,
                teacherId: data.teacherId || null,
                groupId: data.groupId || null,
                type: data.type,
                studentName: data.studentName,
                status: data.status || 'completed',
                attemptCount: data.attemptCount || 1,
                score: data.score || null,
                totalQuestions: data.totalQuestions || null,
                percentage: data.percentage || null,
                band: data.band || null,
                wordCount1: data.wordCount1 || null,
                wordCount2: data.wordCount2 || null,
                timeRemainingText: data.timeRemainingText || '',
                details: detailsStr
            }
        );
        // Get last inserted ID
        const idResult = await execute(`SELECT submissions_seq.CURRVAL AS id FROM dual`);
        return Submission.findById(idResult.rows[0].ID);
    },

    async findOneAndUpdate(filter, update) {
        // Find first
        const doc = await Submission.findOne(filter);
        if (!doc) return null;

        const setClauses = [];
        const binds = { id: doc._id };

        if (update.$set) {
            for (const [key, val] of Object.entries(update.$set)) {
                const col = key === 'aiAnalysis' ? `details = JSON_MERGEPATCH(details, JSON_OBJECT('aiAnalysis' VALUE :aiVal))` : null;
                if (col === null) {
                    // Standard column update
                    const colName = key === 'lastSubmittedAt' ? 'last_submitted_at' :
                                    key === 'attemptCount' ? 'attempt_count' :
                                    key === 'totalQuestions' ? 'total_questions' :
                                    key === 'studentName' ? 'student_name' :
                                    key === 'timeRemainingText' ? 'time_remaining_text' :
                                    key === 'wordCount1' ? 'word_count1' :
                                    key === 'wordCount2' ? 'word_count2' : key;
                    setClauses.push(`${colName} = :${key}`);
                    binds[key] = val;
                } else {
                    setClauses.push(col);
                    binds.aiVal = val;
                }
            }
        }

        if (setClauses.length > 0) {
            setClauses.push("last_submitted_at = CURRENT_TIMESTAMP");
            await execute(`UPDATE submissions SET ${setClauses.join(', ')} WHERE id = :id`, binds);
        }

        return Submission.findById(doc._id);
    },

    async updateMany(filter, update) {
        const docs = await Submission.find(filter);
        for (const doc of docs) {
            const setClauses = [];
            const binds = { id: doc._id };
            if (update.$set) {
                for (const [key, val] of Object.entries(update.$set)) {
                    const colName = key === 'teacherId' ? 'teacher_id' :
                                    key === 'groupId' ? 'group_id' :
                                    key === 'lastSubmittedAt' ? 'last_submitted_at' : key;
                    setClauses.push(`${colName} = :${key}`);
                    binds[key] = val;
                }
            }
            if (setClauses.length > 0) {
                setClauses.push("last_submitted_at = CURRENT_TIMESTAMP");
                await execute(`UPDATE submissions SET ${setClauses.join(', ')} WHERE id = :id`, binds);
            }
        }
    },

    async countDocuments(filter = {}) {
        let sql = `SELECT COUNT(*) AS cnt FROM submissions WHERE 1=1`;
        const binds = {};
        if (filter.testId) { sql += ` AND test_id = :testId`; binds.testId = filter.testId; }
        if (filter.studentId) { sql += ` AND student_id = :studentId`; binds.studentId = filter.studentId; }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        if (filter.groupId) { sql += ` AND group_id = :groupId`; binds.groupId = filter.groupId; }
        if (filter.type) { sql += ` AND type = :type`; binds.type = filter.type; }
        if (filter.status) { sql += ` AND status = :status`; binds.status = filter.status; }
        const result = await execute(sql, binds);
        return result.rows[0].CNT;
    },

    async deleteMany(filter) {
        let sql = `DELETE FROM submissions WHERE 1=1`;
        const binds = {};
        if (filter.testId) {
            if (filter.testId.$in) {
                const ids = filter.testId.$in.map((x, i) => { binds[`tid${i}`] = x; return `:tid${i}`; });
                if (ids.length > 0) sql += ` AND test_id IN (${ids.join(',')})`;
            } else {
                sql += ` AND test_id = :testId`; binds.testId = filter.testId;
            }
        }
        if (filter.studentId) {
            if (filter.studentId.$in) {
                const ids = filter.studentId.$in.map((x, i) => { binds[`sid${i}`] = x; return `:sid${i}`; });
                if (ids.length > 0) sql += ` AND student_id IN (${ids.join(',')})`;
            } else {
                sql += ` AND student_id = :studentId`; binds.studentId = filter.studentId;
            }
        }
        if (filter.teacherId) { sql += ` AND teacher_id = :teacherId`; binds.teacherId = filter.teacherId; }
        await execute(sql, binds);
    }
};

module.exports = Submission;
