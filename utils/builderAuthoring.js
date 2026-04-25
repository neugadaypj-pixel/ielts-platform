const { readBuilderSource } = require('./builderAssets');

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

function buildReadingInjection() {
    return `
${commonInjectionStyles()}
<script>
(function () {
    const actionArea = document.querySelector('.action-area');
    if (!actionArea) return;

    const controls = document.createElement('div');
    controls.className = 'platform-save-box';
    controls.innerHTML = \`
        <div class="platform-save-title">Save This Builder Test to the Platform</div>
        <div class="platform-save-row">
            <div class="platform-save-field">
                <label for="platformTestTitle">Platform Test Title</label>
                <input type="text" id="platformTestTitle" placeholder="e.g. IELTS Reading Practice 1">
            </div>
            <div class="platform-save-actions">
                <button type="button" id="platformSaveButton" class="platform-save-button">Save to Platform</button>
            </div>
        </div>
        <div id="platformSaveStatus" class="platform-save-status"></div>
    \`;

    actionArea.insertBefore(controls, actionArea.firstChild);

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

        status.textContent = 'Saving...';

        try {
            const response = await fetch('/create-test/reading', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || data.message || 'Unable to save reading test');
            }

            status.textContent = 'Saved successfully. Redirecting...';
            setTimeout(() => { window.location.href = '/admin'; }, 900);
        } catch (error) {
            status.textContent = 'Save failed.';
            alert('Error saving reading test: ' + error.message);
        }
    }

    document.getElementById('platformSaveButton').addEventListener('click', saveToPlatform);
})();
</script>`;
}

function buildListeningInjection() {
    return `
${commonInjectionStyles()}
<script>
(function () {
    const actionArea = document.querySelector('.action-area');
    if (!actionArea) return;

    const controls = document.createElement('div');
    controls.className = 'platform-save-box';
    controls.innerHTML = \`
        <div class="platform-save-title">Save This Builder Test to the Platform</div>
        <div class="platform-save-row">
            <div class="platform-save-field">
                <label for="platformTestTitle">Platform Test Title</label>
                <input type="text" id="platformTestTitle" placeholder="e.g. IELTS Listening Practice 1">
            </div>
            <div class="platform-save-actions">
                <button type="button" id="platformSaveButton" class="platform-save-button">Save to Platform</button>
            </div>
        </div>
        <div id="platformSaveStatus" class="platform-save-status"></div>
    \`;

    actionArea.insertBefore(controls, actionArea.firstChild);

    const getVal = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');

    async function saveToPlatform() {
        const status = document.getElementById('platformSaveStatus');
        const title = getVal('platformTestTitle').trim() || 'Listening Test';

        let answerKey;
        try {
            answerKey = JSON.parse(getVal('answer_key_json'));
        } catch (error) {
            alert('Invalid Answer Key JSON');
            return;
        }

        const fileInputs = document.querySelectorAll('.file-upload-box input[type="file"]');
        const fullAudioInput = fileInputs[0];
        const partAudioInputs = Array.from(fileInputs).slice(1, 5);
        const formData = new FormData();

        formData.append('title', title);
        formData.append('answerKey', JSON.stringify(answerKey));
        formData.append('usePause', document.getElementById('add_pause_cb').checked ? 'true' : 'false');
        formData.append('parts', JSON.stringify({
            1: { finalHtml: getVal('q1_text') },
            2: { finalHtml: getVal('q2_text') },
            3: { finalHtml: getVal('q3_text') },
            4: { finalHtml: getVal('q4_text') }
        }));

        if (fullAudioInput && fullAudioInput.files && fullAudioInput.files[0]) {
            formData.append('audioFile', fullAudioInput.files[0]);
        } else {
            partAudioInputs.forEach((input, index) => {
                if (input && input.files && input.files[0]) {
                    formData.append('part' + (index + 1), input.files[0]);
                }
            });
        }

        status.textContent = 'Saving and uploading audio...';

        try {
            const response = await fetch('/create-test/listening', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || data.message || 'Unable to save listening test');
            }

            status.textContent = 'Saved successfully. Redirecting...';
            setTimeout(() => { window.location.href = '/admin'; }, 900);
        } catch (error) {
            status.textContent = 'Save failed.';
            alert('Error saving listening test: ' + error.message);
        }
    }

    document.getElementById('platformSaveButton').addEventListener('click', saveToPlatform);
})();
</script>`;
}

function buildWritingInjection() {
    return `
${commonInjectionStyles()}
<script>
(function () {
    const actionArea = document.querySelector('.action-area');
    if (!actionArea) return;

    const controls = document.createElement('div');
    controls.className = 'platform-save-box';
    controls.innerHTML = \`
        <div class="platform-save-title">Save This Builder Test to the Platform</div>
        <div class="platform-save-row">
            <div class="platform-save-field">
                <label for="platformTestTitle">Platform Test Title</label>
                <input type="text" id="platformTestTitle" placeholder="e.g. IELTS Writing Practice 1">
            </div>
            <div class="platform-save-actions">
                <button type="button" id="platformSaveButton" class="platform-save-button">Save to Platform</button>
            </div>
        </div>
        <div id="platformSaveStatus" class="platform-save-status"></div>
    \`;

    actionArea.insertBefore(controls, actionArea.firstChild);

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

        status.textContent = 'Saving...';

        try {
            const response = await fetch('/create-test/writing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || data.message || 'Unable to save writing test');
            }

            status.textContent = 'Saved successfully. Redirecting...';
            setTimeout(() => { window.location.href = '/admin'; }, 900);
        } catch (error) {
            status.textContent = 'Save failed.';
            alert('Error saving writing test: ' + error.message);
        }
    }

    document.getElementById('platformSaveButton').addEventListener('click', saveToPlatform);
})();
</script>`;
}

function getAuthoringPageHtml(type) {
    const normalizedType = String(type || '').toLowerCase();
    const source = readBuilderSource(normalizedType);

    let injection = '';
    if (normalizedType === 'reading') {
        injection = buildReadingInjection();
    } else if (normalizedType === 'listening') {
        injection = buildListeningInjection();
    } else if (normalizedType === 'writing') {
        injection = buildWritingInjection();
    } else {
        throw new Error(`Unsupported builder type: ${type}`);
    }

    return source.replace('</body>', `${injection}\n</body>`);
}

module.exports = {
    getAuthoringPageHtml
};
