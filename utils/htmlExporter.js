const vm = require('vm');
const { readBuilderFinalTemplate, readBuilderSource } = require('./builderAssets');

const generateFileSourceCache = new Map();

function toPlainObject(testDoc) {
    if (typeof testDoc?.toObject === 'function') {
        return testDoc.toObject();
    }

    return { ...testDoc };
}

function stringifyContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    return JSON.stringify(content ?? {});
}

function parseStoredContent(raw, fieldName) {
    if (!raw) {
        throw new Error(`Invalid test document: missing ${fieldName}`);
    }

    if (typeof raw === 'string') {
        const trimmed = raw.trim();

        if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) {
            return { __rawHtml: raw };
        }

        return JSON.parse(raw);
    }

    if (typeof raw === 'object') {
        return raw;
    }

    throw new Error(`Invalid test document: unsupported ${fieldName} format`);
}

function escapeForBuilderValue(value) {
    return String(value ?? '')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
}

function replaceAllLiteral(template, searchValue, replacementValue) {
    return template.split(searchValue).join(replacementValue);
}

function applyLiteralReplacements(template, replacements) {
    return replacements.reduce(
        (currentTemplate, [searchValue, replacementValue]) => replaceAllLiteral(currentTemplate, searchValue, replacementValue),
        template
    );
}

function createStableSessionId(testDoc, prefix) {
    const plainTest = toPlainObject(testDoc);
    const rawId = plainTest._id ? String(plainTest._id) : `${plainTest.type || 'test'}_${plainTest.title || 'platform'}`;
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${prefix}${safeId}`;
}

function hashStringToSixDigits(value) {
    const source = String(value || '0');
    let hash = 17;

    for (let index = 0; index < source.length; index += 1) {
        hash = (hash * 31 + source.charCodeAt(index)) % 1000000;
    }

    return hash;
}

function createDeterministicMath(seedValue) {
    const mathObject = {};

    for (const propertyName of Object.getOwnPropertyNames(Math)) {
        mathObject[propertyName] = Math[propertyName];
    }

    const sixDigitSeed = hashStringToSixDigits(seedValue);
    mathObject.random = () => (sixDigitSeed + 0.5) / 1000000;

    return mathObject;
}

function extractGenerateFileSource(type) {
    const normalizedType = String(type || '').toLowerCase();

    if (generateFileSourceCache.has(normalizedType)) {
        return generateFileSourceCache.get(normalizedType);
    }

    const source = readBuilderSource(normalizedType);
    const functionStart = source.indexOf('function generateFile()');

    if (functionStart === -1) {
        throw new Error(`Could not find generateFile() in ${normalizedType} builder source`);
    }

    const scriptEnd = source.lastIndexOf('</script>');
    if (scriptEnd === -1 || scriptEnd <= functionStart) {
        throw new Error(`Could not determine the script boundary for ${normalizedType}`);
    }

    const functionSource = source.slice(functionStart, scriptEnd).trim();
    generateFileSourceCache.set(normalizedType, functionSource);
    return functionSource;
}

function runBuilderGenerateFile(type, fields, globals, seedValue) {
    const elements = {};
    let capturedHtml = '';

    const makeElement = (overrides = {}) => ({
        value: '',
        checked: false,
        innerText: '',
        style: {},
        files: [],
        ...overrides
    });

    Object.entries(fields || {}).forEach(([id, overrides]) => {
        elements[id] = makeElement(overrides);
    });

    if (!elements.downloadBtn) {
        elements.downloadBtn = makeElement({ innerText: 'Download', style: {} });
    }

    const documentMock = {
        addEventListener() {},
        getElementById(id) {
            if (!elements[id]) {
                elements[id] = makeElement();
            }
            return elements[id];
        },
        createElement() {
            return {
                href: '',
                download: '',
                click() {},
                style: {}
            };
        },
        body: {
            appendChild() {},
            removeChild() {}
        }
    };

    function BlobMock(parts, options) {
        this.parts = parts;
        this.options = options;

        if (options?.type === 'text/html') {
            capturedHtml = parts.map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                return String(part ?? '');
            }).join('');
        }
    }

    const context = {
        document: documentMock,
        alert(message) {
            throw new Error(message);
        },
        Blob: BlobMock,
        URL: {
            createObjectURL() {
                return 'blob:captured-test';
            }
        },
        setTimeout() {},
        console,
        Math: createDeterministicMath(seedValue),
        btoa(value) {
            return Buffer.from(String(value), 'binary').toString('base64');
        },
        atob(value) {
            return Buffer.from(String(value), 'base64').toString('binary');
        },
        unescape,
        encodeURIComponent,
        fullAudioData: globals?.fullAudioData ?? null,
        audioParts: globals?.audioParts ?? [null, null, null, null]
    };

    vm.createContext(context);
    vm.runInContext(`${extractGenerateFileSource(type)}; generateFile();`, context, { timeout: 2000 });

    if (!capturedHtml || !capturedHtml.trim()) {
        throw new Error(`Builder did not produce HTML for ${type}`);
    }

    return capturedHtml.trim();
}

function base64FromBinary(binaryString) {
    return Buffer.from(binaryString, 'binary').toString('base64');
}

function encodeReadingAnswerKey(answerKeyString) {
    const binaryUtf8 = Buffer.from(answerKeyString, 'utf8').toString('binary');
    const once = base64FromBinary(binaryUtf8);
    return base64FromBinary(once.split('').reverse().join(''));
}

function encodeListeningAnswerKey(answerKeyString) {
    return Buffer.from(answerKeyString, 'utf8').toString('base64');
}

function normalizeReadingContent(parsedContent = {}, testDoc = {}) {
    const fallbackTitle = testDoc.title || 'Reading Test';
    const defaultPassage = {
        title: fallbackTitle,
        text: '',
        questions: ''
    };

    const p1 = parsedContent.p1 && typeof parsedContent.p1 === 'object'
        ? parsedContent.p1
        : {
            title: parsedContent.title || fallbackTitle,
            text: parsedContent.passage || parsedContent.text || '',
            questions: parsedContent.questions || ''
        };

    const p2 = parsedContent.p2 && typeof parsedContent.p2 === 'object'
        ? parsedContent.p2
        : defaultPassage;

    const p3 = parsedContent.p3 && typeof parsedContent.p3 === 'object'
        ? parsedContent.p3
        : defaultPassage;

    const rawAnswerKey = parsedContent.answerKey ?? parsedContent.answer_key ?? {};
    const answerKey = typeof rawAnswerKey === 'string'
        ? rawAnswerKey
        : JSON.stringify(rawAnswerKey || {});

    return {
        p1: {
            title: p1.title || 'Passage 1',
            text: p1.text || '',
            questions: p1.questions || ''
        },
        p2: {
            title: p2.title || 'Passage 2',
            text: p2.text || '',
            questions: p2.questions || ''
        },
        p3: {
            title: p3.title || 'Passage 3',
            text: p3.text || '',
            questions: p3.questions || ''
        },
        answerKey
    };
}

function normalizeListeningContent(parsedContent = {}) {
    const partsSource = parsedContent.parts && typeof parsedContent.parts === 'object' ? parsedContent.parts : {};
    const getPartSource = (index) => (
        partsSource[index]
        ?? partsSource[String(index)]
        ?? parsedContent[`p${index}`]
        ?? ''
    );

    const parts = {};
    for (let index = 1; index <= 4; index += 1) {
        const source = getPartSource(index);

        if (typeof source === 'string') {
            parts[index] = { finalHtml: source };
            continue;
        }

        if (source && typeof source === 'object' && !Array.isArray(source)) {
            parts[index] = {
                ...source,
                finalHtml: source.finalHtml ?? source.html ?? ''
            };
            continue;
        }

        parts[index] = { finalHtml: '' };
    }

    const rawAnswerKey = parsedContent.answerKey ?? parsedContent.answer_key ?? {};
    const answerKey = typeof rawAnswerKey === 'string'
        ? rawAnswerKey
        : JSON.stringify(rawAnswerKey || {});

    let audioParts = parsedContent.audioParts ?? parsedContent.audio?.parts ?? [null, null, null, null];
    if (!Array.isArray(audioParts)) {
        audioParts = [null, null, null, null];
    }

    if (audioParts.length < 4) {
        audioParts = [...audioParts, ...Array(4 - audioParts.length).fill(null)];
    } else if (audioParts.length > 4) {
        audioParts = audioParts.slice(0, 4);
    }

    return {
        p1: parts[1].finalHtml || '',
        p2: parts[2].finalHtml || '',
        p3: parts[3].finalHtml || '',
        p4: parts[4].finalHtml || '',
        answerKey,
        audioParts,
        fullAudio: parsedContent.fullAudio ?? parsedContent.audio?.full ?? null,
        includePause: Boolean(parsedContent.includePause ?? parsedContent.audio?.usePause ?? false)
    };
}

function normalizeWritingContent(parsedContent = {}) {
    return {
        timeLimit: Number.parseInt(parsedContent.timeLimit, 10) || 60,
        task1: {
            prompt: parsedContent.task1?.prompt || '',
            image: parsedContent.task1?.image || '',
            modelAnswer: parsedContent.task1?.modelAnswer || ''
        },
        task2: {
            prompt: parsedContent.task2?.prompt || '',
            modelAnswer: parsedContent.task2?.modelAnswer || ''
        }
    };
}

function injectListeningR2Support(template) {
    let html = replaceAllLiteral(
        template,
        '<audio id="testAudio" preload="auto"></audio>',
        '<audio id="testAudio" preload="auto" crossOrigin="anonymous"></audio>'
    );

    const base64OnlyFunction = `    // Fix for mobile devices: Convert Base64 to Blob URLs to prevent memory crashes
    function createBlobUrl(base64Str) {
        if (!base64Str) return null;
        try {
            const parts = base64Str.split(',');
            const mime = parts[0].match(/:(.*?);/)[1];
            const bstr = atob(parts[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) { u8arr[n] = bstr.charCodeAt(n); }
            return URL.createObjectURL(new Blob([u8arr], { type: mime }));
        } catch(e) { 
            return base64Str; // Fallback
        }
    }`;

    const r2AwareFunction = `    // Support both original base64 audio and Cloudflare R2 URLs.
    function createBlobUrl(audioSource) {
        if (!audioSource) return null;

        if (typeof audioSource === 'string' && (audioSource.startsWith('http://') || audioSource.startsWith('https://') || audioSource.startsWith('/'))) {
            return audioSource;
        }

        if (typeof audioSource !== 'string' || !audioSource.startsWith('data:')) {
            return audioSource;
        }

        try {
            const parts = audioSource.split(',');
            const mime = parts[0].match(/:(.*?);/)[1];
            const bstr = atob(parts[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) { u8arr[n] = bstr.charCodeAt(n); }
            return URL.createObjectURL(new Blob([u8arr], { type: mime }));
        } catch (e) {
            return audioSource;
        }
    }`;

    html = replaceAllLiteral(html, base64OnlyFunction, r2AwareFunction);
    return html;
}

function generateReadingHtml(testDoc, parsedContent) {
    const content = normalizeReadingContent(parsedContent, testDoc);
    const stableSessionId = createStableSessionId(testDoc, 'test_');

    return runBuilderGenerateFile('reading', {
        p1_title: { value: content.p1.title },
        p1_text: { value: content.p1.text },
        p2_title: { value: content.p2.title },
        p2_text: { value: content.p2.text },
        p3_title: { value: content.p3.title },
        p3_text: { value: content.p3.text },
        q1_text: { value: content.p1.questions },
        q2_text: { value: content.p2.questions },
        q3_text: { value: content.p3.questions },
        answer_key_json: { value: content.answerKey },
        downloadBtn: { innerText: 'Download Final Test HTML', style: {} }
    }, {}, stableSessionId).replace(
        /const SESSION_KEY = 'ielts_state_test_\d+';/,
        `const SESSION_KEY = 'ielts_state_${stableSessionId}';`
    );
}

function generateListeningHtml(testDoc, parsedContent) {
    const content = normalizeListeningContent(parsedContent);
    const stableSessionId = createStableSessionId(testDoc, 'ielts_listening_');
    const generatedHtml = runBuilderGenerateFile('listening', {
        q1_text: { value: content.p1 },
        q2_text: { value: content.p2 },
        q3_text: { value: content.p3 },
        q4_text: { value: content.p4 },
        answer_key_json: { value: content.answerKey },
        add_pause_cb: { checked: content.includePause },
        downloadBtn: { innerText: 'Download Final Listening Test', style: {} }
    }, {
        audioParts: content.audioParts,
        fullAudioData: content.fullAudio
    }, stableSessionId).replace(
        /const SESSION_KEY = 'ielts_listening_\d+';/,
        `const SESSION_KEY = '${stableSessionId}';`
    );

    return injectListeningR2Support(generatedHtml);
}

function generateWritingHtml(testDoc, parsedContent, options = {}) {
    const content = normalizeWritingContent(parsedContent);
    const stableSessionId = createStableSessionId(testDoc, 'ielts_writing_');
    const generatedHtml = runBuilderGenerateFile('writing', {
        t1_img: { value: content.task1.image || '' },
        t1_prompt: { value: content.task1.prompt || '' },
        t1_model: { value: content.task1.modelAnswer || '' },
        t2_prompt: { value: content.task2.prompt || '' },
        t2_model: { value: content.task2.modelAnswer || '' },
        time_limit: { value: String(content.timeLimit) }
    }, {}, stableSessionId);

    return generatedHtml
        .replace(
            /const SESSION_ID = "ielts_writing_\d+";/,
            `const SESSION_ID = "${stableSessionId}";`
        )
        .replace(
            /const GROQ_API_KEY = ".*?";/,
            `const GROQ_API_KEY = "${escapeForBuilderValue(options.groqApiKey || '')}";`
        )
        .trim();
}

function generateHTMLFromTest(testDoc, options = {}) {
    const plainTest = toPlainObject(testDoc);

    if (plainTest.renderedHtml && typeof plainTest.renderedHtml === 'string' && plainTest.renderedHtml.trim()) {
        return plainTest.renderedHtml.trim();
    }

    const rawContent = plainTest.readingPassage ?? plainTest.content;
    const parsedContent = parseStoredContent(rawContent, 'readingPassage');

    if (parsedContent.__rawHtml) {
        return parsedContent.__rawHtml.trim();
    }

    const normalizedType = String(plainTest.type || 'reading').toLowerCase();

    if (normalizedType === 'reading') {
        return generateReadingHtml(plainTest, parsedContent);
    }

    if (normalizedType === 'listening') {
        return generateListeningHtml(plainTest, parsedContent);
    }

    if (normalizedType === 'writing') {
        return generateWritingHtml(plainTest, parsedContent, options);
    }

    throw new Error(`Unsupported test type: ${plainTest.type}`);
}

function getHTMLTemplate(testType = 'reading') {
    return readBuilderFinalTemplate(testType);
}

module.exports = {
    generateHTMLFromTest,
    getHTMLTemplate,
    parseStoredContent,
    stringifyContent
};
