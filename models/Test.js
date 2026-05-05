const mongoose = require('mongoose');

const testSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: true,
        trim: true,
        maxlength: 200
    },
    type: { 
        type: String, 
        enum: ['reading', 'listening', 'writing'], 
        required: true,
        default: 'reading' 
    },
    teacherName: { 
        type: String,
        trim: true 
    },
    createdBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    },
    
    // Generic content field (stores HTML, JSON, or passage text)
    readingPassage: { 
        type: String,
        default: '' 
    },
    
    // Builder JSON data
    builderJson: { 
        type: String,
        default: '' 
    },
    
    customTitle: { 
        type: String,
        trim: true 
    },
    
    folder: { 
        type: String, 
        default: '',
        trim: true 
    },
    
    // Questions array (flexible for different test types)
    questions: { 
        type: Array,
        default: [] 
    }
}, {
    timestamps: true // Adds createdAt and updatedAt automatically
});

// Indexes for better query performance
testSchema.index({ createdBy: 1, type: 1 });
testSchema.index({ title: 'text' }); // Text search on title

module.exports = mongoose.model('Test', testSchema);
