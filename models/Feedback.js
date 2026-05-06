const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentName: { type: String, required: true },
    testType: { type: String, enum: ['reading', 'listening', 'writing', 'general'], required: true },
    questionType: { type: String, default: '' },
    issueDescription: { type: String, required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    adminNotes: { type: String, default: '' },
    adminReply: { type: String, default: '' }
}, {
    timestamps: true
});

feedbackSchema.index({ studentId: 1, createdAt: -1 });
feedbackSchema.index({ status: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
