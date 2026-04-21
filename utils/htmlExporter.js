const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const templatePaths = {
    reading: path.join(__dirname, '..', 'views', 'export-reading.ejs'),
    listening: path.join(__dirname, '..', 'views', 'export-listening.ejs')
};

const cachedTemplates = new Map();

function getTemplatePath(testType = 'reading') {
    const templatePath = templatePaths[testType];
    if (!templatePath) {
        throw new Error(`Unsupported test type: ${testType}`);
    }
    return templatePath;
}

function getHTMLTemplate(testType = 'reading') {
    if (!cachedTemplates.has(testType)) {
        cachedTemplates.set(testType, fs.readFileSync(getTemplatePath(testType), 'utf8'));
    }
    return cachedTemplates.get(testType);
}

function toPlainObject(testDoc) {
    if (typeof testDoc?.toObject === 'function') {
        return testDoc.toObject();
    }
    return { ...testDoc };
}

function parseStoredContent(raw, fieldName) {
    if (!raw) {
        throw new Error(`Invalid test document: missing ${fieldName}`);
    }

    if (typeof raw === 'string') {
        return JSON.parse(raw);
    }

    if (typeof raw === 'object') {
        return raw;
    }

    throw new Error(`Invalid test document: unsupported ${fieldName} format`);
}

function normalizeListeningContent(parsed = {}) {
    const partsSource = parsed.parts && typeof parsed.parts === 'object' ? parsed.parts : {};
    const getPartSource = (index) => partsSource[index] ?? partsSource[String(index)];

    const parts = {};
    for (let index = 1; index <= 4; index += 1) {
        const source = getPartSource(index);
        const sourceMeta = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
        const fallbackHtml = parsed[`p${index}`] ?? parsed[`q${index}_text`] ?? '';

        parts[index] = {
            ...sourceMeta,
            finalHtml: typeof source === 'string'
                ? source
                : (sourceMeta.finalHtml ?? sourceMeta.html ?? fallbackHtml ?? '')
        };
    }

    const rawAnswerKey = parsed.answerKey ?? parsed.answer_key ?? {};
    let answerKey = '{}';

    if (typeof rawAnswerKey === 'string') {
        try {
            JSON.parse(rawAnswerKey);
            answerKey = rawAnswerKey;
        } catch (error) {
            answerKey = '{}';
        }
    } else {
        answerKey = JSON.stringify(rawAnswerKey || {});
    }

    let audioParts = parsed.audioParts ?? parsed.audio?.parts ?? [null, null, null, null];
    if (!Array.isArray(audioParts)) {
        audioParts = [null, null, null, null];
    }
    if (audioParts.length < 4) {
        audioParts = [...audioParts, ...Array(4 - audioParts.length).fill(null)];
    } else if (audioParts.length > 4) {
        audioParts = audioParts.slice(0, 4);
    }

    const fullAudio = parsed.fullAudio ?? parsed.audio?.full ?? null;
    const includePause = Boolean(parsed.includePause ?? parsed.audio?.usePause ?? false);

    return {
        parts,
        answerKey,
        audioParts,
        fullAudio,
        includePause
    };
}

function normalizeReadingTest(testDoc) {
    const plainTest = toPlainObject(testDoc);
    parseStoredContent(plainTest.readingPassage ?? plainTest.content, 'readingPassage');
    return plainTest;
}

function normalizeListeningTest(testDoc) {
    const plainTest = toPlainObject(testDoc);
    const parsed = parseStoredContent(plainTest.readingPassage ?? plainTest.content, 'listening content');
    const normalizedContent = normalizeListeningContent(parsed);

    return {
        ...plainTest,
        content: normalizedContent,
        audioParts: normalizedContent.audioParts,
        fullAudio: normalizedContent.fullAudio,
        includePause: normalizedContent.includePause
    };
}

function validateTestDocument(testDoc) {
    if (!testDoc) {
        throw new Error('Invalid test document');
    }

    const testType = String(testDoc.type || 'reading').toLowerCase();

    if (testType === 'reading') {
        return normalizeReadingTest(testDoc);
    }

    if (testType === 'listening') {
        return normalizeListeningTest(testDoc);
    }

    throw new Error(`Unsupported test type: ${testType}`);
}

function generateHTMLFromTest(testDoc) {
    try {
        const validatedTest = validateTestDocument(testDoc);
        const templateType = validatedTest.type === 'listening' ? 'listening' : 'reading';
        const templatePath = getTemplatePath(templateType);

        return ejs.render(
            getHTMLTemplate(templateType),
            { test: validatedTest },
            { filename: templatePath }
        ).trim();
    } catch (error) {
        console.error('Error generating HTML:', error);
        throw new Error(`Failed to generate HTML from test document: ${error.message}`);
    }
}

module.exports = {
    generateHTMLFromTest,
    getHTMLTemplate
};
