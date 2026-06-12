// ============================================================
// UIB AMS — Agency Management System  v1.0
// Shares localStorage with UIB Binder Book
// ============================================================

// ── IndexedDB — file storage ─────────────────────────────────
let amsDB = null;

function amsInitDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('UIB_AMS_Files', 2);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('files')) {
                const store = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
                store.createIndex('clientKey',  'clientKey',  { unique: false });
                store.createIndex('uploadedAt', 'uploadedAt', { unique: false });
                store.createIndex('category',   'category',   { unique: false });
            }
        };
        req.onsuccess = e => { amsDB = e.target.result; resolve(amsDB); };
        req.onerror   = e => { console.warn('IndexedDB error:', e.target.error); resolve(null); };
    });
}

function amsDBAddFile(record) {
    return new Promise((resolve, reject) => {
        if (!amsDB) { reject('DB not ready'); return; }
        const tx = amsDB.transaction('files', 'readwrite');
        const req = tx.objectStore('files').add(record);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function amsDBGetFilesForClient(clientKey) {
    return new Promise((resolve, reject) => {
        if (!amsDB) { resolve([]); return; }
        const tx  = amsDB.transaction('files', 'readonly');
        const req = tx.objectStore('files').index('clientKey').getAll(clientKey);
        req.onsuccess = e => resolve(e.target.result || []);
        req.onerror   = e => reject(e.target.error);
    });
}

function amsDBGetFile(id) {
    return new Promise((resolve, reject) => {
        if (!amsDB) { resolve(null); return; }
        const req = amsDB.transaction('files', 'readonly').objectStore('files').get(id);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function amsDBDeleteFile(id) {
    return new Promise((resolve, reject) => {
        if (!amsDB) { reject('DB not ready'); return; }
        const tx  = amsDB.transaction('files', 'readwrite');
        const req = tx.objectStore('files').delete(id);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
    });
}

// ── Shared constants (mirrors app.js) ───────────────────────
const AMS_LOBS = [
    "BOP","Boat","Builders Risk","Business Owner","Classic Collectors",
    "Commercial Auto","Commercial Property","Excess Liability","Flood",
    "Garage Keepers","General Liability","Home Owners DP1","Home Owners DP2",
    "Home Owners DP3","Home Owners H3","Home Owners H4","Home Owners H6",
    "Home Owners H8","Inland Marine","Motorcycle/ATV","Personal Auto",
    "Professional Liability","Surety Bond","Trucking","Umbrella","Workers Comp"
];

const AMS_ADMIN_PASSWORD = 'admin2024';

// ── State ────────────────────────────────────────────────────
let amsCurrentUser   = null;
let amsCurrentRole   = null;
let amsClientIndex   = {};   // key → { key, displayName, policies[], contact{} }
let amsActiveKey     = null; // currently selected client key
let amsFilteredKeys  = [];   // keys after search/filter
let _amsSearchTimer  = null;

// ── Data helpers ─────────────────────────────────────────────
function amsGetBinderData()  { return JSON.parse(localStorage.getItem('binderData'))  || []; }
function amsGetClientData()  { return JSON.parse(localStorage.getItem('amsClientData')) || {}; }
function amsGetCredentials() { return JSON.parse(localStorage.getItem('agentCredentials')) || {}; }
function amsGetCarriers()    { return JSON.parse(localStorage.getItem('carrierMasterData')) || {}; }

function amsSave(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

// Lock or unlock an agent <select> based on current role.
// Agents see their own name locked; only admin can change it.
function amsLockAgentField(sel) {
    if (!sel) return;
    if (amsCurrentRole !== 'admin') {
        sel.disabled = true;
        sel.title    = '🔒 Only Admin can change the assigned agent';
        sel.style.background   = '#f3f4f6';
        sel.style.cursor       = 'not-allowed';
        sel.style.borderColor  = '#d1d5db';
        sel.style.color        = '#6b7280';
        // Add a lock label next to the field if not already there
        const parent = sel.parentElement;
        if (parent && !parent.querySelector('.ams-agent-lock-badge')) {
            const badge = document.createElement('span');
            badge.className = 'ams-agent-lock-badge';
            badge.textContent = '🔒 Admin only';
            badge.style.cssText = 'font-size:11px;color:#dc2626;font-weight:700;margin-left:8px;';
            const label = parent.previousElementSibling || parent.querySelector('label');
            if (label) label.appendChild(badge);
        }
    } else {
        sel.disabled = false;
        sel.title    = '';
        sel.style.background  = '';
        sel.style.cursor      = '';
        sel.style.borderColor = '';
        sel.style.color       = '';
        // Remove lock badge if present
        sel.closest('.info-field, .form-group, div')
            ?.querySelectorAll('.ams-agent-lock-badge')
            .forEach(b => b.remove());
    }
}

function amsClientKey(name) {
    return (name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// ── Build client index from binderData ───────────────────────
function amsBuildClientIndex() {
    const binder   = amsGetBinderData();
    const contacts = amsGetClientData();
    const index    = {};

    binder.forEach(entry => {
        const key = amsClientKey(entry.customerName);
        if (!key) return;
        if (!index[key]) {
            index[key] = {
                key,
                displayName: entry.customerName,
                policies:    [],
                contact:     contacts[key] || {}
            };
        }
        index[key].policies.push(entry);
    });

    // Also include clients that have contact info but no policies yet
    Object.keys(contacts).forEach(key => {
        if (!index[key]) {
            index[key] = {
                key,
                displayName: contacts[key].firstName
                    ? `${contacts[key].firstName} ${contacts[key].lastName || ''}`.trim()
                    : key,
                policies: [],
                contact:  contacts[key]
            };
        } else {
            index[key].contact = contacts[key];
        }
    });

    // Sort policies within each client by date desc
    Object.values(index).forEach(c => {
        c.policies.sort((a, b) => {
            const da = a.entryDate ? new Date(a.entryDate + 'T12:00:00') : new Date(0);
            const db = b.entryDate ? new Date(b.entryDate + 'T12:00:00') : new Date(0);
            return db - da;
        });
    });

    amsClientIndex = index;
    amsFilteredKeys = Object.keys(index).sort();
}

// ── Login ────────────────────────────────────────────────────
function togglePasswordVisibility(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const showing = inp.type === 'text';
    inp.type = showing ? 'password' : 'text';
    const icon = btn.querySelector('i[data-lucide]');
    if (icon) { icon.setAttribute('data-lucide', showing ? 'eye' : 'eye-off'); lucide.createIcons(); }
}

function amsDoLogin() {
    const email    = (document.getElementById('amsLoginEmail')?.value || '').trim().toLowerCase();
    const password = (document.getElementById('amsLoginPassword')?.value || '');
    const creds    = amsGetCredentials();
    const errEl    = document.getElementById('amsLoginError');

    let matched = null;
    Object.entries(creds).forEach(([agent, data]) => {
        const agentEmail = (typeof data === 'object' ? data.email : '') || '';
        const agentPass  = (typeof data === 'object' ? data.password : data) || '';
        if (agentEmail.toLowerCase() === email && agentPass === password) matched = agent;
    });

    if (!matched) {
        if (errEl) { errEl.textContent = 'Invalid email or password.'; errEl.style.display = 'block'; }
        return;
    }

    const remember = document.getElementById('amsRememberEmail')?.checked;
    if (remember) {
        localStorage.setItem('amsRememberedEmail', email);
    } else {
        localStorage.removeItem('amsRememberedEmail');
    }

    amsCurrentUser = matched;
    amsCurrentRole = 'agent';
    amsLaunchApp();
}

function amsDoAdminLogin() {
    const pwd   = (document.getElementById('amsAdminPassword')?.value || '');
    const errEl = document.getElementById('amsAdminLoginError');
    const creds = amsGetCredentials();
    const adminPwd = (typeof creds['Admin'] === 'object' ? creds['Admin'].password : creds['Admin']) || AMS_ADMIN_PASSWORD;

    if (pwd !== adminPwd && pwd !== AMS_ADMIN_PASSWORD) {
        if (errEl) { errEl.style.display = 'block'; }
        return;
    }
    amsCurrentUser = 'Admin';
    amsCurrentRole = 'admin';
    amsLaunchApp();
}

function amsShowAdminLogin() {
    document.getElementById('amsAgentLoginForm').style.display = 'none';
    document.getElementById('amsAdminLoginForm').style.display = 'block';
}

function amsShowAgentLogin() {
    document.getElementById('amsAgentLoginForm').style.display = 'block';
    document.getElementById('amsAdminLoginForm').style.display = 'none';
}

function amsLogout() {
    amsCurrentUser = null;
    amsCurrentRole = null;
    amsActiveKey   = null;
    document.getElementById('amsApp').classList.remove('visible');
    document.getElementById('amsLoginScreen').style.display = 'flex';
    document.getElementById('amsLoginEmail').value    = '';
    document.getElementById('amsLoginPassword').value = '';
}

// ── App launch ───────────────────────────────────────────────
function amsLaunchApp() {
    document.getElementById('amsLoginScreen').style.display = 'none';
    document.getElementById('amsApp').classList.add('visible');

    // User chip
    const initials = amsCurrentUser.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('amsUserLabel').textContent = amsCurrentUser;
    document.getElementById('amsUserAvatar').textContent = initials;

    // Init IndexedDB for file storage, then load UI
    amsInitDB().then(() => {
        amsBuildClientIndex();
        amsPopulateAgentFilter();
        amsPopulateCarrierFilter();
        amsRenderClientList();
        amsPopulateModalDropdowns();
        lucide.createIcons();
    });

    // Keyboard: Escape closes preview
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') amsClosePreview();
        if (e.key === 'ArrowLeft')  amsPreviewNav(-1);
        if (e.key === 'ArrowRight') amsPreviewNav(1);
    });

    // Listen for storage changes from Binder Book
    window.addEventListener('storage', e => {
        if (e.key === 'binderData' || e.key === 'amsClientData') {
            amsBuildClientIndex();
            amsRenderClientList();
            if (amsActiveKey) amsLoadClientDetail(amsActiveKey);
        }
    });
}

// ── Populate filter dropdowns ────────────────────────────────
function amsPopulateAgentFilter() {
    const sel = document.getElementById('amsAgentFilter');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Agents</option>';
    const agents = [...new Set(Object.values(amsClientIndex).flatMap(c => c.policies.map(p => p.agent)))].filter(Boolean).sort();
    agents.forEach(a => {
        const o = document.createElement('option'); o.value = a; o.textContent = a; sel.appendChild(o);
    });
    sel.value = current;
}

function amsPopulateCarrierFilter() {
    const sel = document.getElementById('amsCarrierFilter');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">All Carriers</option>';
    const carriers = [...new Set(Object.values(amsClientIndex).flatMap(c => c.policies.map(p => p.company)))].filter(Boolean).sort();
    carriers.forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
    });
    sel.value = current;
}

function amsPopulateModalDropdowns() {
    // Agent select in policy modal
    const agentSel = document.getElementById('mp_agent');
    if (agentSel) {
        agentSel.innerHTML = '<option value="">— Select Agent —</option>';
        const creds = amsGetCredentials();
        Object.keys(creds).sort().forEach(a => {
            const o = document.createElement('option'); o.value = a; o.textContent = a; agentSel.appendChild(o);
        });
    }

    // LOB select
    const lobSel = document.getElementById('mp_lob');
    if (lobSel) {
        lobSel.innerHTML = '<option value="">— Select LOB —</option>';
        AMS_LOBS.forEach(l => {
            const o = document.createElement('option'); o.value = l; o.textContent = l; lobSel.appendChild(o);
        });
    }

    // Carrier select
    const carrierSel = document.getElementById('mp_carrier');
    if (carrierSel) {
        carrierSel.innerHTML = '<option value="">— Select Carrier —</option>';
        const carriers = Object.keys(amsGetCarriers()).sort();
        carriers.forEach(c => {
            const o = document.createElement('option'); o.value = c; o.textContent = c; carrierSel.appendChild(o);
        });
    }

    // Contact: assigned agent — admin only
    const ciAgent = document.getElementById('ci_assignedAgent');
    if (ciAgent) {
        ciAgent.innerHTML = '<option value="">— Select Agent —</option>';
        const creds = amsGetCredentials();
        Object.keys(creds).sort().forEach(a => {
            const o = document.createElement('option'); o.value = a; o.textContent = a; ciAgent.appendChild(o);
        });
        amsLockAgentField(ciAgent);
    }
}

// ── Search & Filter ──────────────────────────────────────────
function amsSearch(q) {
    clearTimeout(_amsSearchTimer);
    _amsSearchTimer = setTimeout(() => {
        // Sync both search boxes
        const qLow = (q || '').toLowerCase().trim();
        const sb = document.getElementById('amsSidebarSearch');
        const gb = document.getElementById('amsGlobalSearch');
        if (sb && sb.value.toLowerCase() !== qLow) sb.value = q;
        if (gb && gb.value.toLowerCase() !== qLow) gb.value = q;
        amsApplyFilters(qLow);
    }, 180);
}

function amsApplyFilters(q) {
    if (q === undefined) q = (document.getElementById('amsSidebarSearch')?.value || '').toLowerCase().trim();
    const agentFilter   = document.getElementById('amsAgentFilter')?.value   || '';
    const carrierFilter = document.getElementById('amsCarrierFilter')?.value || '';

    amsFilteredKeys = Object.keys(amsClientIndex).filter(key => {
        const client = amsClientIndex[key];
        // Search match
        if (q) {
            const contact = client.contact || {};
            const haystack = [
                client.displayName,
                contact.phone1, contact.phone2, contact.email,
                contact.address, contact.city,
                ...client.policies.map(p => p.policyNumber || ''),
                ...client.policies.map(p => p.binderNumber || ''),
                ...client.policies.map(p => p.company      || '')
            ].join(' ').toLowerCase();
            if (!haystack.includes(q)) return false;
        }
        // Agent filter
        if (agentFilter && !client.policies.some(p => p.agent === agentFilter)) {
            // allow if contact's assigned agent matches
            if ((client.contact?.assignedAgent || '') !== agentFilter) return false;
        }
        // Carrier filter
        if (carrierFilter && !client.policies.some(p => p.company === carrierFilter)) return false;
        return true;
    }).sort();

    amsRenderClientList();
}

// ── Render client list ───────────────────────────────────────
function amsRenderClientList() {
    const container = document.getElementById('amsClientList');
    const countEl   = document.getElementById('amsClientCount');
    if (!container) return;
    if (countEl) countEl.textContent = `${amsFilteredKeys.length} client${amsFilteredKeys.length !== 1 ? 's' : ''}`;

    if (!amsFilteredKeys.length) {
        container.innerHTML = '<div class="no-results">No clients found.</div>';
        return;
    }

    container.innerHTML = amsFilteredKeys.map(key => {
        const c = amsClientIndex[key];
        const contact = c.contact || {};
        const numPolicies = c.policies.length;
        const lastAgent   = c.policies[0]?.agent || contact.assignedAgent || '';
        const phone       = contact.phone1 || '';
        const lastDate    = c.policies[0]?.entryDate
            ? new Date(c.policies[0].entryDate + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
            : '';
        const initials = c.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

        return `
        <div class="client-card ${key === amsActiveKey ? 'active' : ''}" onclick="amsLoadClientDetail('${amsEsc(key)}')">
            <div style="display:flex;gap:10px;align-items:center;">
                <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--navy));color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>
                <div style="flex:1;min-width:0;">
                    <div class="cc-name">${amsEscHtml(c.displayName)}</div>
                    <div class="cc-meta">
                        ${phone ? `<span>${amsEscHtml(phone)}</span>` : ''}
                        ${lastDate ? `<span>${lastDate}</span>` : ''}
                    </div>
                    <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
                        <span class="cc-badge policies">${numPolicies} polic${numPolicies !== 1 ? 'ies' : 'y'}</span>
                        ${lastAgent ? `<span class="cc-badge agent">${amsEscHtml(lastAgent)}</span>` : ''}
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ── Load & render client detail ──────────────────────────────
function amsLoadClientDetail(key) {
    const client = amsClientIndex[key];
    if (!client) return;
    amsActiveKey = key;

    // Mark active in list
    document.querySelectorAll('.client-card').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.client-card').forEach(el => {
        if (el.onclick?.toString().includes(`'${key}'`)) el.classList.add('active');
    });

    document.getElementById('amsWelcome').style.display      = 'none';
    document.getElementById('amsClientDetail').style.display = 'block';

    const contact  = client.contact || {};
    const initials = client.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const numPol   = client.policies.length;

    document.getElementById('detailAvatar').textContent = initials;
    document.getElementById('detailName').textContent   = contact.firstName
        ? `${contact.firstName} ${contact.lastName || ''}`.trim()
        : client.displayName;

    // Meta row
    const metaItems = [];
    if (contact.phone1) metaItems.push(`<span><i data-lucide="phone" style="width:12px;height:12px;"></i> ${amsEscHtml(contact.phone1)}</span>`);
    if (contact.email)  metaItems.push(`<span><i data-lucide="mail"  style="width:12px;height:12px;"></i> ${amsEscHtml(contact.email)}</span>`);
    if (contact.city)   metaItems.push(`<span><i data-lucide="map-pin" style="width:12px;height:12px;"></i> ${amsEscHtml(contact.city)}</span>`);
    metaItems.push(`<span class="tag tag-blue">${numPol} Polic${numPol !== 1 ? 'ies' : 'y'}</span>`);
    if (contact.clientStatus) metaItems.push(`<span class="tag tag-green">${amsEscHtml(contact.clientStatus)}</span>`);
    document.getElementById('detailMeta').innerHTML = metaItems.join('');

    // Populate contact form fields
    const fields = ['firstName','lastName','dob','gender','marital','ssn4','phone1','phone2','email',
                    'prefContact','address','city','state','zip','dlNum','dlState','dlExp','language',
                    'assignedAgent','csrName','dealerLocation','clientSince','referral','clientStatus'];
    fields.forEach(f => {
        const el = document.getElementById(`ci_${f}`);
        if (el) el.value = contact[f] || '';
    });

    amsRenderPolicies(key);
    amsRenderNotes(key);
    amsUpdateDocBadge();
    amsShowTab('contact');
    lucide.createIcons();
}

// ── Render policy table ──────────────────────────────────────
function amsRenderPolicies(key) {
    const tbody = document.getElementById('amsPoliciesBody');
    if (!tbody) return;
    const policies = (amsClientIndex[key]?.policies || []);
    if (!policies.length) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--gray-400);">No policies on record. Click "Add Policy" to create one.</td></tr>`;
        return;
    }

    tbody.innerHTML = policies.map(p => {
        const dateStr = p.entryDate
            ? new Date(p.entryDate + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
            : '—';
        const prem   = p.totalPremium != null ? `$${parseFloat(p.totalPremium).toFixed(2)}` : '—';
        const canEdit = amsCurrentRole === 'admin' || p.agent === amsCurrentUser;

        return `<tr>
            <td style="white-space:nowrap;">${dateStr}</td>
            <td>${amsEscHtml(p.agent || '—')}</td>
            <td><span class="tag tag-blue">${amsEscHtml(p.policyType || '—')}</span></td>
            <td>${amsEscHtml(p.lineOfBusiness || '—')}</td>
            <td><strong>${amsEscHtml(p.company || '—')}</strong></td>
            <td style="font-family:monospace;font-size:11.5px;">${amsEscHtml(p.policyNumber || '—')}</td>
            <td style="font-family:monospace;font-size:11.5px;">${amsEscHtml(p.binderNumber || '—')}</td>
            <td style="text-align:right;font-weight:700;color:var(--navy);">${prem}</td>
            <td>${amsEscHtml(p.paymentType || p.commissionType || '—')}</td>
            <td>${amsEscHtml(p.mga || '—')}</td>
            <td style="white-space:nowrap;">
                ${canEdit
                    ? `<button class="btn-secondary btn-sm" onclick="amsEditPolicy(${p.id})">
                           <i data-lucide="pencil"></i> Edit
                       </button>`
                    : '<span style="font-size:11px;color:var(--gray-300);">—</span>'}
            </td>
        </tr>`;
    }).join('');
    lucide.createIcons();
}

// ── Render notes ─────────────────────────────────────────────
function amsRenderNotes(key) {
    const container = document.getElementById('amsNotesList');
    if (!container) return;
    const contacts = amsGetClientData();
    const notes    = contacts[key]?.notes || [];

    if (!notes.length) {
        container.innerHTML = '<div class="no-results" style="padding:24px;">No notes yet.</div>';
        return;
    }

    container.innerHTML = [...notes].reverse().map((n, i) => `
        <div class="note-entry">
            <div class="note-meta">${amsEscHtml(n.author || 'Unknown')} — ${amsEscHtml(n.date || '')}</div>
            <div class="note-text">${amsEscHtml(n.text)}</div>
        </div>
    `).join('');
}

// ── Tabs ─────────────────────────────────────────────────────
function amsShowTab(tab) {
    ['contact','policies','notes','documents'].forEach(t => {
        const el = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (el) el.style.display = t === tab ? 'block' : 'none';
        document.querySelector(`.ams-tab[data-tab="${t}"]`)?.classList.toggle('active', t === tab);
    });
    if (tab === 'documents' && amsActiveKey) amsRenderFileGrid();
}

// ── Save contact info ────────────────────────────────────────
function amsSaveContact() {
    if (!amsActiveKey) return;
    const contacts = amsGetClientData();
    if (!contacts[amsActiveKey]) contacts[amsActiveKey] = {};

    const fields = ['firstName','lastName','dob','gender','marital','ssn4','phone1','phone2','email',
                    'prefContact','address','city','state','zip','dlNum','dlState','dlExp','language',
                    'assignedAgent','csrName','dealerLocation','clientSince','referral','clientStatus'];
    fields.forEach(f => {
        contacts[amsActiveKey][f] = document.getElementById(`ci_${f}`)?.value || '';
    });
    contacts[amsActiveKey].updatedAt = new Date().toISOString();

    amsSave('amsClientData', contacts);

    // Re-index and refresh
    amsBuildClientIndex();
    amsRenderClientList();
    amsLoadClientDetail(amsActiveKey);
    amsFlashBanner('Contact info saved ✓');
}

function amsDiscardContact() {
    if (amsActiveKey) amsLoadClientDetail(amsActiveKey);
}

// ── Save note ────────────────────────────────────────────────
function amsSaveNote() {
    if (!amsActiveKey) return;
    const text = (document.getElementById('amsNewNote')?.value || '').trim();
    if (!text) return;

    const contacts = amsGetClientData();
    if (!contacts[amsActiveKey]) contacts[amsActiveKey] = {};
    if (!contacts[amsActiveKey].notes) contacts[amsActiveKey].notes = [];

    const now = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
    contacts[amsActiveKey].notes.push({ text, author: amsCurrentUser, date: now });
    amsSave('amsClientData', contacts);

    document.getElementById('amsNewNote').value = '';
    amsBuildClientIndex();
    amsRenderNotes(amsActiveKey);
    amsFlashBanner('Note saved ✓');
}

// ── Add / Edit Policy Modal ───────────────────────────────────
function amsOpenAddPolicyModal() {
    document.getElementById('amsPolicyModalTitle').innerHTML = '<i data-lucide="file-plus"></i> Add Policy';
    document.getElementById('amsPolicyEditId').value = '';
    const fields = ['mp_agent','mp_policyType','mp_lob','mp_carrier','mp_mga','mp_policyNum','mp_binderNum','mp_premium','mp_payType','mp_effDate','mp_expDate'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    // Pre-select current user if agent, then lock the field
    if (amsCurrentRole === 'agent') {
        const agSel = document.getElementById('mp_agent');
        if (agSel) agSel.value = amsCurrentUser;
    }
    amsLockAgentField(document.getElementById('mp_agent'));

    document.getElementById('amsPolicyModal').classList.add('open');
    lucide.createIcons();
}

function amsEditPolicy(policyId) {
    const binder  = amsGetBinderData();
    const entry   = binder.find(p => p.id === policyId);
    if (!entry) return;

    document.getElementById('amsPolicyModalTitle').innerHTML = '<i data-lucide="pencil"></i> Edit Policy';
    document.getElementById('amsPolicyEditId').value = policyId;

    const map = {
        mp_agent:       'agent',
        mp_policyType:  'policyType',
        mp_lob:         'lineOfBusiness',
        mp_carrier:     'company',
        mp_mga:         'mga',
        mp_policyNum:   'policyNumber',
        mp_binderNum:   'binderNumber',
        mp_premium:     'totalPremium',
        mp_payType:     'paymentType',
        mp_effDate:     'effectiveDate',
        mp_expDate:     'expirationDate'
    };
    Object.entries(map).forEach(([elId, field]) => {
        const el = document.getElementById(elId);
        if (el) el.value = entry[field] || '';
    });

    amsLockAgentField(document.getElementById('mp_agent'));
    document.getElementById('amsPolicyModal').classList.add('open');
    lucide.createIcons();
}

function amsClosePolicyModal() {
    document.getElementById('amsPolicyModal').classList.remove('open');
}

function amsSavePolicyModal() {
    const agent      = document.getElementById('mp_agent')?.value      || '';
    const policyType = document.getElementById('mp_policyType')?.value || '';
    const lob        = document.getElementById('mp_lob')?.value        || '';
    const carrier    = document.getElementById('mp_carrier')?.value    || '';

    if (!agent)      { alert('Please select an Agent.');            return; }
    if (!policyType) { alert('Please select a Policy Type.');       return; }
    if (!lob)        { alert('Please select a Line of Business.');  return; }
    if (!carrier)    { alert('Please select a Carrier.');           return; }

    const editId = parseInt(document.getElementById('amsPolicyEditId')?.value) || null;
    let binder   = amsGetBinderData();

    const premVal = parseFloat(document.getElementById('mp_premium')?.value) || 0;

    if (editId) {
        // Update existing entry
        const idx = binder.findIndex(p => p.id === editId);
        if (idx !== -1) {
            binder[idx] = {
                ...binder[idx],
                agent,
                policyType,
                lineOfBusiness: lob,
                company:        carrier,
                mga:            document.getElementById('mp_mga')?.value        || '',
                policyNumber:   document.getElementById('mp_policyNum')?.value  || '',
                binderNumber:   document.getElementById('mp_binderNum')?.value  || '',
                totalPremium:   premVal,
                paymentType:    document.getElementById('mp_payType')?.value    || '',
                effectiveDate:  document.getElementById('mp_effDate')?.value    || '',
                expirationDate: document.getElementById('mp_expDate')?.value    || ''
            };
        }
    } else {
        // New entry — add to binder
        const newId = Date.now();
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD ET
        binder.push({
            id:             newId,
            agent,
            entryDate:      today,
            customerName:   amsClientIndex[amsActiveKey]?.displayName || amsActiveKey,
            policyType,
            lineOfBusiness: lob,
            company:        carrier,
            mga:            document.getElementById('mp_mga')?.value        || '',
            policyNumber:   document.getElementById('mp_policyNum')?.value  || '',
            binderNumber:   document.getElementById('mp_binderNum')?.value  || '',
            totalPremium:   premVal,
            paymentType:    document.getElementById('mp_payType')?.value    || '',
            effectiveDate:  document.getElementById('mp_effDate')?.value    || '',
            expirationDate: document.getElementById('mp_expDate')?.value    || '',
            agencyCommission: 0, agentCommission: 0
        });
    }

    localStorage.setItem('binderData', JSON.stringify(binder));  // triggers storage event in Binder Book

    amsClosePolicyModal();
    amsBuildClientIndex();
    amsRenderClientList();
    amsRenderPolicies(amsActiveKey);
    amsFlashBanner(editId ? 'Policy updated ✓' : 'Policy added ✓');
}

// ── Print ────────────────────────────────────────────────────
function amsPrintClient() {
    window.print();
}

// ── Utilities ────────────────────────────────────────────────
function amsEsc(str) {
    return (str || '').replace(/'/g, "\\'");
}

function amsEscHtml(str) {
    return (str || '').toString()
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function amsFlashBanner(msg) {
    const b = document.getElementById('amsSyncBanner');
    if (!b) return;
    b.textContent = msg;
    b.style.display = 'block';
    setTimeout(() => { b.style.display = 'none'; }, 2200);
}

// ── Init ─────────────────────────────────────────────────────
const AMS_DRIVE_URL = "https://script.google.com/macros/s/AKfycbypm1A3G5Wgf4onwSU-yk6FbmTOA-9in7HcFrg0YWL6UBdhNj4di7yVDNlflLYwaehI/exec";

async function amsPullCredentialsFromDrive() {
    try {
        const res  = await fetch(`${AMS_DRIVE_URL}?key=agentCredentials`);
        const json = await res.json();
        if (json.success && json.data && typeof json.data === 'object') {
            localStorage.setItem('agentCredentials', JSON.stringify(json.data));
        }
    } catch (e) {
        // Drive unavailable — use whatever is in localStorage already
    }
}

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    // Pull latest credentials from Drive so login works on any device
    amsPullCredentialsFromDrive();

    // Pre-fill remembered email
    const remembered = localStorage.getItem('amsRememberedEmail');
    if (remembered) {
        const emailEl = document.getElementById('amsLoginEmail');
        const checkEl = document.getElementById('amsRememberEmail');
        if (emailEl) { emailEl.value = remembered; }
        if (checkEl) { checkEl.checked = true; }
        document.getElementById('amsLoginPassword')?.focus();
    }

    // Close modal on backdrop click
    document.getElementById('amsPolicyModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('amsPolicyModal')) amsClosePolicyModal();
    });
    // Close preview on backdrop
    document.getElementById('amsPreviewModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('amsPreviewModal')) amsClosePreview();
    });
});


// ============================================================
// FILE / DOCUMENT MANAGEMENT (IndexedDB)
// ============================================================

let _amsCurrentFileList = [];  // files currently shown in grid (for prev/next nav)
let _amsPreviewIdx      = -1;  // index in _amsCurrentFileList being previewed
let _amsPreviewObjUrl   = null; // current object URL to revoke

// ── File type helpers ─────────────────────────────────────────
function amsFileIcon(type, name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (type.startsWith('image/'))            return '🖼️';
    if (type === 'application/pdf')           return '📄';
    if (type.startsWith('video/'))            return '🎬';
    if (type.startsWith('audio/'))            return '🎵';
    if (type.startsWith('text/'))             return '📝';
    if (ext === 'docx' || ext === 'doc')      return '📘';
    if (ext === 'xlsx' || ext === 'xls')      return '📗';
    if (ext === 'pptx' || ext === 'ppt')      return '📙';
    if (ext === 'zip'  || ext === 'rar')      return '🗜️';
    if (ext === 'csv')                        return '📊';
    if (ext === 'json' || ext === 'xml')      return '🧾';
    return '📁';
}

function amsFileColor(type, name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (type.startsWith('image/'))       return '#8b5cf6';
    if (type === 'application/pdf')      return '#dc2626';
    if (type.startsWith('video/'))       return '#059669';
    if (type.startsWith('audio/'))       return '#f59e0b';
    if (ext === 'docx' || ext === 'doc') return '#1d4ed8';
    if (ext === 'xlsx' || ext === 'xls') return '#059669';
    if (ext === 'pptx' || ext === 'ppt') return '#ea580c';
    return '#64748b';
}

function amsFormatSize(bytes) {
    if (bytes < 1024)               return `${bytes} B`;
    if (bytes < 1024 * 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function amsCanPreview(type, name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    return type.startsWith('image/')
        || type === 'application/pdf'
        || type.startsWith('video/')
        || type.startsWith('audio/')
        || type.startsWith('text/')
        || ['csv','json','xml','html','htm','md','txt','log','js','css'].includes(ext);
}

// ── Upload handling ───────────────────────────────────────────
function amsHandleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('amsUploadZone')?.classList.remove('drag-over');
    const items = e.dataTransfer?.items;
    if (items) {
        const fileList = [];
        for (let item of items) {
            const entry = item.webkitGetAsEntry?.();
            if (entry) {
                _amsTraverseEntry(entry, '', fileList);
            } else {
                const f = item.getAsFile();
                if (f) fileList.push({ file: f, path: '' });
            }
        }
        // Wait briefly for traversal to settle then upload
        setTimeout(() => amsUploadFiles(fileList), 100);
    } else if (e.dataTransfer?.files?.length) {
        const files = Array.from(e.dataTransfer.files).map(f => ({ file: f, path: '' }));
        amsUploadFiles(files);
    }
}

function _amsTraverseEntry(entry, path, list) {
    if (entry.isFile) {
        entry.file(f => list.push({ file: f, path }));
    } else if (entry.isDirectory) {
        const reader = entry.createReader();
        reader.readEntries(entries => {
            entries.forEach(child => _amsTraverseEntry(child, path ? `${path}/${entry.name}` : entry.name, list));
        });
    }
}

function amsHandleFileInput(e) {
    const files = Array.from(e.target.files || []).map(f => ({ file: f, path: '' }));
    amsUploadFiles(files);
    e.target.value = '';
}

function amsHandleFolderInput(e) {
    const files = Array.from(e.target.files || []).map(f => ({
        file: f,
        path: f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(0, -1).join('/') : ''
    }));
    amsUploadFiles(files);
    e.target.value = '';
}

async function amsUploadFiles(fileList) {
    if (!amsActiveKey || !fileList.length) return;
    if (!amsDB) { alert('Storage not ready. Please refresh.'); return; }

    const category = document.getElementById('amsUploadCategory')?.value || 'Other';
    const progWrap = document.getElementById('amsUploadProgress');
    const progBar  = document.getElementById('amsUploadProgressBar');
    const statEl   = document.getElementById('amsUploadStatus');
    if (progWrap) progWrap.style.display = 'block';

    let done = 0;
    const total = fileList.length;
    for (const { file, path } of fileList) {
        if (statEl) statEl.textContent = `Uploading ${done + 1} of ${total}: ${file.name}`;
        try {
            const data = await file.arrayBuffer();
            await amsDBAddFile({
                clientKey:  amsActiveKey,
                name:       file.name,
                path:       path || '',
                fullPath:   path ? `${path}/${file.name}` : file.name,
                type:       file.type || 'application/octet-stream',
                size:       file.size,
                category,
                uploadedAt: new Date().toISOString(),
                uploadedBy: amsCurrentUser,
                data
            });
        } catch (err) {
            console.warn('Upload failed for', file.name, err);
        }
        done++;
        if (progBar) progBar.style.width = `${Math.round((done / total) * 100)}%`;
    }

    if (progWrap) setTimeout(() => { progWrap.style.display = 'none'; if (progBar) progBar.style.width = '0%'; }, 800);
    if (statEl)   setTimeout(() => { statEl.textContent = ''; }, 1500);

    amsRenderFileGrid();
    amsUpdateDocBadge();
    amsFlashBanner(`${total} file${total > 1 ? 's' : ''} uploaded ✓`);
}

// ── Render file grid ──────────────────────────────────────────
async function amsRenderFileGrid() {
    const grid = document.getElementById('amsFileGrid');
    if (!grid || !amsActiveKey) return;
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--gray-400);font-size:13px;">Loading files…</div>';

    const catFilter = document.getElementById('docCategorySelect')?.value || '';
    let files = await amsDBGetFilesForClient(amsActiveKey);
    if (catFilter) files = files.filter(f => f.category === catFilter);
    files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    _amsCurrentFileList = files;

    if (!files.length) {
        grid.innerHTML = '<div class="fc-no-files">No documents found.<br><span style="font-size:12px;">Upload files using the area above.</span></div>';
        return;
    }

    const cards = await Promise.all(files.map(async (f, idx) => {
        const icon     = amsFileIcon(f.type, f.name);
        const color    = amsFileColor(f.type, f.name);
        const size     = amsFormatSize(f.size);
        const date     = new Date(f.uploadedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
        const canPrev  = amsCanPreview(f.type, f.name);
        const isImage  = f.type.startsWith('image/');

        let thumbHtml;
        if (isImage) {
            // Build a temporary object URL for the thumbnail
            const blob      = new Blob([f.data], { type: f.type });
            const objUrl    = URL.createObjectURL(blob);
            thumbHtml = `<img src="${objUrl}" alt="${amsEscHtml(f.name)}" onload="URL.revokeObjectURL(this.src)" style="width:60px;height:60px;object-fit:cover;border-radius:4px;">`;
        } else {
            thumbHtml = `<div class="fc-type-icon" style="color:${color};">${icon}</div>`;
        }

        return `
        <div class="file-card" onclick="amsPreviewFile(${idx})" title="${amsEscHtml(f.fullPath || f.name)}">
            <button class="fc-del" onclick="event.stopPropagation(); amsDeleteFileById(${f.id})" title="Delete">✕</button>
            <div class="fc-thumb">${thumbHtml}</div>
            ${f.path ? `<div class="fc-path">${amsEscHtml(f.path)}/</div>` : ''}
            <div class="fc-name">${amsEscHtml(f.name)}</div>
            <div class="fc-meta">${size} · ${date}</div>
            <div style="font-size:9px;color:var(--gray-300);margin-bottom:5px;">${amsEscHtml(f.category || '')}</div>
            <div class="fc-actions">
                ${canPrev ? `<button class="btn-primary btn-sm" style="font-size:10px;padding:3px 8px;" onclick="event.stopPropagation();amsPreviewFile(${idx})"><i data-lucide="eye" style="width:10px;height:10px;"></i> View</button>` : ''}
                <button class="btn-secondary btn-sm" style="font-size:10px;padding:3px 8px;" onclick="event.stopPropagation();amsDownloadFile(${f.id})"><i data-lucide="download" style="width:10px;height:10px;"></i></button>
            </div>
        </div>`;
    }));

    grid.innerHTML = cards.join('');
    lucide.createIcons();
}

// ── Delete file ───────────────────────────────────────────────
async function amsDeleteFileById(id) {
    if (!confirm('Delete this file permanently?')) return;
    await amsDBDeleteFile(id);
    amsRenderFileGrid();
    amsUpdateDocBadge();
    amsFlashBanner('File deleted');
}

// ── Download file ─────────────────────────────────────────────
async function amsDownloadFile(id) {
    const rec  = await amsDBGetFile(id);
    if (!rec)  return;
    const blob = new Blob([rec.data], { type: rec.type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url; a.download = rec.name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ── Preview system ────────────────────────────────────────────
async function amsPreviewFile(listIdx) {
    const rec = _amsCurrentFileList[listIdx];
    if (!rec) return;
    _amsPreviewIdx = listIdx;
    await _amsRenderPreview(rec);
}

async function _amsRenderPreview(rec) {
    // Fetch fresh record with data
    const full = await amsDBGetFile(rec.id);
    if (!full) return;

    // Revoke previous blob URL
    if (_amsPreviewObjUrl) { URL.revokeObjectURL(_amsPreviewObjUrl); _amsPreviewObjUrl = null; }

    const modal    = document.getElementById('amsPreviewModal');
    const body     = document.getElementById('amsPreviewBody');
    const nameEl   = document.getElementById('previewFileName');
    const metaEl   = document.getElementById('previewFileMeta');

    nameEl.textContent = full.fullPath || full.name;
    metaEl.textContent = `${amsFormatSize(full.size)} · ${full.type || 'unknown type'}`;

    const blob     = new Blob([full.data], { type: full.type });
    const objUrl   = URL.createObjectURL(blob);
    _amsPreviewObjUrl  = objUrl;

    const type = full.type || '';
    const ext  = (full.name || '').split('.').pop().toLowerCase();

    if (type.startsWith('image/')) {
        body.innerHTML = `<img src="${objUrl}" alt="${amsEscHtml(full.name)}">`;
    } else if (type === 'application/pdf') {
        body.innerHTML = `<iframe src="${objUrl}" title="${amsEscHtml(full.name)}"></iframe>`;
    } else if (type.startsWith('video/')) {
        body.innerHTML = `<video src="${objUrl}" controls autoplay style="max-width:100%;max-height:calc(100vh - 120px);"></video>`;
    } else if (type.startsWith('audio/')) {
        body.innerHTML = `<div style="text-align:center;color:white;"><div style="font-size:64px;margin-bottom:20px;">🎵</div><p style="margin-bottom:16px;">${amsEscHtml(full.name)}</p><audio src="${objUrl}" controls autoplay></audio></div>`;
    } else if (type.startsWith('text/') || ['txt','csv','json','xml','html','htm','md','log','js','css','sql'].includes(ext)) {
        const text = await blob.text();
        // CSV → simple table preview
        if (ext === 'csv') {
            body.innerHTML = _amsCSVTable(text);
        } else {
            body.innerHTML = `<pre>${amsEscHtml(text)}</pre>`;
        }
    } else {
        // Unsupported — offer download
        body.innerHTML = `
            <div class="preview-unsupported">
                <div class="pu-icon">${amsFileIcon(type, full.name)}</div>
                <h3>${amsEscHtml(full.name)}</h3>
                <p>Preview not available for this file type (${type || ext}).</p>
                <button class="btn-primary" onclick="amsDownloadCurrent()"><i data-lucide="download"></i> Download File</button>
            </div>`;
        lucide.createIcons();
    }

    modal.classList.add('open');
}

function _amsCSVTable(text) {
    const rows = text.trim().split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
    if (!rows.length) return '<pre>Empty CSV</pre>';
    const header = rows[0].map(h => `<th style="padding:6px 10px;background:#1e293b;color:#e2e8f0;font-size:12px;white-space:nowrap;">${amsEscHtml(h)}</th>`).join('');
    const body   = rows.slice(1).map(r =>
        `<tr>${r.map(c => `<td style="padding:5px 10px;font-size:12px;border-bottom:1px solid #e2e8f0;">${amsEscHtml(c)}</td>`).join('')}</tr>`
    ).join('');
    return `<div style="overflow:auto;max-width:100%;max-height:calc(100vh - 120px);background:white;border-radius:8px;"><table style="border-collapse:collapse;width:100%;"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function amsPreviewNav(dir) {
    const next = _amsPreviewIdx + dir;
    if (next < 0 || next >= _amsCurrentFileList.length) return;
    _amsPreviewIdx = next;
    await _amsRenderPreview(_amsCurrentFileList[_amsPreviewIdx]);
}

function amsClosePreview() {
    document.getElementById('amsPreviewModal')?.classList.remove('open');
    if (_amsPreviewObjUrl) { URL.revokeObjectURL(_amsPreviewObjUrl); _amsPreviewObjUrl = null; }
    document.getElementById('amsPreviewBody').innerHTML = '';
}

async function amsDownloadCurrent() {
    const rec = _amsCurrentFileList[_amsPreviewIdx];
    if (rec) await amsDownloadFile(rec.id);
}

// ── Badge: show file count on Documents tab ───────────────────
async function amsUpdateDocBadge() {
    if (!amsActiveKey) return;
    const files  = await amsDBGetFilesForClient(amsActiveKey);
    const badge  = document.getElementById('docTabBadge');
    if (!badge) return;
    if (files.length > 0) {
        badge.textContent = files.length;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }
}
