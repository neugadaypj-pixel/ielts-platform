const { execute } = require('../connection');

const Feedback = {
    async findById(id) {
        const result = await execute(
            `SELECT id AS "_id", student_id AS "studentId", student_name AS "studentName",
                    test_type AS "testType", question_type AS "questionType",
                    issue_description AS "issueDescription", status AS "status",
                    admin_notes AS "adminNotes", admin_reply AS "adminReply",
                    TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
                    TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
             FROM feedbacks WHERE id = :id`,
            { id }
        );
        return result.rows[0] || null;
    },

    async findOne(filter) {
        let sql = `SELECT id AS "_id", student_id AS "studentId", student_name AS "studentName",
                          test_type AS "testType", question_type AS "questionType",
                          issue_description AS "issueDescription", status AS "status",
                          admin_notes AS "adminNotes", admin_reply AS "adminReply",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                   FROM feedbacks WHERE 1=1`;
        const binds = {};
        if (filter._id) { sql += ` AND id = :id`; binds.id = filter._id; }
        if (filter.studentId) { sql += ` AND student_id = :studentId`; binds.studentId = filter.studentId; }
        if (filter.status) { sql += ` AND status = :status`; binds.status = filter.status; }
        sql += ` AND ROWNUM = 1`;
        const result = await execute(sql, binds);
        return result.rows[0] || null;
    },

    async find(filter) {
        let sql = `SELECT id AS "_id", student_id AS "studentId", student_name AS "studentName",
                          test_type AS "testType", question_type AS "questionType",
                          issue_description AS "issueDescription", status AS "status",
                          admin_notes AS "adminNotes", admin_reply AS "adminReply",
                          TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
                   FROM feedbacks WHERE 1=1`;
        const binds = {};
        if (filter.studentId) { sql += ` AND student_id = :studentId`; binds.studentId = filter.studentId; }
        if (filter.status) { sql += ` AND status = :status`; binds.status = filter.status; }
        if (filter.testType) { sql += ` AND test_type = :testType`; binds.testType = filter.testType; }

        // Sort
        if (filter.$sort) {
            const entries = Object.entries(filter.$sort);
            sql += ` ORDER BY ` + entries.map(([key, dir]) => {
                const col = key === 'createdAt' ? 'created_at' :
                            key === 'studentId' ? 'student_id' : key;
                return `${col} ${dir === -1 ? 'DESC' : 'ASC'}`;
            }).join(', ');
        } else {
            sql += ` ORDER BY created_at DESC`;
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
        await execute(
            `INSERT INTO feedbacks (student_id, student_name, test_type, question_type, issue_description, status, admin_notes, admin_reply)
             VALUES (:studentId, :studentName, :testType, :questionType, :issueDescription, :status, :adminNotes, :adminReply)`,
            {
                studentId: data.studentId,
                studentName: data.studentName,
                testType: data.testType,
                questionType: data.questionType || '',
                issueDescription: data.issueDescription,
                status: data.status || 'open',
                adminNotes: data.adminNotes || '',
                adminReply: data.adminReply || ''
            }
        );
        const idResult = await execute(`SELECT feedbacks_seq.CURRVAL AS id FROM dual`);
        return Feedback.findById(idResult.rows[0].ID);
    },

    async findByIdAndUpdate(id, update) {
        const setClauses = [];
        const binds = { id };

        if (update.status) { setClauses.push("status = :status"); binds.status = update.status; }
        if (update.adminNotes !== undefined) { setClauses.push("admin_notes = :adminNotes"); binds.adminNotes = update.adminNotes; }
        if (update.adminReply !== undefined) { setClauses.push("admin_reply = :adminReply"); binds.adminReply = update.adminReply; }
        if (update.issueDescription) { setClauses.push("issue_description = :issueDescription"); binds.issueDescription = update.issueDescription; }

        if (setClauses.length > 0) {
            await execute(
                `UPDATE feedbacks SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = :id`, binds
            );
        }

        return Feedback.findById(id);
    },

    async findByIdAndDelete(id) {
        const doc = await Feedback.findById(id);
        if (doc) {
            await execute(`DELETE FROM feedbacks WHERE id = :id`, { id });
        }
        return doc;
    },

    async deleteMany(filter) {
        let sql = `DELETE FROM feedbacks WHERE 1=1`;
        const binds = {};
        if (filter.studentId) { sql += ` AND student_id = :sid`; binds.sid = filter.studentId; }
        await execute(sql, binds);
    },

    async countDocuments(filter = {}) {
        let sql = `SELECT COUNT(*) AS cnt FROM feedbacks WHERE 1=1`;
        const binds = {};
        if (filter.status) { sql += ` AND status = :status`; binds.status = filter.status; }
        if (filter.studentId) { sql += ` AND student_id = :sid`; binds.sid = filter.studentId; }
        const result = await execute(sql, binds);
        return result.rows[0].CNT;
    }
};

module.exports = Feedback;
