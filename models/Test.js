const mongoose = require('mongoose');

const testSchema = new mongoose.Schema({
    title: String,
    type: { type: String, enum: ['reading', 'listening', 'writing'], default: 'reading' },
    teacherName: String,
    createdBy: mongoose.Schema.Types.ObjectId,
    readingPassage: String,
    builderJson: String,
    customTitle: String,
    folder: { type: String, default: '' },
    questions: Array
});

module.exports = mongoose.model('Test', testSchema);
