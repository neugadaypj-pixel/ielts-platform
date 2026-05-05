const mongoose = require('mongoose');

// Base test schema with common fields
const baseTestSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: true,
        trim: true,
        maxlength: 200
    },
    type: { 
        type: String, 
        enum: ['reading', 'listening', 'writing'], 
        required: true
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
    customTitle: { 
        type: String,
        trim: true 
    },
    folder: { 
        type: String, 
        default: '',
        trim: true 
    }
}, {
    timestamps: true,
    discriminatorKey: 'type'
});

// Indexes for better query performance
baseTestSchema.index({ createdBy: 1, type: 1 });
baseTestSchema.index({ title: 'text' });

const Test = mongoose.model('Test', baseTestSchema);

// Reading Test Schema
const ReadingTest = Test.discriminator('reading', new mongoose.Schema({
    passages: [{
        title: String,
        content: String,
        questions: [{
            type: String,
            question: String,
            options: [String],
            correctAnswer: String
        }]
    }],
    readingPassage: String, // Legacy field for backward compatibility
    builderJson: String,
    questions: Array
}));

// Listening Test Schema
const ListeningTest = Test.discriminator('listening', new mongoose.Schema({
    audioUrl: {
        type: String,
        required: function() {
            return this.type === 'listening';
        }
    },
    audioParts: [{
        partNumber: Number,
        audioUrl: String
    }],
    parts: [{
        partNumber: Number,
        questions: [{
            type: String,
            question: String,
            options: [String],
            correctAnswer: String
        }]
    }],
    answerKey: {
        type: Map,
        of: String
    },
    includePause: {
        type: Boolean,
        default: false
    },
    readingPassage: String, // Legacy field for backward compatibility
    builderJson: String,
    questions: Array
}));

// Writing Test Schema
const WritingTest = Test.discriminator('writing', new mongoose.Schema({
    timeLimit: {
        type: Number,
        default: 60 // minutes
    },
    task1: {
        prompt: String,
        image: String,
        modelAnswer: String,
        minWords: {
            type: Number,
            default: 150
        }
    },
    task2: {
        prompt: String,
        modelAnswer: String,
        minWords: {
            type: Number,
            default: 250
        }
    },
    readingPassage: String, // Legacy field for backward compatibility
    builderJson: String
}));

module.exports = {
    Test,
    ReadingTest,
    ListeningTest,
    WritingTest
};
