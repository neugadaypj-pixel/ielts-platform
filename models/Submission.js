const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
    type: { type: String, enum: ['reading', 'listening', 'writing'], required: true },
    studentName: { type: String, required: true },
    status: { type: String, enum: ['completed'], default: 'completed' },
    attemptCount: { type: Number, default: 1 },
    score: { type: Number, default: null },
    totalQuestions: { type: Number, default: null },
    percentage: { type: Number, default: null },
    band: { type: String, default: null },
    wordCount1: { type: Number, default: null },
    wordCount2: { type: Number, default: null },
    timeRemainingText: { type: String, default: '' },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }
}, {
    timestamps: {
        createdAt: 'firstSubmittedAt',
        updatedAt: 'lastSubmittedAt'
    }
});

submissionSchema.index({ testId: 1, studentId: 1 }, { unique: true });
submissionSchema.index({ teacherId: 1, type: 1 });

module.exports = mongoose.model('Submission', submissionSchema);
