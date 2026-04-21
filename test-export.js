/**
 * Test script to verify reading and listening HTML export from test-platform
 * matches the Builder-style student templates.
 */

const { generateHTMLFromTest } = require('./utils/htmlExporter');

const sampleReadingTest = {
    _id: "69dfc4326a334a9b5fc9c058",
    title: "Carnivorous plant",
    type: "reading",
    teacherName: "jamolbek",
    readingPassage: JSON.stringify({
        p1: {
            title: "Carnivorous plant",
            text: "<p style=\"margin-bottom: 15px;\">They attract insects and then eat their flesh. Is that any way for a plant to behave?</p>",
            questions: "<div class=\"question-section-header\">Questions 1вЂ“5</div><div class=\"gap-fill-text\">Test questions here...</div>"
        },
        p2: {
            title: "Drawing Lessons from History",
            text: "<p style=\"margin-bottom: 15px;\">Numerous ancient civilizations collapsed...</p>",
            questions: "<div class=\"question-section-header\">Questions 14вЂ“26</div>"
        },
        p3: {
            title: "Neanderthal Technology",
            text: "<p style=\"margin-bottom: 15px;\">We think of our prehistoric ancestors...</p>",
            questions: "<div class=\"question-section-header\">Questions 27вЂ“40</div>"
        },
        answerKey: {
            "1": "Raindrops",
            "2": "Stomach",
            "3": "Pores"
        }
    })
};

const sampleListeningTest = {
    _id: "69dfc4326a334a9b5fc9c099",
    title: "Sample Listening Test",
    type: "listening",
    teacherName: "jamolbek",
    readingPassage: JSON.stringify({
        p1: '<div class="question-section-header"><strong>SECTION 1</strong><br>Questions 1-2</div><div class="short-answer-question" data-q-start="1"><p><strong>1</strong> Sample question <input id="q1" class="answer-input" placeholder="1" style="width:160px;" autocomplete="off"></p></div>',
        p2: '<div class="question-section-header"><strong>SECTION 2</strong></div>',
        p3: '<div class="question-section-header"><strong>SECTION 3</strong></div>',
        p4: '<div class="question-section-header"><strong>SECTION 4</strong></div>',
        answerKey: {
            "1": "Jamie",
            "2": ["11 July", "11th July"]
        },
        audio: {
            full: null,
            parts: [null, null, null, null],
            usePause: true
        }
    })
};

function runChecks(name, html, checks) {
    console.log(`${name} Validation Results:`);
    console.log("=".repeat(50));

    let passed = 0;
    checks.forEach(check => {
        const status = check.test ? "вњ“ PASS" : "вњ— FAIL";
        console.log(`${status}: ${check.name}`);
        if (check.test) passed += 1;
    });

    console.log("=".repeat(50));
    console.log(`\n${name} Result: ${passed}/${checks.length} checks passed\n`);

    return passed === checks.length;
}

try {
    console.log("Testing HTML generation from test-platform documents...\n");

    const readingHtml = generateHTMLFromTest(sampleReadingTest);
    const listeningHtml = generateHTMLFromTest(sampleListeningTest);

    const readingChecks = [
        { name: "HTML starts correctly", test: readingHtml.startsWith('<!DOCTYPE html>') },
        { name: "Contains IELTS Reading Test title", test: readingHtml.includes('IELTS Reading Test') },
        { name: "Has passage panel", test: readingHtml.includes('id="passagePanel"') },
        { name: "Has questions panel", test: readingHtml.includes('id="questionsPanel"') },
        { name: "Contains p1 content", test: readingHtml.includes('id="p1"') },
        { name: "Contains p2 content", test: readingHtml.includes('id="p2"') },
        { name: "Contains p3 content", test: readingHtml.includes('id="p3"') },
        { name: "Has theme toggle", test: readingHtml.includes('toggleTheme()') },
        { name: "Has timer", test: readingHtml.includes('timerDisplay') },
        { name: "Has Builder submit button", test: readingHtml.includes('Submit & Check') },
        { name: "Uses Builder Unicode-safe answer decoding", test: readingHtml.includes('JSON.parse(decodeURIComponent(simpleDec(') },
        { name: "Has Builder advanced navigator logic", test: readingHtml.includes('const scanRoot = (root) => {') },
        { name: "Includes dark mode styles", test: readingHtml.includes('dark-mode') },
        { name: "Has modern table styles", test: readingHtml.includes('modern-ielts-table') },
        { name: "HTML closes properly", test: readingHtml.endsWith('</html>') }
    ];

    const listeningChecks = [
        { name: "Listening HTML starts correctly", test: listeningHtml.startsWith('<!DOCTYPE html>') },
        { name: "Listening uses Builder title", test: listeningHtml.includes('<title>IELTS Listening Test</title>') },
        { name: "Listening start overlay uses Builder title", test: listeningHtml.includes('<h1 style="color:#2c3e50; margin-bottom: 20px; font-size:3rem;">IELTS Listening Test</h1>') },
        { name: "Listening contains Part 1 panel", test: listeningHtml.includes('id="panel_q1"') },
        { name: "Listening includes saved Part 1 HTML", test: listeningHtml.includes('SECTION 1') && listeningHtml.includes('Sample question') },
        { name: "Listening answer key is encoded for Builder-style grading", test: listeningHtml.includes('const encodedKey = ') && listeningHtml.includes('JSON.parse(atob(encodedKey))') },
        { name: "Listening audio state key is present", test: listeningHtml.includes("const AUDIO_KEY = SESSION_KEY + '_audio_state';") },
        { name: "Listening pause setting survives export", test: listeningHtml.includes('const usePause = true;') },
        { name: "Listening includes start overlay", test: listeningHtml.includes('id="startOverlay"') },
        { name: "Listening includes submit button", test: listeningHtml.includes('Submit & Check') },
        { name: "Listening HTML closes properly", test: listeningHtml.endsWith('</html>') }
    ];

    const readingOk = runChecks('Reading', readingHtml, readingChecks);
    const listeningOk = runChecks('Listening', listeningHtml, listeningChecks);

    if (readingOk) {
        console.log("вњ… Reading export is still compatible with Builder_v70.html format!");
    } else {
        console.log("вљ пёЏ Some reading checks failed. Please review the reading HTML output.");
    }

    if (listeningOk) {
        console.log("вњ… Listening export now matches the Builder-style student test shell.");
    } else {
        console.log("вљ пёЏ Some listening checks failed. Please review the listening HTML output.");
    }

    if (!readingOk || !listeningOk) {
        process.exit(1);
    }
} catch (error) {
    console.error("вќЊ Error during HTML generation:", error);
    process.exit(1);
}
