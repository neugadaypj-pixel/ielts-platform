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

function injectThemeStyles(html) {
    const themeStyles = `
<style id="platform-theme-overrides">
    .site-theme-btn {
        position: relative;
        overflow: hidden;
    }
    .theme-btn.site-theme-btn {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: #fff !important;
        border: 1px solid rgba(255,255,255,0.35) !important;
        box-shadow: 0 10px 24px rgba(102, 126, 234, 0.28) !important;
    }
    .part-btn.site-theme-btn {
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.14) 0%, rgba(118, 75, 162, 0.1) 100%) !important;
        border-color: rgba(102, 126, 234, 0.28) !important;
        color: #4338ca !important;
        box-shadow: 0 10px 24px rgba(102, 126, 234, 0.14) !important;
    }
    .site-theme-btn.active-site-theme {
        filter: brightness(1.04);
        transform: translateY(-1px);
        box-shadow: 0 14px 28px rgba(102, 126, 234, 0.34) !important;
    }
    body.platform-theme {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: #1f2937 !important;
    }
    body.platform-theme::before {
        opacity: 0 !important;
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
        background: rgba(255, 255, 255, 0.94) !important;
        border-color: rgba(255, 255, 255, 0.32) !important;
        color: #1f2937 !important;
        box-shadow: 0 18px 38px rgba(31, 41, 55, 0.16) !important;
        backdrop-filter: blur(18px);
    }
    .platform-theme .main-container {
        background: transparent !important;
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
        background: rgba(245, 247, 250, 0.94) !important;
        backdrop-filter: blur(18px);
    }
    .platform-theme .start-overlay h1,
    .platform-theme .start-overlay p {
        color: #1f2937 !important;
    }
</style>`;

    return html.replace('</head>', `${themeStyles}\n</head>`);
}

function injectWebsiteThemeButton(html, type) {
    if (type === 'writing') {
        return html.replace(
            /(<button class="part-btn theme-btn"[^>]*>.*?<\/button>)/,
            `$1\n            <button class="part-btn site-theme-btn" data-mode-label="text" onclick="toggleSiteTheme()" style="margin-right:10px; padding:5px 15px; font-size:12px;">Site Theme</button>`
        );
    }

    return html.replace(
        /(<button class="theme-btn"[^>]*>.*?<\/button>)/,
        `$1\n            <button class="theme-btn site-theme-btn" data-tooltip="Website Theme" onclick="toggleSiteTheme()">S</button>`
    );
}

function injectThemeController(html, type) {
    const snippet = `
<script>
(function() {
    const storageKey = 'platform_site_theme_' + (location.pathname || document.title || '${type}');
    const siteThemeButton = document.querySelector('.site-theme-btn');

    function syncSiteThemeButton() {
        if (!siteThemeButton) return;
        const isActive = document.body.classList.contains('platform-theme');
        siteThemeButton.classList.toggle('active-site-theme', isActive);
        if (siteThemeButton.dataset.modeLabel === 'text') {
            siteThemeButton.innerText = isActive ? 'Site On' : 'Site Theme';
        }
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

    return html.replace('</body>', `${snippet}\n</body>`);
}

function injectReadingHighlightFix(html) {
    const snippet = `
<script>
(function() {
    if (!document.getElementById('contextMenu')) return;

    const ctxMenu = document.getElementById('contextMenu');
    const panels = [document.getElementById('passagePanel'), document.getElementById('questionsPanel')].filter(Boolean);
    let stickyRange = null;
    let stickyOwner = null;

    function captureSelection(owner) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;

        const range = sel.getRangeAt(0).cloneRange();
        const container = range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;

        if (owner && container && !owner.contains(container)) return false;

        stickyRange = range;
        stickyOwner = owner || stickyOwner;
        savedRange = range.cloneRange();
        activeHighlightPanel = stickyOwner;
        return true;
    }

    panels.forEach((panel) => {
        ['mouseup', 'keyup', 'touchend'].forEach((eventName) => {
            panel.addEventListener(eventName, () => setTimeout(() => captureSelection(panel), 0), true);
        });

        panel.addEventListener('contextmenu', (event) => {
            const hasSelection = captureSelection(panel) || (stickyRange && stickyOwner === panel);
            if (hasSelection) {
                event.preventDefault();
                savedRange = (stickyRange || savedRange).cloneRange();
                activeHighlightPanel = stickyOwner || panel;
                ctxMenu.style.display = 'block';
                ctxMenu.style.left = event.clientX + 'px';
                ctxMenu.style.top = event.clientY + 'px';
            }
        }, true);
    });

    function getWorkingRange() {
        if (savedRange && typeof savedRange.cloneRange === 'function') return savedRange.cloneRange();
        if (stickyRange && typeof stickyRange.cloneRange === 'function') return stickyRange.cloneRange();
        return null;
    }

    function wrapRange(range, colorCode) {
        const span = document.createElement('span');
        span.style.backgroundColor = colorCode;
        span.style.borderRadius = '3px';
        try {
            range.surroundContents(span);
        } catch (error) {
            const extracted = range.extractContents();
            span.appendChild(extracted);
            range.insertNode(span);
        }
    }

    performHighlight = function(colorCode) {
        const range = getWorkingRange();
        if (!range || range.collapsed) {
            ctxMenu.style.display = 'none';
            return;
        }

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        wrapRange(selection.getRangeAt(0), colorCode);
        selection.removeAllRanges();
        savedRange = null;
        stickyRange = null;
        stickyOwner = null;
        activeHighlightPanel = null;
        if (typeof saveState === 'function') saveState();
        ctxMenu.style.display = 'none';
    };

    clearHighlight = function() {
        const range = getWorkingRange();
        if (!range || range.collapsed) {
            ctxMenu.style.display = 'none';
            return;
        }

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        let parent = selection.getRangeAt(0).commonAncestorContainer;
        if (parent.nodeType === 3) parent = parent.parentNode;
        if (parent && parent.tagName && parent.tagName.toLowerCase() === 'span' && parent.style.backgroundColor) {
            const text = document.createTextNode(parent.textContent);
            parent.parentNode.replaceChild(text, parent);
        }

        selection.removeAllRanges();
        savedRange = null;
        stickyRange = null;
        stickyOwner = null;
        activeHighlightPanel = null;
        if (typeof saveState === 'function') saveState();
        ctxMenu.style.display = 'none';
    };

    window.performHighlight = performHighlight;
    window.clearHighlight = clearHighlight;
})();
</script>`;

    return html.replace('</body>', `${snippet}\n</body>`);
}

function injectListeningHighlightFix(html) {
    const snippet = `
<script>
(function() {
    if (!document.getElementById('contextMenu')) return;

    const ctxMenu = document.getElementById('contextMenu');
    const questionsPanel = document.getElementById('questionsPanel');
    if (!questionsPanel) return;

    let stickyRange = null;

    function captureSelection() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;

        const range = sel.getRangeAt(0).cloneRange();
        const container = range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;

        if (container && !questionsPanel.contains(container)) return false;

        stickyRange = range;
        savedRange = range.cloneRange();
        return true;
    }

    ['mouseup', 'keyup', 'touchend'].forEach((eventName) => {
        questionsPanel.addEventListener(eventName, () => setTimeout(captureSelection, 0), true);
    });

    questionsPanel.addEventListener('contextmenu', (event) => {
        const hasSelection = captureSelection() || stickyRange;
        if (hasSelection) {
            event.preventDefault();
            savedRange = (stickyRange || savedRange).cloneRange();
            ctxMenu.style.display = 'block';
            ctxMenu.style.left = event.clientX + 'px';
            ctxMenu.style.top = event.clientY + 'px';
        }
    }, true);

    function getWorkingRange() {
        if (savedRange && typeof savedRange.cloneRange === 'function') return savedRange.cloneRange();
        if (stickyRange && typeof stickyRange.cloneRange === 'function') return stickyRange.cloneRange();
        return null;
    }

    function wrapRange(range, colorCode) {
        const span = document.createElement('span');
        span.style.backgroundColor = colorCode;
        span.style.borderRadius = '3px';
        try {
            range.surroundContents(span);
        } catch (error) {
            if (document.queryCommandSupported && document.queryCommandSupported('BackColor')) {
                document.body.contentEditable = 'true';
                document.execCommand('BackColor', false, colorCode);
                document.body.contentEditable = 'false';
                return;
            }
            const extracted = range.extractContents();
            span.appendChild(extracted);
            range.insertNode(span);
        }
    }

    performHighlight = function(colorCode) {
        const range = getWorkingRange();
        if (!range || range.collapsed) {
            ctxMenu.style.display = 'none';
            return;
        }

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        wrapRange(selection.getRangeAt(0), colorCode);
        selection.removeAllRanges();
        savedRange = null;
        stickyRange = null;
        if (typeof saveState === 'function') saveState();
        ctxMenu.style.display = 'none';
    };

    clearHighlight = function() {
        const range = getWorkingRange();
        if (!range || range.collapsed) {
            ctxMenu.style.display = 'none';
            return;
        }

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let parent = selection.getRangeAt(0).commonAncestorContainer;
        if (parent.nodeType === 3) parent = parent.parentNode;

        if (parent && parent.tagName && parent.tagName.toLowerCase() === 'span' && parent.style.backgroundColor) {
            const text = document.createTextNode(parent.textContent);
            parent.parentNode.replaceChild(text, parent);
        } else if (document.queryCommandSupported && document.queryCommandSupported('BackColor')) {
            document.body.contentEditable = 'true';
            document.execCommand('BackColor', false, 'transparent');
            document.body.contentEditable = 'false';
        }

        selection.removeAllRanges();
        savedRange = null;
        stickyRange = null;
        if (typeof saveState === 'function') saveState();
        ctxMenu.style.display = 'none';
    };

    window.performHighlight = performHighlight;
    window.clearHighlight = clearHighlight;
})();
</script>`;

    return html.replace('</body>', `${snippet}\n</body>`);
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
    return html;
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

    generatedHtml = injectListeningR2Support(generatedHtml);
    generatedHtml = injectThemeStyles(generatedHtml);
    generatedHtml = injectWebsiteThemeButton(generatedHtml, 'listening');
    generatedHtml = injectThemeController(generatedHtml, 'listening');
    generatedHtml = injectListeningHighlightFix(generatedHtml);
    return generatedHtml;
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
