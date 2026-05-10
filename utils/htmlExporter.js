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

function replaceLastLiteral(template, searchValue, replacementValue) {
    const lastIndex = template.lastIndexOf(searchValue);
    if (lastIndex === -1) {
        return template;
    }

    return `${template.slice(0, lastIndex)}${replacementValue}${template.slice(lastIndex + searchValue.length)}`;
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
        addEventListener() { },
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
                click() { },
                style: {}
            };
        },
        body: {
            appendChild() { },
            removeChild() { }
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
        setTimeout() { },
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

function injectListeningUrlSupport(template) {
    // The builder template now natively includes a URL-aware createBlobUrl.
    // This function handles backward-compat for any older HTML that still
    // has the base64-only version.
    let html = template;

    // If the HTML already has the URL-aware function, nothing to do.
    if (html.includes('audioSource.startsWith(')) {
        return html;
    }

    // Fallback: replace old base64-only function with URL-aware version.
    html = html.replace(
        /\/\/ Fix for mobile devices: Convert Base64 to Blob URLs[\s\S]*?function createBlobUrl\s*\(\s*\w+\s*\)\s*\{[\s\S]*?return base64Str;\s*\/\/ Fallback\s*\n\s*\}\s*\n\s*\}/,
        `    // Support both base64 data URIs and HTTP/local URL audio sources
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
        } catch(e) {
            return audioSource;
        }
    }`
    );

    return html;
}

function injectThemeStyles(html) {
    const themeStyles = `
<style id="platform-theme-overrides">
    .site-theme-btn {
        border: none !important;
        border-radius: 999px !important;
        padding: 9px 16px !important;
        min-height: 38px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: #fff !important;
        font-size: 12px !important;
        font-weight: 800 !important;
        letter-spacing: 0.02em;
        cursor: pointer;
        box-shadow: 0 12px 28px rgba(102, 126, 234, 0.28) !important;
        transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        white-space: nowrap;
    }
    .site-theme-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 16px 32px rgba(102, 126, 234, 0.32) !important;
    }
    .site-theme-btn.active-site-theme {
        background: linear-gradient(135deg, #1f2937 0%, #334155 100%) !important;
        box-shadow: 0 16px 34px rgba(15, 23, 42, 0.35) !important;
    }
    body.platform-theme {
        background:
            radial-gradient(circle at top left, rgba(255,255,255,0.22), transparent 28%),
            radial-gradient(circle at right 18%, rgba(191, 219, 254, 0.28), transparent 24%),
            linear-gradient(135deg, #5f6ee9 0%, #7144a9 48%, #95d1ff 100%) !important;
        color: #1f2937 !important;
        font-family: "Trebuchet MS", "Segoe UI", sans-serif;
    }
    body.platform-theme::before {
        opacity: 0 !important;
    }
    body.platform-theme::after {
        content: '';
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
            linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px);
        background-size: 28px 28px;
        opacity: 0.14;
        z-index: 0;
    }
    .platform-theme .header {
        top: 16px !important;
        left: 18px;
        width: calc(100% - 36px) !important;
        min-height: 82px;
        height: auto !important;
        border-radius: 30px !important;
        border: 1px solid rgba(255,255,255,0.44) !important;
        background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(244,247,255,0.94) 100%) !important;
        box-shadow: 0 20px 44px rgba(15, 23, 42, 0.16) !important;
        backdrop-filter: blur(20px);
        padding: 18px 24px !important;
    }
    .platform-theme .footer {
        bottom: 18px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: min(1180px, calc(100% - 36px)) !important;
        border-radius: 28px !important;
        border: 1px solid rgba(255,255,255,0.44) !important;
        background: linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(246,248,255,0.94) 100%) !important;
        box-shadow: 0 22px 44px rgba(15, 23, 42, 0.18) !important;
        backdrop-filter: blur(18px);
    }
    .platform-theme .header-right,
    .platform-theme .part-nav {
        gap: 10px !important;
    }
    .platform-theme .part-nav,
    .platform-theme #subNav {
        background: rgba(102, 126, 234, 0.08);
        border-radius: 999px;
        padding: 6px;
    }
    .platform-theme .header,
    .platform-theme .footer,
    .platform-theme .prompt-panel,
    .platform-theme .passage-panel,
    .platform-theme .questions-panel,
    .platform-theme .task-card,
    .platform-theme .tf-question,
    .platform-theme .multi-choice-question,
    .platform-theme .short-answer-question,
    .platform-theme .drag-wrapper,
    .platform-theme .gap-fill-text,
    .platform-theme .pick-n-question,
    .platform-theme .matching-group-block,
    .platform-theme .diagram-container,
    .platform-theme .flow-question-block,
    .platform-theme .map-question-block,
    .platform-theme .modal-content,
    .platform-theme .modern-modal-box,
    .platform-theme .lockdown-box,
    .platform-theme .audio-player,
    .platform-theme .notes-panel,
    .platform-theme .writing-panel {
        background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(245,248,255,0.92) 100%) !important;
        border-color: rgba(255, 255, 255, 0.38) !important;
        color: #1f2937 !important;
        box-shadow: 0 18px 38px rgba(31, 41, 55, 0.16) !important;
        backdrop-filter: blur(18px);
    }
    .platform-theme .main-container {
        background: transparent !important;
        /* Preserve the Reading/Writing builders' fixed viewport layout so
           internal panels keep their scroll behavior. */
        /* Header has top:16px + min-height:82px + padding, so we need ~116px margin */
        margin-top: 116px !important;
        margin-bottom: 18px !important;
        height: calc(100vh - 216px) !important;
        min-height: 0 !important;
        overflow: hidden !important;
        overflow-x: hidden !important;
    }
    .platform-theme .content {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 24px !important;
        margin-bottom: 32px !important;
        height: auto !important;
        width: 100% !important;
        overflow: visible !important;
    }
    .platform-theme .test-section {
        height: auto !important;
        overflow-y: auto !important;
        max-height: none !important;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
    }
    .platform-theme .test-section::-webkit-scrollbar {
        display: none !important;
    }
    .platform-theme .passage {
        max-height: none !important;
        overflow-y: auto !important;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
    }
    .platform-theme .passage::-webkit-scrollbar {
        display: none !important;
    }
    .platform-theme #questionsPanel {
        overflow-y: auto !important;
        height: 100% !important;
        padding-bottom: 100px !important;
        box-sizing: border-box !important;
    }
    .platform-theme .passage-panel,
    .platform-theme .questions-panel,
    .platform-theme .prompt-panel,
    .platform-theme .writing-panel {
        border-radius: 32px !important;
        border-width: 1px !important;
        padding: 30px !important;
        position: relative;
        min-height: 0 !important;
        overflow-y: auto !important;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
    }
    .platform-theme .passage-panel::-webkit-scrollbar,
    .platform-theme .questions-panel::-webkit-scrollbar,
    .platform-theme .prompt-panel::-webkit-scrollbar,
    .platform-theme .writing-panel::-webkit-scrollbar {
        display: none !important;
    }
    /* Universal scrollbar hiding for all scrollable elements in platform theme */
    .platform-theme * {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
    }
    .platform-theme *::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
        background: transparent !important;
    }
    .platform-theme .passage-panel::before,
    .platform-theme .questions-panel::before,
    .platform-theme .prompt-panel::before,
    .platform-theme .writing-panel::before {
        content: '';
        position: sticky;
        top: 0;
        display: block;
        height: 6px;
        width: 96px;
        border-radius: 999px;
        margin-bottom: 18px;
        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        opacity: 0.85;
        z-index: 1;
    }
    .platform-theme .resizer {
        width: 4px !important;
        background: rgba(102, 126, 234, 0.15) !important;
        border-radius: 2px !important;
        cursor: col-resize;
        transition: background 0.2s ease, width 0.2s ease;
    }
    .platform-theme .resizer:hover {
        width: 6px !important;
        background: rgba(102, 126, 234, 0.4) !important;
    }
    .platform-theme .resizer:active {
        width: 6px !important;
        background: rgba(102, 126, 234, 0.6) !important;
    }
    .platform-theme .logo,
    .platform-theme h1,
    .platform-theme h2,
    .platform-theme h3,
    .platform-theme strong,
    .platform-theme b,
    .platform-theme .question-section-header,
    .platform-theme .instructions,
    .platform-theme .ielts-instruction,
    .platform-theme .modern-modal-title {
        color: #1f2937 !important;
    }
    .platform-theme .logo {
        gap: 18px !important;
        font-weight: 900 !important;
        letter-spacing: -0.02em;
    }
    .platform-theme .timer,
    .platform-theme .part-btn.active,
    .platform-theme .check-btn,
    .platform-theme .synergy-logo,
    .platform-theme .start-btn-big,
    .platform-theme .download-btn,
    .platform-theme .nav-circle.answered {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: #fff !important;
        border-color: transparent !important;
    }
    .platform-theme .timer {
        box-shadow: 0 10px 22px rgba(102, 126, 234, 0.24) !important;
        border-radius: 999px !important;
        padding: 8px 16px !important;
    }
    .platform-theme .part-btn,
    .platform-theme .theme-btn,
    .platform-theme .help-btn,
    .platform-theme .admin-btn,
    .platform-theme .download-btn,
    .platform-theme .check-btn {
        border-radius: 999px !important;
    }
    .platform-theme .theme-btn,
    .platform-theme .help-btn,
    .platform-theme .admin-btn {
        box-shadow: 0 10px 24px rgba(102, 126, 234, 0.2) !important;
    }
    .platform-theme .part-btn,
    .platform-theme .nav-circle,
    .platform-theme .custom-select-trigger,
    .platform-theme .gap-input,
    .platform-theme .answer-input,
    .platform-theme .drop-zone,
    .platform-theme .map-drop-zone,
    .platform-theme .name-input,
    .platform-theme textarea.student-input,
    .platform-theme .modal-input-field,
    .platform-theme .lockdown-input,
    .platform-theme .notes-area {
        background: rgba(255,255,255,0.92) !important;
        color: #1f2937 !important;
        border-color: rgba(102, 126, 234, 0.28) !important;
    }
    .platform-theme .nav-circle {
        box-shadow: 0 8px 18px rgba(102, 126, 234, 0.14);
    }
    .platform-theme .nav-circle.flagged {
        background: linear-gradient(135deg, #f97316 0%, #ef4444 100%) !important;
        border-color: transparent !important;
        color: #fff !important;
    }
    .platform-theme #contextMenu,
    .platform-theme .variant-popup,
    .platform-theme .custom-select-options {
        background: rgba(255,255,255,0.97) !important;
        border-color: rgba(102, 126, 234, 0.24) !important;
        color: #1f2937 !important;
        box-shadow: 0 18px 34px rgba(31, 41, 55, 0.16) !important;
    }
    .platform-theme .ctx-item:hover,
    .platform-theme .variant-option:hover,
    .platform-theme .custom-option:hover {
        background: rgba(102, 126, 234, 0.08) !important;
        color: #4338ca !important;
    }
    .platform-theme .start-overlay {
        background:
            radial-gradient(circle at top left, rgba(255,255,255,0.65), transparent 30%),
            linear-gradient(135deg, rgba(245,247,255,0.98) 0%, rgba(232,239,255,0.94) 100%) !important;
        backdrop-filter: blur(18px);
    }
    .platform-theme .start-overlay h1,
    .platform-theme .start-overlay p {
        color: #1f2937 !important;
    }
    .platform-theme .start-btn-big {
        padding: 16px 32px !important;
        border-radius: 999px !important;
        box-shadow: 0 18px 34px rgba(102, 126, 234, 0.28) !important;
    }
    .platform-theme .task-card,
    .platform-theme .tf-question,
    .platform-theme .multi-choice-question,
    .platform-theme .short-answer-question,
    .platform-theme .drag-wrapper,
    .platform-theme .gap-fill-text,
    .platform-theme .pick-n-question,
    .platform-theme .matching-group-block,
    .platform-theme .diagram-container,
    .platform-theme .flow-question-block,
    .platform-theme .map-question-block {
        border-radius: 24px !important;
        border: 1px solid rgba(102, 126, 234, 0.12) !important;
        box-shadow: 0 14px 28px rgba(15, 23, 42, 0.08) !important;
    }
    .platform-theme .notes-panel {
        border-radius: 28px !important;
    }
    .platform-theme .notes-area,
    .platform-theme textarea.student-input {
        border-radius: 24px !important;
        box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .platform-theme span[data-platform-highlight="1"] {
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        border-bottom: 2px solid rgba(15, 23, 42, 0.08);
    }
    .platform-theme .flag-btn,
    .platform-theme .q-flag {
        position: relative !important;
        z-index: 12 !important;
        pointer-events: auto !important;
        cursor: pointer !important;
        background: transparent !important;
        border: none !important;
        padding: 0 !important;
        margin: 0 !important;
        transition: all 0.2s ease !important;
    }
    .platform-theme .flag-btn {
        font-size: 24px !important;
        color: #e0e0e0 !important;
        position: absolute !important;
        top: 10px !important;
        right: 10px !important;
    }
    .platform-theme .flag-btn:hover {
        color: #f39c12 !important;
        transform: scale(1.1) !important;
    }
    .platform-theme .q-flag {
        font-size: 18px !important;
        color: #e0e0e0 !important;
        margin-left: 5px !important;
        vertical-align: middle !important;
    }
    .platform-theme .q-flag:hover {
        color: #f39c12 !important;
        transform: scale(1.2) !important;
    }
    .platform-theme .q-flag.active,
    .platform-theme .flag-btn.active {
        color: #e74c3c !important;
    }
    .platform-theme .q-flag.inline-flag {
        color: #cbd5e1 !important;
    }
    .platform-theme .q-flag.inline-flag:hover {
        color: #f39c12 !important;
    }
    .platform-theme .q-flag.inline-flag.active {
        color: #e74c3c !important;
    }
    .platform-theme .map-drop-zone.flagged-zone {
        border-color: #e74c3c !important;
        background-color: #fff5f5 !important;
    }
    .platform-theme .gap-input.flagged-input {
        border-color: #e74c3c !important;
        box-shadow: 0 0 0 4px rgba(231, 76, 60, 0.15) !important;
        background-color: #fff9f9 !important;
    }
    .platform-theme .flagged {
        border: 1px solid #e74c3c !important;
        border-left: 6px solid #e74c3c !important;
    }
</style>`;

    return replaceLastLiteral(html, '</head>', `${themeStyles}\n</head>`);
}

function injectWebsiteThemeButton(html, type) {
    const platformBtn = `<button class="part-btn site-theme-btn" data-off-label="Platform Theme" data-on-label="Builder Theme" onclick="toggleSiteTheme()" style="margin-right:10px;">Platform Theme</button>`;

    if (type === 'writing') {
        // Find the theme button and add platform theme button after it
        // Note: use [\\s\\S] so it works even if the button markup spans lines.
        const writingRe = /(<button[\s\S]*?onclick="toggleDarkMode[^"]*"[\s\S]*?>[\s\S]*?<\/button>)/;
        return html.replace(writingRe, `$1\n            ${platformBtn}`);
    }

    const genericRe = /(<button[\s\S]*?class="theme-btn"[\s\S]*?>[\s\S]*?<\/button>)/;
    return html.replace(genericRe, `$1\n            ${platformBtn}`);
}

function injectThemeController(html, type) {
    const snippet = `
<script>
(function() {
    const storageBase = (typeof SESSION_KEY !== 'undefined' && SESSION_KEY)
        || (typeof SESSION_ID !== 'undefined' && SESSION_ID)
        || location.pathname
        || document.title
        || '${type}';
    const storageKey = 'platform_site_theme_' + storageBase;
    const siteThemeButton = document.querySelector('.site-theme-btn');

    function syncSiteThemeButton() {
        if (!siteThemeButton) return;
        const isActive = document.body.classList.contains('platform-theme');
        siteThemeButton.classList.toggle('active-site-theme', isActive);
        siteThemeButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        siteThemeButton.innerText = isActive
            ? (siteThemeButton.dataset.onLabel || 'Builder Theme')
            : (siteThemeButton.dataset.offLabel || 'Platform Theme');
        siteThemeButton.title = isActive
            ? 'Switch back to the original builder look'
            : 'Match the test to the platform design';
    }

    const originalToggleTheme = typeof toggleTheme === 'function' ? toggleTheme : null;
    if (originalToggleTheme) {
        toggleTheme = function(...args) {
            document.body.classList.remove('platform-theme');
            try { localStorage.removeItem(storageKey); } catch (error) {}
            const result = originalToggleTheme.apply(this, args);
            syncSiteThemeButton();
            return result;
        };
        window.toggleTheme = toggleTheme;
    }

    const originalToggleDarkMode = typeof toggleDarkMode === 'function' ? toggleDarkMode : null;
    if (originalToggleDarkMode) {
        toggleDarkMode = function(...args) {
            document.body.classList.remove('platform-theme');
            try { localStorage.removeItem(storageKey); } catch (error) {}
            const result = originalToggleDarkMode.apply(this, args);
            syncSiteThemeButton();
            return result;
        };
        window.toggleDarkMode = toggleDarkMode;
    }

    window.toggleSiteTheme = function() {
        const nextState = !document.body.classList.contains('platform-theme');
        document.body.classList.toggle('platform-theme', nextState);
        if (nextState) {
            document.body.classList.remove('dark-mode');
            try { localStorage.setItem(storageKey, 'on'); } catch (error) {}
        } else {
            try { localStorage.removeItem(storageKey); } catch (error) {}
        }
        syncSiteThemeButton();
    };

    try {
        if (localStorage.getItem(storageKey) === 'on') {
            document.body.classList.add('platform-theme');
            document.body.classList.remove('dark-mode');
        }
    } catch (error) {}

    syncSiteThemeButton();
})();
</script>`;

    return replaceLastLiteral(html, '</body>', `${snippet}\n</body>`);
}

function injectReadingHighlightFix(html) {
    const snippet = `
<script>
(function() {
    const ctxMenu = document.getElementById('contextMenu');
    const panels = [document.getElementById('passagePanel'), document.getElementById('questionsPanel')].filter(Boolean);
    if (!ctxMenu || panels.length === 0) return;

    let stickyRange = null;
    let stickyOwner = null;

    function getRangeContainer(range) {
        return range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentNode;
    }

    function captureSelection(owner) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
        const range = selection.getRangeAt(0).cloneRange();
        const container = getRangeContainer(range);
        if (!owner || !container || !owner.contains(container)) return false;

        stickyRange = range;
        stickyOwner = owner;
        savedRange = range.cloneRange();
        activeHighlightPanel = owner;
        return true;
    }

    function closeMenu() {
        ctxMenu.style.display = 'none';
    }

    function getWorkingRange() {
        if (stickyRange && typeof stickyRange.cloneRange === 'function') return stickyRange.cloneRange();
        if (savedRange && typeof savedRange.cloneRange === 'function') return savedRange.cloneRange();
        return null;
    }

    function isHighlightNode(node) {
        return Boolean(node && node.nodeType === 1 && node.matches && node.matches('span[data-platform-highlight="1"]'));
    }

    function rangeIntersectsNode(range, node) {
        try {
            return range.intersectsNode(node);
        } catch (error) {
            const nodeRange = document.createRange();
            nodeRange.selectNodeContents(node);
            return range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0
                && range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0;
        }
    }

    function unwrapHighlight(node) {
        const parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) {
            parent.insertBefore(node.firstChild, node);
        }
        parent.removeChild(node);
        parent.normalize();
    }

    function collectHighlights(range) {
        const items = [];
        const container = getRangeContainer(range);
        if (isHighlightNode(container)) items.push(container);

        const root = container && container.nodeType === 1 ? container : container && container.parentNode;
        if (!root) return items;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                return isHighlightNode(node) && rangeIntersectsNode(range, node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        });

        let node;
        while ((node = walker.nextNode())) {
            items.push(node);
        }

        if (!items.length && root.closest) {
            const closest = root.closest('span[data-platform-highlight="1"]');
            if (closest) items.push(closest);
        }

        return [...new Set(items)];
    }

    function resetSelection() {
        stickyRange = null;
        stickyOwner = null;
        savedRange = null;
        activeHighlightPanel = null;
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
        closeMenu();
    }

    function applyHighlight(colorCode) {
        const range = getWorkingRange();
        if (!range || range.collapsed) {
            closeMenu();
            return;
        }

        const span = document.createElement('span');
        span.dataset.platformHighlight = '1';
        span.style.backgroundColor = colorCode;
        span.style.borderRadius = '4px';
        span.style.padding = '1px 0';

        try {
            range.surroundContents(span);
        } catch (error) {
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
        }

        if (typeof saveState === 'function') saveState();
        resetSelection();
    }

    function clearHighlights() {
        const range = getWorkingRange();
        if (!range) {
            closeMenu();
            return;
        }

        collectHighlights(range).forEach(unwrapHighlight);
        if (typeof saveState === 'function') saveState();
        resetSelection();
    }

    panels.forEach((panel) => {
        ['mouseup', 'keyup', 'touchend'].forEach((eventName) => {
            panel.addEventListener(eventName, () => setTimeout(() => captureSelection(panel), 0), true);
        });

        panel.addEventListener('scroll', closeMenu, { passive: true });
        panel.addEventListener('contextmenu', (event) => {
            const hasSelection = captureSelection(panel) || (stickyRange && stickyOwner === panel);
            if (!hasSelection) return;

            event.preventDefault();
            ctxMenu.style.display = 'block';
            ctxMenu.style.left = event.clientX + 'px';
            ctxMenu.style.top = event.clientY + 'px';
        }, true);
    });

    document.addEventListener('click', (event) => {
        if (!ctxMenu.contains(event.target)) closeMenu();
    });

    const originalSaveState = typeof saveState === 'function' ? saveState : null;
    if (originalSaveState && !window.__platformReadingStatePatched) {
        const patchedSaveState = function(...args) {
            const result = originalSaveState.apply(this, args);
            try {
                if (typeof SESSION_KEY !== 'undefined') {
                    const rawState = localStorage.getItem(SESSION_KEY);
                    const questionsPanel = document.getElementById('questionsPanel');
                    if (rawState && questionsPanel) {
                        const state = JSON.parse(rawState);
                        state.questionsHTML = questionsPanel.innerHTML;
                        localStorage.setItem(SESSION_KEY, JSON.stringify(state));
                    }
                }
            } catch (error) {}
            return result;
        };

        saveState = patchedSaveState;
        window.saveState = patchedSaveState;

        const originalRestoreState = typeof restoreState === 'function' ? restoreState : null;
        if (originalRestoreState) {
            const patchedRestoreState = function(...args) {
                let questionsHTML = null;
                try {
                    if (typeof SESSION_KEY !== 'undefined') {
                        const rawState = localStorage.getItem(SESSION_KEY);
                        if (rawState) {
                            questionsHTML = JSON.parse(rawState).questionsHTML || null;
                        }
                    }
                } catch (error) {}

                const result = originalRestoreState.apply(this, args);
                if (questionsHTML && document.getElementById('questionsPanel')) {
                    document.getElementById('questionsPanel').innerHTML = questionsHTML;
                }
                return result;
            };

            restoreState = patchedRestoreState;
            window.restoreState = patchedRestoreState;
        }

        window.__platformReadingStatePatched = true;
    }

    performHighlight = function(colorCode) { applyHighlight(colorCode); };
    clearHighlight = function() { clearHighlights(); };
    window.performHighlight = performHighlight;
    window.clearHighlight = clearHighlight;
})();
</script>`;

    return replaceLastLiteral(html, '</body>', `${snippet}\n</body>`);
}

function injectListeningHighlightFix(html) {
    const snippet = `
<script>
(function() {
    const ctxMenu = document.getElementById('contextMenu');
    const questionsPanel = document.getElementById('questionsPanel');
    if (!ctxMenu || !questionsPanel) return;

    let stickyRange = null;

    function getRangeContainer(range) {
        return range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentNode;
    }

    function captureSelection() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
        const range = selection.getRangeAt(0).cloneRange();
        const container = getRangeContainer(range);
        if (!container || !questionsPanel.contains(container)) return false;

        stickyRange = range;
        savedRange = range.cloneRange();
        return true;
    }

    function closeMenu() {
        ctxMenu.style.display = 'none';
    }

    function getWorkingRange() {
        if (stickyRange && typeof stickyRange.cloneRange === 'function') return stickyRange.cloneRange();
        if (savedRange && typeof savedRange.cloneRange === 'function') return savedRange.cloneRange();
        return null;
    }

    function isHighlightNode(node) {
        return Boolean(node && node.nodeType === 1 && node.matches && node.matches('span[data-platform-highlight="1"]'));
    }

    function rangeIntersectsNode(range, node) {
        try {
            return range.intersectsNode(node);
        } catch (error) {
            const nodeRange = document.createRange();
            nodeRange.selectNodeContents(node);
            return range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0
                && range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0;
        }
    }

    function unwrapHighlight(node) {
        const parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) {
            parent.insertBefore(node.firstChild, node);
        }
        parent.removeChild(node);
        parent.normalize();
    }

    function collectHighlights(range) {
        const items = [];
        const container = getRangeContainer(range);
        if (isHighlightNode(container)) items.push(container);

        const root = container && container.nodeType === 1 ? container : container && container.parentNode;
        if (!root) return items;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode(node) {
                return isHighlightNode(node) && rangeIntersectsNode(range, node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        });

        let node;
        while ((node = walker.nextNode())) {
            items.push(node);
        }

        if (!items.length && root.closest) {
            const closest = root.closest('span[data-platform-highlight="1"]');
            if (closest) items.push(closest);
        }

        return [...new Set(items)];
    }

    function resetSelection() {
        stickyRange = null;
        savedRange = null;
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
        closeMenu();
    }

    function applyHighlight(colorCode) {
        const range = getWorkingRange();
        if (!range || range.collapsed) {
            closeMenu();
            return;
        }

        const span = document.createElement('span');
        span.dataset.platformHighlight = '1';
        span.style.backgroundColor = colorCode;
        span.style.borderRadius = '4px';
        span.style.padding = '1px 0';

        try {
            range.surroundContents(span);
        } catch (error) {
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
        }

        if (typeof saveState === 'function') saveState();
        resetSelection();
    }

    function clearHighlights() {
        const range = getWorkingRange();
        if (!range) {
            closeMenu();
            return;
        }

        collectHighlights(range).forEach(unwrapHighlight);
        if (typeof saveState === 'function') saveState();
        resetSelection();
    }

    ['mouseup', 'keyup', 'touchend'].forEach((eventName) => {
        questionsPanel.addEventListener(eventName, () => setTimeout(captureSelection, 0), true);
    });

    questionsPanel.addEventListener('scroll', closeMenu, { passive: true });
    questionsPanel.addEventListener('contextmenu', (event) => {
        const hasSelection = captureSelection() || stickyRange;
        if (!hasSelection) return;

        event.preventDefault();
        ctxMenu.style.display = 'block';
        ctxMenu.style.left = event.clientX + 'px';
        ctxMenu.style.top = event.clientY + 'px';
    }, true);

    document.addEventListener('click', (event) => {
        if (!ctxMenu.contains(event.target)) closeMenu();
    });

    performHighlight = function(colorCode) { applyHighlight(colorCode); };
    clearHighlight = function() { clearHighlights(); };
    window.performHighlight = performHighlight;
    window.clearHighlight = clearHighlight;
})();
</script>`;

    return replaceLastLiteral(html, '</body>', `${snippet}\n</body>`);
}

function injectQuitButton(html) {
    const snippet = `
<style>
#platformQuitBtn {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 99999;
    padding: 12px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 800;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
    transition: all 0.3s ease;
    display: none;
}
#platformQuitBtn:hover {
    transform: translateY(-2px);
    box-shadow: 0 15px 40px rgba(102, 126, 234, 0.5);
}
#platformQuitBtn.visible {
    display: block;
}
</style>
<script>
(function() {
    function addQuitButton() {
        if (document.getElementById('platformQuitBtn')) return;
        
        const quitBtn = document.createElement('button');
        quitBtn.id = 'platformQuitBtn';
        quitBtn.innerHTML = '← Back to Dashboard';
        quitBtn.onclick = () => window.location.href = '/student-dashboard';
        document.body.appendChild(quitBtn);
        
        // Show button when result modal appears or when answers are checked
        const resultModal = document.getElementById('resultModal');
        if (resultModal) {
            const observer = new MutationObserver(() => {
                if (resultModal.style.display === 'flex' || resultModal.style.display === 'block') {
                    quitBtn.classList.add('visible');
                }
            });
            observer.observe(resultModal, { attributes: true, attributeFilter: ['style'] });
        }
        
        // Also show after checkAnswers is called
        const originalCheckAnswers = window.checkAnswers;
        if (typeof originalCheckAnswers === 'function') {
            window.checkAnswers = function(...args) {
                const result = originalCheckAnswers.apply(this, args);
                setTimeout(() => quitBtn.classList.add('visible'), 500);
                return result;
            };
        }
        
        // For writing tests, show after submission
        const originalSubmitTest = window.submitTest;
        if (typeof originalSubmitTest === 'function') {
            window.submitTest = function(...args) {
                const result = originalSubmitTest.apply(this, args);
                setTimeout(() => quitBtn.classList.add('visible'), 500);
                return result;
            };
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addQuitButton);
    } else {
        addQuitButton();
    }
})();
</script>`;
    return replaceLastLiteral(html, '</head>', `${snippet}\n</head>`);
}

function injectReadingSubmissionHook(html, testDoc) {
    const safeTestId = escapeForBuilderValue(testDoc._id);
    const snippet = `
<script>
(function() {
    const syncKey = 'platform_submission_sync_' + ((typeof SESSION_KEY !== 'undefined' && SESSION_KEY) || 'reading_${safeTestId}');

    function canSync() {
        return typeof fetch === 'function'
            && typeof location !== 'undefined'
            && /^https?:$/i.test(location.protocol || '');
    }

    function wasSynced(signature) {
        try {
            return localStorage.getItem(syncKey) === signature;
        } catch (error) {
            return false;
        }
    }

    function rememberSync(signature) {
        try {
            localStorage.setItem(syncKey, signature);
        } catch (error) {}
    }

    function buildPayload() {
        const scoreText = (document.getElementById('scoreValue')?.innerText || '').trim();
        const match = scoreText.match(/(\d+)\s*\/\s*(\d+)/);
        if (!match) return null;

        const score = Number(match[1]);
        const totalQuestions = Number(match[2]);
        const band = (document.getElementById('bandValue')?.innerText || '').replace(/^Band:\\s*/i, '').trim();
        const studentName = (document.getElementById('studentName')?.value || '').trim() || 'Student';
        const timeRemainingText = (document.getElementById('timerDisplay')?.innerText || '').trim();
        const summaryText = (document.getElementById('modalTitle')?.innerText || '').trim();
        const resultSignature = ['reading', '${safeTestId}', studentName, score, totalQuestions, band, timeRemainingText].join(':');

        return {
            testId: '${safeTestId}',
            type: 'reading',
            studentName,
            score,
            totalQuestions,
            percentage: totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : null,
            band,
            timeRemainingText,
            summaryText,
            incorrectSummary: '',
            resultSignature,
            details: {
                scoreText,
                summaryText
            }
        };
    }

    function syncSubmission() {
        if (!canSync()) return;
        const payload = buildPayload();
        if (!payload || !payload.resultSignature || wasSynced(payload.resultSignature)) return;

        fetch('/api/test-submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        })
            .then((response) => response.ok ? response.json() : null)
            .then((data) => {
                if (data && data.success) {
                    rememberSync(payload.resultSignature);
                }
            })
            .catch(() => {});
    }

    const originalCheckAnswers = typeof checkAnswers === 'function' ? checkAnswers : null;
    if (originalCheckAnswers) {
        const wrappedCheckAnswers = function(...args) {
            const result = originalCheckAnswers.apply(this, args);
            setTimeout(syncSubmission, 350);
            return result;
        };

        checkAnswers = wrappedCheckAnswers;
        window.checkAnswers = wrappedCheckAnswers;
    }

    window.addEventListener('load', () => {
        ensureWritingBindings();
        setTimeout(syncSubmission, 1200);
    });
})();
</script>`;

    return replaceLastLiteral(html, '</body>', `${snippet}\n</body>`);
}

function injectListeningSubmissionHook(html, testDoc) {
    const safeTestId = escapeForBuilderValue(testDoc._id);
    const snippet = `
<script>
(function() {
    const syncKey = 'platform_submission_sync_' + ((typeof SESSION_KEY !== 'undefined' && SESSION_KEY) || 'listening_${safeTestId}');

    function canSync() {
        return typeof fetch === 'function'
            && typeof location !== 'undefined'
            && /^https?:$/i.test(location.protocol || '');
    }

    function wasSynced(signature) {
        try {
            return localStorage.getItem(syncKey) === signature;
        } catch (error) {
            return false;
        }
    }

    function rememberSync(signature) {
        try {
            localStorage.setItem(syncKey, signature);
        } catch (error) {}
    }

    function buildPayload() {
        const resultModal = document.getElementById('resultModal');
        // Only sync after the grading UI is shown (scoreValue/bandValue are populated then).
        if (!resultModal || resultModal.style.display !== 'flex') return null;

        const scoreText = (document.getElementById('scoreValue')?.innerText || '').trim();
        const match = scoreText.match(/(\d+)\s*\/\s*(\d+)/);
        if (!match) return null;

        const score = Number(match[1]);
        const totalQuestions = Number(match[2]);
        const band = (document.getElementById('bandValue')?.innerText || '').replace(/^Band:\\s*/i, '').trim();
        const studentName = (document.getElementById('studentName')?.value || '').trim() || 'Student';
        const timeRemainingText = (document.getElementById('timerDisplay')?.innerText || '').trim();
        const summaryText = (document.getElementById('modalTitle')?.innerText || '').trim();
        const resultSignature = ['listening', '${safeTestId}', studentName, score, totalQuestions, band, timeRemainingText].join(':');

        return {
            testId: '${safeTestId}',
            type: 'listening',
            studentName,
            score,
            totalQuestions,
            percentage: totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : null,
            band,
            timeRemainingText,
            summaryText,
            incorrectSummary: '',
            resultSignature,
            details: {
                scoreText,
                summaryText
            }
        };
    }

    function syncSubmissionWithRetry(attempt = 1) {
        if (!canSync()) return;
        if (attempt > 8) return;

        const payload = buildPayload();
        if (!payload || !payload.resultSignature) {
            // Scoring can be asynchronous; retry shortly until the modal/values are ready.
            setTimeout(() => syncSubmissionWithRetry(attempt + 1), 450);
            return;
        }

        if (wasSynced(payload.resultSignature)) return;

        fetch('/api/test-submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        })
            .then((response) => response.ok ? response.json() : null)
            .then((data) => {
                if (data && data.success) {
                    rememberSync(payload.resultSignature);
                } else if (attempt < 8) {
                    setTimeout(() => syncSubmissionWithRetry(attempt + 1), 450);
                }
            })
            .catch(() => {
                if (attempt < 8) setTimeout(() => syncSubmissionWithRetry(attempt + 1), 450);
            });
    }

    const originalCheckAnswers = typeof checkAnswers === 'function' ? checkAnswers : null;
    if (originalCheckAnswers) {
        const wrappedCheckAnswers = function(...args) {
            const result = originalCheckAnswers.apply(this, args);
            setTimeout(() => syncSubmissionWithRetry(1), 800);
            return result;
        };

        checkAnswers = wrappedCheckAnswers;
        window.checkAnswers = wrappedCheckAnswers;
    }

    window.addEventListener('load', () => {
        setTimeout(() => syncSubmissionWithRetry(1), 1500);
    });
})();
</script>`;

    return replaceLastLiteral(html, '</body>', `${snippet}\n</body>`);
}

function injectWritingSubmissionHook(html, testDoc) {
    const safeTestId = escapeForBuilderValue(testDoc._id);
    const snippet = `
<script>
(function() {
    function ensureWritingBindings() {
        try {
            // Bind buttons defensively in case inline handlers are stripped or globals are missing.
            const footerButtons = Array.from(document.querySelectorAll('.footer .part-btn'));
            if (footerButtons.length >= 2) {
                footerButtons[0].addEventListener('click', () => {
                    if (typeof window.switchTask === 'function') window.switchTask(1);
                });
                footerButtons[1].addEventListener('click', () => {
                    if (typeof window.switchTask === 'function') window.switchTask(2);
                });
            }

            const submitBtn = document.querySelector('.footer .check-btn');
            if (submitBtn) {
                submitBtn.addEventListener('click', () => {
                    if (typeof window.submitTest === 'function') window.submitTest();
                });
            }

            // Fallback switchTask implementation (matches builder behavior).
            if (typeof window.switchTask !== 'function') {
                window.switchTask = function(num) {
                    const buttons = document.querySelectorAll('.footer .part-btn');
                    buttons.forEach((b) => b.classList.remove('active'));
                    if (buttons[num - 1]) buttons[num - 1].classList.add('active');

                    const pTask1 = document.getElementById('p_task1');
                    const pTask2 = document.getElementById('p_task2');
                    const inputTask1 = document.getElementById('input_task1');
                    const inputTask2 = document.getElementById('input_task2');
                    const wcBox1 = document.querySelector('.word-count-box');
                    const wcBox2 = document.getElementById('wc_box_2');

                    if (num === 1) {
                        pTask1?.classList.remove('hidden');
                        pTask2?.classList.add('hidden');
                        inputTask1?.classList.remove('hidden');
                        inputTask2?.classList.add('hidden');
                        wcBox1?.classList.remove('hidden');
                        wcBox2?.classList.add('hidden');
                    } else {
                        pTask1?.classList.add('hidden');
                        pTask2?.classList.remove('hidden');
                        inputTask1?.classList.add('hidden');
                        inputTask2?.classList.remove('hidden');
                        wcBox1?.classList.add('hidden');
                        wcBox2?.classList.remove('hidden');
                    }
                };
            }

            // Fallback timer if builder interval didn't start.
            if (!window.__platformWritingTimerStarted) {
                window.__platformWritingTimerStarted = true;

                if (typeof window.time !== 'number' || !Number.isFinite(window.time)) {
                    const initial = (document.getElementById('timerDisplay')?.innerText || '').trim();
                    const match = initial.match(/^(\d+):(\d+)$/);
                    if (match) {
                        const minutes = Number(match[1]);
                        const seconds = Number(match[2]);
                        if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
                            window.time = minutes * 60 + seconds;
                        }
                    }
                }

                if (typeof window.time !== 'number' || !Number.isFinite(window.time)) {
                    window.time = 60 * 60;
                }

                setInterval(() => {
                    try {
                        const submitted = typeof window.isSubmitted !== 'undefined' ? window.isSubmitted : false;
                        if (window.time > 0 && !submitted) {
                            window.time -= 1;
                            const m = Math.floor(window.time / 60);
                            const s = window.time % 60;
                            const timerDisplay = document.getElementById('timerDisplay');
                            if (timerDisplay) {
                                timerDisplay.innerText = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
                            }
                        } else if (window.time <= 0 && !submitted && typeof window.checkTimeUp === 'function') {
                            window.checkTimeUp();
                        }
                    } catch (error) {
                        // Ignore timer failures - keep page usable.
                    }
                }, 1000);
            }
        } catch (error) {
            // ignore
        }
    }

    const syncKey = 'platform_submission_sync_' + ((typeof SESSION_ID !== 'undefined' && SESSION_ID) || 'writing_${safeTestId}');

    function canSync() {
        return typeof fetch === 'function'
            && typeof location !== 'undefined'
            && /^https?:$/i.test(location.protocol || '');
    }

    function wasSynced(signature) {
        try {
            return localStorage.getItem(syncKey) === signature;
        } catch (error) {
            return false;
        }
    }

    function rememberSync(signature) {
        try {
            localStorage.setItem(syncKey, signature);
        } catch (error) {}
    }

    function parseCount(id, fallbackId) {
        const primary = document.getElementById(id);
        const fallback = document.getElementById(fallbackId);
        const source = (primary?.innerText || fallback?.innerText || '0').trim();
        const value = Number(source);
        return Number.isFinite(value) ? value : 0;
    }

    function buildPayload() {
        const submitted = typeof isSubmitted !== 'undefined' ? isSubmitted : false;
        const modalVisible = document.getElementById('resultModal')?.style.display === 'flex';
        if (!submitted && !modalVisible) return null;

        const studentName = (document.getElementById('studentName')?.value || '').trim() || 'Student';
        const task1 = document.getElementById('view_t1')?.innerText || document.getElementById('input_task1')?.value || '';
        const task2 = document.getElementById('view_t2')?.innerText || document.getElementById('input_task2')?.value || '';
        const wordCount1 = parseCount('final_wc1', 'wc_1');
        const wordCount2 = parseCount('final_wc2', 'wc_2');
        const timeRemainingText = (document.getElementById('timerDisplay')?.innerText || '').trim();
        const resultSignature = ['writing', '${safeTestId}', studentName, wordCount1, wordCount2, task1.length, task2.length].join(':');

        return {
            testId: '${safeTestId}',
            type: 'writing',
            studentName,
            wordCount1,
            wordCount2,
            timeRemainingText,
            task1,
            task2,
            resultSignature,
            details: {
                wordCount1,
                wordCount2,
                task1Preview: task1.slice(0, 200),
                task2Preview: task2.slice(0, 200)
            }
        };
    }

    function syncSubmission() {
        if (!canSync()) return;
        const payload = buildPayload();
        if (!payload || !payload.resultSignature || wasSynced(payload.resultSignature)) return;

        fetch('/api/test-submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        })
            .then((response) => response.ok ? response.json() : null)
            .then((data) => {
                if (data && data.success) {
                    rememberSync(payload.resultSignature);
                }
            })
            .catch(() => {});
    }

    const originalSubmitTest = typeof submitTest === 'function' ? submitTest : null;
    if (originalSubmitTest) {
        const wrappedSubmitTest = function(...args) {
            const result = originalSubmitTest.apply(this, args);
            setTimeout(syncSubmission, 500);
            return result;
        };

        submitTest = wrappedSubmitTest;
        window.submitTest = wrappedSubmitTest;
    }

    window.addEventListener('load', () => {
        setTimeout(syncSubmission, 1200);
    });
})();
</script>`;

    return replaceLastLiteral(html, '</body>', `${snippet}\n</body>`);
}

function injectStudentName(html, testDoc, studentName) {
    if (!studentName) return html;
    const snippet = `
<script>
(function() {
    window.addEventListener('load', function() {
        const nameInput = document.getElementById('studentName');
        if (!nameInput) return;
        nameInput.value = window.__platformStudentName || '';
        nameInput.readOnly = true;
        nameInput.style.display = 'none';
    });
})();
</script>`;
    return replaceLastLiteral(html, '</body>', `${snippet}\n</body>`);
}

function injectHeartbeat(html, testDoc) {
    const safeTestId = escapeForBuilderValue(testDoc._id);
    const safeType = escapeForBuilderValue(testDoc.type || 'reading');
    const snippet = `
<script>
(function() {
    if (!/^https?:$/i.test(location.protocol || '')) return;
    const TEST_ID = '${safeTestId}';
    const TEST_TYPE = '${safeType}';

    function countAnswered() {
        let count = 0;
        const seen = new Set();

        // Gap inputs (text)
        document.querySelectorAll('input.gap-input, input.answer-input').forEach(el => {
            if (!seen.has(el.id) && el.value && el.value.trim()) {
                seen.add(el.id);
                count++;
            }
        });

        // Radio groups
        const radioGroups = new Set();
        document.querySelectorAll('input[type="radio"]').forEach(el => radioGroups.add(el.name));
        radioGroups.forEach(name => {
            if (document.querySelector('input[name="' + name + '"]:checked')) count++;
        });

        // Checkboxes (pick-n)
        document.querySelectorAll('.pick-n-question').forEach(group => {
            if (group.querySelector('input[type="checkbox"]:checked')) count++;
        });

        // Map drop zones
        document.querySelectorAll('.map-drop-zone.filled').forEach(zone => {
            if (!seen.has(zone.dataset.qid)) {
                seen.add(zone.dataset.qid);
                count++;
            }
        });

        // Custom select (matching)
        document.querySelectorAll('.custom-select-wrapper input[type="hidden"]').forEach(el => {
            if (!seen.has(el.id) && el.value && el.value.trim()) {
                seen.add(el.id);
                count++;
            }
        });

        return count;
    }

    function countTotal() {
        // The answer key is stored as encodedKey in the test HTML
        try {
            if (typeof encodedKey !== 'undefined' && encodedKey) {
                const decoded = JSON.parse(atob(encodedKey));
                return Object.keys(decoded).length;
            }
        } catch(e) {}
        // Fallback: count unique question IDs excluding non-question inputs
        const ids = new Set();
        document.querySelectorAll('input[id^="q"]').forEach(el => {
            if (el.type !== 'hidden' && el.id !== 'studentName') ids.add(el.id);
        });
        document.querySelectorAll('.map-drop-zone[data-qid]').forEach(el => ids.add('q' + el.dataset.qid));
        document.querySelectorAll('input[type="radio"][name^="q"]').forEach(el => ids.add(el.name));
        return ids.size;
    }

    function getCurrentPart() {
        const active = document.querySelector('.part-btn.active, .tab.active');
        return active ? active.innerText.trim() : '';
    }

    function getTimeRemaining() {
        const el = document.getElementById('timerDisplay');
        return el ? el.innerText.trim() : '';
    }

    function getStudentName() {
        const el = document.getElementById('studentName') || document.getElementById('lockdownName');
        return (el ? el.value.trim() : '') || (window.__platformStudentName || 'Student');
    }

    let heartbeatInterval = 5000;
    let heartbeatTimer = null;

    function scheduleNext(activeCount) {
        // 1-10 students: 5s, 11-20: 8s, 21-40: 12s, 40+: 20s
        const next = activeCount <= 10 ? 5000
            : activeCount <= 20 ? 8000
            : activeCount <= 40 ? 12000
            : 20000;
        if (next !== heartbeatInterval) heartbeatInterval = next;
        clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(sendHeartbeat, heartbeatInterval);
    }

    function sendHeartbeat() {
        const studentName = getStudentName();
        const answered = countAnswered();
        const total = countTotal();

        // For writing tests, capture task text
        const task1 = (document.getElementById('input_task1') || document.getElementById('view_t1'));
        const task2 = (document.getElementById('input_task2') || document.getElementById('view_t2'));
        const wc1El = document.getElementById('wc_1') || document.getElementById('final_wc1');
        const wc2El = document.getElementById('wc_2') || document.getElementById('final_wc2');

        fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                testId: TEST_ID,
                studentName,
                answeredCount: answered,
                totalCount: total,
                currentPart: getCurrentPart(),
                timeRemaining: getTimeRemaining(),
                type: TEST_TYPE,
                task1Preview: task1 ? (task1.value || task1.innerText || '').slice(0, 300) : null,
                task2Preview: task2 ? (task2.value || task2.innerText || '').slice(0, 300) : null,
                wordCount1: wc1El ? wc1El.innerText.trim() : null,
                wordCount2: wc2El ? wc2El.innerText.trim() : null
            })
        })
        .then(r => r.json())
        .then(data => scheduleNext(data.activeCount || 1))
        .catch(() => scheduleNext(1));
    }

    setTimeout(sendHeartbeat, 2000);
})();
</script>`;
    return replaceLastLiteral(html, '</body>', `${snippet}\n</body>`);
}

function injectPersistentStateForDownload(html, testDoc) {
    const stableId = createStableSessionId(testDoc, 'dl_');
    const snippet = `
<script>
(function() {
    // Ensure state keys are stable and not time-based so data survives file re-open
    const STABLE_KEY = '${stableId}';
    function patchSessionKey(varName) {
        try {
            const current = window[varName];
            if (current && typeof current === 'string' && current !== STABLE_KEY) {
                // Migrate any existing state from old key to stable key
                try {
                    const old = localStorage.getItem(current);
                    if (old && !localStorage.getItem(STABLE_KEY)) {
                        localStorage.setItem(STABLE_KEY, old);
                    }
                } catch(e) {}
                window[varName] = STABLE_KEY;
            }
        } catch(e) {}
    }
    if (typeof SESSION_KEY !== 'undefined') patchSessionKey('SESSION_KEY');
    if (typeof SESSION_ID !== 'undefined') patchSessionKey('SESSION_ID');
})();
</script>`;
    return replaceAllLiteral(html, '</head>', `${snippet}\n</head>`);
}

function generateReadingHtml(testDoc, parsedContent, studentName) {
    const content = normalizeReadingContent(parsedContent, testDoc);
    const stableSessionId = createStableSessionId(testDoc, 'test_');

    let html = runBuilderGenerateFile('reading', {
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

    html = injectThemeStyles(html);
    html = injectWebsiteThemeButton(html, 'reading');
    html = injectThemeController(html, 'reading');
    html = injectReadingHighlightFix(html);
    html = injectReadingSubmissionHook(html, testDoc);
    html = injectQuitButton(html);
    html = injectStudentName(html, testDoc, studentName);
    html = injectHeartbeat(html, testDoc);
    return html.trim();
}

function generateListeningHtml(testDoc, parsedContent, studentName) {
    const content = normalizeListeningContent(parsedContent);
    const stableSessionId = createStableSessionId(testDoc, 'ielts_listening_');
    let generatedHtml = runBuilderGenerateFile('listening', {
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

    // Post-process: Ensure audio URLs are available in the generated HTML
    // This reinforces the audio injection even if the builder stringified different values
    const audioPartsJson = JSON.stringify(content.audioParts || [null, null, null, null]);
    const fullAudioJson = JSON.stringify(content.fullAudio || null);

    console.log('[Listening Generation] Audio Parts:', content.audioParts);
    console.log('[Listening Generation] Full Audio:', content.fullAudio);
    console.log('[Listening Generation] Audio Parts JSON:', audioPartsJson);
    console.log('[Listening Generation] Full Audio JSON:', fullAudioJson);

    // Force replace audio variables if they contain actual URLs
    if (content.audioParts && content.audioParts.some(url => url)) {
        // Replace the audio data list line with our URLs - handle multiline with greedy match
        const before = generatedHtml.match(/const rawAudioDataList\s*=\s*[\[\s\S]*?\];/);
        console.log('[Listening Generation] Before replacement:', before ? before[0].substring(0, 100) : 'NO MATCH');

        generatedHtml = generatedHtml.replace(
            /const rawAudioDataList\s*=\s*[\[\s\S]*?\];/,
            `const rawAudioDataList = ${audioPartsJson};`
        );

        const after = generatedHtml.match(/const rawAudioDataList\s*=\s*[\[\s\S]*?\];/);
        console.log('[Listening Generation] After replacement:', after ? after[0].substring(0, 100) : 'NO MATCH');
    }
    if (content.fullAudio) {
        // Replace the full audio line with our URL - handle multiline
        generatedHtml = generatedHtml.replace(
            /const rawFullAudioData\s*=\s*[\s\S]*?;/,
            `const rawFullAudioData = ${fullAudioJson};`
        );
    }

    generatedHtml = injectListeningUrlSupport(generatedHtml);
    generatedHtml = injectThemeStyles(generatedHtml);
    generatedHtml = injectWebsiteThemeButton(generatedHtml, 'listening');
    generatedHtml = injectThemeController(generatedHtml, 'listening');
    generatedHtml = injectListeningHighlightFix(generatedHtml);
    generatedHtml = injectListeningSubmissionHook(generatedHtml, testDoc);
    generatedHtml = injectQuitButton(generatedHtml);
    generatedHtml = injectStudentName(generatedHtml, testDoc, studentName);
    generatedHtml = injectHeartbeat(generatedHtml, testDoc);
    return generatedHtml.trim();
}

function generateWritingHtml(testDoc, parsedContent, options = {}) {
    const studentName = options.studentName || '';
    const content = normalizeWritingContent(parsedContent);
    const stableSessionId = createStableSessionId(testDoc, 'ielts_writing_');
    let generatedHtml = runBuilderGenerateFile('writing', {
        t1_img: { value: content.task1.image || '' },
        t1_prompt: { value: content.task1.prompt || '' },
        t1_model: { value: content.task1.modelAnswer || '' },
        t2_prompt: { value: content.task2.prompt || '' },
        t2_model: { value: content.task2.modelAnswer || '' },
        time_limit: { value: String(content.timeLimit) }
    }, {}, stableSessionId);

    generatedHtml = generatedHtml
        .replace(
            /var SESSION_ID = "ielts_writing_\d+";/,
            `var SESSION_ID = "${stableSessionId}";`
        )
        .replace(
            /const GROQ_API_KEY = ".*?";/g,
            `const DEEPSEEK_API_KEY = "${escapeForBuilderValue(options.deepseekApiKey || '')}";`
        )
        .replace(
            /GROQ_API_KEY/g,
            'DEEPSEEK_API_KEY'
        )
        .replace(
            /https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions/g,
            'https://api.deepseek.com/v1/chat/completions'
        )
        .replace(
            /model: ['"]llama-3\.3-70b-versatile['"]/g,
            "model: 'deepseek-chat'"
        )
        .replace(
            /model: ['"]llama3-70b-8192['"]/g,
            "model: 'deepseek-chat'"
        );

    generatedHtml = injectThemeStyles(generatedHtml);
    generatedHtml = injectWebsiteThemeButton(generatedHtml, 'writing');
    generatedHtml = injectThemeController(generatedHtml, 'writing');
    generatedHtml = injectWritingSubmissionHook(generatedHtml, testDoc);
    generatedHtml = injectQuitButton(generatedHtml);
    generatedHtml = injectStudentName(generatedHtml, testDoc, studentName);
    generatedHtml = injectHeartbeat(generatedHtml, testDoc);
    return generatedHtml.trim();
}
function generateHTMLFromTest(testDoc, options = {}) {
    const plainTest = toPlainObject(testDoc);
    const studentName = escapeForBuilderValue(options.studentName || '');

    function injectNameVar(html) {
        if (!studentName) return html;
        return html.replace('<head>', `<head>\n<script>window.__platformStudentName = "${studentName}";</script>`);
    }

    if (plainTest.renderedHtml && typeof plainTest.renderedHtml === 'string' && plainTest.renderedHtml.trim()) {
        const normalizedType = String(plainTest.type || 'reading').toLowerCase();
        let html = plainTest.renderedHtml.trim();

        // Ensure platform theme toggle exists for all types.
        if (!html.includes('platform-theme-overrides')) {
            html = injectThemeStyles(html);
        }
        if (!html.includes('toggleSiteTheme') && !html.includes('Platform Theme')) {
            html = injectWebsiteThemeButton(html, normalizedType);
            html = injectThemeController(html, normalizedType);
        } else {
            if (!html.includes('toggleSiteTheme')) {
                html = injectThemeController(html, normalizedType);
            }
            if (!html.includes('Platform Theme')) {
                html = injectWebsiteThemeButton(html, normalizedType);
            }
        }

        // Writing tests need runtime hooks even when HTML was stored.
        if (normalizedType === 'writing') {
            if (!html.includes('platform_submission_sync_')) {
                html = injectWritingSubmissionHook(html, plainTest);
            }
            html = injectQuitButton(html);
            html = injectStudentName(html, plainTest, studentName);
            html = injectHeartbeat(html, plainTest);
        }

        return html;
    }

    const rawContent = plainTest.readingPassage ?? plainTest.content;
    const parsedContent = parseStoredContent(rawContent, 'readingPassage');

    if (parsedContent.__rawHtml) {
        const normalizedType = String(plainTest.type || 'reading').toLowerCase();
        let rawHtml = parsedContent.__rawHtml.trim();

        // Backward-compat: some older saved tests may contain already-rendered HTML.
        // Still inject the Platform Theme CSS/JS/button so the toggle works.
        if (!rawHtml.includes('platform-theme-overrides')) {
            rawHtml = injectThemeStyles(rawHtml);
        }
        if (!rawHtml.includes('toggleSiteTheme') && !rawHtml.includes('Platform Theme')) {
            rawHtml = injectWebsiteThemeButton(rawHtml, normalizedType);
            rawHtml = injectThemeController(rawHtml, normalizedType);
        } else {
            // Ensure controller exists even if the button markup is already present.
            if (!rawHtml.includes('toggleSiteTheme')) {
                rawHtml = injectThemeController(rawHtml, normalizedType);
            }
            if (!rawHtml.includes('Platform Theme')) {
                rawHtml = injectWebsiteThemeButton(rawHtml, normalizedType);
            }
        }

        // Writing tests: ensure submission hook + heartbeat exist even for raw HTML.
        if (normalizedType === 'writing') {
            if (!rawHtml.includes('platform_submission_sync_')) {
                rawHtml = injectWritingSubmissionHook(rawHtml, plainTest);
            }
            rawHtml = injectQuitButton(rawHtml);
            rawHtml = injectStudentName(rawHtml, plainTest, studentName);
            rawHtml = injectHeartbeat(rawHtml, plainTest);
        }

        return rawHtml;
    }

    const normalizedType = String(plainTest.type || 'reading').toLowerCase();

    if (normalizedType === 'reading') {
        return injectNameVar(generateReadingHtml(plainTest, parsedContent, studentName));
    }

    if (normalizedType === 'listening') {
        return injectNameVar(generateListeningHtml(plainTest, parsedContent, studentName));
    }

    if (normalizedType === 'writing') {
        return injectNameVar(generateWritingHtml(plainTest, parsedContent, options));
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
    stringifyContent,
    injectPersistentStateForDownload
};
