const { readBuilderFinalTemplate } = require('./builderAssets');

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
    const template = readBuilderFinalTemplate('reading');
    const content = normalizeReadingContent(parsedContent, testDoc);
    const encodedKey = encodeReadingAnswerKey(content.answerKey);
    const sessionId = createStableSessionId(testDoc, 'test_');

    return applyLiteralReplacements(template, [
        ['${escape(p1t)}', escapeForBuilderValue(content.p1.title)],
        ['${p1b}', content.p1.text],
        ['${escape(p2t)}', escapeForBuilderValue(content.p2.title)],
        ['${p2b}', content.p2.text],
        ['${escape(p3t)}', escapeForBuilderValue(content.p3.title)],
        ['${p3b}', content.p3.text],
        ['${escape(q1b)}', escapeForBuilderValue(content.p1.questions)],
        ['${escape(q2b)}', escapeForBuilderValue(content.p2.questions)],
        ['${escape(q3b)}', escapeForBuilderValue(content.p3.questions)],
        ['${encodedKey}', encodedKey],
        ['${uniqueId}', sessionId]
    ]).trim();
}

function generateListeningHtml(testDoc, parsedContent) {
    const rawTemplate = readBuilderFinalTemplate('listening');
    const template = injectListeningR2Support(rawTemplate);
    const content = normalizeListeningContent(parsedContent);
    const encodedKey = encodeListeningAnswerKey(content.answerKey);
    const sessionId = createStableSessionId(testDoc, 'ielts_listening_');

    return applyLiteralReplacements(template, [
        ['${escape(q1b)}', escapeForBuilderValue(content.p1)],
        ['${escape(q2b)}', escapeForBuilderValue(content.p2)],
        ['${escape(q3b)}', escapeForBuilderValue(content.p3)],
        ['${escape(q4b)}', escapeForBuilderValue(content.p4)],
        ['${encodedAnsKey}', encodedKey],
        ['${uniqueId}', sessionId],
        ['${audios}', JSON.stringify(content.audioParts)],
        ['${fullAudioStr}', JSON.stringify(content.fullAudio)],
        ['${includePause}', content.includePause ? 'true' : 'false']
    ]).trim();
}

function generateWritingHtml(testDoc, parsedContent, options = {}) {
    const template = readBuilderFinalTemplate('writing');
    const content = normalizeWritingContent(parsedContent);
    const pdfScript = '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><' + '/script>';
    const sessionId = createStableSessionId(testDoc, 'ielts_writing_');
    const task1ImageHtml = content.task1.image
        ? `<img src="${escapeForBuilderValue(content.task1.image)}" class="task-img" alt="Task 1 Chart">`
        : '';

    return applyLiteralReplacements(template, [
        ['${pdfScript}', pdfScript],
        ['${t1img ? `<img src="${escape(t1img)}" class="task-img" alt="Task 1 Chart">` : \'\'}', task1ImageHtml],
        ['${escape(t1p)}', escapeForBuilderValue(content.task1.prompt)],
        ['${escape(t2p)}', escapeForBuilderValue(content.task2.prompt)],
        ['${escape(t1m) || "No model answer provided."}', escapeForBuilderValue(content.task1.modelAnswer || 'No model answer provided.')],
        ['${escape(t2m) || "No model answer provided."}', escapeForBuilderValue(content.task2.modelAnswer || 'No model answer provided.')],
        ['${timeLimit * 60}', String(content.timeLimit * 60)],
        ['${uniqueId}', sessionId],
        ['${API_KEY_PLACEHOLDER}', escapeForBuilderValue(options.groqApiKey || '')]
    ]).replace(/\\\s*$/, '').trim();
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
