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
        margin-top: 0 !important;
        height: auto !important;
        min-height: 100vh !important;
        padding: 118px 18px 112px !important;
        gap: 18px !important;
        box-sizing: border-box;
        overflow-y: auto !important;
        overflow-x: hidden !important;
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
        height: 100% !important;
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
        width: 12px !important;
        border-radius: 999px;
        background: rgba(255,255,255,0.52) !important;
        box-shadow: inset 0 0 0 1px rgba(102, 126, 234, 0.16);
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
</style>`;

    return replaceLastLiteral(html, '</head>', `${themeStyles}\n</head>`);
}

function injectWebsiteThemeButton(html, type) {
    const platformBtn = `<button class="part-btn site-theme-btn" data-off-label="Platform Theme" data-on-label="Builder Theme" onclick="toggleSiteTheme()" style="margin-right:10px;">Platform Theme</button>`;
    
    if (type === 'writing') {
        // Find the theme button and add platform theme button after it
        return html.replace(
            /(<button[^>]*onclick="toggleDarkMode[^>]*>.*?<\/button>)/,
            `$1\n            ${platformBtn}`
        );
    }

    return html.replace(
        /(<button class="theme-btn"[^>]*>.*?<\/button>)/,
        `$1\n            ${platformBtn}`
    );
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
        const match = scoreText.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
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
        const scoreText = (document.getElementById('scoreValue')?.innerText || '').trim();
        const match = scoreText.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
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
        setTimeout(syncSubmission, 1200);
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

function generateReadingHtml(testDoc, parsedContent) {
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
    return html.trim();
}

function generateListeningHtml(testDoc, parsedContent) {
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
    
    // Post-process: Ensure R2 audio URLs are available in the generated HTML
    // This reinforces the audio injection even if the builder stringified different values
    const audioPartsJson = JSON.stringify(content.audioParts || [null, null, null, null]);
    const fullAudioJson = JSON.stringify(content.fullAudio || null);
    
    console.log('[Listening Generation] Audio Parts:', content.audioParts);
    console.log('[Listening Generation] Full Audio:', content.fullAudio);
    console.log('[Listening Generation] Audio Parts JSON:', audioPartsJson);
    console.log('[Listening Generation] Full Audio JSON:', fullAudioJson);
    
    // Force replace audio variables if they contain actual R2 URLs
    if (content.audioParts && content.audioParts.some(url => url)) {
        // Replace the audio data list line with our R2 URLs - handle multiline with greedy match
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
        // Replace the full audio line with our R2 URL - handle multiline
        generatedHtml = generatedHtml.replace(
            /const rawFullAudioData\s*=\s*[\s\S]*?;/,
            `const rawFullAudioData = ${fullAudioJson};`
        );
    }

    generatedHtml = injectListeningR2Support(generatedHtml);
    generatedHtml = injectThemeStyles(generatedHtml);
    generatedHtml = injectWebsiteThemeButton(generatedHtml, 'listening');
    generatedHtml = injectThemeController(generatedHtml, 'listening');
    generatedHtml = injectListeningHighlightFix(generatedHtml);
    generatedHtml = injectListeningSubmissionHook(generatedHtml, testDoc);
    return generatedHtml.trim();
}

function generateWritingHtml(testDoc, parsedContent, options = {}) {
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
            /const SESSION_ID = "ielts_writing_\d+";/,
            `const SESSION_ID = "${stableSessionId}";`
        )
        .replace(
            /const GROQ_API_KEY = ".*?";/,
            `const GROQ_API_KEY = "${escapeForBuilderValue(options.groqApiKey || '')}";`
        );

    generatedHtml = injectThemeStyles(generatedHtml);
    generatedHtml = injectWebsiteThemeButton(generatedHtml, 'writing');
    generatedHtml = injectThemeController(generatedHtml, 'writing');
    generatedHtml = injectWritingSubmissionHook(generatedHtml, testDoc);
    return generatedHtml.trim();
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
