const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require('./logger');

/**
 * Call DeepSeek AI API
 */
async function callDeepSeek(prompt) {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: 'deepseek-v4-pro',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 1500
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'DeepSeek API error');
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
}
async function analyzeReadingTest(submission, test) {
    try {
        const incorrectAnswers = submission.details?.incorrectSummary || 'Not available';
        const questionTypes = extractQuestionTypes(test);
        
        const prompt = `Expert IELTS Reading instructor analyzing student performance:

Test: ${test.title}
Score: ${submission.score}/${submission.totalQuestions} (${submission.percentage}%)
Time: ${submission.timeRemainingText || 'Not recorded'}
Incorrect Answers: ${incorrectAnswers.slice(0, 200)}
Question Types: ${questionTypes}

Provide detailed analysis:

📊 PERFORMANCE BREAKDOWN:
[Analyze by question type - strengths and weaknesses]

🎯 WEAKNESSES DETECTED:
1. [Primary weakness with specific examples]
2. [Secondary weakness with examples]
3. [Tertiary weakness with examples]

💡 PERSONALIZED RECOMMENDATIONS:
1. [Specific actionable advice]
2. [Practice suggestion]
3. [Study resource]

📈 4-WEEK IMPROVEMENT PLAN:
Week 1: [Specific focus and daily practice]
Week 2: [Specific focus and daily practice]
Week 3: [Specific focus and daily practice]
Week 4: [Specific focus and daily practice]

🎯 TARGET:
Improve from ${submission.percentage}% to [realistic target]% in 4 weeks

Be concise, actionable, and encouraging.`;

        const analysis = await callDeepSeek(prompt);
        
        logger.info('Reading test analyzed by DeepSeek AI', { 
            submissionId: submission._id,
            score: submission.score 
        });
        
        return {
            success: true,
            analysis: analysis,
            analyzedAt: new Date(),
            model: 'deepseek-chat'
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
        
        const prompt = `Expert IELTS Listening instructor analyzing student performance:

Test: ${test.title}
Score: ${submission.score}/${submission.totalQuestions} (${submission.percentage}%)
Time: ${submission.timeRemainingText || 'Not recorded'}
Section Performance: ${sectionScores}
Incorrect Answers: ${incorrectAnswers.slice(0, 200)}

Provide detailed analysis:

📊 SECTION-BY-SECTION ANALYSIS:
Section 1 (Conversation): [Performance and issues]
Section 2 (Monologue): [Performance and issues]
Section 3 (Discussion): [Performance and issues]
Section 4 (Lecture): [Performance and issues]

🎯 WEAKNESSES DETECTED:
1. [Primary weakness with examples]
2. [Secondary weakness with examples]
3. [Tertiary weakness with examples]

💡 PERSONALIZED RECOMMENDATIONS:
1. [Specific listening practice advice]
2. [Note-taking strategy]
3. [Accent exposure recommendation]

📈 4-WEEK IMPROVEMENT PLAN:
Week 1: [Specific focus - e.g., British accent, 30 min daily]
Week 2: [Specific focus - e.g., Section 4 practice]
Week 3: [Specific focus - e.g., Multiple choice strategies]
Week 4: [Full practice tests with review]

🎯 TARGET:
Improve from ${submission.percentage}% to [realistic target]% in 4 weeks

Be concise, actionable, and encouraging.`;

        const analysis = await callDeepSeek(prompt);
        
        logger.info('Listening test analyzed by DeepSeek AI', { 
            submissionId: submission._id,
            score: submission.score 
        });
        
        return {
            success: true,
            analysis: analysis,
            analyzedAt: new Date(),
            model: 'deepseek-chat'
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
        
        const submissionSummary = submissions.map((sub, index) => {
            const date = new Date(sub.createdAt).toLocaleDateString();
            const errors = sub.details?.incorrectSummary ? ` | Errors: ${sub.details.incorrectSummary.slice(0, 80)}` : '';
            return `Test ${index + 1}: ${sub.type} - ${sub.score}/${sub.totalQuestions} (${sub.percentage}%) - ${date}${errors}`;
        }).join('\n');
        
        const prompt = `IELTS expert analyzing student progress across ${submissions.length} tests:

${submissionSummary}

Provide analysis:

🔍 CONSISTENT WEAKNESSES:
[Weaknesses appearing in 3+ tests - core problems]

📈 IMPROVEMENT TRENDS:
[What improved over time - encourage student]

⚠️ STAGNANT AREAS:
[What hasn't improved - needs urgent attention]

✅ STRENGTHS TO MAINTAIN:
[What student is consistently good at]

💡 PRIORITY ACTION PLAN:
1. [Most urgent area to focus on]
2. [Second priority]
3. [Third priority]

Be encouraging but honest. Focus on actionable insights.`;

        const patterns = await callDeepSeek(prompt);
        
        logger.info('Pattern analysis completed by DeepSeek AI', { 
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
