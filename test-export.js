/**
 * Test script to verify reading, listening, and writing HTML export from
 * test-platform matches the builder-style student templates.
 */

const { generateHTMLFromTest } = require('./utils/htmlExporter');

const sampleReadingTest = {
    _id: '69dfc4326a334a9b5fc9c058',
    title: 'Carnivorous plant',
    type: 'reading',
    teacherName: 'jamolbek',
    readingPassage: JSON.stringify({
        p1: {
            title: 'Carnivorous plant',
            text: '<p style="margin-bottom: 15px;">They attract insects and then eat their flesh. Is that any way for a plant to behave?</p>',
            questions: '<div class="question-section-header">Questions 1-5</div><div class="gap-fill-text">Test questions here...</div>'
        },
        p2: {
            title: 'Drawing Lessons from History',
            text: '<p style="margin-bottom: 15px;">Numerous ancient civilizations collapsed...</p>',
            questions: '<div class="question-section-header">Questions 14-26</div>'
        },
        p3: {
            title: 'Neanderthal Technology',
            text: '<p style="margin-bottom: 15px;">We think of our prehistoric ancestors...</p>',
            questions: '<div class="question-section-header">Questions 27-40</div>'
        },
        answerKey: {
            '1': 'Raindrops',
            '2': 'Stomach',
            '3': 'Pores'
        }
    })
};

const sampleListeningTest = {
    _id: '69dfc4326a334a9b5fc9c099',
    title: 'Sample Listening Test',
    type: 'listening',
    teacherName: 'jamolbek',
    readingPassage: JSON.stringify({
        parts: {
            1: {
                finalHtml: '<div class="question-section-header"><strong>SECTION 1</strong><br>Questions 1-2</div><div class="short-answer-question" data-q-start="1"><p><strong>1</strong> Sample question <input id="q1" class="answer-input" placeholder="1" style="width:160px;" autocomplete="off"></p></div>'
            },
            2: { finalHtml: '<div class="question-section-header"><strong>SECTION 2</strong></div>' },
            3: { finalHtml: '<div class="question-section-header"><strong>SECTION 3</strong></div>' },
            4: { finalHtml: '<div class="question-section-header"><strong>SECTION 4</strong></div>' }
        },
        answerKey: {
            '1': 'Jamie',
            '2': ['11 July', '11th July']
        },
        audioParts: ['https://example.com/part1.mp3', null, null, null],
        fullAudio: null,
        includePause: true
    })
};

const sampleWritingTest = {
    _id: '69dfc4326a334a9b5fc9c111',
    title: 'Sample Writing Test',
    type: 'writing',
    teacherName: 'jamolbek',
    readingPassage: JSON.stringify({
        timeLimit: 60,
        task1: {
            prompt: 'The chart below shows changes in household spending over a ten-year period.',
            image: 'https://example.com/chart.png',
            modelAnswer: 'Sample task 1 answer.'
        },
        task2: {
            prompt: 'Some people believe that children should learn practical skills at school.',
            modelAnswer: 'Sample task 2 answer.'
        }
    })
};

function runChecks(name, html, checks) {
    console.log(`${name} Validation Results:`);
    console.log('='.repeat(50));

    let passed = 0;
    checks.forEach((check) => {
        const status = check.test ? 'PASS' : 'FAIL';
        console.log(`${status}: ${check.name}`);
        if (check.test) {
            passed += 1;
        }
    });

    console.log('='.repeat(50));
    console.log(`\n${name} Result: ${passed}/${checks.length} checks passed\n`);

    return passed === checks.length;
}

try {
    console.log('Testing HTML generation from test-platform documents...\n');

    const readingHtml = generateHTMLFromTest(sampleReadingTest);
    const listeningHtml = generateHTMLFromTest(sampleListeningTest);
    const writingHtml = generateHTMLFromTest(sampleWritingTest, { groqApiKey: 'demo-key' });

    const readingChecks = [
        { name: 'HTML starts correctly', test: readingHtml.startsWith('<!DOCTYPE html>') },
        { name: 'Contains IELTS Reading Test title', test: readingHtml.includes('IELTS Reading Test') },
        { name: 'Has passage panel', test: readingHtml.includes('id="passagePanel"') },
        { name: 'Has questions panel', test: readingHtml.includes('id="questionsPanel"') },
        { name: 'Contains p1 content', test: readingHtml.includes('id="p1"') },
        { name: 'Contains p2 content', test: readingHtml.includes('id="p2"') },
        { name: 'Contains p3 content', test: readingHtml.includes('id="p3"') },
        { name: 'Has theme toggle', test: readingHtml.includes('toggleTheme()') },
        { name: 'Has timer', test: readingHtml.includes('timerDisplay') },
        { name: 'Has Builder submit button', test: readingHtml.includes('Submit & Check') },
        { name: 'Uses Builder Unicode-safe answer decoding', test: readingHtml.includes('JSON.parse(decodeURIComponent(simpleDec(') },
        { name: 'Has Builder advanced navigator logic', test: readingHtml.includes('const scanRoot = (root) => {') },
        { name: 'Includes dark mode styles', test: readingHtml.includes('dark-mode') },
        { name: 'Has modern table styles', test: readingHtml.includes('modern-ielts-table') },
        { name: 'Includes Platform Theme button', test: readingHtml.includes('Platform Theme') },
        { name: 'Includes platform theme controller', test: readingHtml.includes('toggleSiteTheme') },
        { name: 'Has stable session key', test: readingHtml.includes("const SESSION_KEY = 'ielts_state_test_69dfc4326a334a9b5fc9c058';") },
        { name: 'HTML closes properly', test: readingHtml.endsWith('</html>') }
    ];

    const listeningChecks = [
        { name: 'Listening HTML starts correctly', test: listeningHtml.startsWith('<!DOCTYPE html>') },
        { name: 'Listening uses Builder title', test: listeningHtml.includes('<title>IELTS Listening Test</title>') },
        { name: 'Listening start overlay uses Builder title', test: listeningHtml.includes('<h1 style="color:#2c3e50; margin-bottom: 20px; font-size:3rem;">IELTS Listening Test</h1>') },
        { name: 'Listening contains Part 1 panel', test: listeningHtml.includes('id="panel_q1"') },
        { name: 'Listening includes saved Part 1 HTML', test: listeningHtml.includes('SECTION 1') && listeningHtml.includes('Sample question') },
        { name: 'Listening answer key is encoded for Builder-style grading', test: listeningHtml.includes('const encodedKey = ') && listeningHtml.includes('JSON.parse(atob(encodedKey))') },
        { name: 'Listening audio state key is present', test: listeningHtml.includes("const AUDIO_KEY = SESSION_KEY + '_audio_state';") },
        { name: 'Listening keeps audio URL', test: listeningHtml.includes('https://example.com/part1.mp3') },
        { name: 'Listening pause setting survives export', test: listeningHtml.includes('const usePause = true;') },
        { name: 'Listening includes start overlay', test: listeningHtml.includes('id="startOverlay"') },
        { name: 'Listening includes submit button', test: listeningHtml.includes('Submit & Check') },
        { name: 'Includes Platform Theme button', test: listeningHtml.includes('Platform Theme') },
        { name: 'Listening syncs to student dashboard API', test: listeningHtml.includes("fetch('/api/test-submissions'") },
        { name: 'Listening payload type is set', test: listeningHtml.includes("type: 'listening'") },
        { name: 'Listening HTML closes properly', test: listeningHtml.endsWith('</html>') }
    ];

    const writingChecks = [
        { name: 'Writing HTML starts correctly', test: writingHtml.startsWith('<!DOCTYPE html>') },
        { name: 'Writing uses Builder title', test: writingHtml.includes('<title>IELTS Writing Test</title>') },
        { name: 'Writing includes Task 1 prompt', test: writingHtml.includes('household spending over a ten-year period') },
        { name: 'Writing includes Task 2 prompt', test: writingHtml.includes('children should learn practical skills at school') },
        { name: 'Writing includes Task 1 image', test: writingHtml.includes('https://example.com/chart.png') },
        { name: 'Writing injects current Groq API key', test: writingHtml.includes('demo-key') },
        { name: 'Writing uses stable session key', test: writingHtml.includes('const SESSION_ID = "ielts_writing_69dfc4326a334a9b5fc9c111";') },
        { name: 'Includes Platform Theme button', test: writingHtml.includes('Platform Theme') },
        { name: 'Includes platform theme controller', test: writingHtml.includes('toggleSiteTheme') },
        { name: 'Writing HTML closes properly', test: writingHtml.endsWith('</html>') }
    ];

    const readingOk = runChecks('Reading', readingHtml, readingChecks);
    const listeningOk = runChecks('Listening', listeningHtml, listeningChecks);
    const writingOk = runChecks('Writing', writingHtml, writingChecks);

    if (readingOk) {
        console.log('Reading export matches the builder-style student shell.');
    } else {
        console.log('Some reading checks failed. Please review the reading HTML output.');
    }

    if (listeningOk) {
        console.log('Listening export matches the builder-style student shell and keeps audio URL support.');
    } else {
        console.log('Some listening checks failed. Please review the listening HTML output.');
    }

    if (writingOk) {
        console.log('Writing export matches the builder-style student shell.');
    } else {
        console.log('Some writing checks failed. Please review the writing HTML output.');
    }

    if (!readingOk || !listeningOk || !writingOk) {
        process.exit(1);
    }
} catch (error) {
    console.error('Error during HTML generation:', error);
    process.exit(1);
}
