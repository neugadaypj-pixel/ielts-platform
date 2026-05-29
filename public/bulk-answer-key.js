/**
 * Bulk answer key editor for Reading & Listening builders.
 * Merges numbered answers into #answer_key_json (| = multiple accepted answers).
 */
(function () {
    'use strict';

    const PANEL_ID = 'bulk-answer-key-panel';

    function applyAnswerToKey(num, ans) {
        if (num === '' || num === null || num === undefined) return;
        const qNum = Number.parseInt(String(num), 10);
        if (!Number.isFinite(qNum) || qNum < 1) return;

        const textarea = document.getElementById('answer_key_json');
        if (!textarea) return;

        const trimmed = typeof ans === 'string' ? ans.trim() : ans;
        if (trimmed === '' || trimmed === null || trimmed === undefined) return;

        try {
            const current = JSON.parse(textarea.value || '{}');
            let valueToSet = trimmed;
            if (typeof trimmed === 'string') {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) valueToSet = parsed;
                } catch (e) {
                    if (trimmed.includes('|')) {
                        valueToSet = trimmed.split('|').map((s) => s.trim()).filter(Boolean);
                    }
                }
            }
            current[qNum] = valueToSet;
            textarea.value = JSON.stringify(current, null, 2);
        } catch (e) {
            textarea.value = JSON.stringify({ [qNum]: trimmed }, null, 2);
        }
    }

    function formatKeyValue(value) {
        if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join('|');
        if (typeof value === 'string' && value.includes('|')) return value;
        return value === null || value === undefined ? '' : String(value);
    }

    function getRowsContainer() {
        return document.getElementById('bulk_answer_key_rows');
    }

    function addRow(qNum, answer) {
        const container = getRowsContainer();
        if (!container) return;

        const row = document.createElement('div');
        row.className = 'bulk-ak-row';
        row.innerHTML =
            '<label class="bulk-ak-label">Q</label>' +
            '<input type="number" class="bulk-ak-num" min="1" step="1" placeholder="#" value="' +
            (qNum !== undefined && qNum !== '' ? String(qNum) : '') +
            '">' +
            '<input type="text" class="bulk-ak-val" placeholder="Answer (use | for alternates)" value="' +
            escapeAttr(answer || '') +
            '">' +
            '<button type="button" class="bulk-ak-remove" title="Remove row">&times;</button>';

        row.querySelector('.bulk-ak-remove').addEventListener('click', function () {
            row.remove();
        });

        container.appendChild(row);
    }

    function escapeAttr(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    function clearRows() {
        const container = getRowsContainer();
        if (container) container.innerHTML = '';
    }

    function loadRowsFromJson() {
        const textarea = document.getElementById('answer_key_json');
        if (!textarea) return;

        let parsed;
        try {
            parsed = JSON.parse(textarea.value || '{}');
        } catch (e) {
            alert('Answer Key JSON is invalid. Fix it before loading into the bulk list.');
            return;
        }

        clearRows();
        const keys = Object.keys(parsed).sort((a, b) => Number(a) - Number(b));
        if (keys.length === 0) {
            addRow('', '');
            return;
        }
        keys.forEach(function (key) {
            addRow(key, formatKeyValue(parsed[key]));
        });
    }

    function addEmptyRows(count, startAt) {
        const start = startAt || 1;
        for (let i = 0; i < count; i++) {
            addRow(start + i, '');
        }
    }

    function collectRows() {
        const rows = [];
        document.querySelectorAll('#bulk_answer_key_rows .bulk-ak-row').forEach(function (row) {
            const num = row.querySelector('.bulk-ak-num')?.value;
            const val = row.querySelector('.bulk-ak-val')?.value;
            if (num !== '' && num !== null && num !== undefined) {
                rows.push({ num: num, val: val || '' });
            }
        });
        return rows;
    }

    function applyRowsToJson() {
        const rows = collectRows();
        if (rows.length === 0) {
            alert('Add at least one question row with a number.');
            return;
        }

        let applied = 0;
        rows.forEach(function (row) {
            if (row.val.trim() !== '') {
                applyAnswerToKey(row.num, row.val);
                applied++;
            }
        });

        const status = document.getElementById('bulk_answer_key_status');
        if (status) {
            status.textContent =
                applied > 0
                    ? 'Applied ' + applied + ' answer(s) to Answer Key JSON below.'
                    : 'No answers to apply (fill in the answer fields).';
        }
    }

    function parsePasteLines(text) {
        const lines = text.split(/\r?\n/);
        const entries = [];

        lines.forEach(function (line) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;

            let match = trimmed.match(/^(\d+)\s*[:=.\-]\s*(.+)$/);
            if (match) {
                entries.push({ num: match[1], val: match[2].trim() });
                return;
            }

            match = trimmed.match(/^(\d+)\s+(.+)$/);
            if (match) {
                entries.push({ num: match[1], val: match[2].trim() });
            }
        });

        return entries;
    }

    function parsePasteIntoRows() {
        const paste = document.getElementById('bulk_answer_key_paste');
        if (!paste || !paste.value.trim()) {
            alert('Paste lines like:\n1 TRUE\n2 FALSE\n14 color|colour');
            return;
        }

        const entries = parsePasteLines(paste.value);
        if (entries.length === 0) {
            alert('Could not parse any lines. Use: question number, then answer (e.g. "1 TRUE" or "2: FALSE").');
            return;
        }

        clearRows();
        entries.forEach(function (entry) {
            addRow(entry.num, entry.val);
        });

        const status = document.getElementById('bulk_answer_key_status');
        if (status) status.textContent = 'Parsed ' + entries.length + ' line(s). Review, then click Apply to Answer Key.';
    }

    function injectStyles() {
        if (document.getElementById('bulk-answer-key-styles')) return;
        const style = document.createElement('style');
        style.id = 'bulk-answer-key-styles';
        style.textContent =
            '.bulk-answer-key-panel{margin:20px 0 24px;padding:18px 20px;border-radius:16px;background:#f4ecf7;border:1px solid #e8daef;}' +
            '.bulk-answer-key-panel h3{margin:0 0 8px;color:#8e44ad;font-size:1.05rem;}' +
            '.bulk-answer-key-panel .bulk-ak-help{margin:0 0 14px;font-size:13px;color:#5d6d7e;line-height:1.5;}' +
            '.bulk-ak-rows{max-height:320px;overflow-y:auto;margin-bottom:12px;padding-right:4px;}' +
            '.bulk-ak-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}' +
            '.bulk-ak-label{font-weight:700;color:#8e44ad;min-width:18px;}' +
            '.bulk-ak-num{width:72px!important;flex:0 0 72px;margin-top:0!important;}' +
            '.bulk-ak-val{flex:1;margin-top:0!important;}' +
            '.bulk-ak-remove{flex:0 0 36px;height:36px;padding:0;border-radius:10px;background:#e74c3c;color:#fff;font-size:20px;line-height:1;cursor:pointer;border:none;}' +
            '.bulk-ak-remove:hover{filter:brightness(1.05);}' +
            '.bulk-ak-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}' +
            '.bulk-ak-btn{padding:8px 14px;border-radius:10px;border:none;font-weight:600;font-size:13px;cursor:pointer;background:#ecf0f1;color:#2c3e50;}' +
            '.bulk-ak-btn:hover{background:#dfe6e9;}' +
            '.bulk-ak-btn-primary{background:linear-gradient(135deg,#9b59b6,#8e44ad);color:#fff;}' +
            '.bulk-ak-btn-primary:hover{filter:brightness(1.05);}' +
            '.bulk-ak-paste{width:100%;min-height:88px;margin-top:6px;padding:10px;border-radius:12px;border:1px solid #ccc;font-family:Consolas,monospace;font-size:13px;resize:vertical;}' +
            '.bulk-ak-status{margin-top:10px;font-size:13px;color:#27ae60;min-height:18px;}';
        document.head.appendChild(style);
    }

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'bulk-answer-key-panel';
        panel.innerHTML =
            '<h3>Bulk Answer Key</h3>' +
            '<p class="bulk-ak-help">Fill answers at the end. Use <strong>|</strong> for multiple correct answers (e.g. <code>color|colour</code>). ' +
            'Applying merges into the JSON below without removing other questions.</p>' +
            '<div id="bulk_answer_key_rows" class="bulk-ak-rows"></div>' +
            '<div class="bulk-ak-actions">' +
            '<button type="button" class="bulk-ak-btn" data-action="add-row">+ Add row</button>' +
            '<button type="button" class="bulk-ak-btn" data-action="add-1-40">Add rows 1–40</button>' +
            '<button type="button" class="bulk-ak-btn" data-action="load-json">Load from JSON below</button>' +
            '<button type="button" class="bulk-ak-btn bulk-ak-btn-primary" data-action="apply">Apply to Answer Key</button>' +
            '</div>' +
            '<label style="font-weight:600;font-size:13px;">Or paste lines</label>' +
            '<textarea id="bulk_answer_key_paste" class="bulk-ak-paste" placeholder="1 TRUE&#10;2: FALSE&#10;14 color|colour"></textarea>' +
            '<div class="bulk-ak-actions" style="margin-top:8px;">' +
            '<button type="button" class="bulk-ak-btn" data-action="parse-paste">Parse paste into list</button>' +
            '</div>' +
            '<div id="bulk_answer_key_status" class="bulk-ak-status"></div>';

        panel.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            if (action === 'add-row') addRow('', '');
            else if (action === 'add-1-40') {
                clearRows();
                addEmptyRows(40, 1);
            } else if (action === 'load-json') loadRowsFromJson();
            else if (action === 'apply') applyRowsToJson();
            else if (action === 'parse-paste') parsePasteIntoRows();
        });

        return panel;
    }

    function init() {
        const textarea = document.getElementById('answer_key_json');
        if (!textarea || document.getElementById(PANEL_ID)) return;

        injectStyles();
        const panel = buildPanel();
        textarea.parentNode.insertBefore(panel, textarea);

        addRow('', '');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }
})();
