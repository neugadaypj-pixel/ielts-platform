const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true,
        trim: true,
        maxlength: 100
    },
    teacherId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    },
    students: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
    }],
    assignedTests: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Test' 
    }],
    testSchedule: [{
        testId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'Test' 
        },
        availableFrom: { 
            type: Date, 
            default: null 
        }
    }]
}, {
    timestamps: true
});

// Indexes for better query performance
GroupSchema.index({ teacherId: 1 });
GroupSchema.index({ name: 1, teacherId: 1 });

module.exports = mongoose.model('Group', GroupSchema);