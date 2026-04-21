const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'teacher', 'student'], default: 'student' },
    
    // For teachers: which tests the admin gave them
    assignedTests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Test' }],
    
    // For students: who is their teacher
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // THE NEW PART (Make sure there is a comma above this line!)
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' }
});

module.exports = mongoose.model('User', userSchema);