const mongoose = require('mongoose');

const testSchema = new mongoose.Schema({
    title: String,
    type: { type: String, enum: ['reading', 'listening', 'writing'], default: 'reading' },
    teacherName: String,
    createdBy: mongoose.Schema.Types.ObjectId, // Reference to the teacher/admin who created it
    readingPassage: String, // We'll store the JSON content from the builders here
    questions: Array
});

module.exports = mongoose.model('Test', testSchema);