/**
 * IELTS Testing Platform - Frontend SPA
 * Vanilla JS single-page app with role-based dashboards.
 * Communicates with the FastAPI backend via fetch().
 */

/* ========================================================================
 * SECTION 0: UTILITIES
 * ======================================================================== */

const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
const html = (str) => {
    const t = document.createElement('template');
    t.innerHTML = str.trim();
    return t.content.firstChild;
};

function toast(msg, type = 'info') {
    const c = $('#toast-container');
    const el = html(`<div class="toast toast-${type}">${msg}</div>`);
    c.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 3000);
    setTimeout(() => el.remove(), 3300);
}

function showSpinner(container) {
    container.innerHTML = '<div class="spinner"></div>';
}

function formatDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function openModal(title, bodyHtml, footerHtml) {
    const overlay = $('#modal-overlay');
    const content = $('#modal-content');
    content.innerHTML = `
        <div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="App.closeModal()">&times;</button></div>
        <div>${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    `;
    overlay.classList.add('active');
}

window.closeModal = function () {
    $('#modal-overlay').classList.remove('active');
};

$('#modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
});

/* ========================================================================
 * SECTION 1: API CLIENT
 * ======================================================================== */

const API = {
    _token: null,
    _base: '',

    init() {
        this._token = localStorage.getItem('ielts_token');
        this._base = window.location.origin;
    },

    setToken(t) { this._token = t; localStorage.setItem('ielts_token', t); },
    clearToken() { this._token = null; localStorage.removeItem('ielts_token'); },
    getToken() { return this._token; },

    async _fetch(method, path, body, isRetry = false) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (this._token) opts.headers['Authorization'] = `Bearer ${this._token}`;
        if (body) opts.body = JSON.stringify(body);

        let res;
        try {
            res = await fetch(this._base + path, opts);
        } catch (e) {
            throw new Error('Network error — server may be offline.');
        }

        if (res.status === 401 && !isRetry) {
            // Token expired — clear and redirect to login
            this.clearToken();
            App.logout();
            throw new Error('Session expired. Please sign in again.');
        }

        if (res.status === 204) return null;

        const data = await res.json().catch(() => null);

        if (!res.ok) {
            const detail = (data && data.detail) ? data.detail : `HTTP ${res.status}`;
            const msg = Array.isArray(detail) ? detail.map(e => e.msg || JSON.stringify(e)).join('; ') : String(detail);
            throw new Error(msg);
        }

        return data;
    },

    get(path) { return this._fetch('GET', path); },
    post(path, body) { return this._fetch('POST', path, body); },
    put(path, body) { return this._fetch('PUT', path, body); },
    del(path) { return this._fetch('DELETE', path); },
};

/* ========================================================================
 * SECTION 2: APPLICATION STATE & ROUTER
 * ======================================================================== */

const App = {
    user: null,
    currentView: null,

    /* ---- Init ---- */
    async init() {
        API.init();
        this._bindEvents();

        if (API.getToken()) {
            // Try to restore session
            try {
                this.user = await API.get('/auth/me');
                this._showShell();
                this._buildSidebar();
                this._route();
                return;
            } catch (e) {
                API.clearToken();
            }
        }

        this._showLogin();
    },

    /* ---- Auth ---- */
    async login(username, password) {
        const data = await API.post('/auth/login', { username, password });
        API.setToken(data.access_token);
        this.user = { username: data.username, role: data.role };
        this._showShell();
        this._buildSidebar();
        this._route();
    },

    logout() {
        API.clearToken();
        this.user = null;
        this._showLogin();
    },

    /* ---- View Switching ---- */
    _showLogin() {
        $('#login-view').style.display = 'flex';
        $('#app-shell').classList.remove('active');
        $('#login-username').focus();
    },

    _showShell() {
        $('#login-view').style.display = 'none';
        $('#app-shell').classList.add('active');
        $('#sidebar-username').textContent = this.user.username;
        $('#sidebar-role').textContent = this.user.role;
        if (this.user.center_id) {
            const roleEl = $('#sidebar-role');
            roleEl.textContent += ' • ' + this.user.center_id.slice(-6);
        }
    },

    _buildSidebar() {
        const nav = $('#sidebar-nav');
        nav.innerHTML = '';
        const links = [];

        switch (this.user.role) {
            case 'superadmin':
                links.push(['#dashboard', '📊', 'Dashboard']);
                links.push(['#centers', '🏢', 'Centers']);
                links.push(['#tests', '📝', 'Tests']);
                links.push(['#analytics', '📈', 'Analytics']);
                break;
            case 'admin':
                links.push(['#dashboard', '📊', 'Dashboard']);
                links.push(['#teachers', '👩‍🏫', 'Teachers']);
                links.push(['#groups', '👥', 'Groups']);
                links.push(['#tests', '📝', 'Tests']);
                links.push(['#analytics', '📈', 'Analytics']);
                break;
            case 'teacher':
                links.push(['#dashboard', '📊', 'Dashboard']);
                links.push(['#students', '🎓', 'Students']);
                links.push(['#tests', '📝', 'Tests']);
                links.push(['#analytics', '📈', 'Analytics']);
                break;
            case 'student':
                links.push(['#dashboard', '📊', 'Dashboard']);
                links.push(['#tests', '📋', 'My Tests']);
                links.push(['#results', '📊', 'My Results']);
                break;
        }

        links.forEach(([href, icon, label]) => {
            const a = html(`<a href="${href}">${icon} ${label}</a>`);
            nav.appendChild(a);
        });
    },

    _route() {
        const hash = window.location.hash || '#dashboard';
        $$('.sidebar-nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash));
        $$('.view-section').forEach(s => s.classList.remove('active'));

        $('#page-title').textContent = $$('.sidebar-nav a.active')[0]?.textContent?.trim() || 'Dashboard';

        switch (hash) {
            case '#dashboard':
                if (this.user.role === 'superadmin') Views.renderSuperadminDashboard();
                else if (this.user.role === 'admin') Views.renderAdminDashboard();
                else if (this.user.role === 'teacher') Views.renderTeacherDashboard();
                else Views.renderStudentDashboard();
                break;
            case '#centers': Views.renderCenters(); break;
            case '#teachers': Views.renderTeachers(); break;
            case '#groups': Views.renderGroups(); break;
            case '#students': Views.renderStudents(); break;
            case '#tests':
                if (this.user.role === 'student') Views.renderStudentTests();
                else Views.renderTests();
                break;
            case '#analytics': Views.renderAnalytics(); break;
            case '#results': Views.renderStudentResults(); break;
            default: window.location.hash = '#dashboard';
        }
    },

    showView(sectionId) {
        $$('.view-section').forEach(s => s.classList.remove('active'));
        const el = $('#view-' + sectionId);
        if (el) el.classList.add('active');
    },

    /* ---- Events ---- */
    _bindEvents() {
        window.addEventListener('hashchange', () => this._route());

        $('#login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = $('#login-username').value.trim();
            const password = $('#login-password').value.trim();
            if (!username || !password) return;

            const btn = $('#login-btn');
            const txt = $('#login-btn-text');
            const spin = $('#login-btn-spinner');
            const err = $('#login-error');
            btn.disabled = true; txt.style.display = 'none'; spin.style.display = 'block'; err.style.display = 'none';

            try {
                await this.login(username, password);
            } catch (ex) {
                err.textContent = ex.message;
                err.style.display = 'block';
                btn.disabled = false; txt.style.display = ''; spin.style.display = 'none';
            }
        });

        $('#logout-btn').addEventListener('click', () => this.logout());

        $('#mobile-menu-btn').addEventListener('click', () => {
            $('#sidebar').classList.toggle('open');
        });

        // Close sidebar on nav click (mobile)
        $('#sidebar-nav').addEventListener('click', () => {
            $('#sidebar').classList.remove('open');
        });
    },
};

/* ========================================================================
 * SECTION 3: VIEW RENDERERS
 * ======================================================================== */

const Views = {

    /* ============ SUPERADMIN ============ */

    async renderSuperadminDashboard() {
        App.showView('superadmin-dashboard');
        const el = $('#view-superadmin-dashboard');
        showSpinner(el);
        try {
            const stats = await API.get('/analytics/stats/center');
            const centers = await API.get('/superadmin/centers');
            el.innerHTML = `
                <div class="stats-grid">
                    ${statCard('🏢', centers.length, 'Total Centers')}
                    ${statCard('🎓', stats.total_students, 'Total Students')}
                    ${statCard('👩‍🏫', stats.total_teachers, 'Total Teachers')}
                    ${statCard('📝', stats.total_tests, 'Tests Created')}
                    ${statCard('📤', stats.total_submissions, 'Submissions')}
                    ${statCard('📊', stats.average_percentage + '%', 'Avg Score')}
                </div>
                <div class="card">
                    <div class="card-header">Centers Overview</div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Name</th><th>Admin</th><th>Created</th></tr></thead>
                            <tbody>
                                ${centers.map(c => `<tr>
                                    <td><strong>${esc(c.name)}</strong></td>
                                    <td>${esc(c.admin_id)}</td>
                                    <td>${formatDate(c.created_at)}</td>
                                </tr>`).join('')}
                                ${centers.length === 0 ? '<tr><td colspan="3" class="empty-state">No centers yet — create one below.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    async renderCenters() {
        App.showView('superadmin-centers');
        const el = $('#view-superadmin-centers');
        showSpinner(el);
        try {
            const centers = await API.get('/superadmin/centers');
            el.innerHTML = `
                <div style="margin-bottom:1rem">
                    <button class="btn btn-primary" onclick="Views.showCreateCenterModal()">+ Create Center</button>
                </div>
                <div class="card">
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Center Name</th><th>Admin ID</th><th>Created</th></tr></thead>
                            <tbody id="centers-tbody">
                                ${centers.map(c => `<tr>
                                    <td><strong>${esc(c.name)}</strong></td>
                                    <td><code>${esc(c.admin_id)}</code></td>
                                    <td>${formatDate(c.created_at)}</td>
                                </tr>`).join('')}
                                ${centers.length === 0 ? '<tr><td colspan="3" class="empty-state">No centers yet.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    showCreateCenterModal() {
        openModal(
            'Create New Center',
            `
                <div class="form-group"><label>Center Name</label><input id="mc-name" class="form-control" placeholder="e.g. Tashkent Academy" required /></div>
                <div class="form-group"><label>Admin Username</label><input id="mc-admin-username" class="form-control" placeholder="admin username" required /></div>
                <div class="form-group"><label>Admin Password</label><input id="mc-admin-password" type="password" class="form-control" placeholder="min 6 characters" required /></div>
                <div class="form-group"><label>Admin Full Name</label><input id="mc-admin-fullname" class="form-control" placeholder="John Doe" required /></div>
                <div class="form-group"><label>Admin Contact (optional)</label><input id="mc-admin-contact" class="form-control" placeholder="Phone or email" /></div>
            `,
            `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
             <button class="btn btn-primary" onclick="Views.createCenter()">Create Center</button>`
        );
    },

    async createCenter() {
        const body = {
            name: $('#mc-name').value.trim(),
            admin_username: $('#mc-admin-username').value.trim(),
            admin_password: $('#mc-admin-password').value,
            admin_full_name: $('#mc-admin-fullname').value.trim(),
            admin_contact: $('#mc-admin-contact').value.trim() || undefined,
        };
        if (!body.name || !body.admin_username || !body.admin_password || !body.admin_full_name) {
            return toast('Please fill all required fields.', 'error');
        }
        try {
            await API.post('/superadmin/centers', body);
            closeModal();
            toast('Center created successfully!', 'success');
            Views.renderCenters();
        } catch (e) {
            toast(e.message, 'error');
        }
    },

    /* ============ ADMIN ============ */

    async renderAdminDashboard() {
        App.showView('admin-dashboard');
        const el = $('#view-admin-dashboard');
        showSpinner(el);
        try {
            const [stats, teachers, groups] = await Promise.all([
                API.get('/analytics/stats/center'),
                API.get('/admin/teachers'),
                API.get('/admin/groups'),
            ]);
            el.innerHTML = `
                <div class="stats-grid">
                    ${statCard('👩‍🏫', stats.total_teachers, 'Teachers')}
                    ${statCard('🎓', stats.total_students, 'Students')}
                    ${statCard('👥', groups.length, 'Groups')}
                    ${statCard('📝', stats.total_tests, 'Tests')}
                    ${statCard('📤', stats.total_submissions, 'Submissions')}
                    ${statCard('📊', stats.average_percentage + '%', 'Avg Score')}
                </div>
                <div class="card">
                    <div class="card-header">Quick Summary</div>
                    <p style="font-size:0.9rem;color:var(--text-secondary)">You have <strong>${teachers.length}</strong> teachers and <strong>${groups.length}</strong> groups in your center.</p>
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    async renderTeachers() {
        App.showView('admin-teachers');
        const el = $('#view-admin-teachers');
        showSpinner(el);
        try {
            const teachers = await API.get('/admin/teachers');
            el.innerHTML = `
                <div style="margin-bottom:1rem">
                    <button class="btn btn-primary" onclick="Views.showCreateTeacherModal()">+ Create Teacher</button>
                </div>
                <div class="card">
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Username</th><th>Full Name</th><th>Contact</th><th>Created</th></tr></thead>
                            <tbody>
                                ${teachers.map(t => `<tr>
                                    <td><strong>${esc(t.username)}</strong></td>
                                    <td>${esc(t.full_name)}</td>
                                    <td>${esc(t.contact || '-')}</td>
                                    <td>${formatDate(t.created_at)}</td>
                                </tr>`).join('')}
                                ${teachers.length === 0 ? '<tr><td colspan="4" class="empty-state">No teachers yet.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    showCreateTeacherModal() {
        openModal(
            'Create Teacher',
            `
                <div class="form-group"><label>Username</label><input id="mt-username" class="form-control" placeholder="teacher username" required /></div>
                <div class="form-group"><label>Password</label><input id="mt-password" type="password" class="form-control" placeholder="min 6 characters" required /></div>
                <div class="form-group"><label>Full Name</label><input id="mt-fullname" class="form-control" placeholder="Jane Smith" required /></div>
                <div class="form-group"><label>Contact (optional)</label><input id="mt-contact" class="form-control" placeholder="Phone or email" /></div>
            `,
            `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
             <button class="btn btn-primary" onclick="Views.createTeacher()">Create Teacher</button>`
        );
    },

    async createTeacher() {
        const body = {
            username: $('#mt-username').value.trim(),
            password: $('#mt-password').value,
            full_name: $('#mt-fullname').value.trim(),
            contact: $('#mt-contact').value.trim() || undefined,
        };
        if (!body.username || !body.password || !body.full_name) {
            return toast('Please fill all required fields.', 'error');
        }
        try {
            await API.post('/admin/teachers', body);
            closeModal();
            toast('Teacher created!', 'success');
            Views.renderTeachers();
        } catch (e) {
            toast(e.message, 'error');
        }
    },

    async renderGroups() {
        App.showView('admin-groups');
        const el = $('#view-admin-groups');
        showSpinner(el);
        try {
            const groups = await API.get('/admin/groups');
            el.innerHTML = `
                <div style="margin-bottom:1rem">
                    <button class="btn btn-primary" onclick="Views.showCreateGroupModal()">+ Create Group</button>
                </div>
                <div class="card">
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Group Name</th><th>Teacher ID</th><th>Created</th></tr></thead>
                            <tbody>
                                ${groups.map(g => `<tr>
                                    <td><strong>${esc(g.name)}</strong></td>
                                    <td>${esc(g.teacher_id || 'Not assigned')}</td>
                                    <td>${formatDate(g.created_at)}</td>
                                </tr>`).join('')}
                                ${groups.length === 0 ? '<tr><td colspan="3" class="empty-state">No groups yet.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    showCreateGroupModal() {
        openModal(
            'Create Group',
            `<div class="form-group"><label>Group Name</label><input id="mg-name" class="form-control" placeholder="e.g. IELTS Prep A" required /></div>`,
            `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
             <button class="btn btn-primary" onclick="Views.createGroup()">Create Group</button>`
        );
    },

    async createGroup() {
        const name = $('#mg-name').value.trim();
        if (!name) return toast('Group name is required.', 'error');
        try {
            await API.post('/admin/groups', { name });
            closeModal();
            toast('Group created!', 'success');
            Views.renderGroups();
        } catch (e) {
            toast(e.message, 'error');
        }
    },

    /* ============ TEACHER ============ */

    async renderTeacherDashboard() {
        App.showView('teacher-dashboard');
        const el = $('#view-teacher-dashboard');
        showSpinner(el);
        try {
            const [stats, students] = await Promise.all([
                API.get('/analytics/stats/center'),
                API.get('/teacher/students'),
            ]);
            el.innerHTML = `
                <div class="stats-grid">
                    ${statCard('🎓', students.length, 'My Students')}
                    ${statCard('📝', stats.total_tests, 'Tests')}
                    ${statCard('📤', stats.total_submissions, 'Submissions')}
                    ${statCard('📊', stats.average_percentage + '%', 'Avg Score')}
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    async renderStudents() {
        App.showView('teacher-students');
        const el = $('#view-teacher-students');
        showSpinner(el);
        try {
            const students = await API.get('/teacher/students');
            el.innerHTML = `
                <div style="margin-bottom:1rem">
                    <button class="btn btn-primary" onclick="Views.showCreateStudentModal()">+ Add Student</button>
                </div>
                <div class="card">
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Username</th><th>Full Name</th><th>Contact</th><th>Group</th><th>Created</th></tr></thead>
                            <tbody>
                                ${students.map(s => `<tr>
                                    <td><strong>${esc(s.username)}</strong></td>
                                    <td>${esc(s.full_name)}</td>
                                    <td>${esc(s.contact || '-')}</td>
                                    <td><code>${esc((s.group_id || '').slice(-8))}</code></td>
                                    <td>${formatDate(s.created_at)}</td>
                                </tr>`).join('')}
                                ${students.length === 0 ? '<tr><td colspan="5" class="empty-state">No students yet.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    showCreateStudentModal() {
        openModal(
            'Add Student',
            `
                <div class="form-group"><label>Username</label><input id="ms-username" class="form-control" placeholder="student username" required /></div>
                <div class="form-group"><label>Password</label><input id="ms-password" type="password" class="form-control" placeholder="min 6 characters" required /></div>
                <div class="form-group"><label>Full Name</label><input id="ms-fullname" class="form-control" placeholder="Student name" required /></div>
                <div class="form-group"><label>Contact (optional)</label><input id="ms-contact" class="form-control" placeholder="Phone or email" /></div>
                <div class="form-group"><label>Group ID</label><input id="ms-group-id" class="form-control" placeholder="Group ObjectId" required /></div>
            `,
            `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
             <button class="btn btn-primary" onclick="Views.createStudent()">Add Student</button>`
        );
    },

    async createStudent() {
        const body = {
            username: $('#ms-username').value.trim(),
            password: $('#ms-password').value,
            full_name: $('#ms-fullname').value.trim(),
            contact: $('#ms-contact').value.trim() || undefined,
            group_id: $('#ms-group-id').value.trim(),
        };
        if (!body.username || !body.password || !body.full_name || !body.group_id) {
            return toast('Please fill all required fields.', 'error');
        }
        try {
            await API.post('/teacher/students', body);
            closeModal();
            toast('Student added!', 'success');
            Views.renderStudents();
        } catch (e) {
            toast(e.message, 'error');
        }
    },

    /* ============ TESTS (Admin/Teacher) ============ */

    async renderTests() {
        App.showView('tests');
        const el = $('#view-tests');
        showSpinner(el);
        try {
            const tests = await API.get('/staff/tests');
            let groups = [];
            try { groups = await API.get('/admin/groups'); } catch (_) { groups = []; }
            window._cachedGroups = groups;

            el.innerHTML = `
                <div style="margin-bottom:1rem;display:flex;gap:0.75rem;flex-wrap:wrap">
                    <button class="btn btn-primary" onclick="Views.showCreateTestModal()">+ Create Test</button>
                    ${groups.length > 0 ? `<button class="btn btn-secondary" onclick="Views.showAssignTestModal()">📋 Assign to Group</button>` : ''}
                </div>
                <div class="card">
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Title</th><th>Questions</th><th>Total Points</th><th>Time Limit</th><th>Created</th></tr></thead>
                            <tbody id="tests-tbody">
                                ${tests.map(t => {
                                    const q = t.content_json && t.content_json.questions ? t.content_json.questions.length : 0;
                                    const pts = t.content_json && t.content_json.total_points ? t.content_json.total_points : 0;
                                    const mins = t.content_json && t.content_json.time_limit_minutes ? t.content_json.time_limit_minutes : 60;
                                    return `<tr>
                                        <td><strong>${esc(t.title)}</strong></td>
                                        <td>${q} questions</td>
                                        <td>${pts} pts</td>
                                        <td>${mins} min</td>
                                        <td>${formatDate(t.created_at)}</td>
                                    </tr>`;
                                }).join('')}
                                ${tests.length === 0 ? '<tr><td colspan="5" class="empty-state">No tests yet — create one!</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    showCreateTestModal() {
        openModal(
            'Create New Test',
            `
                <div class="form-group"><label>Test Title</label><input id="mct-title" class="form-control" placeholder="e.g. IELTS Mock Test 1" required /></div>
                <div class="form-group"><label>Time Limit (minutes)</label><input id="mct-time" type="number" class="form-control" value="60" min="1" /></div>
                <div class="form-group"><label>Instructions (optional)</label><textarea id="mct-instructions" class="form-control" placeholder="General instructions for students..."></textarea></div>
                <hr style="margin:1rem 0;border-color:var(--border)" />
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
                    <strong style="font-size:0.9rem">Questions</strong>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="Views.addQuestionRow()">+ Add Question</button>
                </div>
                <div id="mct-questions"></div>
            `,
            `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
             <button class="btn btn-primary" onclick="Views.createTest()">Create Test</button>`
        );
        // Start with 1 question
        Views.addQuestionRow();
    },

    _questionCounter: 0,

    addQuestionRow() {
        this._questionCounter++;
        const idx = this._questionCounter;
        const container = $('#mct-questions');
        if (!container) return;
        const row = html(`
            <div class="question-builder" id="qb-${idx}">
                <div class="qb-header">
                    <span>Question #${idx}</span>
                    <button type="button" class="btn btn-sm btn-danger" onclick="document.getElementById('qb-${idx}').remove()">Remove</button>
                </div>
                <div class="form-group">
                    <label>Type</label>
                    <select class="form-control qb-type" data-idx="${idx}">
                        <option value="multiple_choice">Multiple Choice</option>
                        <option value="true_false">True / False</option>
                        <option value="short_answer">Short Answer</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Question Text</label>
                    <input class="form-control qb-text" placeholder="What is the question?" />
                </div>
                <div class="qb-options-list" id="qb-options-${idx}">
                    <label style="font-size:0.8rem;color:var(--text-secondary)">Options</label>
                    <div class="qb-option-row"><input class="form-control qb-opt" placeholder="Option A" /><span style="font-size:0.75rem;color:var(--text-light)">← correct</span></div>
                    <div class="qb-option-row"><input class="form-control qb-opt" placeholder="Option B" /></div>
                    <div class="qb-option-row"><input class="form-control qb-opt" placeholder="Option C" /></div>
                    <div class="qb-option-row"><input class="form-control qb-opt" placeholder="Option D" /></div>
                </div>
                <div class="form-group">
                    <label>Correct Answer</label>
                    <input class="form-control qb-correct" placeholder="For MC: 'A'; For T/F: 'true'/'false'; For short: exact answer text" />
                </div>
                <div class="form-group">
                    <label>Points</label>
                    <input type="number" class="form-control qb-points" value="1" min="0.5" step="0.5" style="width:100px" />
                </div>
            </div>
        `);
        container.appendChild(row);

        // Show/hide options based on type
        const typeSel = row.querySelector('.qb-type');
        const optionsDiv = row.querySelector('.qb-options-list');
        typeSel.addEventListener('change', function () {
            optionsDiv.style.display = (this.value === 'multiple_choice') ? 'block' : 'none';
        });
    },

    async createTest() {
        const title = $('#mct-title').value.trim();
        const timeLimit = parseInt($('#mct-time').value) || 60;
        const instructions = $('#mct-instructions').value.trim() || null;

        if (!title) return toast('Test title is required.', 'error');

        const questions = [];
        const builders = $$('.question-builder', $('#modal-content'));
        builders.forEach(b => {
            const type = $('.qb-type', b).value;
            const text = $('.qb-text', b).value.trim();
            const correct = $('.qb-correct', b).value.trim();
            const points = parseFloat($('.qb-points', b).value) || 1;

            if (!text || !correct) return;

            const opts = [];
            if (type === 'multiple_choice') {
                $$('.qb-opt', b).forEach(o => { if (o.value.trim()) opts.push(o.value.trim()); });
            }
            if (type === 'true_false') {
                opts.push('True', 'False');
            }

            questions.push({
                id: 'q' + (questions.length + 1),
                type,
                text,
                options: opts.length > 0 ? opts : null,
                correct_answer: correct,
                points,
            });
        });

        if (questions.length === 0) return toast('Add at least one complete question.', 'error');

        const totalPoints = questions.reduce((s, q) => s + q.points, 0);

        const body = {
            title,
            content_json: {
                sections: [],
                questions,
                total_points: totalPoints,
                time_limit_minutes: timeLimit,
                instructions,
            },
        };

        try {
            await API.post('/staff/tests', body);
            closeModal();
            toast('Test created!', 'success');
            Views.renderTests();
        } catch (e) {
            toast(e.message, 'error');
        }
    },

    showAssignTestModal() {
        const groups = window._cachedGroups || [];

        openModal(
            'Assign Test to Group',
            `
                <div class="form-group"><label>Test ID</label><input id="mat-test-id" class="form-control" placeholder="Paste test ObjectId" required /></div>
                <div class="form-group">
                    <label>Group</label>
                    <select id="mat-group-id" class="form-control" required>
                        <option value="">-- Select Group --</option>
                        ${groups.map(g => `<option value="${esc(g.id || g._id)}">${esc(g.name)}</option>`).join('')}
                    </select>
                </div>
            `,
            `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
             <button class="btn btn-primary" onclick="Views.assignTest()">Assign</button>`
        );
    },

    async assignTest() {
        const testId = $('#mat-test-id').value.trim();
        const groupId = $('#mat-group-id').value;
        if (!testId || !groupId) return toast('Both fields are required.', 'error');
        try {
            await API.post('/staff/tests/assign', { test_id: testId, group_id: groupId });
            closeModal();
            toast('Test assigned to group!', 'success');
        } catch (e) {
            toast(e.message, 'error');
        }
    },

    /* ============ ANALYTICS ============ */

    async renderAnalytics() {
        App.showView('analytics');
        const el = $('#view-analytics');
        showSpinner(el);
        try {
            const [stats, results] = await Promise.all([
                API.get('/analytics/stats/center'),
                API.get('/analytics/results'),
            ]);
            el.innerHTML = `
                <div class="stats-grid">
                    ${statCard('🎓', stats.total_students, 'Students')}
                    ${statCard('📝', stats.total_tests, 'Tests')}
                    ${statCard('📤', stats.total_submissions, 'Submissions')}
                    ${statCard('📊', stats.average_percentage + '%', 'Avg Score')}
                </div>
                <div class="card">
                    <div class="card-header">Recent Results</div>
                    <div class="table-wrap">
                        <table>
                            <thead><tr><th>Test ID</th><th>Student ID</th><th>Score</th><th>Percentage</th><th>Completed</th></tr></thead>
                            <tbody>
                                ${results.map(r => `<tr>
                                    <td><code>${esc((r.test_id || '').slice(-8))}</code></td>
                                    <td><code>${esc((r.student_id || '').slice(-8))}</code></td>
                                    <td>${r.score} / ${r.total_points}</td>
                                    <td>${r.total_points > 0 ? Math.round((r.score / r.total_points) * 100) : 0}%</td>
                                    <td>${formatDate(r.completed_at)}</td>
                                </tr>`).join('')}
                                ${results.length === 0 ? '<tr><td colspan="5" class="empty-state">No results yet.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    /* ============ STUDENT ============ */

    async renderStudentDashboard() {
        App.showView('student-dashboard');
        const el = $('#view-student-dashboard');
        showSpinner(el);
        try {
            const [results, assigned] = await Promise.all([
                API.get('/student/results'),
                API.get('/student/tests/assigned'),
            ]);
            const avgPct = results.length > 0
                ? Math.round(results.reduce((s, r) => s + (r.total_points > 0 ? (r.score / r.total_points) * 100 : 0), 0) / results.length)
                : 0;
            el.innerHTML = `
                <div class="stats-grid">
                    ${statCard('📋', assigned.length, 'Assigned Tests')}
                    ${statCard('✅', results.length, 'Completed')}
                    ${statCard('📊', avgPct + '%', 'Average Score')}
                    ${statCard('🏆', results.length > 0 ? Math.max(...results.map(r => r.total_points > 0 ? Math.round((r.score / r.total_points) * 100) : 0)) + '%' : '-', 'Best Score')}
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    async renderStudentTests() {
        App.showView('student-tests');
        const el = $('#view-student-tests');
        showSpinner(el);
        try {
            const tests = await API.get('/student/tests/assigned');
            // Store tests in a map so onclick can reference them by test ID
            window._studentTests = {};
            tests.forEach(t => { window._studentTests[t.id || t._id] = t; });
            el.innerHTML = `
                <div class="card">
                    <div class="card-header">Assigned Tests</div>
                    ${tests.length === 0 ? '<div class="empty-state"><div class="icon">📋</div><p>No tests assigned yet.</p></div>' : ''}
                    ${tests.map(t => {
                        const tid = t.id || t._id;
                        const qCount = t.content_json && t.content_json.questions ? t.content_json.questions.length : 0;
                        const pts = t.content_json && t.content_json.total_points ? t.content_json.total_points : 0;
                        const mins = t.content_json && t.content_json.time_limit_minutes ? t.content_json.time_limit_minutes : 60;
                        return `<div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem">
                            <div>
                                <strong>${esc(t.title)}</strong>
                                <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.25rem">
                                    ${qCount} questions • ${pts} pts • ${mins} min
                                </div>
                                ${t.content_json && t.content_json.instructions ? `<div style="font-size:0.8rem;color:var(--text-light);margin-top:0.25rem">${esc(t.content_json.instructions)}</div>` : ''}
                            </div>
                            <button class="btn btn-primary" onclick="Views.startTestById('${esc(tid)}')">Start Test</button>
                        </div>`;
                    }).join('')}
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },

    startTestById(testId) {
        const testData = window._studentTests && window._studentTests[testId];
        if (!testData) {
            toast('Test data not found. Please refresh.', 'error');
            return;
        }
        Views.startTest(testId, testData);
    },

    startTest(testId, testData) {
        const assignmentId = testData.assignment_id || testData._assignment_id || '';
        App.showView('student-take-test');
        const el = $('#view-student-take-test');
        const questions = (testData && testData.content_json && testData.content_json.questions) || [];
        const timeLimit = (testData && testData.content_json && testData.content_json.time_limit_minutes) || 60;

        el.innerHTML = `
            <div class="card" style="margin-bottom:1rem">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
                    <div>
                        <strong style="font-size:1.1rem">${esc(testData.title || 'Test')}</strong>
                        <span style="font-size:0.8rem;color:var(--text-secondary);margin-left:0.5rem">${questions.length} questions • ${timeLimit} min</span>
                    </div>
                    <span id="test-timer" style="font-weight:700;color:var(--primary);font-size:1rem"></span>
                </div>
            </div>
            <div id="questions-container">
                ${questions.map((q, i) => `
                    <div class="question-card">
                        <div class="q-header">
                            <div class="q-number">${i + 1}</div>
                            <div>
                                <div class="q-text">${esc(q.text)}</div>
                                <div class="q-points">${q.points} point${q.points !== 1 ? 's' : ''} • ${q.type.replace('_', ' ')}</div>
                            </div>
                        </div>
                        <div class="options" data-qid="${esc(q.id)}">
                            ${q.type === 'multiple_choice' && q.options ? q.options.map((opt, oi) => `
                                <label class="option">
                                    <input type="radio" name="q-${esc(q.id)}" value="${esc(opt)}" />
                                    <span>${String.fromCharCode(65 + oi)}. ${esc(opt)}</span>
                                </label>
                            `).join('') : ''}
                            ${q.type === 'true_false' ? `
                                <label class="option"><input type="radio" name="q-${esc(q.id)}" value="true" /> True</label>
                                <label class="option"><input type="radio" name="q-${esc(q.id)}" value="false" /> False</label>
                            ` : ''}
                            ${q.type === 'short_answer' ? `
                                <input type="text" class="form-control" name="q-${esc(q.id)}" placeholder="Type your answer..." style="margin-top:0.5rem" />
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top:1rem;display:flex;gap:0.75rem">
                <button class="btn btn-secondary" onclick="window.location.hash='#tests'">← Back</button>
                <button class="btn btn-success" onclick="Views.submitTest('${esc(testId)}')">Submit Test</button>
            </div>
            <div id="submit-error" style="color:var(--danger);margin-top:0.75rem;display:none"></div>
        `;

        // Highlight selected options
        $$('.option', el).forEach(opt => {
            opt.addEventListener('click', function () {
                const parent = this.parentElement;
                $$('.option', parent).forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                const radio = $('input', this);
                if (radio) radio.checked = true;
            });
        });

        // Timer
        let remaining = timeLimit * 60;
        const timerEl = $('#test-timer');
        const updateTimer = () => {
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            if (remaining <= 300) timerEl.style.color = 'var(--danger)';
            if (remaining <= 0) {
                toast('Time is up! Submitting your test...', 'warning');
                Views.submitTest(testId);
                return;
            }
            remaining--;
        };
        updateTimer();
        this._timerInterval = setInterval(updateTimer, 1000);

        // Store test info including assignment_id
        this._currentTestId = testId;
        this._currentTestData = testData;
        this._currentAssignmentId = assignmentId;
    },

    async submitTest(testId) {
        if (this._timerInterval) clearInterval(this._timerInterval);

        const errEl = $('#submit-error');
        if (errEl) errEl.style.display = 'none';

        const questions = (this._currentTestData && this._currentTestData.content_json && this._currentTestData.content_json.questions) || [];
        const answers = [];

        questions.forEach(q => {
            let answer = '';
            const container = $(`.options[data-qid="${q.id}"]`);
            if (!container) return;
            if (q.type === 'short_answer') {
                const input = $(`input[name="q-${q.id}"]`);
                answer = input ? input.value.trim() : '';
            } else {
                const selected = $(`input[name="q-${q.id}"]:checked`);
                answer = selected ? selected.value : '';
            }
            answers.push({ question_id: q.id, answer });
        });

        if (!this._currentAssignmentId) {
            const msg = 'Assignment ID missing. Please go back and try again.';
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            toast(msg, 'error');
            return;
        }

        try {
            const result = await API.post('/student/tests/submit', {
                test_id: testId,
                assignment_id: this._currentAssignmentId,
                answers,
            });
            toast(`Test submitted! Score: ${result.score}/${result.total_points}`, 'success');
            window.location.hash = '#results';
        } catch (e) {
            if (errEl) {
                errEl.textContent = 'Submission failed: ' + e.message;
                errEl.style.display = 'block';
            }
            toast('Submission failed: ' + e.message, 'error');
        }
    },

    async renderStudentResults() {
        App.showView('student-results');
        const el = $('#view-student-results');
        showSpinner(el);
        try {
            const results = await API.get('/student/results');
            el.innerHTML = `
                <div class="card">
                    <div class="card-header">My Test Results</div>
                    ${results.length === 0 ? '<div class="empty-state"><div class="icon">📊</div><p>No results yet. Take a test to see your scores!</p></div>' : ''}
                    ${results.map((r, ri) => `
                        <div class="card" style="margin-bottom:1rem;border:1px solid var(--border)">
                            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem">
                                <div>
                                    <strong>Test: ${esc((r.test_id || '').slice(-8))}</strong>
                                    <span style="font-size:0.8rem;color:var(--text-secondary);margin-left:0.5rem">${formatDate(r.completed_at)}</span>
                                </div>
                                <div class="result-score" style="padding:0">
                                    <span style="font-size:1.5rem;font-weight:700;color:${r.total_points > 0 && (r.score / r.total_points) >= 0.7 ? 'var(--success)' : 'var(--danger)'}">
                                        ${r.score} / ${r.total_points}
                                    </span>
                                    <span class="percent" style="margin-left:0.5rem">
                                        (${r.total_points > 0 ? Math.round((r.score / r.total_points) * 100) : 0}%)
                                    </span>
                                </div>
                            </div>
                            <details style="font-size:0.85rem">
                                <summary style="cursor:pointer;font-weight:600;color:var(--primary)">View Answer Details</summary>
                                <div style="margin-top:0.75rem">
                                    ${(r.answers || []).map(a => `
                                        <div class="answer-review ${a.is_correct ? 'correct' : 'incorrect'}">
                                            <strong>Q:</strong> ${esc(a.question_id)}
                                            ${a.is_correct
                                                ? '<span class="badge badge-success" style="margin-left:0.5rem">✓ Correct</span>'
                                                : `<span class="badge badge-danger" style="margin-left:0.5rem">✗ Incorrect</span><br><small>Your answer: "${esc(a.your_answer || '')}" → Correct: "${esc(a.correct_answer || '')}"</small>`}
                                            <span style="float:right;font-weight:600">${a.points_earned || 0} / ${a.points_possible || 0} pts</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </details>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (e) {
            el.innerHTML = `<div class="card"><p style="color:var(--danger)">Failed to load: ${esc(e.message)}</p></div>`;
        }
    },
};

/* ========================================================================
 * SECTION 4: HELPERS
 * ======================================================================== */

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

function statCard(icon, value, label) {
    return `<div class="stat-card"><div class="stat-value">${icon} ${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`;
}

/* ========================================================================
 * SECTION 5: BOOT
 * ======================================================================== */

document.addEventListener('DOMContentLoaded', () => App.init());
