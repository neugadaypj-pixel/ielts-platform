const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require('./logger');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

/**
 * Analyze Reading Test Submission
 * Detects weaknesses, patterns, and provides personalized recommendations
 */
async function analyzeReadingTest(submission, test) {
    try {
        const incorrectAnswers = submission.details?.incorrectSummary || 'Not available';
        const questionTypes = extractQuestionTypes(test);
        
        const prompt = `You are an expert IELTS Reading instructor. Analyze this student's performance:

**Test Details:**
- Test Title: ${test.title}
- Total Questions: ${submission.totalQuestions}
- Correct Answers: ${submission.score}
- Incorrect Answers: ${submission.totalQuestions - submission.score}
- Score: ${submission.percentage}%
- Time Taken: ${submission.timeRemainingText || 'Not recorded'}

**Incorrect Answers:**
${incorrectAnswers}

**Question Types in Test:**
${questionTypes}

**Provide a detailed analysis in this EXACT format:**

📊 PERFORMANCE BREAKDOWN:
[Analyze performance by question type - which types they got right/wrong]

🎯 WEAKNESSES DETECTED:
1. [Primary weakness with specific examples]
2. [Secondary weakness with specific examples]
3. [Tertiary weakness with specific examples]

💡 PERSONALIZED RECOMMENDATIONS:
1. [Specific actionable advice]
2. [Specific practice suggestion]
3. [Specific study resource]

📈 4-WEEK IMPROVEMENT PLAN:
Week 1: [Specific focus area and daily practice]
Week 2: [Specific focus area and daily practice]
Week 3: [Specific focus area and daily practice]
Week 4: [Specific focus area and daily practice]

🎯 TARGET:
Improve from ${submission.percentage}% to [realistic target]% in 4 weeks

Keep it concise, actionable, and encouraging. Focus on specific IELTS Reading strategies.`;

        const result = await model.generateContent(prompt);
        const analysis = result.response.text();
        
        logger.info('Reading test analyzed by AI', { 
            submissionId: submission._id,
            score: submission.score 
        });
        
        return {
            success: true,
            analysis: analysis,
            analyzedAt: new Date(),
            model: 'gemini-1.5-flash'
        };
    } catch (error) {
        logger.error('AI Reading analysis failed', { 
            error: error.message,
            submissionId: submission._id 
        });
        
        return {
            success: false,
            analysis: generateBasicReadingAnalysis(submission),
            error: error.message
        };
    }
}

/**
 * Analyze Listening Test Submission
 * Detects section weaknesses, accent issues, and provides recommendations
 */
async function analyzeListeningTest(submission, test) {
    try {
        const incorrectAnswers = submission.details?.incorrectSummary || 'Not available';
        const sectionScores = extractSectionScores(submission);
        
        const prompt = `You are an expert IELTS Listening instructor. Analyze this student's performance:

**Test Details:**
- Test Title: ${test.title}
- Total Questions: ${submission.totalQuestions}
- Correct Answers: ${submission.score}
- Incorrect Answers: ${submission.totalQuestions - submission.score}
- Score: ${submission.percentage}%
- Time Taken: ${submission.timeRemainingText || 'Not recorded'}

**Section Performance:**
${sectionScores}

**Incorrect Answers:**
${incorrectAnswers}

**Provide a detailed analysis in this EXACT format:**

📊 SECTION-BY-SECTION ANALYSIS:
Section 1 (Conversation): [Performance and issues]
Section 2 (Monologue): [Performance and issues]
Section 3 (Discussion): [Performance and issues]
Section 4 (Lecture): [Performance and issues]

🎯 WEAKNESSES DETECTED:
1. [Primary weakness - e.g., accent recognition, note-taking, focus]
2. [Secondary weakness with specific examples]
3. [Tertiary weakness with specific examples]

💡 PERSONALIZED RECOMMENDATIONS:
1. [Specific listening practice advice]
2. [Note-taking strategy]
3. [Accent exposure recommendation]

📈 4-WEEK IMPROVEMENT PLAN:
Week 1: [Specific focus - e.g., British accent exposure, 30 min daily]
Week 2: [Specific focus - e.g., Section 4 practice, note-taking drills]
Week 3: [Specific focus - e.g., Multiple choice strategies]
Week 4: [Full practice tests with review]

🎯 TARGET:
Improve from ${submission.percentage}% to [realistic target]% in 4 weeks

Keep it concise, actionable, and encouraging. Focus on specific IELTS Listening strategies.`;

        const result = await model.generateContent(prompt);
        const analysis = result.response.text();
        
        logger.info('Listening test analyzed by AI', { 
            submissionId: submission._id,
            score: submission.score 
        });
        
        return {
            success: true,
            analysis: analysis,
            analyzedAt: new Date(),
            model: 'gemini-1.5-flash'
        };
    } catch (error) {
        logger.error('AI Listening analysis failed', { 
            error: error.message,
            submissionId: submission._id 
        });
        
        return {
            success: false,
            analysis: generateBasicListeningAnalysis(submission),
            error: error.message
        };
    }
}

/**
 * Detect Patterns Across Multiple Tests
 * Analyzes last 5 submissions to find consistent weaknesses
 */
async function detectPatterns(studentId, submissions) {
    try {
        if (!submissions || submissions.length < 2) {
            return {
                success: false,
                message: 'Need at least 2 submissions to detect patterns'
            };
        }
        
        const submissionSummary = submissions.map((sub, index) => `
Test ${index + 1}:
- Type: ${sub.type}
- Score: ${sub.score}/${sub.totalQuestions} (${sub.percentage}%)
- Date: ${new Date(sub.createdAt).toLocaleDateString()}
- Weaknesses: ${sub.details?.incorrectSummary || 'Not available'}
        `).join('\n');
        
        const prompt = `You are an IELTS expert analyzing a student's progress across multiple tests.

**Student's Last ${submissions.length} Tests:**
${submissionSummary}

**Analyze and provide:**

🔍 CONSISTENT WEAKNESSES:
[List weaknesses that appear in 3+ tests - these are the student's core problems]

📈 IMPROVEMENT TRENDS:
[What has improved over time? Encourage the student!]

⚠️ STAGNANT AREAS:
[What hasn't improved? These need urgent attention]

✅ STRENGTHS TO MAINTAIN:
[What is the student consistently good at?]

💡 PRIORITY ACTION PLAN:
1. [Most urgent area to focus on]
2. [Second priority]
3. [Third priority]

Keep it encouraging but honest. Focus on actionable insights.`;

        const result = await model.generateContent(prompt);
        const patterns = result.response.text();
        
        logger.info('Pattern analysis completed', { 
            studentId,
            testsAnalyzed: submissions.length 
        });
        
        return {
            success: true,
            patterns: patterns,
            analyzedAt: new Date(),
            testsAnalyzed: submissions.length
        };
    } catch (error) {
        logger.error('Pattern detection failed', { 
            error: error.message,
            studentId 
        });
        
        return {
            success: false,
            message: 'Pattern analysis unavailable',
            error: error.message
        };
    }
}

/**
 * Helper: Extract question types from test
 */
function extractQuestionTypes(test) {
    try {
        const content = JSON.parse(test.readingPassage || '{}');
        const types = new Set();
        
        // Extract from different test formats
        if (content.parts) {
            Object.values(content.parts).forEach(part => {
                if (part.questionType) types.add(part.questionType);
            });
        }
        
        if (types.size === 0) {
            return 'Multiple Choice, True/False/Not Given, Matching, Fill in the Blanks';
        }
        
        return Array.from(types).join(', ');
    } catch (error) {
        return 'Various question types';
    }
}

/**
 * Helper: Extract section scores from listening test
 */
function extractSectionScores(submission) {
    try {
        const details = submission.details || {};
        if (details.sectionScores) {
            return Object.entries(details.sectionScores)
                .map(([section, score]) => `${section}: ${score}`)
                .join('\n');
        }
        return 'Section scores not available';
    } catch (error) {
        return 'Section scores not available';
    }
}

/**
 * Fallback: Basic Reading Analysis (No AI)
 */
function generateBasicReadingAnalysis(submission) {
    const percentage = submission.percentage || 0;
    let level = 'needs significant improvement';
    if (percentage >= 80) level = 'excellent';
    else if (percentage >= 70) level = 'good';
    else if (percentage >= 60) level = 'satisfactory';
    
    return `📊 BASIC ANALYSIS:

Score: ${submission.score}/${submission.totalQuestions} (${percentage}%)
Performance: ${level}

💡 GENERAL RECOMMENDATIONS:
1. Practice reading comprehension daily (30 minutes)
2. Expand academic vocabulary
3. Work on time management (20 minutes per passage)
4. Review incorrect answers to understand mistakes

Note: Detailed AI analysis temporarily unavailable. This is a basic assessment.`;
}

/**
 * Fallback: Basic Listening Analysis (No AI)
 */
function generateBasicListeningAnalysis(submission) {
    const percentage = submission.percentage || 0;
    let level = 'needs significant improvement';
    if (percentage >= 80) level = 'excellent';
    else if (percentage >= 70) level = 'good';
    else if (percentage >= 60) level = 'satisfactory';
    
    return `📊 BASIC ANALYSIS:

Score: ${submission.score}/${submission.totalQuestions} (${percentage}%)
Performance: ${level}

💡 GENERAL RECOMMENDATIONS:
1. Practice listening daily with various accents (British, American, Australian)
2. Improve note-taking skills (use abbreviations)
3. Focus on academic lectures (Section 4)
4. Practice with authentic IELTS materials

Note: Detailed AI analysis temporarily unavailable. This is a basic assessment.`;
}

module.exports = {
    analyzeReadingTest,
    analyzeListeningTest,
    detectPatterns
};
