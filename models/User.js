const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 50
    },
    password: { 
        type: String, 
        required: true,
        minlength: 6 
    },
    plainPassword: {
        type: String,
        select: false // Don't include by default in queries
    },
    role: { 
        type: String, 
        enum: ['admin', 'teacher', 'student'], 
        default: 'student',
        required: true 
    },
    
    // For teachers: which tests the admin gave them
    assignedTests: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Test' 
    }],
    
    // For students: who is their teacher
    teacherId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    },

    // For students: which group they belong to
    groupId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Group' 
    }
}, {
    timestamps: true // Adds createdAt and updatedAt
});

// Indexes for better query performance
userSchema.index({ username: 1 });
userSchema.index({ role: 1, teacherId: 1 });

module.exports = mongoose.model('User', userSchema);