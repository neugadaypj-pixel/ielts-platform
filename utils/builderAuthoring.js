const { readBuilderSource } = require('./builderAssets');

function replaceLastLiteral(template, searchValue, replacementValue) {
    const lastIndex = template.lastIndexOf(searchValue);
    if (lastIndex === -1) {
        return template;
    }
    return `${template.slice(0, lastIndex)}${replacementValue}${template.slice(lastIndex + searchValue.length)}`;
}

function commonInjectionStyles() {
    return `
<style>
    .platform-save-box {
        margin-bottom: 24px;
        padding: 18px 20px;
        border-radius: 18px;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.12) 0%, rgba(118, 75, 162, 0.08) 100%);
        border: 1px solid rgba(102, 126, 234, 0.22);
        box-shadow: 0 8px 24px rgba(102, 126, 234, 0.1);
    }
    .platform-save-title {
        margin: 0 0 12px 0;
        font-size: 15px;
        font-weight: 800;
        color: #34495e;
    }
    .platform-save-row {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        align-items: flex-end;
    }
    .platform-save-field {
        flex: 1 1 280px;
    }
    .platform-save-field label {
        margin-top: 0;
    }
    .platform-save-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
    }
    .platform-save-button {
        border: none;
        border-radius: 14px;
        padding: 12px 22px;
        font-weight: 700;
        cursor: pointer;
        color: white;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        box-shadow: 0 10px 20px rgba(102, 126, 234, 0.25);
    }
    .platform-save-button:hover {
        transform: translateY(-2px);
        filter: brightness(1.04);
    }
    .platform-save-status {
        margin-top: 10px;
        min-height: 18px;
        font-size: 13px;
        color: #34495e;
    }
</style>`;
}

function buildReadingInjection(testData = null) {
    const isEditMode = testData && testData._id;
    const testId = isEditMode ? testData._id : null;
    const preloadedData = isEditMode ? JSON.stringify(testData) : 'null';
    const builderJson = isEditMode && testData.builderJson ? JSON.stringify(testData.builderJson) : 'null';

    return `
${commonInjectionStyles()}
<script>
(function () {
    const isEditMode = ${isEditMode ? 'true' : 'false'};
    const testId = '${testId}';
    const preloadedData = ${preloadedData};

    const actionArea = document.querySelector('.action-area');
    if (!actionArea) return;

    const controls = document.createElement('div');
    controls.className = 'platform-save-box';
    controls.innerHTML = \`
        <div class="platform-save-title">${isEditMode ? '✏️ Update This Reading Test' : 'Save This Builder Test to the Platform'}</div>
        <div class="platform-save-row">
            <div class="platform-save-field">
                <label for="platformTestTitle">${isEditMode ? 'Reading Test Title (Update)' : 'Platform Test Title'}</label>
                <input type="text" id="platformTestTitle" placeholder="e.g. IELTS Reading Practice 1" value="${isEditMode ? (preloadedData ? JSON.parse(preloadedData).title || '' : '') : ''}">
            </div>
            <div class="platform-save-actions">
                <button type="button" id="platformSaveButton" class="platform-save-button">${isEditMode ? 'Update Test' : 'Save to Platform'}</button>
                ${isEditMode ? '<button type="button" id="platformCancelButton" class="platform-save-button" style="background: #9ca3af;">Cancel</button>' : ''}
            </div>
        </div>
        <div id="platformSaveStatus" class="platform-save-status"></div>
    \`;

    actionArea.insertBefore(controls, actionArea.firstChild);

    if (isEditMode) {
        const savedJson = JSON.parse(${builderJson});
        if (savedJson && savedJson.parts) {
            function applyReadingData() {
                const el = document.getElementById('p1_title');
                if (!el) { setTimeout(applyReadingData, 100); return; }
                try {
                    ['p1_title','p1_text','q1_text','p2_title','p2_text','q2_text','p3_title','p3_text','q3_text'].forEach(function(id) {
                        if (savedJson.parts[id] && document.getElementById(id)) document.getElementById(id).value = savedJson.parts[id];
                    });
                    if (savedJson.answerKey && document.getElementById('answer_key_json')) {
                        document.getElementById('answer_key_json').value = savedJson.answerKey;
                    }
                } catch (e) { console.error('Error loading builder JSON:', e); }
            }
            setTimeout(applyReadingData, 200);
        }
    }

    const getVal = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');

    function autoFormat(text) {
        if (!text) return '';
        return text.split(/\\n\\s*\\n/).map((para) => {
            const trimmed = para.trim();
            if (!trimmed) return '';
            if (trimmed.search(/<\\/?(p|div|ul|ol|h[1-6]|table)/i) !== -1) {
                return trimmed;
            }
            return '<p style="margin-bottom: 15px;">' + trimmed.replace(/\\n/g, '<br>') + '</p>';
        }).join('\\n');
    }

    async function saveToPlatform() {
        const status = document.getElementById('platformSaveStatus');
        const title = getVal('platformTestTitle').trim() || getVal('p1_title').trim() || 'Reading Test';

        let answerKey;
        try {
            answerKey = JSON.parse(getVal('answer_key_json'));
        } catch (error) {
            alert('Invalid Answer Key JSON');
            return;
        }

        const content = {
            p1: { title: getVal('p1_title'), text: autoFormat(getVal('p1_text')), questions: getVal('q1_text') },
            p2: { title: getVal('p2_title'), text: autoFormat(getVal('p2_text')), questions: getVal('q2_text') },
            p3: { title: getVal('p3_title'), text: autoFormat(getVal('p3_text')), questions: getVal('q3_text') },
            answerKey
        };

        const builderJson = JSON.stringify({
            answerKey: getVal('answer_key_json'),
            parts: {
                p1_title: getVal('p1_title'), p1_text: getVal('p1_text'), q1_text: getVal('q1_text'),
                p2_title: getVal('p2_title'), p2_text: getVal('p2_text'), q2_text: getVal('q2_text'),
                p3_title: getVal('p3_title'), p3_text: getVal('p3_text'), q3_text: getVal('q3_text')
            }
        });

        status.textContent = isEditMode ? 'Updating...' : 'Saving...';

        try {
            const endpoint = isEditMode ? '/update-test/' + testId : '/create-test/reading';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content, type: 'reading', builderJson })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || data.message || 'Unable to save reading test');
            }

            status.textContent = isEditMode ? 'Updated successfully. Redirecting...' : 'Saved successfully. Redirecting...';
            setTimeout(() => { window.location.href = '/admin'; }, 900);
        } catch (error) {
            status.textContent = 'Save failed.';
            alert('Error saving reading test: ' + error.message);
        }
    }

    document.getElementById('platformSaveButton').addEventListener('click', saveToPlatform);

    if (isEditMode && document.getElementById('platformCancelButton')) {
        document.getElementById('platformCancelButton').addEventListener('click', () => {
            window.location.href = '/admin';
        });
    }
})();
</script>`;
}

function buildListeningInjection(testData = null) {
    const isEditMode = testData && testData._id;
    const testId = isEditMode ? testData._id : null;
    const preloadedData = isEditMode ? JSON.stringify(testData) : 'null';
    const builderJson = isEditMode && testData.builderJson ? JSON.stringify(testData.builderJson) : 'null';

    return `
${commonInjectionStyles()}
<style>
    .file-upload-progress { margin-top: 10px; padding: 8px 12px; border-radius: 8px; background: #e3f2fd; color: #1976d2; font-size: 12px; display: none; }
    .file-upload-progress.show { display: block; }
    .file-status { color: #4caf50; font-weight: 600; }
    .file-status.error { color: #f44336; }
</style>
<script>
(function () {
    const isEditMode = ${isEditMode ? 'true' : 'false'};
    const testId = '${testId}';
    const preloadedData = ${preloadedData};

    const actionArea = document.querySelector('.action-area');
    if (!actionArea) return;

    const controls = document.createElement('div');
    controls.className = 'platform-save-box';
    controls.innerHTML = \`
        <div class="platform-save-title">${isEditMode ? '🎧 Update This Listening Test' : '🎧 Save This Builder Test to the Platform'}</div>
        <div class="platform-save-row">
            <div class="platform-save-field">
                <label for="platformTestTitle">${isEditMode ? 'Listening Test Title (Update)' : 'Platform Test Title'}</label>
                <input type="text" id="platformTestTitle" placeholder="e.g. IELTS Listening Practice 1" value="${isEditMode ? (preloadedData ? JSON.parse(preloadedData).title || '' : '') : ''}">
            </div>
            <div class="platform-save-actions">
                <button type="button" id="platformSaveButton" class="platform-save-button">${isEditMode ? 'Update Test' : 'Save to Platform'}</button>
                ${isEditMode ? '<button type="button" id="platformCancelButton" class="platform-save-button" style="background: #9ca3af;">Cancel</button>' : ''}
            </div>
        </div>
        <div id="platformSaveStatus" class="platform-save-status"></div>
        <div id="fileUploadProgress" class="file-upload-progress"></div>
    \`;

    actionArea.insertBefore(controls, actionArea.firstChild);

    if (isEditMode) {
        const savedJson = JSON.parse(${builderJson});
        if (savedJson && savedJson.parts) {
            function applyListeningData() {
                const el = document.getElementById('q1_text');
                if (!el) { setTimeout(applyListeningData, 100); return; }
                try {
                    for (let i = 1; i <= 4; i++) {
                        const field = document.getElementById('q' + i + '_text');
                        if (field && savedJson.parts[i]) field.value = savedJson.parts[i];
                    }
                    if (savedJson.answerKey && document.getElementById('answer_key_json')) {
                        document.getElementById('answer_key_json').value = savedJson.answerKey;
                    }
                } catch (e) { console.error('Error loading builder JSON:', e); }
            }
            setTimeout(applyListeningData, 200);
        }
    }

    const getVal = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');
    const statusEl = document.getElementById('platformSaveStatus');
    const progressEl = document.getElementById('fileUploadProgress');

    function getCookie(name) {
        const value = '; ' + document.cookie;
        const parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function updateStatus(msg, isError = false) {
        statusEl.textContent = msg;
        statusEl.style.color = isError ? '#f44336' : '#34495e';
    }

    function updateProgress(msg) {
        progressEl.innerHTML = msg;
        progressEl.classList.add('show');
    }

    async function saveToPlatform() {
        updateStatus(isEditMode ? 'Preparing update...' : 'Preparing upload...');

        const title = getVal('platformTestTitle').trim() || 'Listening Test';
        if (!title) {
            updateStatus('Please enter a test title', true);
            return;
        }

        let answerKey;
        try {
            answerKey = JSON.parse(getVal('answer_key_json'));
        } catch (error) {
            updateStatus('Invalid Answer Key JSON', true);
            return;
        }

        const fileInputs = document.querySelectorAll('.file-upload-box input[type="file"]');
        const fullAudioInput = fileInputs[0];
        const partAudioInputs = Array.from(fileInputs).slice(1, 5);
        const formData = new FormData();

        let hasAudio = false;
        if (fullAudioInput && fullAudioInput.files && fullAudioInput.files[0]) {
            hasAudio = true;
            formData.append('audioFile', fullAudioInput.files[0]);
            updateProgress('📤 Uploading full audio...');
        } else {
            for (let i = 0; i < partAudioInputs.length; i++) {
                const input = partAudioInputs[i];
                if (input && input.files && input.files[0]) {
                    hasAudio = true;
                    formData.append('part' + (i + 1), input.files[0]);
                    updateProgress('📤 Uploading Part ' + (i + 1) + '...');
                }
            }
        }

        if (!hasAudio && !isEditMode) {
            updateStatus('Please upload at least one audio file', true);
            return;
        }

        formData.append('title', title);
        formData.append('answerKey', JSON.stringify(answerKey));
        formData.append('usePause', document.getElementById('add_pause_cb').checked ? 'true' : 'false');
        formData.append('parts', JSON.stringify({
            1: { finalHtml: getVal('q1_text') },
            2: { finalHtml: getVal('q2_text') },
            3: { finalHtml: getVal('q3_text') },
            4: { finalHtml: getVal('q4_text') }
        }));
        formData.append('builderJson', JSON.stringify({
            answerKey: getVal('answer_key_json'),
            parts: { 1: getVal('q1_text'), 2: getVal('q2_text'), 3: getVal('q3_text'), 4: getVal('q4_text') }
        }));

        // Get CSRF token from meta tag or cookie
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || getCookie('_csrf');
        console.log('CSRF Token found:', csrfToken ? 'Yes' : 'No');
        if (!csrfToken) {
            updateStatus('CSRF token not found. Please refresh the page.', true);
            return;
        }

        updateStatus(isEditMode ? 'Updating test...' : 'Uploading to server and processing...');

        try {
            const endpoint = isEditMode ? '/update-test/' + testId : '/create-test/listening';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'csrf-token': csrfToken
                },
                body: formData
            });

            let data;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                throw new Error(text || 'Server returned non-JSON response');
            }

            if (!response.ok || !data.success) {
                throw new Error(data.error || data.message || 'Unable to save listening test');
            }

            updateStatus(isEditMode ? '✅ Test updated successfully!' : '✅ Test saved successfully!');
            progressEl.classList.remove('show');
            setTimeout(() => { window.location.href = '/admin'; }, 1200);
        } catch (error) {
            updateStatus('Save failed: ' + error.message, true);
            progressEl.classList.remove('show');
        }
    }

    document.getElementById('platformSaveButton').addEventListener('click', saveToPlatform);

    if (isEditMode && document.getElementById('platformCancelButton')) {
        document.getElementById('platformCancelButton').addEventListener('click', () => {
            window.location.href = '/admin';
        });
    }
})();
</script>`;
}

function buildWritingInjection(testData = null) {
    const isEditMode = testData && testData._id;
    const testId = isEditMode ? testData._id : null;
    const preloadedData = isEditMode ? JSON.stringify(testData) : 'null';
    const builderJson = isEditMode && testData.builderJson ? JSON.stringify(testData.builderJson) : 'null';

    return `
${commonInjectionStyles()}
<script>
(function () {
    const isEditMode = ${isEditMode ? 'true' : 'false'};
    const testId = '${testId}';
    const preloadedData = ${preloadedData};

    const actionArea = document.querySelector('.action-area');
    if (!actionArea) return;

    const controls = document.createElement('div');
    controls.className = 'platform-save-box';
    controls.innerHTML = \`
        <div class="platform-save-title">${isEditMode ? '✏️ Update This Writing Test' : 'Save This Builder Test to the Platform'}</div>
        <div class="platform-save-row">
            <div class="platform-save-field">
                <label for="platformTestTitle">${isEditMode ? 'Writing Test Title (Update)' : 'Platform Test Title'}</label>
                <input type="text" id="platformTestTitle" placeholder="e.g. IELTS Writing Practice 1" value="${isEditMode ? (preloadedData ? JSON.parse(preloadedData).title || '' : '') : ''}">
            </div>
            <div class="platform-save-actions">
                <button type="button" id="platformSaveButton" class="platform-save-button">${isEditMode ? 'Update Test' : 'Save to Platform'}</button>
                ${isEditMode ? '<button type="button" id="platformCancelButton" class="platform-save-button" style="background: #9ca3af;">Cancel</button>' : ''}
            </div>
        </div>
        <div id="platformSaveStatus" class="platform-save-status"></div>
    \`;

    actionArea.insertBefore(controls, actionArea.firstChild);

    if (isEditMode) {
        const savedJson = JSON.parse(${builderJson});
        if (savedJson && savedJson.parts) {
            function applyWritingData() {
                const el = document.getElementById('t1_prompt');
                if (!el) { setTimeout(applyWritingData, 100); return; }
                try {
                    ['time_limit','t1_prompt','t1_img','t1_model','t2_prompt','t2_model'].forEach(function(id) {
                        if (savedJson.parts[id] && document.getElementById(id)) document.getElementById(id).value = savedJson.parts[id];
                    });
                } catch (e) { console.error('Error loading builder JSON:', e); }
            }
            setTimeout(applyWritingData, 200);
        }
    }

    const getVal = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');

    async function saveToPlatform() {
        const status = document.getElementById('platformSaveStatus');
        const title = getVal('platformTestTitle').trim() || 'Writing Test';

        const content = {
            timeLimit: Number.parseInt(getVal('time_limit'), 10) || 60,
            task1: {
                prompt: getVal('t1_prompt'),
                image: getVal('t1_img'),
                modelAnswer: getVal('t1_model')
            },
            task2: {
                prompt: getVal('t2_prompt'),
                modelAnswer: getVal('t2_model')
            }
        };

        const builderJson = JSON.stringify({
            parts: {
                time_limit: getVal('time_limit'),
                t1_prompt: getVal('t1_prompt'), t1_img: getVal('t1_img'), t1_model: getVal('t1_model'),
                t2_prompt: getVal('t2_prompt'), t2_model: getVal('t2_model')
            }
        });

        status.textContent = isEditMode ? 'Updating...' : 'Saving...';

        try {
            const endpoint = isEditMode ? '/update-test/' + testId : '/create-test/writing';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content, type: 'writing', builderJson })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || data.message || 'Unable to save writing test');
            }

            status.textContent = isEditMode ? 'Updated successfully. Redirecting...' : 'Saved successfully. Redirecting...';
            setTimeout(() => { window.location.href = '/admin'; }, 900);
        } catch (error) {
            status.textContent = 'Save failed.';
            alert('Error saving writing test: ' + error.message);
        }
    }

    document.getElementById('platformSaveButton').addEventListener('click', saveToPlatform);

    if (isEditMode && document.getElementById('platformCancelButton')) {
        document.getElementById('platformCancelButton').addEventListener('click', () => {
            window.location.href = '/admin';
        });
    }
})();
</script>`;
}

function getAuthoringPageHtml(type, testData = null) {
    const normalizedType = String(type || '').toLowerCase();
    const source = readBuilderSource(normalizedType);

    let injection = '';
    if (normalizedType === 'reading') {
        injection = buildReadingInjection(testData);
    } else if (normalizedType === 'listening') {
        injection = buildListeningInjection(testData);
    } else if (normalizedType === 'writing') {
        injection = buildWritingInjection(testData);
    } else {
        throw new Error(`Unsupported builder type: ${type}`);
    }

    return replaceLastLiteral(source, '</body>', `${injection}\n</body>`);
}

module.exports = {
    getAuthoringPageHtml
};
