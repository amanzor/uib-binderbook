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
    "Home Owners H8","Inland Marine","Motorcycle/ATV","Non-Trucking Liability",
    "Personal Auto","Pollution Liability","Professional Liability","Surety Bond",
    "Trucking","Umbrella","Workers Comp"
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
function amsGetBinderData()  { let d = JSON.parse(localStorage.getItem('binderData'))  || []; if (!Array.isArray(d)) d = d.value || []; return d; }
function amsGetClientData()  { return JSON.parse(localStorage.getItem('amsClientData')) || {}; }
function amsGetCredentials() { return JSON.parse(localStorage.getItem('agentCredentials')) || {}; }
function amsGetCarriers()    { return JSON.parse(localStorage.getItem('carrierMasterData')) || {}; }

function amsSave(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    amsSyncToDrive(key, value);
}

async function amsSyncToDrive(key, value) {
    try {
        const payload = JSON.stringify({ key: key, value: value });
        await fetch(AMS_DRIVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, mode: 'no-cors' });
    } catch (e) { /* Drive unavailable */ }
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

// ── Drive → localStorage sync ────────────────────────────────
async function amsSyncDataFromDrive() {
    const keys = ['binderData', 'amsClientData', 'carrierMasterData', 'agentMasterData'];
    const results = await Promise.allSettled(keys.map(async key => {
        try {
            const res  = await fetch(`${AMS_DRIVE_URL}?key=${key}`);
            const json = await res.json();
            if (json.success && json.data != null) {
                let data = json.data;
                // Unwrap {value: [...]} if data was stored with wrapper
                if (data && !Array.isArray(data) && data.value && Array.isArray(data.value)) {
                    data = data.value;
                }
                localStorage.setItem(key, JSON.stringify(data));
                return { key, count: Array.isArray(data) ? data.length : Object.keys(data).length };
            }
        } catch (e) { /* Drive unavailable — use localStorage */ }
        return { key, count: 0 };
    }));
    return results.map(r => r.value || r.reason);
}

// ── App launch ───────────────────────────────────────────────
function amsLaunchApp() {
    document.getElementById('amsLoginScreen').style.display = 'none';
    document.getElementById('amsApp').classList.add('visible');

    // User chip
    const initials = amsCurrentUser.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('amsUserLabel').textContent = amsCurrentUser;
    document.getElementById('amsUserAvatar').textContent = initials;

    // Init IndexedDB + sync from Drive, then load UI
    amsInitDB().then(async () => {
        await amsSyncDataFromDrive();
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
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:var(--gray-400);">No policies on record. Click "Add Policy" to create one.</td></tr>`;
        return;
    }

    tbody.innerHTML = policies.map(p => {
        const dateStr = p.entryDate
            ? new Date(p.entryDate + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
            : '—';
        const prem   = p.totalPremium != null ? `$${parseFloat(p.totalPremium).toFixed(2)}` : '—';
        const canEdit = amsCurrentRole === 'admin' || p.agent === amsCurrentUser;
        
        // Determine policy status
        const status = amsGetPolicyStatus(p);
        const statusColor = amsGetStatusColor(status);
        const statusBg = amsGetStatusBackground(status);

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
                <span class="policy-status" style="background:${statusBg};color:${statusColor};padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;display:inline-block;">
                    ${amsEscHtml(p.policyStatus || status)}
                </span>
            </td>
            <td style="white-space:nowrap;">
                ${canEdit
                    ? `<div class="policy-actions" style="display:flex;gap:4px;">
                           <button class="btn-secondary btn-sm" onclick="amsEditPolicy(${p.id})" title="Edit policy">
                               <i data-lucide="pencil"></i>
                           </button>
                           <button class="btn-secondary btn-sm" onclick="amsOpenPolicyActionMenu(event, ${p.id})" title="More actions">
                               <i data-lucide="more-vertical"></i>
                           </button>
                       </div>`
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
    ['contact','policies','notes','documents','forms'].forEach(t => {
        const el = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (el) el.style.display = t === tab ? 'block' : 'none';
        document.querySelector(`.ams-tab[data-tab="${t}"]`)?.classList.toggle('active', t === tab);
    });
    if (tab === 'documents' && amsActiveKey) amsRenderFileGrid();
    if (tab === 'forms' && amsActiveKey) acordRenderFormsList();
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
    const fields = ['mp_agent','mp_policyType','mp_lob','mp_carrier','mp_mga','mp_policyNum','mp_binderNum',
                    'mp_down','mp_agencyFee','mp_basePremium','mp_premium',
                    'mp_payMethod','mp_payMethod2','mp_agencyCommission','mp_agentCommission','mp_payType',
                    'mp_effDate','mp_expDate','mp_policyStatus'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    // Pre-select current user if agent, then lock the field
    if (amsCurrentRole === 'agent') {
        const agSel = document.getElementById('mp_agent');
        if (agSel) agSel.value = amsCurrentUser;
    }
    amsLockAgentField(document.getElementById('mp_agent'));

    // Reset drivers/vehicles with one empty row each, prefill from client contact
    amsResetDriversVehicles();

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
        mp_agent:            'agent',
        mp_policyType:       'policyType',
        mp_lob:              'lineOfBusiness',
        mp_carrier:          'company',
        mp_mga:              'mga',
        mp_policyNum:        'policyNumber',
        mp_binderNum:        'binderNumber',
        mp_down:             'down',
        mp_agencyFee:        'agencyFee',
        mp_basePremium:      'basePremium',
        mp_premium:          'totalPremium',
        mp_payMethod:        'paymentMethod',
        mp_payMethod2:       'paymentMethod2',
        mp_agencyCommission: 'agencyCommission',
        mp_agentCommission:  'agentCommissionShare',
        mp_payType:          'paymentType',
        mp_effDate:          'effectiveDate',
        mp_expDate:          'expirationDate',
        mp_policyStatus:     'policyStatus'
    };
    Object.entries(map).forEach(([elId, field]) => {
        const el = document.getElementById(elId);
        if (el) el.value = entry[field] || '';
    });

    // Load drivers and vehicles from the entry
    amsResetDriversVehicles(entry.drivers, entry.vehicles);

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

    const v = id => document.getElementById(id)?.value || '';
    const n = id => parseFloat(document.getElementById(id)?.value) || 0;

    const policyData = {
        agent,
        policyType,
        lineOfBusiness:       lob,
        company:              carrier,
        mga:                  v('mp_mga'),
        policyNumber:         v('mp_policyNum'),
        binderNumber:         v('mp_binderNum'),
        down:                 n('mp_down'),
        agencyFee:            n('mp_agencyFee'),
        basePremium:          n('mp_basePremium'),
        totalPremium:         n('mp_premium'),
        paymentMethod:        v('mp_payMethod'),
        paymentMethod2:       v('mp_payMethod2'),
        agencyCommission:     n('mp_agencyCommission') || Math.round(n('mp_premium') * 0.10 * 100) / 100,
        agentCommissionShare: n('mp_agentCommission'),
        paymentType:          v('mp_payType'),
        effectiveDate:        v('mp_effDate'),
        expirationDate:       v('mp_expDate'),
        policyStatus:         v('mp_policyStatus'),
        drivers:              amsCollectDriverRows(),
        vehicles:             amsCollectVehicleRows()
    };

    if (editId) {
        const idx = binder.findIndex(p => p.id === editId);
        if (idx !== -1) {
            binder[idx] = { ...binder[idx], ...policyData };
        }
    } else {
        const newId = Date.now();
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        binder.push({
            id:           newId,
            entryDate:    today,
            customerName: amsClientIndex[amsActiveKey]?.displayName || amsActiveKey,
            ...policyData
        });
    }

    amsSave('binderData', binder);

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

// ============================================================
// AMS — Drivers & Vehicles mini-sections (mirror of BinderBook)
// ============================================================

let _amsDriverRowCounter = 0;
let _amsVehicleRowCounter = 0;

function amsAddDriverRow(prefill) {
    const container = document.getElementById('amsDriversContainer');
    if (!container) return;
    _amsDriverRowCounter++;
    const div = document.createElement('div');
    div.className = 'ams-driver-row';
    div.style.cssText = 'background:#fff;border:1px solid #99f6e4;border-radius:8px;padding:10px 12px;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:8px;align-items:end;';
    div.innerHTML = `
        <div>
            <label style="font-size:11px;font-weight:700;color:#115e59;display:block;margin-bottom:3px;text-transform:uppercase;">First Name</label>
            <input type="text" class="amsdrv-firstName" placeholder="John" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#115e59;display:block;margin-bottom:3px;text-transform:uppercase;">Last Name</label>
            <input type="text" class="amsdrv-lastName" placeholder="Doe" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#115e59;display:block;margin-bottom:3px;text-transform:uppercase;">Date of Birth</label>
            <input type="date" class="amsdrv-dob" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#115e59;display:block;margin-bottom:3px;text-transform:uppercase;">DL #</label>
            <input type="text" class="amsdrv-dl" placeholder="License #" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <button type="button" onclick="this.closest('.ams-driver-row').remove(); amsUpdateDriversEmptyState();" title="Remove driver"
            style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;padding:7px 10px;cursor:pointer;font-weight:700;font-size:14px;height:32px;">✕</button>
    `;
    container.appendChild(div);
    if (prefill) {
        if (prefill.firstName) div.querySelector('.amsdrv-firstName').value = prefill.firstName;
        if (prefill.lastName)  div.querySelector('.amsdrv-lastName').value  = prefill.lastName;
        if (prefill.dob)       div.querySelector('.amsdrv-dob').value       = prefill.dob;
        if (prefill.dl)        div.querySelector('.amsdrv-dl').value        = prefill.dl;
    }
    amsUpdateDriversEmptyState();
}

function amsAddVehicleRow(prefill) {
    const container = document.getElementById('amsVehiclesContainer');
    if (!container) return;
    _amsVehicleRowCounter++;
    const div = document.createElement('div');
    div.className = 'ams-vehicle-row';
    div.style.cssText = 'background:#fff;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;margin-bottom:8px;display:grid;grid-template-columns:80px 1fr 1fr 1.6fr auto;gap:8px;align-items:end;';
    div.innerHTML = `
        <div>
            <label style="font-size:11px;font-weight:700;color:#9a3412;display:block;margin-bottom:3px;text-transform:uppercase;">Year</label>
            <input type="number" class="amsveh-year" min="1900" max="2099" placeholder="2024" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#9a3412;display:block;margin-bottom:3px;text-transform:uppercase;">Make</label>
            <input type="text" class="amsveh-make" placeholder="Toyota" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#9a3412;display:block;margin-bottom:3px;text-transform:uppercase;">Model</label>
            <input type="text" class="amsveh-model" placeholder="Camry" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#9a3412;display:block;margin-bottom:3px;text-transform:uppercase;">VIN</label>
            <input type="text" class="amsveh-vin" placeholder="17-character VIN" maxlength="17" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:monospace;text-transform:uppercase;box-sizing:border-box;">
        </div>
        <button type="button" onclick="this.closest('.ams-vehicle-row').remove(); amsUpdateVehiclesEmptyState();" title="Remove vehicle"
            style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;padding:7px 10px;cursor:pointer;font-weight:700;font-size:14px;height:32px;">✕</button>
    `;
    container.appendChild(div);
    if (prefill) {
        if (prefill.year)  div.querySelector('.amsveh-year').value  = prefill.year;
        if (prefill.make)  div.querySelector('.amsveh-make').value  = prefill.make;
        if (prefill.model) div.querySelector('.amsveh-model').value = prefill.model;
        if (prefill.vin)   div.querySelector('.amsveh-vin').value   = prefill.vin;
    }
    amsUpdateVehiclesEmptyState();
}

function amsCollectDriverRows() {
    const rows = document.querySelectorAll('#amsDriversContainer .ams-driver-row');
    const drivers = [];
    rows.forEach(r => {
        const driver = {
            firstName: r.querySelector('.amsdrv-firstName')?.value.trim() || '',
            lastName:  r.querySelector('.amsdrv-lastName')?.value.trim()  || '',
            dob:       r.querySelector('.amsdrv-dob')?.value              || '',
            dl:        r.querySelector('.amsdrv-dl')?.value.trim()        || ''
        };
        if (driver.firstName || driver.lastName || driver.dob || driver.dl) drivers.push(driver);
    });
    return drivers;
}

function amsCollectVehicleRows() {
    const rows = document.querySelectorAll('#amsVehiclesContainer .ams-vehicle-row');
    const vehicles = [];
    rows.forEach(r => {
        const vehicle = {
            year:  r.querySelector('.amsveh-year')?.value.trim()           || '',
            make:  r.querySelector('.amsveh-make')?.value.trim()           || '',
            model: r.querySelector('.amsveh-model')?.value.trim()          || '',
            vin:   r.querySelector('.amsveh-vin')?.value.trim().toUpperCase() || ''
        };
        if (vehicle.year || vehicle.make || vehicle.model || vehicle.vin) vehicles.push(vehicle);
    });
    return vehicles;
}

function amsResetDriversVehicles(prefilledDrivers, prefilledVehicles) {
    const dc = document.getElementById('amsDriversContainer');
    const vc = document.getElementById('amsVehiclesContainer');
    if (dc) dc.innerHTML = '';
    if (vc) vc.innerHTML = '';
    _amsDriverRowCounter = 0;
    _amsVehicleRowCounter = 0;

    // Only preload rows when editing an existing policy that already has them.
    // For a new policy, both sections stay empty — they're optional.
    if (Array.isArray(prefilledDrivers) && prefilledDrivers.length > 0) {
        prefilledDrivers.forEach(d => amsAddDriverRow(d));
    }
    if (Array.isArray(prefilledVehicles) && prefilledVehicles.length > 0) {
        prefilledVehicles.forEach(v => amsAddVehicleRow(v));
    }

    amsUpdateDriversEmptyState();
    amsUpdateVehiclesEmptyState();
}

// ── Policy Status Management ─────────────────────────────────
// Determine policy status based on dates and explicit status field
function amsGetPolicyStatus(policy) {
    // If explicit status is set, use it
    if (policy.policyStatus && ['Active', 'Pending Cancellation', 'Expired', 'Canceled'].includes(policy.policyStatus)) {
        return policy.policyStatus;
    }

    // Otherwise, infer from expiration date
    const expDate = policy.expirationDate;
    const today = new Date();
    
    if (!expDate) return 'Active'; // If no expiration date, assume active
    
    const exp = new Date(expDate + 'T23:59:59');
    
    if (today > exp) {
        return 'Expired';
    }
    return 'Active';
}

// Get text color for status badge
function amsGetStatusColor(status) {
    const colors = {
        'Active': '#047857',              // green
        'Pending Cancellation': '#ea580c', // orange
        'Expired': '#7c3aed',             // purple
        'Canceled': '#dc2626'             // red
    };
    return colors[status] || '#64748b';
}

// Get background color for status badge
function amsGetStatusBackground(status) {
    const backgrounds = {
        'Active': '#ecfdf5',              // light green
        'Pending Cancellation': '#fef3c7', // light orange
        'Expired': '#f5f3ff',             // light purple
        'Canceled': '#fef2f2'             // light red
    };
    return backgrounds[status] || '#f1f5f9';
}

// Open policy action menu
function amsOpenPolicyActionMenu(event, policyId) {
    event.stopPropagation();
    
    // Close any open menu
    const existing = document.getElementById('amsPolicyActionMenu');
    if (existing) existing.remove();
    
    const binder = amsGetBinderData();
    const policy = binder.find(p => p.id === policyId);
    if (!policy) return;
    
    const currentStatus = amsGetPolicyStatus(policy);
    
    // Create menu dropdown
    const menu = document.createElement('div');
    menu.id = 'amsPolicyActionMenu';
    menu.style.cssText = `
        position: fixed;
        background: white;
        border: 1px solid var(--gray-200);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        z-index: 1000;
        min-width: 200px;
    `;
    
    // Get button position
    const btn = event.target.closest('button');
    const rect = btn.getBoundingClientRect();
    menu.style.left = (rect.left + window.scrollX - 150) + 'px';
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    
    // Build menu items
    const statusOptions = ['Active', 'Pending Cancellation', 'Expired', 'Canceled'];
    
    let menuHTML = `<div style="padding:8px 0;">`;
    
    menuHTML += `<div style="padding:8px 12px;font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;">Change Status</div>`;
    
    statusOptions.forEach(status => {
        const isActive = currentStatus === status;
        const statusColor = amsGetStatusColor(status);
        const statusBg = amsGetStatusBackground(status);
        
        menuHTML += `
            <button onclick="amsChangePolicyStatus(${policyId}, '${status}')" style="
                width: 100%;
                padding: 8px 12px;
                border: none;
                background: ${isActive ? 'var(--blue-pale)' : 'transparent'};
                color: var(--navy);
                text-align: left;
                cursor: pointer;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: background .15s;
            " onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background='${isActive ? 'var(--blue-pale)' : 'transparent'}'">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};"></span>
                <span>${status}</span>
                ${isActive ? '<span style="margin-left:auto;font-weight:700;">✓</span>' : ''}
            </button>
        `;
    });
    
    menuHTML += `<div style="border-top:1px solid var(--gray-200);margin:4px 0;"></div>`;
    menuHTML += `<button onclick="amsEditPolicy(${policyId});document.getElementById('amsPolicyActionMenu').remove();" style="
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: var(--navy);
        text-align: left;
        cursor: pointer;
        font-size: 13px;
        transition: background .15s;
    " onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background='transparent'">
        <i data-lucide="pencil" style="width:14px;height:14px;display:inline;margin-right:6px;"></i> Edit Policy
    </button>`;
    
    menuHTML += `<button onclick="amsDeletePolicy(${policyId});document.getElementById('amsPolicyActionMenu').remove();" style="
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: var(--red);
        text-align: left;
        cursor: pointer;
        font-size: 13px;
        transition: background .15s;
    " onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='transparent'">
        <i data-lucide="trash-2" style="width:14px;height:14px;display:inline;margin-right:6px;"></i> Delete Policy
    </button>`;
    
    menuHTML += `</div>`;
    menu.innerHTML = menuHTML;
    document.body.appendChild(menu);
    lucide.createIcons();
    
    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target) && !e.target.closest('button[onclick*="amsOpenPolicyActionMenu"]')) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 50);
}

// Change policy status
function amsChangePolicyStatus(policyId, newStatus) {
    const binder = amsGetBinderData();
    const idx = binder.findIndex(p => p.id === policyId);
    
    if (idx !== -1) {
        binder[idx].policyStatus = newStatus;
        amsSave('binderData', binder);
        
        // Close menu and refresh
        const menu = document.getElementById('amsPolicyActionMenu');
        if (menu) menu.remove();
        
        amsBuildClientIndex();
        amsRenderPolicies(amsActiveKey);
        amsFlashBanner(`Status changed to "${newStatus}" ✓`);
    }
}

// Delete policy
function amsDeletePolicy(policyId) {
    if (!confirm('Are you sure you want to delete this policy? This action cannot be undone.')) return;
    
    const binder = amsGetBinderData();
    const filtered = binder.filter(p => p.id !== policyId);
    amsSave('binderData', filtered);
    
    amsBuildClientIndex();
    amsRenderPolicies(amsActiveKey);
    amsFlashBanner('Policy deleted ✓');
}

function amsUpdateDriversEmptyState() {
    const dc = document.getElementById('amsDriversContainer');
    const ds = document.getElementById('amsDriversEmptyState');
    if (!dc || !ds) return;
    ds.style.display = dc.children.length === 0 ? 'block' : 'none';
}

function amsUpdateVehiclesEmptyState() {
    const vc = document.getElementById('amsVehiclesContainer');
    const vs = document.getElementById('amsVehiclesEmptyState');
    if (!vc || !vs) return;
    vs.style.display = vc.children.length === 0 ? 'block' : 'none';
}

// ══════════════════════════════════════════════════════════════
// ACORD FORMS MODULE
// ══════════════════════════════════════════════════════════════

const ACORD_FORMS = [
    // Applications
    { id:'acord125', num:'ACORD 125', name:'Commercial Insurance Application', cat:'app', catLabel:'Application', icon:'📋',
      sections:['a125_agency','a125_status','a125_applicant','a125_premises','a125_natureOfBiz','a125_generalInfo125','a125_remarksProcessing','signature','a125_priorCarrierInfo','a125_glLimits','a125_autoLimits','a125_propLimits','a125_otherLine','a125_lossHist'] },
    { id:'acord126', num:'ACORD 126', name:'Commercial General Liability Section', cat:'commercial', catLabel:'Commercial', icon:'🏢',
      sections:['applicant','glInfo','premises','classification','coverage','remarks'] },
    { id:'acord127', num:'ACORD 127', name:'Business Auto Section', cat:'auto', catLabel:'Auto', icon:'🚛',
      sections:['applicant','vehicles','drivers','coverage','remarks'] },
    { id:'acord130', num:'ACORD 130', name:'Workers Compensation Application', cat:'commercial', catLabel:'Commercial', icon:'👷',
      sections:['applicant','business','classification','coverage','remarks','signature'] },
    { id:'acord131', num:'ACORD 131', name:'Umbrella / Excess Liability', cat:'commercial', catLabel:'Commercial', icon:'☂️',
      sections:['applicant','underlying','coverage','remarks'] },
    { id:'acord140', num:'ACORD 140', name:'Property Section', cat:'commercial', catLabel:'Commercial', icon:'🏗️',
      sections:['applicant','building','valuation','coverage','remarks'] },

    // Personal Lines
    { id:'acord80', num:'ACORD 80', name:'Homeowners Application', cat:'home', catLabel:'Homeowners', icon:'🏠',
      sections:['applicant','property','construction','coverage','mortgagee','remarks','signature'] },
    { id:'acord90', num:'ACORD 90', name:'Personal Auto Application', cat:'auto', catLabel:'Auto', icon:'🚗',
      sections:['applicant','vehicles','drivers','coverage','violations','remarks','signature'] },
    { id:'acord95', num:'ACORD 95', name:'Personal Auto Supplement', cat:'auto', catLabel:'Auto', icon:'🚗',
      sections:['applicant','vehicles','drivers','additionalInfo'] },

    // Certificates
    { id:'acord25', num:'ACORD 25', name:'Certificate of Liability Insurance', cat:'cert', catLabel:'Certificate', icon:'📜',
      sections:['producer','insured','insurers','coverages','certificateHolder','remarks'] },
    { id:'acord27', num:'ACORD 27', name:'Evidence of Property Insurance', cat:'cert', catLabel:'Certificate', icon:'📜',
      sections:['producer','insured','company','property','coverage','mortgagee'] },
    { id:'acord28', num:'ACORD 28', name:'Evidence of Commercial Property Insurance', cat:'cert', catLabel:'Certificate', icon:'📜',
      sections:['producer','insured','company','property','coverage','additionalInterest'] },

    // Claims
    { id:'acord1', num:'ACORD 1', name:'Property Loss Notice', cat:'claims', catLabel:'Claims', icon:'⚠️',
      sections:['insured','policy','lossInfo','propertyDamage','remarks'] },
    { id:'acord2', num:'ACORD 2', name:'Automobile Loss Notice', cat:'claims', catLabel:'Claims', icon:'💥',
      sections:['insured','policy','lossInfo','vehicleInfo','injuries','remarks'] },
    { id:'acord3', num:'ACORD 3', name:'General Liability Loss Notice', cat:'claims', catLabel:'Claims', icon:'⚠️',
      sections:['insured','policy','lossInfo','injuredParty','remarks'] },
    { id:'acord4', num:'ACORD 4', name:'Workers Compensation - First Report', cat:'claims', catLabel:'Claims', icon:'🏥',
      sections:['employer','employee','injuryInfo','treatment','remarks'] },

    // General / Agency
    { id:'acord35', num:'ACORD 35', name:'Agency - Company Agreement', cat:'general', catLabel:'General', icon:'🤝',
      sections:['agency','company','terms','signature'] },
    { id:'acord36', num:'ACORD 36', name:'Agent Statement / Inspection Report', cat:'general', catLabel:'General', icon:'🔍',
      sections:['applicant','propertyInfo','observations','recommendations','signature'] },
    { id:'acord37', num:'ACORD 37', name:'Request for Cancellation', cat:'general', catLabel:'General', icon:'❌',
      sections:['insured','policy','cancellationInfo','remarks','signature'] },
    { id:'acord38', num:'ACORD 38', name:'Request for Policy Change / Endorsement', cat:'general', catLabel:'General', icon:'✏️',
      sections:['insured','policy','changeDescription','remarks','signature'] },

    // Inland Marine / Specialty
    { id:'acord75', num:'ACORD 75', name:'Insurance Binder', cat:'general', catLabel:'General', icon:'📎',
      sections:['producer','insured','company','binderInfo','coverage','remarks'] },
    { id:'acord160', num:'ACORD 160', name:'Inland Marine Application', cat:'commercial', catLabel:'Commercial', icon:'🚢',
      sections:['applicant','propertyDescription','valuation','coverage','remarks'] },
    { id:'acord163', num:'ACORD 163', name:'Contractors Equipment', cat:'commercial', catLabel:'Commercial', icon:'🔧',
      sections:['applicant','equipmentSchedule','coverage','remarks'] },

    // Auto Supplements
    { id:'acord91', num:'ACORD 91', name:'Personal Auto - FL PIP', cat:'auto', catLabel:'Auto', icon:'🚗',
      sections:['applicant','pipElection','householdMembers','signature'] },
    { id:'acord92', num:'ACORD 92', name:'Personal Watercraft Application', cat:'auto', catLabel:'Auto', icon:'🚤',
      sections:['applicant','watercraft','operators','coverage','remarks','signature'] },

    // Life & Health
    { id:'acord161', num:'ACORD 161', name:'Life Insurance Application', cat:'life', catLabel:'Life/Health', icon:'❤️',
      sections:['applicant','beneficiary','healthInfo','coverage','signature'] },
    { id:'acord162', num:'ACORD 162', name:'Health Insurance Application', cat:'life', catLabel:'Life/Health', icon:'🏥',
      sections:['applicant','dependents','healthHistory','coverage','signature'] },

    // ── Additional ACORD Forms (from NowCerts) ──

    // ACORD 11 - Auto Accident Information
    { id:'acord11', num:'ACORD 11', name:'Auto Accident Information Form', cat:'claims', catLabel:'Claims', icon:'🚗',
      sections:['acc_insured','acc_otherParty','acc_vehicleA','acc_vehicleB','acc_scene','acc_witnesses','acc_police','acc_injuries','acc_diagram','remarks'] },

    // ACORD 12 - Exchange of Information
    { id:'acord12', num:'ACORD 12', name:'Exchange of Information Form', cat:'claims', catLabel:'Claims', icon:'🔄',
      sections:['exch_yourInfo','exch_otherParty','exch_accident','exch_witnesses','remarks'] },

    // ACORD 13 - Witness Card
    { id:'acord13', num:'ACORD 13', name:'Witness Card', cat:'claims', catLabel:'Claims', icon:'👁️',
      sections:['witness_info','witness_accident','witness_statement'] },

    // ACORD 24 - Certificate of Property Insurance
    { id:'acord24', num:'ACORD 24', name:'Certificate of Property Insurance', cat:'cert', catLabel:'Certificate', icon:'📜',
      sections:['producer','insured','cert24_company','cert24_property','cert24_coverage','cert24_lossPayee','cert24_mortgagee','remarks'] },

    // ACORD 45 - Commercial Insurance Application Supplement
    { id:'acord45', num:'ACORD 45', name:'Commercial Insurance Application Supplement', cat:'app', catLabel:'Application', icon:'📋',
      sections:['applicant','acord45_nature','acord45_premises','acord45_employees','acord45_subcontractors','acord45_loss','remarks'] },

    // ACORD 50 - Home Daycare Supplement
    { id:'acord50', num:'ACORD 50', name:'Home Daycare Insurance Supplement', cat:'home', catLabel:'Homeowners', icon:'👶',
      sections:['applicant','acord50_daycare','acord50_employees','acord50_safety','remarks','signature'] },

    // ACORD 83 FL - Florida Personal Umbrella
    { id:'acord83fl', num:'ACORD 83 FL', name:'Florida Personal Umbrella Application', cat:'auto', catLabel:'Auto', icon:'☂️',
      sections:['applicant','acord83_underlying_auto','acord83_underlying_home','acord83_underlying_watercraft','acord83_limits','acord83_drivers','acord83_residences','acord83_claims','remarks','signature'] },

    // ACORD 101 - Additional Remarks Schedule
    { id:'acord101', num:'ACORD 101', name:'Additional Remarks Schedule', cat:'general', catLabel:'General', icon:'📝',
      sections:['acord101_ref','acord101_remarks'] },

    // ACORD 103 - Personal Auto Additional Resident/Driver
    { id:'acord103', num:'ACORD 103', name:'Personal Auto - Additional Resident & Driver Info', cat:'auto', catLabel:'Auto', icon:'🚗',
      sections:['applicant','acord103_resident1','acord103_resident2','acord103_resident3','acord103_driver_detail1','acord103_driver_detail2'] },

    // ACORD 105 - Apartment Building Supplement
    { id:'acord105', num:'ACORD 105', name:'Apartment Building Supplement', cat:'commercial', catLabel:'Commercial', icon:'🏢',
      sections:['applicant','acord105_building','acord105_units','acord105_safety','acord105_maintenance','remarks'] },

    // ACORD 125 FL - Florida Commercial App
    { id:'acord125fl', num:'ACORD 125 FL', name:'Florida Commercial Insurance Application', cat:'app', catLabel:'Application', icon:'📋',
      sections:['applicant','business','acord125_contact','acord125_premises_p1','acord125_premises_p2','acord125_priorCarrier','acord125_lossHistory','acord125_generalInfo','remarks','signature'] },

    // ACORD 125-126-140 Combined
    { id:'acord125combo', num:'ACORD 125-126-140', name:'Combined Commercial App / GL / Property', cat:'app', catLabel:'Application', icon:'📦',
      sections:['applicant','business','acord125_contact','acord125_premises_p1','acord125_priorCarrier','acord125_lossHistory','glInfo','classification','premises','building','valuation','coverage','remarks','signature'] },

    // ACORD 128 - Garage and Dealers Section
    { id:'acord128', num:'ACORD 128', name:'Garage and Dealers Section', cat:'commercial', catLabel:'Commercial', icon:'🔧',
      sections:['applicant','acord128_operations','acord128_premises','acord128_coverage','acord128_employees','acord128_sublet','remarks'] },

    // ACORD 129 - Vehicle Schedule
    { id:'acord129', num:'ACORD 129', name:'Vehicle Schedule', cat:'auto', catLabel:'Auto', icon:'📋',
      sections:['applicant','acord129_veh1','acord129_veh2','acord129_veh3','acord129_veh4','acord129_veh5'] },

    // ACORD 130 FL - Florida Workers Comp
    { id:'acord130fl', num:'ACORD 130 FL', name:'Florida Workers Compensation Application', cat:'commercial', catLabel:'Commercial', icon:'👷',
      sections:['applicant','business','acord130_ownership','acord130_ratingInfo','acord130_class1','acord130_class2','acord130_class3','acord130_priorCarrier','acord130_lossHistory','acord130_stateInfo_fl','acord130_officers','acord130_subcontractors','acord130_safetyProgram','remarks','signature'] },

    // ACORD 130 - Workers Comp Additional Locations (Page 2)
    { id:'acord130p2', num:'ACORD 130 P2', name:'Workers Compensation - Additional Locations', cat:'commercial', catLabel:'Commercial', icon:'👷',
      sections:['applicant','acord130_addloc1','acord130_addloc2','acord130_addloc3','acord130_addlClass1','acord130_addlClass2'] },

    // ACORD 140 - Property Additional Locations
    { id:'acord140addl', num:'ACORD 140 Addl', name:'Property Section - Additional Locations', cat:'commercial', catLabel:'Commercial', icon:'🏗️',
      sections:['applicant','acord140_loc2','acord140_loc3','acord140_loc2_building','acord140_loc3_building','acord140_addl_coverage'] },

    // ACORD 175 - Commercial Lines
    { id:'acord175', num:'ACORD 175', name:'Commercial Lines Policy Checklist', cat:'commercial', catLabel:'Commercial', icon:'✅',
      sections:['insured','policy','acord175_checklist','acord175_endorsements','remarks'] },

    // ACORD 211 - Professional Liability
    { id:'acord211', num:'ACORD 211', name:'Professional Liability Application', cat:'commercial', catLabel:'Commercial', icon:'⚖️',
      sections:['applicant','business','acord211_profInfo','acord211_claims','acord211_coverage','remarks','signature'] },

    // ACORD 501 - Surety Report of Execution
    { id:'acord501', num:'ACORD 501', name:'Surety Report of Execution', cat:'commercial', catLabel:'Commercial', icon:'📎',
      sections:['acord501_principal','acord501_surety','acord501_bond','acord501_execution','signature'] },

    // ACORD 610 - Premium Payment Supplement
    { id:'acord610', num:'ACORD 610', name:'Premium Payment Supplement', cat:'general', catLabel:'General', icon:'💳',
      sections:['insured','policy','acord610_payment','acord610_installments','acord610_financeCompany'] },

    // ACORD 807 - Directors & Officers
    { id:'acord807', num:'ACORD 807', name:'Directors & Officers Liability Section', cat:'commercial', catLabel:'Commercial', icon:'👔',
      sections:['applicant','acord807_orgInfo','acord807_directors','acord807_claims','acord807_coverage','remarks','signature'] },

    // ACORD 810 - Business Income / Extra Expense
    { id:'acord810', num:'ACORD 810', name:'Business Income / Extra Expense / Rental Value Supplement', cat:'commercial', catLabel:'Commercial', icon:'💰',
      sections:['applicant','policy','acord810_income','acord810_expenses','acord810_rental','acord810_coverage'] },

    // ACORD 811 - Value Reporting
    { id:'acord811', num:'ACORD 811', name:'Value Reporting Information Supplement', cat:'commercial', catLabel:'Commercial', icon:'📊',
      sections:['applicant','policy','acord811_loc1','acord811_loc2','acord811_values','remarks'] },

    // ACORD 819 - Producer Appointment
    { id:'acord819', num:'ACORD 819', name:'P&C Producer Appointment Form', cat:'general', catLabel:'General', icon:'🤝',
      sections:['acord819_producer','acord819_company','acord819_appointment','acord819_linesAuth','signature'] },

    // ACORD 823 - Misc Professional Liability
    { id:'acord823', num:'ACORD 823', name:'Miscellaneous Professional Liability Section', cat:'commercial', catLabel:'Commercial', icon:'⚖️',
      sections:['applicant','acord823_profInfo','acord823_services','acord823_claims','acord823_coverage','remarks','signature'] },

    // ── Custom / Carrier-Specific Forms ──

    // Cancellation Letter to Prior Policy
    { id:'cancelLetter', num:'Cancel Letter', name:'Cancellation Letter to Prior Policy', cat:'general', catLabel:'General', icon:'✉️',
      sections:['insured','policy','cancelLetter_details','signature'] },

    // Commercial Auto & Cargo Application
    { id:'cargoApp', num:'Cargo App', name:'Commercial Auto & Cargo Application', cat:'auto', catLabel:'Auto', icon:'🚛',
      sections:['applicant','business','cargo_operations','cargo_vehicles','cargo_drivers','cargo_commodities','cargo_coverage','cargo_lossHistory','remarks','signature'] },

    // Safepoint Restaurant Supplemental
    { id:'safepointRest', num:'Safepoint Rest', name:'Safepoint - Restaurant Supplemental App', cat:'commercial', catLabel:'Commercial', icon:'🍽️',
      sections:['applicant','sp_restaurant','sp_operations','sp_safety','sp_coverage','remarks'] },

    // Colony Specialty Property Questionnaire
    { id:'colonyProp', num:'Colony Prop Q', name:'Colony Specialty - Property Questionnaire', cat:'commercial', catLabel:'Commercial', icon:'🏗️',
      sections:['applicant','colony_property','colony_construction','colony_protection','colony_occupancy','colony_loss','remarks'] },

    // Align General Contractors & Consultants
    { id:'alignGeneral', num:'Align General', name:'Align General - Contractors & Consultants App', cat:'commercial', catLabel:'Commercial', icon:'🔨',
      sections:['applicant','business','align_operations','align_subcontractors','align_coverage','align_lossHistory','remarks','signature'] },

    // ENCORE New Client Enrollment
    { id:'encoreNew', num:'ENCORE New', name:'ENCORE New Client Enrollment', cat:'general', catLabel:'General', icon:'📋',
      sections:['applicant','encore_account','encore_billing','encore_policies','remarks'] },
];

const ACORD_FORM_SECTIONS = {
    applicant: { title:'Applicant / Named Insured', fields:[
        {id:'appName',label:'Full Name',type:'text',map:'name'},
        {id:'appDBA',label:'DBA / Trade Name',type:'text'},
        {id:'appMailAddr',label:'Mailing Address',type:'text',map:'address'},
        {id:'appCity',label:'City',type:'text',map:'city'},
        {id:'appState',label:'State',type:'text',map:'state'},
        {id:'appZip',label:'Zip Code',type:'text',map:'zip'},
        {id:'appPhone',label:'Phone',type:'tel',map:'phone1'},
        {id:'appEmail',label:'Email',type:'email',map:'email'},
        {id:'appDOB',label:'Date of Birth',type:'date',map:'dob'},
        {id:'appSSN4',label:'SSN (last 4)',type:'text',map:'ssn4'},
        {id:'appGender',label:'Gender',type:'select',opts:['','Male','Female','Non-binary'],map:'gender'},
        {id:'appMarital',label:'Marital Status',type:'select',opts:['','Single','Married','Divorced','Widowed'],map:'marital'},
        {id:'appFEIN',label:'FEIN',type:'text'},
        {id:'appSIC',label:'SIC Code',type:'text'},
        {id:'appNAICS',label:'NAICS Code',type:'text'},
        {id:'appEntityType',label:'Entity Type',type:'select',opts:['','Individual','Corporation','Partnership','LLC','Joint Venture','Trust','Non-Profit']},
        {id:'appStateIncorp',label:'State of Incorporation',type:'text'},
        {id:'appBizStartDate',label:'Date Business Started',type:'date'},
        {id:'appNatureBiz',label:'Nature of Business',type:'text'},
        {id:'appGrossRevenue',label:'Annual Gross Revenue/Receipts',type:'number'},
        {id:'appInspContact',label:'Contact Person for Inspection',type:'text'},
        {id:'appInspPhone',label:'Contact Phone for Inspection',type:'tel'},
    ]},
    insured: { title:'Insured Information', fields:[
        {id:'insName',label:'Insured Name',type:'text',map:'name'},
        {id:'insAddr',label:'Address',type:'text',map:'address'},
        {id:'insCity',label:'City',type:'text',map:'city'},
        {id:'insState',label:'State',type:'text',map:'state'},
        {id:'insZip',label:'Zip',type:'text',map:'zip'},
        {id:'insPhone',label:'Phone',type:'tel',map:'phone1'},
        {id:'insEmail',label:'Email',type:'email',map:'email'},
    ]},
    producer: { title:'Producer / Agency Information', fields:[
        {id:'prodAgency',label:'Agency Name',type:'text',defaultVal:'Universal Insurance Brokers'},
        {id:'prodContact',label:'Contact Name',type:'text'},
        {id:'prodPhone',label:'Phone',type:'tel'},
        {id:'prodEmail',label:'Email',type:'email',defaultVal:'admin@universalinsurancebroker.com'},
        {id:'prodAddr',label:'Address',type:'text'},
        {id:'prodCity',label:'City',type:'text'},
        {id:'prodState',label:'State',type:'text',defaultVal:'FL'},
        {id:'prodZip',label:'Zip',type:'text'},
        {id:'prodCode',label:'Producer Code',type:'text',defaultVal:'24258'},
    ]},
    policy: { title:'Policy Information', fields:[
        {id:'polNumber',label:'Policy Number',type:'text',map:'policyNumber'},
        {id:'polEffDate',label:'Effective Date',type:'date',map:'effDate'},
        {id:'polExpDate',label:'Expiration Date',type:'date',map:'expirationDate'},
        {id:'polCarrier',label:'Insurance Company',type:'text',map:'company'},
        {id:'polLOB',label:'Line of Business',type:'text',map:'lineOfBusiness'},
        {id:'polPremium',label:'Premium',type:'number',map:'premium'},
    ]},
    business: { title:'Business / Operations', fields:[
        {id:'bizType',label:'Type of Business',type:'text'},
        {id:'bizDesc',label:'Description of Operations',type:'textarea'},
        {id:'bizSIC',label:'SIC Code',type:'text'},
        {id:'bizNAICS',label:'NAICS Code',type:'text'},
        {id:'bizYrsOp',label:'Years in Business',type:'number'},
        {id:'bizFEIN',label:'FEIN',type:'text'},
        {id:'bizNumEmp',label:'Number of Employees',type:'number'},
        {id:'bizAnnualRev',label:'Annual Revenue',type:'number'},
        {id:'bizOpsDetail',label:'Description of Operations (detailed)',type:'textarea'},
        {id:'bizPriorAddr',label:'Prior Address (if less than 3 years)',type:'text'},
        {id:'bizSubsidiaries',label:'Any Subsidiaries?',type:'select',opts:['','Yes','No']},
        {id:'bizSubNames',label:'Subsidiary Names',type:'text'},
        {id:'bizPriorCancel',label:'Prior Insurance Cancelled/Declined?',type:'select',opts:['','Yes','No']},
        {id:'bizPriorCancelDetail',label:'Details of Cancellation/Decline',type:'textarea'},
        {id:'bizLosses5yr',label:'Any Losses Last 5 Years?',type:'select',opts:['','Yes','No']},
    ]},
    vehicles: { title:'Vehicle Information', fields:[
        {id:'veh1Year',label:'Year',type:'text'},
        {id:'veh1Make',label:'Make',type:'text'},
        {id:'veh1Model',label:'Model',type:'text'},
        {id:'veh1VIN',label:'VIN',type:'text'},
        {id:'veh1Use',label:'Use (Pleasure/Commute/Business)',type:'select',opts:['','Pleasure','Commute','Business','Farm']},
        {id:'veh1Annual',label:'Annual Miles',type:'number'},
        {id:'veh1Garage',label:'Garaging Zip',type:'text',map:'zip'},
        {id:'veh1Body',label:'Body Type',type:'text'},
        {id:'veh1GVW',label:'GVW/GCW',type:'text'},
        {id:'veh1CostNew',label:'Cost New',type:'number'},
        {id:'veh1AgeGroup',label:'Age Group',type:'text'},
        {id:'veh1Radius',label:'Radius of Operations',type:'select',opts:['','Local','Intermediate','Long Distance']},
        {id:'veh1FarthestTerm',label:'Farthest Terminal',type:'text'},
        {id:'veh1Fleet',label:'Fleet?',type:'select',opts:['','Yes','No']},
        {id:'veh1Hired',label:'Hired Autos?',type:'select',opts:['','Yes','No']},
        {id:'veh1NonOwned',label:'Non-Owned Autos?',type:'select',opts:['','Yes','No']},
        {id:'veh1Territory',label:'Territory/State',type:'text'},
        {id:'veh1CompDed',label:'Comp Deductible',type:'text'},
        {id:'veh1CollDed',label:'Collision Deductible',type:'text'},
        {id:'veh1StatedAmt',label:'Stated Amount',type:'number'},
    ]},
    drivers: { title:'Driver Information', fields:[
        {id:'drv1Name',label:'Driver Name',type:'text',map:'name'},
        {id:'drv1DOB',label:'Date of Birth',type:'date',map:'dob'},
        {id:'drv1Gender',label:'Gender',type:'select',opts:['','Male','Female','Non-binary'],map:'gender'},
        {id:'drv1Marital',label:'Marital Status',type:'select',opts:['','Single','Married','Divorced','Widowed'],map:'marital'},
        {id:'drv1DL',label:'License Number',type:'text',map:'dlNum'},
        {id:'drv1DLState',label:'License State',type:'text',map:'dlState'},
        {id:'drv1DLExp',label:'License Exp. Date',type:'date',map:'dlExp'},
        {id:'drv1Relation',label:'Relationship to Named Insured',type:'select',opts:['','Self','Spouse','Child','Other']},
        {id:'drv1YrsLicensed',label:'Years Licensed',type:'number'},
        {id:'drv1Accidents3yr',label:'Accidents Last 3 Years',type:'number'},
        {id:'drv1Violations3yr',label:'Violations Last 3 Years',type:'number'},
        {id:'drv1CDL',label:'CDL?',type:'select',opts:['','Yes','No']},
        {id:'drv1CDLClass',label:'CDL Class',type:'select',opts:['','A','B','C']},
        {id:'drv1ExpYrs',label:'Experience (years)',type:'number'},
        {id:'drv1SR22',label:'SR-22 Required?',type:'select',opts:['','Yes','No']},
        {id:'drv1PctUse',label:'% of Use',type:'number'},
    ]},
    coverage: { title:'Coverage / Limits', fields:[
        {id:'covBI',label:'Bodily Injury Limits',type:'text'},
        {id:'covPD',label:'Property Damage Limit',type:'text'},
        {id:'covMed',label:'Medical Payments',type:'text'},
        {id:'covUM',label:'Uninsured Motorist',type:'text'},
        {id:'covComp',label:'Comprehensive Deductible',type:'text'},
        {id:'covColl',label:'Collision Deductible',type:'text'},
        {id:'covPIP',label:'PIP',type:'text'},
        {id:'covRental',label:'Rental Reimbursement',type:'text'},
        {id:'covTow',label:'Towing / Roadside',type:'text'},
        {id:'covPIPElection',label:'FL PIP Election',type:'select',opts:['','Full','Limited']},
        {id:'covPIPDeduct',label:'PIP Deductible',type:'select',opts:['','$0','$250','$500','$1,000']},
        {id:'covStacking',label:'Stacking',type:'select',opts:['','Yes','No']},
        {id:'covDeathDisability',label:'Death/Disability',type:'text'},
        {id:'covMedPay',label:'Medical Payments Limit',type:'text'},
        {id:'covRentalLimit',label:'Rental Reimbursement Limit',type:'text'},
        {id:'covTowLimit',label:'Towing Limit',type:'text'},
    ]},
    coverages: { title:'Coverages', fields:[
        {id:'cglOcc',label:'CGL Each Occurrence',type:'text'},
        {id:'cglAgg',label:'General Aggregate',type:'text'},
        {id:'cglProdOps',label:'Products/Completed Ops',type:'text'},
        {id:'cglPersAdv',label:'Personal & Advertising Injury',type:'text'},
        {id:'cglDmgRent',label:'Damage to Rented Premises',type:'text'},
        {id:'cglMedExp',label:'Medical Expense',type:'text'},
        {id:'autoCSL',label:'Auto Combined Single Limit',type:'text'},
        {id:'umbLimit',label:'Umbrella / Excess Limit',type:'text'},
        {id:'wcStatLimits',label:'WC Statutory Limits',type:'text'},
        {id:'wcEL',label:'Employers Liability',type:'text'},
        {id:'covGLPolNum',label:'GL Policy Number',type:'text'},
        {id:'covGLPolEff',label:'GL Policy Effective Date',type:'date'},
        {id:'covGLPolExp',label:'GL Policy Expiration Date',type:'date'},
        {id:'covAutoPolNum',label:'Auto Policy Number',type:'text'},
        {id:'covAutoPolEff',label:'Auto Policy Effective Date',type:'date'},
        {id:'covAutoPolExp',label:'Auto Policy Expiration Date',type:'date'},
        {id:'covUmbPolNum',label:'Umbrella Policy Number',type:'text'},
        {id:'covUmbPolEff',label:'Umbrella Policy Effective Date',type:'date'},
        {id:'covUmbPolExp',label:'Umbrella Policy Expiration Date',type:'date'},
        {id:'covWCPolNum',label:'WC Policy Number',type:'text'},
        {id:'covWCPolEff',label:'WC Policy Effective Date',type:'date'},
        {id:'covWCPolExp',label:'WC Policy Expiration Date',type:'date'},
        {id:'covOtherPolNum',label:'Other Policy Number',type:'text'},
        {id:'covOtherPolEff',label:'Other Policy Effective Date',type:'date'},
        {id:'covOtherPolExp',label:'Other Policy Expiration Date',type:'date'},
        {id:'covAddlInsGL',label:'Additional Insured (GL)?',type:'select',opts:['','Y','N']},
        {id:'covAddlInsAuto',label:'Additional Insured (Auto)?',type:'select',opts:['','Y','N']},
        {id:'covAddlInsUmb',label:'Additional Insured (Umbrella)?',type:'select',opts:['','Y','N']},
        {id:'covWaiverSubGL',label:'Waiver of Subrogation (GL)?',type:'select',opts:['','Y','N']},
        {id:'covWaiverSubAuto',label:'Waiver of Subrogation (Auto)?',type:'select',opts:['','Y','N']},
        {id:'covWaiverSubWC',label:'Waiver of Subrogation (WC)?',type:'select',opts:['','Y','N']},
        {id:'covPrimaryNonContrib',label:'Primary/Non-Contributory?',type:'select',opts:['','Yes','No']},
        {id:'covDescOps',label:'Description of Operations / Locations / Vehicles',type:'textarea'},
    ]},
    property: { title:'Property Information', fields:[
        {id:'propAddr',label:'Property Address',type:'text',map:'address'},
        {id:'propCity',label:'City',type:'text',map:'city'},
        {id:'propState',label:'State',type:'text',map:'state'},
        {id:'propZip',label:'Zip',type:'text',map:'zip'},
        {id:'propYrBuilt',label:'Year Built',type:'text'},
        {id:'propSqFt',label:'Square Footage',type:'number'},
        {id:'propStories',label:'Number of Stories',type:'number'},
        {id:'propOccupancy',label:'Occupancy Type',type:'select',opts:['','Owner-Occupied','Tenant','Vacant','Under Construction']},
        {id:'propValue',label:'Dwelling Value / Replacement Cost',type:'number'},
        {id:'propResType',label:'Type of Residence',type:'select',opts:['','Single Family','Condo','Townhouse','Rowhouse','Duplex','Mobile Home']},
        {id:'propNumFamilies',label:'Number of Families',type:'number'},
        {id:'propNumUnits',label:'Number of Units',type:'number'},
        {id:'propUsage',label:'Usage',type:'select',opts:['','Primary','Secondary','Seasonal','Rental','Vacant']},
        {id:'propDistFireStn',label:'Distance to Fire Station (miles)',type:'text'},
        {id:'propDistHydrant',label:'Distance to Fire Hydrant (ft)',type:'text'},
        {id:'propProtClass',label:'Protection Class',type:'text'},
        {id:'propPool',label:'Swimming Pool?',type:'select',opts:['','Yes','No']},
        {id:'propPoolFenced',label:'Pool Fenced?',type:'select',opts:['','Yes','No']},
        {id:'propTrampoline',label:'Trampoline?',type:'select',opts:['','Yes','No']},
        {id:'propDogs',label:'Dogs?',type:'select',opts:['','Yes','No']},
        {id:'propDogBreed',label:'Dog Breed',type:'text'},
        {id:'propBizOnPrem',label:'Business on Premises?',type:'select',opts:['','Yes','No']},
        {id:'propFarming',label:'Farming?',type:'select',opts:['','Yes','No']},
        {id:'propPriorCarrier',label:'Prior Insurance Carrier',type:'text'},
        {id:'propPriorPolNum',label:'Prior Policy Number',type:'text'},
        {id:'propPriorPremium',label:'Prior Premium',type:'number'},
        {id:'propYrsWithPrior',label:'Years with Prior Carrier',type:'number'},
        {id:'propLosses5yr',label:'Any Losses Last 5 Years?',type:'select',opts:['','Yes','No']},
    ]},
    construction: { title:'Construction Details', fields:[
        {id:'constType',label:'Construction Type',type:'select',opts:['','Frame','Masonry','Steel','Concrete','Other']},
        {id:'constRoof',label:'Roof Type',type:'select',opts:['','Shingle','Tile','Metal','Flat','Other']},
        {id:'constRoofAge',label:'Roof Age (years)',type:'number'},
        {id:'constElectrical',label:'Electrical Updated',type:'select',opts:['','Yes','No','Unknown']},
        {id:'constPlumbing',label:'Plumbing Updated',type:'select',opts:['','Yes','No','Unknown']},
        {id:'constHVAC',label:'HVAC Updated',type:'select',opts:['','Yes','No','Unknown']},
        {id:'constProtection',label:'Protection Class',type:'text'},
        {id:'constFoundation',label:'Foundation Type',type:'select',opts:['','Slab','Crawl Space','Basement','Pier']},
        {id:'constExtWalls',label:'Exterior Walls',type:'select',opts:['','Brick','Vinyl','Wood','Stucco','HardiPlank','Other']},
        {id:'constFireplaces',label:'Number of Fireplaces',type:'number'},
        {id:'constHeating',label:'Heating Type',type:'select',opts:['','Central','Heat Pump','Baseboard','Other']},
        {id:'constCentralAir',label:'Central Air?',type:'select',opts:['','Yes','No']},
        {id:'constWaterHeater',label:'Water Heater Type',type:'text'},
        {id:'constElecPanel',label:'Electrical Panel Type',type:'select',opts:['','Circuit Breaker','Fuse']},
        {id:'constAmperage',label:'Amperage',type:'select',opts:['','100','150','200','Other']},
        {id:'constSmokeDetect',label:'Smoke Detectors?',type:'select',opts:['','Yes','No']},
        {id:'constFireExt',label:'Fire Extinguisher?',type:'select',opts:['','Yes','No']},
        {id:'constDeadbolts',label:'Deadbolts?',type:'select',opts:['','Yes','No']},
        {id:'constBurglarAlarm',label:'Burglar Alarm',type:'select',opts:['','Central','Local','None']},
        {id:'constHurricane',label:'Hurricane Shutters/Impact Windows?',type:'select',opts:['','Yes','No']},
    ]},
    mortgagee: { title:'Mortgagee / Additional Interest', fields:[
        {id:'mortName',label:'Mortgagee Name',type:'text'},
        {id:'mortAddr',label:'Address',type:'text'},
        {id:'mortCity',label:'City',type:'text'},
        {id:'mortState',label:'State',type:'text'},
        {id:'mortZip',label:'Zip',type:'text'},
        {id:'mortLoan',label:'Loan Number',type:'text'},
    ]},
    additionalInterest: { title:'Additional Interest', fields:[
        {id:'addIntName',label:'Name',type:'text'},
        {id:'addIntAddr',label:'Address',type:'text'},
        {id:'addIntType',label:'Interest Type',type:'select',opts:['','Mortgagee','Loss Payee','Additional Insured','Certificate Holder']},
        {id:'addIntRef',label:'Reference / Loan #',type:'text'},
    ]},
    certificateHolder: { title:'Certificate Holder', fields:[
        {id:'certHolderName',label:'Name',type:'text'},
        {id:'certHolderAddr',label:'Address',type:'text'},
        {id:'certHolderCity',label:'City',type:'text'},
        {id:'certHolderState',label:'State',type:'text'},
        {id:'certHolderZip',label:'Zip',type:'text'},
    ]},
    insurers: { title:'Insurers Affording Coverage', fields:[
        {id:'insrA',label:'Insurer A',type:'text'},
        {id:'insrANAIC',label:'NAIC #',type:'text'},
        {id:'insrB',label:'Insurer B',type:'text'},
        {id:'insrBNAIC',label:'NAIC #',type:'text'},
        {id:'insrC',label:'Insurer C',type:'text'},
        {id:'insrCNAIC',label:'NAIC # (C)',type:'text'},
        {id:'insrD',label:'Insurer D',type:'text'},
        {id:'insrDNAIC',label:'NAIC # (D)',type:'text'},
        {id:'insrABestA',label:'Insurer A AM Best Rating',type:'text'},
        {id:'insrBBestA',label:'Insurer B AM Best Rating',type:'text'},
        {id:'insrCBestA',label:'Insurer C AM Best Rating',type:'text'},
        {id:'insrDBestA',label:'Insurer D AM Best Rating',type:'text'},
    ]},
    company: { title:'Insurance Company', fields:[
        {id:'coName',label:'Company Name',type:'text',map:'company'},
        {id:'coNAIC',label:'NAIC Code',type:'text'},
        {id:'coAddr',label:'Address',type:'text'},
    ]},
    remarks: { title:'Remarks / Special Conditions', fields:[
        {id:'remarks',label:'Remarks',type:'textarea'},
    ]},
    signature: { title:'Signature', fields:[
        {id:'sigApplicant',label:'Applicant Signature',type:'text'},
        {id:'sigDate',label:'Date',type:'date'},
        {id:'sigProducer',label:'Producer / Agent Signature',type:'text'},
        {id:'sigProducerDate',label:'Date',type:'date'},
    ]},
    lossInfo: { title:'Loss / Occurrence Information', fields:[
        {id:'lossDate',label:'Date of Loss',type:'date'},
        {id:'lossTime',label:'Time of Loss',type:'time'},
        {id:'lossLocation',label:'Location of Loss',type:'text'},
        {id:'lossDesc',label:'Description of Loss',type:'textarea'},
        {id:'lossEstimate',label:'Estimated Amount of Loss',type:'number'},
        {id:'lossPoliceReport',label:'Police / Fire Report #',type:'text'},
        {id:'lossType',label:'Type of Loss',type:'select',opts:['','Fire','Water','Wind','Theft','Vandalism','Other']},
        {id:'lossSubrogation',label:'Subrogation Possible?',type:'select',opts:['','Yes','No']},
        {id:'lossWitnesses',label:'Any Witnesses?',type:'select',opts:['','Yes','No']},
        {id:'lossWitnessName',label:'Witness Name',type:'text'},
        {id:'lossWitnessPhone',label:'Witness Phone',type:'tel'},
        {id:'lossOccupied',label:'Were Premises Occupied?',type:'select',opts:['','Yes','No']},
        {id:'lossSecured',label:'Was Property Secured?',type:'select',opts:['','Yes','No']},
        {id:'lossFireDept',label:'Fire Dept Called?',type:'select',opts:['','Yes','No']},
        {id:'lossCauseFire',label:'Cause of Fire',type:'text'},
        {id:'lossOriginFire',label:'Origin of Fire',type:'text'},
    ]},
    propertyDamage: { title:'Property Damage Details', fields:[
        {id:'pdDesc',label:'Description of Damage',type:'textarea'},
        {id:'pdEstRepair',label:'Estimated Repair Cost',type:'number'},
        {id:'pdContractor',label:'Contractor / Repair Company',type:'text'},
        {id:'pdMoved',label:'Was Property Moved?',type:'select',opts:['','Yes','No']},
        {id:'pdTempRepairs',label:'Temporary Repairs Made?',type:'select',opts:['','Yes','No']},
        {id:'pdPersonalProp',label:'Personal Property Damaged (describe)',type:'textarea'},
        {id:'pdStorage',label:'Property in Storage?',type:'select',opts:['','Yes','No']},
        {id:'pdValueBefore',label:'Property Value Before Loss',type:'number'},
        {id:'pdLienNotified',label:'Mortgage/Lien Holder Notified?',type:'select',opts:['','Yes','No']},
    ]},
    vehicleInfo: { title:'Vehicle Involved', fields:[
        {id:'accVehYear',label:'Year',type:'text'},
        {id:'accVehMake',label:'Make',type:'text'},
        {id:'accVehModel',label:'Model',type:'text'},
        {id:'accVehVIN',label:'VIN',type:'text'},
        {id:'accVehDamage',label:'Damage Description',type:'textarea'},
        {id:'accVehPlate',label:'License Plate',type:'text'},
        {id:'accVehPlateState',label:'Plate State',type:'text'},
        {id:'accVehMileage',label:'Mileage',type:'number'},
        {id:'accVehDriveable',label:'Was Vehicle Driveable?',type:'select',opts:['','Yes','No']},
        {id:'accVehTowedTo',label:'Towed To',type:'text'},
        {id:'accVehParked',label:'Was Vehicle Parked?',type:'select',opts:['','Yes','No']},
        {id:'accDriverName',label:'Driver at Time of Accident (Name)',type:'text'},
        {id:'accDriverDL',label:'Driver DL#',type:'text'},
        {id:'accDriverDLState',label:'Driver DL State',type:'text'},
        {id:'accDriverOwner',label:'Was Driver Owner?',type:'select',opts:['','Yes','No']},
        {id:'accPermission',label:'Permission Given?',type:'select',opts:['','Yes','No']},
        {id:'accOtherVehYMM',label:'Other Vehicle (Year/Make/Model)',type:'text'},
        {id:'accOtherDriverName',label:'Other Driver Name',type:'text'},
        {id:'accOtherDriverAddr',label:'Other Driver Address',type:'text'},
        {id:'accOtherDriverPhone',label:'Other Driver Phone',type:'tel'},
        {id:'accOtherInsCompany',label:'Other Driver Insurance Company',type:'text'},
        {id:'accOtherPolNum',label:'Other Driver Policy Number',type:'text'},
    ]},
    injuries: { title:'Injury Information', fields:[
        {id:'injName',label:'Injured Party Name',type:'text'},
        {id:'injDesc',label:'Description of Injury',type:'textarea'},
        {id:'injTreated',label:'Was Medical Treatment Received?',type:'select',opts:['','Yes','No']},
        {id:'injHospital',label:'Hospital / Doctor',type:'text'},
        {id:'inj2Name',label:'Injured Party 2 Name',type:'text'},
        {id:'inj2Desc',label:'Injured Party 2 Description',type:'textarea'},
        {id:'injSeatbelt',label:'Was Seatbelt Worn?',type:'select',opts:['','Yes','No']},
        {id:'injAmbulance',label:'Was Ambulance Called?',type:'select',opts:['','Yes','No']},
        {id:'injPassengersYours',label:'Number of Passengers in Your Vehicle',type:'number'},
        {id:'injPassengersOther',label:'Number of Passengers in Other Vehicle',type:'number'},
    ]},
    injuredParty: { title:'Injured / Claimant Information', fields:[
        {id:'claimantName',label:'Name',type:'text'},
        {id:'claimantAddr',label:'Address',type:'text'},
        {id:'claimantPhone',label:'Phone',type:'tel'},
        {id:'claimantInjury',label:'Injury Description',type:'textarea'},
        {id:'claimantDOB',label:'Date of Birth',type:'date'},
        {id:'claimantSSN',label:'SSN',type:'text'},
        {id:'claimantEmployer',label:'Employer',type:'text'},
        {id:'claimantNatureInj',label:'Nature of Injury/Illness',type:'text'},
        {id:'claimantBodyPart',label:'Body Part',type:'text'},
        {id:'claimantMedAttn',label:'Was Medical Attention Received?',type:'select',opts:['','Yes','No']},
        {id:'claimantHospital',label:'Hospital',type:'text'},
        {id:'claimantDisabilityDur',label:'Estimated Disability Duration',type:'text'},
        {id:'claimantAttyName',label:'Attorney Name',type:'text'},
        {id:'claimantAttyPhone',label:'Attorney Phone',type:'tel'},
    ]},
    violations: { title:'Violations / Accidents', fields:[
        {id:'vio1Date',label:'Date',type:'date'},
        {id:'vio1Type',label:'Type (Accident/Violation)',type:'select',opts:['','Accident','Violation']},
        {id:'vio1Desc',label:'Description',type:'text'},
        {id:'vio1Driver',label:'Driver',type:'text'},
        {id:'vio2Date',label:'Violation 2 Date',type:'date'},
        {id:'vio2Type',label:'Violation 2 Type',type:'select',opts:['','Accident','Violation']},
        {id:'vio2Desc',label:'Violation 2 Description',type:'text'},
        {id:'vio2Driver',label:'Violation 2 Driver',type:'text'},
        {id:'vio3Date',label:'Violation 3 Date',type:'date'},
        {id:'vio3Type',label:'Violation 3 Type',type:'select',opts:['','Accident','Violation']},
        {id:'vio3Desc',label:'Violation 3 Description',type:'text'},
        {id:'vio3Driver',label:'Violation 3 Driver',type:'text'},
        {id:'vioFaultDate',label:'At-Fault Accident Date',type:'date'},
        {id:'vioFaultDesc',label:'At-Fault Accident Description',type:'text'},
        {id:'vioFaultPaid',label:'Amount Paid',type:'number'},
        {id:'vioFaultDriver',label:'At-Fault Driver',type:'text'},
        {id:'vioDUI',label:'Any DUI/DWI?',type:'select',opts:['','Yes','No']},
        {id:'vioSuspended',label:'License Ever Suspended/Revoked?',type:'select',opts:['','Yes','No']},
        {id:'vioSR22',label:'SR-22 Required?',type:'select',opts:['','Yes','No']},
    ]},
    binderInfo: { title:'Binder Details', fields:[
        {id:'binderNum',label:'Binder Number',type:'text'},
        {id:'binderEffDate',label:'Effective Date',type:'date'},
        {id:'binderExpDate',label:'Expiration Date',type:'date'},
        {id:'binderPremium',label:'Estimated Premium',type:'number'},
        {id:'binderInsType',label:'Type of Insurance',type:'select',opts:['','Property','GL','Auto','WC','Package','Other']},
        {id:'binderCovForm',label:'Coverage Form',type:'text'},
        {id:'binderLOB',label:'Line of Business',type:'text'},
        {id:'binderNamedAs',label:'Named Insured As',type:'text'},
        {id:'binderLocations',label:'Location(s) Covered',type:'textarea'},
        {id:'binderDescOps',label:'Description of Operations',type:'textarea'},
        {id:'binderAddlIns',label:'Additional Insureds',type:'textarea'},
        {id:'binderLossPayees',label:'Loss Payees',type:'textarea'},
        {id:'binderMortgagees',label:'Mortgagees',type:'textarea'},
        {id:'binderSpecCond',label:'Special Conditions/Provisions',type:'textarea'},
    ]},
    cancellationInfo: { title:'Cancellation Details', fields:[
        {id:'cancelDate',label:'Requested Cancel Date',type:'date'},
        {id:'cancelReason',label:'Reason for Cancellation',type:'select',opts:['','Insured Request','Non-Payment','Replacement Coverage','Sold Property','Other']},
        {id:'cancelReasonOther',label:'Other Reason',type:'text'},
        {id:'cancelFlatProRata',label:'Cancel Flat or Pro-Rata?',type:'select',opts:['','Flat','Pro-Rata']},
        {id:'cancelReturnMethod',label:'Return Premium Method',type:'text'},
        {id:'cancelNewCarrier',label:'New Carrier (if replacement)',type:'text'},
        {id:'cancelNewPolNum',label:'New Policy Number',type:'text'},
        {id:'cancelNewEffDate',label:'New Effective Date',type:'date'},
        {id:'cancelInsSigDate',label:'Insured Signature Date',type:'date'},
        {id:'cancelWrittenReq',label:'Was Written Request Received from Insured?',type:'select',opts:['','Yes','No']},
    ]},
    changeDescription: { title:'Requested Changes', fields:[
        {id:'changeEffDate',label:'Change Effective Date',type:'date'},
        {id:'changeDesc',label:'Description of Change',type:'textarea'},
        {id:'changeType',label:'Type of Change',type:'select',opts:['','Add Vehicle','Remove Vehicle','Add Driver','Remove Driver','Add Coverage','Delete Coverage','Change Address','Change Name','Add Lender','Other']},
        {id:'changePremDir',label:'Premium Change',type:'select',opts:['','Increase','Decrease']},
        {id:'changePremAmt',label:'Premium Change Amount',type:'number'},
        {id:'changeAddlPrem',label:'Additional Premium Due',type:'number'},
        {id:'changeReturnPrem',label:'Return Premium',type:'number'},
        {id:'changeAppliesTo',label:'Change Applies to Which Vehicle/Location?',type:'text'},
        {id:'changeEndorsement',label:'Endorsement Number',type:'text'},
    ]},
    glInfo: { title:'General Liability Information', fields:[
        {id:'glClassCode',label:'Classification Code',type:'text'},
        {id:'glClassDesc',label:'Classification Description',type:'text'},
        {id:'glPremBasis',label:'Premium Basis (Sales/Payroll/Area)',type:'text'},
        {id:'glExposure',label:'Exposure Amount',type:'number'},
        {id:'glRate',label:'Rate',type:'number'},
        {id:'glOccCM',label:'Occurrence/Claims-Made',type:'select',opts:['','Occurrence','Claims-Made']},
        {id:'glRetroDate',label:'Retroactive Date',type:'date'},
        {id:'glEachOcc',label:'Each Occurrence Limit',type:'text'},
        {id:'glGenAgg',label:'General Aggregate',type:'text'},
        {id:'glProdOpsAgg',label:'Products/Completed Ops Aggregate',type:'text'},
        {id:'glPersAdvInj',label:'Personal & Advertising Injury',type:'text'},
        {id:'glDmgRentPrem',label:'Damage to Rented Premises',type:'text'},
        {id:'glMedExp',label:'Medical Expense',type:'text'},
        {id:'glDedPerOcc',label:'Deductible (Per Occurrence)',type:'select',opts:['','Yes','No']},
        {id:'glDedAmt',label:'Deductible Amount',type:'number'},
        {id:'glAddlInsReq',label:'Additional Insured Required?',type:'select',opts:['','Yes','No']},
        {id:'glWaiverSub',label:'Waiver of Subrogation?',type:'select',opts:['','Yes','No']},
        {id:'glPrimaryNC',label:'Primary/Non-Contributory?',type:'select',opts:['','Yes','No']},
        {id:'glHazardous',label:'Any Hazardous Exposures?',type:'select',opts:['','Yes','No']},
        {id:'glXCU',label:'Explosion/Collapse/Underground?',type:'select',opts:['','Yes','No']},
        {id:'glRecall',label:'Any Recall Exposure?',type:'select',opts:['','Yes','No']},
    ]},
    premises: { title:'Premises Information', fields:[
        {id:'premAddr',label:'Location Address',type:'text',map:'address'},
        {id:'premCity',label:'City',type:'text',map:'city'},
        {id:'premState',label:'State',type:'text',map:'state'},
        {id:'premZip',label:'Zip',type:'text',map:'zip'},
        {id:'premOccupancy',label:'Occupancy',type:'text'},
        {id:'premSqFt',label:'Square Footage',type:'number'},
        {id:'premAreaOccupied',label:'Building Area Occupied by Insured %',type:'number'},
        {id:'premInterest',label:'Interest',type:'select',opts:['','Owner','Tenant']},
        {id:'premYrBuilt',label:'Year Built',type:'text'},
        {id:'premConstType',label:'Construction Type',type:'select',opts:['','Frame','Masonry','Steel','Concrete','Other']},
        {id:'premStories',label:'Number of Stories',type:'number'},
        {id:'premBasement',label:'Basement?',type:'select',opts:['','Yes','No']},
        {id:'premSprinklered',label:'Sprinklered?',type:'select',opts:['','Yes','No']},
        {id:'premFireAlarm',label:'Fire Alarm',type:'select',opts:['','Central','Local','None']},
        {id:'premBurglarAlarm',label:'Burglar Alarm',type:'select',opts:['','Central','Local','None']},
        {id:'premNumEmployees',label:'Number of Employees at Location',type:'number'},
    ]},
    classification: { title:'Classification', fields:[
        {id:'classCode',label:'Class Code',type:'text'},
        {id:'classDesc',label:'Description',type:'text'},
        {id:'classPayroll',label:'Remuneration / Payroll',type:'number'},
        {id:'classRate',label:'Rate',type:'number'},
        {id:'classPremBasis',label:'Premium Basis',type:'select',opts:['','Area','Gross Sales','Payroll','Units']},
        {id:'classExposureAmt',label:'Exposure/Basis Amount',type:'number'},
        {id:'classEstPrem',label:'Estimated Annual Premium',type:'number'},
        {id:'classTerritory',label:'Territory',type:'text'},
        {id:'classIfAny',label:'If-Any Code',type:'text'},
        {id:'classHazardGrp',label:'Hazard Group',type:'text'},
    ]},
    underlying: { title:'Underlying Insurance', fields:[
        {id:'ulCGL',label:'CGL Policy Number',type:'text'},
        {id:'ulCGLLimit',label:'CGL Limit',type:'text'},
        {id:'ulAuto',label:'Auto Policy Number',type:'text'},
        {id:'ulAutoLimit',label:'Auto Limit',type:'text'},
        {id:'ulEmpl',label:'Employers Liability Policy',type:'text'},
        {id:'ulEmplLimit',label:'EL Limit',type:'text'},
        {id:'ulCGLCarrier',label:'CGL Carrier',type:'text'},
        {id:'ulCGLEffDate',label:'CGL Effective Date',type:'date'},
        {id:'ulCGLExpDate',label:'CGL Expiration Date',type:'date'},
        {id:'ulAutoCarrier',label:'Auto Carrier',type:'text'},
        {id:'ulAutoEffDate',label:'Auto Effective Date',type:'date'},
        {id:'ulAutoExpDate',label:'Auto Expiration Date',type:'date'},
        {id:'ulELCarrier',label:'EL Carrier',type:'text'},
        {id:'ulELEffDate',label:'EL Effective Date',type:'date'},
        {id:'ulELExpDate',label:'EL Expiration Date',type:'date'},
        {id:'ulOtherPolicies',label:'Any Other Underlying Policies?',type:'select',opts:['','Yes','No']},
        {id:'ulOtherDesc',label:'Other Policy Description',type:'textarea'},
        {id:'ulSameNamed',label:'Do All Underlying Policies Have Same Named Insured?',type:'select',opts:['','Yes','No']},
        {id:'ulSIR',label:'Self-Insured Retention',type:'number'},
        {id:'ulUmbLimit',label:'Umbrella Limit Requested',type:'text'},
        {id:'ulOccCM',label:'Occurrence/Claims-Made',type:'select',opts:['','Occurrence','Claims-Made']},
        {id:'ulRetainedLimit',label:'Retained Limit',type:'text'},
        {id:'ulClaims5yr',label:'Any Claims Last 5 Years?',type:'select',opts:['','Yes','No']},
    ]},
    building: { title:'Building Information', fields:[
        {id:'bldgAddr',label:'Location Address',type:'text',map:'address'},
        {id:'bldgConstruction',label:'Construction',type:'select',opts:['','Frame','Joisted Masonry','Non-Combustible','Masonry Non-Combustible','Modified Fire Resistive','Fire Resistive']},
        {id:'bldgYrBuilt',label:'Year Built',type:'text'},
        {id:'bldgSqFt',label:'Square Footage',type:'number'},
        {id:'bldgStories',label:'Stories',type:'number'},
        {id:'bldgOccupancy',label:'Occupancy',type:'text'},
        {id:'bldgRoofType',label:'Roof Type',type:'select',opts:['','Built-Up','Shingle','Tile','Metal','Flat','Other']},
        {id:'bldgRoofYear',label:'Roof Year',type:'text'},
        {id:'bldgWiring',label:'Wiring Type',type:'text'},
        {id:'bldgHeating',label:'Heating Type',type:'text'},
        {id:'bldgSprinklered',label:'Sprinklered?',type:'select',opts:['','Full','Partial','None']},
        {id:'bldgFireAlarm',label:'Fire Alarm',type:'select',opts:['','Central','Local','None']},
        {id:'bldgBurglarAlarm',label:'Burglar Alarm',type:'select',opts:['','Central','Local','None']},
        {id:'bldgProtClass',label:'Protection Class',type:'text'},
        {id:'bldgDistFireStn',label:'Distance to Fire Station',type:'text'},
        {id:'bldgDistHydrant',label:'Distance to Fire Hydrant',type:'text'},
        {id:'bldgElecYear',label:'Electrical Update Year',type:'text'},
        {id:'bldgPlumbYear',label:'Plumbing Update Year',type:'text'},
        {id:'bldgHVACYear',label:'HVAC Update Year',type:'text'},
        {id:'bldgRoofUpdYear',label:'Roof Update Year',type:'text'},
    ]},
    valuation: { title:'Valuation', fields:[
        {id:'valBuilding',label:'Building Value',type:'number'},
        {id:'valBPP',label:'Business Personal Property',type:'number'},
        {id:'valBI',label:'Business Income',type:'number'},
        {id:'valExtra',label:'Extra Expense',type:'number'},
        {id:'valBlanket',label:'Blanket Coverage',type:'number'},
        {id:'valCoinsurance',label:'Coinsurance %',type:'select',opts:['','80%','90%','100%']},
        {id:'valMethod',label:'Valuation Method',type:'select',opts:['','Replacement Cost','ACV','Agreed Value','Functional']},
        {id:'valCauseOfLoss',label:'Cause of Loss',type:'select',opts:['','Basic','Broad','Special']},
        {id:'valDeductible',label:'Deductible',type:'number'},
        {id:'valWindHailDed',label:'Wind/Hail Deductible %',type:'text'},
        {id:'valEquipBreakdown',label:'Equipment Breakdown?',type:'select',opts:['','Yes','No']},
        {id:'valOrdLaw',label:'Ordinance or Law?',type:'select',opts:['','Yes','No']},
        {id:'valAcctsReceiv',label:'Accounts Receivable',type:'number'},
        {id:'valValPapers',label:'Valuable Papers',type:'number'},
        {id:'valSigns',label:'Signs Value',type:'number'},
        {id:'valEDP',label:'EDP Equipment',type:'number'},
    ]},
    propertyDescription: { title:'Property Description', fields:[
        {id:'imPropDesc',label:'Description of Property',type:'textarea'},
        {id:'imPropValue',label:'Value',type:'number'},
        {id:'imPropLoc',label:'Location',type:'text'},
        {id:'imPropType',label:'Type of Property',type:'select',opts:['','Contractors Equipment','Builders Risk','Installation Floater','EDP','Camera','Musical Instruments','Fine Arts','Other']},
        {id:'imItem2Desc',label:'Item 2 Description',type:'text'},
        {id:'imItem2Serial',label:'Item 2 Serial #',type:'text'},
        {id:'imItem2Value',label:'Item 2 Value',type:'number'},
        {id:'imItem3Desc',label:'Item 3 Description',type:'text'},
        {id:'imItem3Serial',label:'Item 3 Serial #',type:'text'},
        {id:'imItem3Value',label:'Item 3 Value',type:'number'},
        {id:'imTerritory',label:'Territory of Use',type:'text'},
        {id:'imMobile',label:'Is Property Mobile?',type:'select',opts:['','Yes','No']},
        {id:'imTransport',label:'Transported How?',type:'text'},
        {id:'imSecurity',label:'Security Measures',type:'textarea'},
        {id:'imAgreedVal',label:'Agreed Value?',type:'select',opts:['','Yes','No']},
        {id:'imCoinsurance',label:'Coinsurance %',type:'text'},
        {id:'imDeductible',label:'Deductible',type:'number'},
        {id:'imRCOrACV',label:'Replacement Cost or ACV?',type:'select',opts:['','Replacement Cost','ACV']},
    ]},
    equipmentSchedule: { title:'Equipment Schedule', fields:[
        {id:'eq1Desc',label:'Description',type:'text'},
        {id:'eq1Serial',label:'Serial / ID',type:'text'},
        {id:'eq1Year',label:'Year',type:'text'},
        {id:'eq1Value',label:'Value',type:'number'},
        {id:'eq1Make',label:'Make/Manufacturer',type:'text'},
        {id:'eq1Model',label:'Model',type:'text'},
        {id:'eq1Type',label:'Type',type:'select',opts:['','Owned','Leased','Rented']},
        {id:'eq2Desc',label:'Item 2 Description',type:'text'},
        {id:'eq2Serial',label:'Item 2 Serial / ID',type:'text'},
        {id:'eq2Year',label:'Item 2 Year',type:'text'},
        {id:'eq2Value',label:'Item 2 Value',type:'number'},
        {id:'eq2Make',label:'Item 2 Make/Manufacturer',type:'text'},
        {id:'eq2Model',label:'Item 2 Model',type:'text'},
        {id:'eq2Type',label:'Item 2 Type',type:'select',opts:['','Owned','Leased','Rented']},
        {id:'eq3Desc',label:'Item 3 Description',type:'text'},
        {id:'eq3Serial',label:'Item 3 Serial / ID',type:'text'},
        {id:'eq3Year',label:'Item 3 Year',type:'text'},
        {id:'eq3Value',label:'Item 3 Value',type:'number'},
        {id:'eq3Make',label:'Item 3 Make/Manufacturer',type:'text'},
        {id:'eq3Model',label:'Item 3 Model',type:'text'},
        {id:'eq3Type',label:'Item 3 Type',type:'select',opts:['','Owned','Leased','Rented']},
        {id:'eqLocNotInUse',label:'Location When Not In Use',type:'text'},
        {id:'eqTerritoryOps',label:'Territory of Operations',type:'text'},
    ]},
    pipElection: { title:'PIP Election (Florida)', fields:[
        {id:'pipLimit',label:'PIP Limit',type:'select',opts:['$10,000','$2,500 (Limited)']},
        {id:'pipDeduct',label:'PIP Deductible',type:'select',opts:['$0','$250','$500','$1,000']},
        {id:'pipWorkLoss',label:'Work Loss Exclusion',type:'select',opts:['','Included','Excluded']},
        {id:'pipNIElection',label:'Named Insured Election',type:'select',opts:['','Full','Limited']},
        {id:'pipNIWorkLossReject',label:'Named Insured Rejection of Work Loss Benefits',type:'select',opts:['','Yes','No']},
        {id:'pipNIMedicare',label:'Named Insured Medicare/Medicaid Coverage?',type:'select',opts:['','Yes','No']},
        {id:'pipNIHMO',label:'Named Insured Has Other HMO/Health Coverage?',type:'select',opts:['','Yes','No']},
        {id:'pipNILimitElect',label:'Named Insured Elects',type:'select',opts:['','$10,000','$2,500']},
        {id:'pipDedElection',label:'Deductible Election',type:'select',opts:['','$0','$250','$500','$1,000']},
        {id:'pipStacking',label:'Stacking/Non-Stacking?',type:'select',opts:['','Stacking','Non-Stacking']},
        {id:'pipDeathBenefits',label:'Death Benefits Election',type:'select',opts:['','Yes','No']},
    ]},
    householdMembers: { title:'Household Members', fields:[
        {id:'hh1Name',label:'Name',type:'text'},
        {id:'hh1Relation',label:'Relationship',type:'text'},
        {id:'hh1DOB',label:'Date of Birth',type:'date'},
        {id:'hh1Coverage',label:'Covered?',type:'select',opts:['','Yes','No']},
    ]},
    watercraft: { title:'Watercraft Information', fields:[
        {id:'wcYear',label:'Year',type:'text'},
        {id:'wcMake',label:'Make / Manufacturer',type:'text'},
        {id:'wcModel',label:'Model',type:'text'},
        {id:'wcLength',label:'Length (ft)',type:'number'},
        {id:'wcHull',label:'Hull ID',type:'text'},
        {id:'wcHP',label:'Horsepower',type:'number'},
        {id:'wcValue',label:'Value',type:'number'},
        {id:'wcType',label:'Type',type:'select',opts:['','Inboard','Outboard','I/O','Jet','Sailboat','PWC']},
    ]},
    operators: { title:'Operators', fields:[
        {id:'op1Name',label:'Operator Name',type:'text',map:'name'},
        {id:'op1DOB',label:'Date of Birth',type:'date',map:'dob'},
        {id:'op1Exp',label:'Years of Experience',type:'number'},
        {id:'op1Cert',label:'Boating Safety Certificate',type:'select',opts:['','Yes','No']},
    ]},
    employer: { title:'Employer Information', fields:[
        {id:'empName',label:'Employer Name',type:'text'},
        {id:'empAddr',label:'Address',type:'text'},
        {id:'empCity',label:'City',type:'text'},
        {id:'empState',label:'State',type:'text'},
        {id:'empFEIN',label:'FEIN',type:'text'},
        {id:'empSIC',label:'SIC Code',type:'text'},
    ]},
    employee: { title:'Employee Information', fields:[
        {id:'eeFirstName',label:'First Name',type:'text'},
        {id:'eeLastName',label:'Last Name',type:'text'},
        {id:'eeDOB',label:'Date of Birth',type:'date'},
        {id:'eeGender',label:'Gender',type:'select',opts:['','Male','Female']},
        {id:'eeSSN',label:'SSN',type:'text'},
        {id:'eeOccupation',label:'Occupation',type:'text'},
        {id:'eeHireDate',label:'Date of Hire',type:'date'},
        {id:'eeWage',label:'Wage / Salary',type:'number'},
    ]},
    injuryInfo: { title:'Injury / Illness Information', fields:[
        {id:'injDate',label:'Date of Injury',type:'date'},
        {id:'injTime',label:'Time',type:'time'},
        {id:'injLoc',label:'Location (on premises?)',type:'text'},
        {id:'injBodyPart',label:'Body Part(s) Affected',type:'text'},
        {id:'injNature',label:'Nature of Injury',type:'text'},
        {id:'injCause',label:'Cause / How Injury Occurred',type:'textarea'},
    ]},
    treatment: { title:'Medical Treatment', fields:[
        {id:'txPhysician',label:'Treating Physician',type:'text'},
        {id:'txHospital',label:'Hospital / Clinic',type:'text'},
        {id:'txAddr',label:'Address',type:'text'},
        {id:'txInitialDate',label:'Date of Initial Treatment',type:'date'},
        {id:'txEmergency',label:'Emergency Room?',type:'select',opts:['','Yes','No']},
        {id:'txHospitalized',label:'Hospitalized?',type:'select',opts:['','Yes','No']},
    ]},
    agency: { title:'Agency Details', fields:[
        {id:'agName',label:'Agency Name',type:'text',defaultVal:'Universal Insurance Brokers'},
        {id:'agAddr',label:'Address',type:'text'},
        {id:'agCity',label:'City',type:'text'},
        {id:'agState',label:'State',type:'text',defaultVal:'FL'},
        {id:'agPhone',label:'Phone',type:'tel'},
        {id:'agEmail',label:'Email',type:'email',defaultVal:'admin@universalinsurancebroker.com'},
        {id:'agLicense',label:'License Number',type:'text'},
    ]},
    terms: { title:'Agreement Terms', fields:[
        {id:'termEffDate',label:'Effective Date',type:'date'},
        {id:'termTerritory',label:'Territory',type:'text'},
        {id:'termCommRate',label:'Commission Rate %',type:'number'},
        {id:'termAuthority',label:'Binding Authority Limit',type:'number'},
    ]},
    observations: { title:'Observations', fields:[
        {id:'obsExterior',label:'Exterior Condition',type:'textarea'},
        {id:'obsInterior',label:'Interior Condition',type:'textarea'},
        {id:'obsHazards',label:'Hazards Noted',type:'textarea'},
    ]},
    recommendations: { title:'Recommendations', fields:[
        {id:'recText',label:'Recommendations',type:'textarea'},
    ]},
    propertyInfo: { title:'Property Information', fields:[
        {id:'piAddr',label:'Address',type:'text',map:'address'},
        {id:'piType',label:'Property Type',type:'select',opts:['','Single Family','Multi-Family','Condo','Townhouse','Mobile Home','Commercial']},
        {id:'piYrBuilt',label:'Year Built',type:'text'},
        {id:'piCondition',label:'Overall Condition',type:'select',opts:['','Excellent','Good','Average','Fair','Poor']},
    ]},
    beneficiary: { title:'Beneficiary', fields:[
        {id:'benName',label:'Beneficiary Name',type:'text'},
        {id:'benRelation',label:'Relationship',type:'text'},
        {id:'benPercent',label:'Percentage',type:'number'},
        {id:'benContName',label:'Contingent Beneficiary',type:'text'},
    ]},
    healthInfo: { title:'Health Information', fields:[
        {id:'hlHeight',label:'Height',type:'text'},
        {id:'hlWeight',label:'Weight',type:'text'},
        {id:'hlTobacco',label:'Tobacco Use',type:'select',opts:['','Yes','No']},
        {id:'hlConditions',label:'Pre-existing Conditions',type:'textarea'},
        {id:'hlMedications',label:'Current Medications',type:'textarea'},
        {id:'hlPhysician',label:'Primary Physician',type:'text'},
    ]},
    dependents: { title:'Dependents', fields:[
        {id:'dep1Name',label:'Name',type:'text'},
        {id:'dep1DOB',label:'Date of Birth',type:'date'},
        {id:'dep1Relation',label:'Relationship',type:'select',opts:['','Spouse','Child','Domestic Partner']},
        {id:'dep1Gender',label:'Gender',type:'select',opts:['','Male','Female']},
    ]},
    healthHistory: { title:'Health History', fields:[
        {id:'hhHospital',label:'Hospitalized in last 5 years?',type:'select',opts:['','Yes','No']},
        {id:'hhSurgery',label:'Surgeries in last 5 years?',type:'select',opts:['','Yes','No']},
        {id:'hhDisability',label:'Any disabilities?',type:'select',opts:['','Yes','No']},
        {id:'hhDetails',label:'Details (if yes)',type:'textarea'},
    ]},
    additionalInfo: { title:'Additional Information', fields:[
        {id:'addInfo',label:'Additional Notes',type:'textarea'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 125 - Commercial Insurance Application (Page 1 & 2)
    // ══════════════════════════════════════════════════════════
    a125_agency: { title:'Agency / Carrier Information', fields:[
        {id:'a125_agencyName',label:'Agency',type:'text',defaultVal:'Universal Insurance Brokers'},
        {id:'a125_agencyPhone',label:'Phone (A/C, No, Ext)',type:'tel'},
        {id:'a125_agencyFax',label:'Fax (A/C, No)',type:'tel'},
        {id:'a125_carrier',label:'Carrier',type:'text',map:'company'},
        {id:'a125_naicCode',label:'NAIC Code',type:'text'},
        {id:'a125_underwriter',label:'Underwriter',type:'text'},
        {id:'a125_underwriterOff',label:'Underwriter Office',type:'text'},
        {id:'a125_polNumber',label:'Policy Number',type:'text',map:'policyNumber'},
        {id:'a125_secProperty',label:'Property',type:'checkbox'},
        {id:'a125_secGlasSign',label:'Glass and Sign',type:'checkbox'},
        {id:'a125_secARVP',label:'Accounts Receivable / Valuable Papers',type:'checkbox'},
        {id:'a125_secCrime',label:'Crime / Miscellaneous Crime',type:'checkbox'},
        {id:'a125_secTransport',label:'Transportation / Motor Truck Cargo',type:'checkbox'},
        {id:'a125_secEquipFloat',label:'Equipment Floater',type:'checkbox'},
        {id:'a125_secInstBR',label:'Installation / Builders Risk',type:'checkbox'},
        {id:'a125_secEDP',label:'Electronic Data Processing',type:'checkbox'},
        {id:'a125_secCGL',label:'Commercial General Liability',type:'checkbox'},
        {id:'a125_secBizAuto',label:'Business Auto',type:'checkbox'},
        {id:'a125_secTruckers',label:'Truckers / Motor Carrier',type:'checkbox'},
        {id:'a125_secGarage',label:'Garage and Dealers',type:'checkbox'},
        {id:'a125_secVehSched',label:'Vehicle Schedule',type:'checkbox'},
        {id:'a125_secBoiler',label:'Boiler & Machinery',type:'checkbox'},
        {id:'a125_secWC',label:'Workers Compensation',type:'checkbox'},
        {id:'a125_secUmbrella',label:'Umbrella',type:'checkbox'},
        {id:'a125_code',label:'Code',type:'text'},
        {id:'a125_subCode',label:'Sub Code',type:'text'},
        {id:'a125_agencyCustId',label:'Agency Customer ID',type:'text'},
    ]},
    a125_status: { title:'Status of Transaction / Package Policy Information', fields:[
        {id:'a125_transType',label:'Status of Transaction',type:'select',opts:['','Quote','Issue Policy','Renew','Bound','Change','Cancel']},
        {id:'a125_boundDate',label:'Bound (Give Date and/or Attach Copy)',type:'text'},
        {id:'a125_changeDate',label:'Change Date',type:'date'},
        {id:'a125_changeTime',label:'Change Time',type:'time'},
        {id:'a125_changeAMPM',label:'AM / PM',type:'select',opts:['','AM','PM']},
        {id:'a125_proposedEff',label:'Proposed Eff Date',type:'date',map:'effDate'},
        {id:'a125_proposedExp',label:'Proposed Exp Date',type:'date',map:'expirationDate'},
        {id:'a125_billingPlan',label:'Billing Plan',type:'select',opts:['','Direct Bill','Agency Bill']},
        {id:'a125_paymentPlan',label:'Payment Plan',type:'select',opts:['','Annual','Semi-Annual','Quarterly','Monthly','10-Pay','9-Pay','Other']},
        {id:'a125_audit',label:'Audit',type:'select',opts:['','Annual','Semi-Annual','Monthly','At Expiration','None']},
    ]},
    a125_applicant: { title:'Applicant Information', fields:[
        {id:'a125_appName',label:'Name (First Named Insured & Other Named Insureds)',type:'text',map:'name'},
        {id:'a125_appFEIN',label:'FEIN or Soc Sec #',type:'text'},
        {id:'a125_appPhone',label:'Phone (A/C, No, Ext)',type:'tel',map:'phone1'},
        {id:'a125_appMailAddr',label:'Mailing Address Incl ZIP+4 (of First Named Insured)',type:'text',map:'address'},
        {id:'a125_appMailCity',label:'City',type:'text',map:'city'},
        {id:'a125_appMailState',label:'State',type:'text',map:'state'},
        {id:'a125_appMailZip',label:'Zip+4',type:'text',map:'zip'},
        {id:'a125_appEmail',label:'E-Mail Address(es)',type:'email',map:'email'},
        {id:'a125_appWebsite',label:'Website Address(es)',type:'text'},
        {id:'a125_entityIndividual',label:'Individual',type:'checkbox'},
        {id:'a125_entityCorp',label:'Corporation',type:'checkbox'},
        {id:'a125_entitySubS',label:'Subchapter "S" Corporation',type:'checkbox'},
        {id:'a125_entityLLC',label:'LLC',type:'checkbox'},
        {id:'a125_entityNFP',label:'Not for Profit Org',type:'checkbox'},
        {id:'a125_entityMembers',label:'No. of Members and Managers',type:'text'},
        {id:'a125_entityPartnership',label:'Partnership',type:'checkbox'},
        {id:'a125_entityJV',label:'Joint Venture',type:'checkbox'},
        {id:'a125_crBureauName',label:'CR Bureau Name',type:'text'},
        {id:'a125_crBureauId',label:'ID Number',type:'text'},
        {id:'a125_dateBusStarted',label:'Date Business Started',type:'date'},
        {id:'a125_inspContact',label:'Inspection Contact',type:'text'},
        {id:'a125_inspPhone',label:'Inspection Contact Phone (A/C, No, Ext)',type:'tel'},
        {id:'a125_acctContact',label:'Accounting Records Contact',type:'text'},
        {id:'a125_acctPhone',label:'Accounting Records Phone (A/C, No, Ext)',type:'tel'},
    ]},
    a125_premises: { title:'Premises Information', fields:[
        {id:'a125_loc1Num',label:'Loc # (Location 1)',type:'text',defaultVal:'1'},
        {id:'a125_loc1Bld',label:'Bld #',type:'text',defaultVal:'1'},
        {id:'a125_loc1Addr',label:'Street, City, County, State, ZIP+4',type:'text',map:'address'},
        {id:'a125_loc1CityLimits',label:'City Limits',type:'select',opts:['','Inside','Outside']},
        {id:'a125_loc1Interest',label:'Interest',type:'select',opts:['','Owner','Tenant']},
        {id:'a125_loc1YrBuilt',label:'Yr Built',type:'text'},
        {id:'a125_loc1Employees',label:'# Employees',type:'number'},
        {id:'a125_loc1PartOccupied',label:'Part Occupied',type:'text'},
        {id:'a125_loc2Num',label:'Loc # (Location 2)',type:'text'},
        {id:'a125_loc2Bld',label:'Bld #',type:'text'},
        {id:'a125_loc2Addr',label:'Street, City, County, State, ZIP+4',type:'text'},
        {id:'a125_loc2CityLimits',label:'City Limits',type:'select',opts:['','Inside','Outside']},
        {id:'a125_loc2Interest',label:'Interest',type:'select',opts:['','Owner','Tenant']},
        {id:'a125_loc2YrBuilt',label:'Yr Built',type:'text'},
        {id:'a125_loc2Employees',label:'# Employees',type:'number'},
        {id:'a125_loc2PartOccupied',label:'Part Occupied',type:'text'},
    ]},
    a125_natureOfBiz: { title:'Nature of Business / Description of Operations by Premise(s)', fields:[
        {id:'a125_bizNature',label:'Nature of Business / Description of Operations',type:'textarea'},
    ]},
    a125_generalInfo125: { title:'General Information — Explain All "Yes" Responses', fields:[
        {id:'a125_gi1a',label:'1a. Is the applicant a subsidiary of another entity?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi1b',label:'1b. Does the applicant have any subsidiaries?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi2',label:'2. Is a formal safety program in operation?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi3',label:'3. Any exposure to flammables, explosives, chemicals?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi4',label:'4. Any catastrophe exposure?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi5',label:'5. Any other insurance with this company or being submitted?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi6',label:'6. Any policy or coverage declined, cancelled or non-renewed during the prior 3 years?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi7',label:'7. Any past losses or claims relating to sexual abuse or molestation, discrimination or negligent hiring?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi8',label:'8. During the last 5 years (10 in RI), has any applicant been convicted of any degree of the crime of arson?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi9',label:'9. Any uncorrected fire code violations?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi10',label:'10. Any bankruptcies, tax or credit liens against the applicant in the past 5 years?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi11',label:'11. Has business been placed in a trust?',type:'select',opts:['','Yes','No']},
        {id:'a125_gi11Name',label:'If Yes, Name of Trust',type:'text'},
        {id:'a125_giExplain',label:'Explain All "Yes" Responses',type:'textarea'},
    ]},
    a125_remarksProcessing: { title:'Remarks / Processing Instructions', fields:[
        {id:'a125_remarks',label:'Remarks / Processing Instructions',type:'textarea'},
    ]},
    a125_priorCarrierInfo: { title:'Page 2 — Prior Carrier Information', fields:[
        {id:'a125_pc1Line',label:'Line 1 Category',type:'text'},
        {id:'a125_pc1Carrier',label:'Line 1 Carrier',type:'text'},
        {id:'a125_pc1PolNum',label:'Line 1 Policy Number',type:'text'},
        {id:'a125_pc1PolType',label:'Line 1 Policy Type',type:'select',opts:['','Claims Made','Occurrence']},
        {id:'a125_pc1RetroDate',label:'Line 1 Retro Date',type:'date'},
        {id:'a125_pc2Line',label:'Line 2 Category',type:'text'},
        {id:'a125_pc2Carrier',label:'Line 2 Carrier',type:'text'},
        {id:'a125_pc2PolNum',label:'Line 2 Policy Number',type:'text'},
        {id:'a125_pc2PolType',label:'Line 2 Policy Type',type:'select',opts:['','Claims Made','Occurrence']},
        {id:'a125_pc3Line',label:'Line 3 Category',type:'text'},
        {id:'a125_pc3Carrier',label:'Line 3 Carrier',type:'text'},
        {id:'a125_pc3PolNum',label:'Line 3 Policy Number',type:'text'},
        {id:'a125_pc3PolType',label:'Line 3 Policy Type',type:'select',opts:['','Claims Made','Occurrence']},
        {id:'a125_pc4Line',label:'Line 4 Category',type:'text'},
        {id:'a125_pc4Carrier',label:'Line 4 Carrier',type:'text'},
        {id:'a125_pc4PolNum',label:'Line 4 Policy Number',type:'text'},
        {id:'a125_pc5Line',label:'Line 5 Category',type:'text'},
        {id:'a125_pc5Carrier',label:'Line 5 Carrier',type:'text'},
        {id:'a125_pc5PolNum',label:'Line 5 Policy Number',type:'text'},
    ]},
    a125_glLimits: { title:'Page 2 — General Liability / Commercial Liability Limits', fields:[
        {id:'a125_glEffExpDate',label:'Eff-Exp Date',type:'text'},
        {id:'a125_glGenAgg',label:'General Aggregate',type:'text'},
        {id:'a125_glProdCompOps',label:'Products / Completed Ops Aggregate',type:'text'},
        {id:'a125_glPersAdvInj',label:'Personal & Advertising Injury',type:'text'},
        {id:'a125_glEachOcc',label:'Each Occurrence',type:'text'},
        {id:'a125_glFireDmg',label:'Fire Damage',type:'text'},
        {id:'a125_glMedExp',label:'Medical Expense',type:'text'},
        {id:'a125_glBIOcc',label:'Bodily Injury - Occurrence',type:'text'},
        {id:'a125_glBIAgg',label:'Bodily Injury - Aggregate',type:'text'},
        {id:'a125_glPDOcc',label:'Property Damage - Occurrence',type:'text'},
        {id:'a125_glPDAgg',label:'Property Damage - Aggregate',type:'text'},
        {id:'a125_glCSL',label:'Combined Single Limit',type:'text'},
        {id:'a125_glModFactor',label:'Modification Factor',type:'text'},
        {id:'a125_glTotalPrem',label:'Total Premium',type:'number'},
    ]},
    a125_autoLimits: { title:'Page 2 — Automobile Liability', fields:[
        {id:'a125_alCarrier',label:'Carrier',type:'text'},
        {id:'a125_alPolNum',label:'Policy Number',type:'text'},
        {id:'a125_alPolType',label:'Policy Type',type:'text'},
        {id:'a125_alEffExpDate',label:'Eff-Exp Date',type:'text'},
        {id:'a125_alCSL',label:'Combined Single Limit',type:'text'},
        {id:'a125_alBIPerson',label:'Bodily Injury - Ea Person',type:'text'},
        {id:'a125_alBIAccident',label:'Bodily Injury - Ea Accident',type:'text'},
        {id:'a125_alPD',label:'Property Damage',type:'text'},
        {id:'a125_alModFactor',label:'Modification Factor',type:'text'},
        {id:'a125_alTotalPrem',label:'Total Premium',type:'number'},
    ]},
    a125_propLimits: { title:'Page 2 — Property', fields:[
        {id:'a125_prCarrier',label:'Carrier',type:'text'},
        {id:'a125_prPolNum',label:'Policy Number',type:'text'},
        {id:'a125_prPolType',label:'Policy Type',type:'text'},
        {id:'a125_prEffExpDate',label:'Eff-Exp Date',type:'text'},
        {id:'a125_prBldgAmt',label:'Building Amount',type:'number'},
        {id:'a125_prPersPropAmt',label:'Personal Property Amount',type:'number'},
        {id:'a125_prModFactor',label:'Modification Factor',type:'text'},
        {id:'a125_prTotalPrem',label:'Total Premium',type:'number'},
    ]},
    a125_otherLine: { title:'Page 2 — Other Line (WC / Umbrella / Other)', fields:[
        {id:'a125_olCarrier',label:'Carrier',type:'text'},
        {id:'a125_olPolNum',label:'Policy Number',type:'text'},
        {id:'a125_olPolType',label:'Policy Type',type:'text'},
        {id:'a125_olEffExpDate',label:'Eff-Exp Date',type:'text'},
        {id:'a125_olLimit',label:'Limit',type:'text'},
        {id:'a125_olModFactor',label:'Modification Factor',type:'text'},
        {id:'a125_olTotalPrem',label:'Total Premium',type:'number'},
    ]},
    a125_lossHist: { title:'Page 2 — Loss History (5 Years / 3 Years in KS & NY)', fields:[
        {id:'a125_lhNone',label:'Check Here If None',type:'checkbox'},
        {id:'a125_lh1Date',label:'Loss 1 Date of Occurrence',type:'date'},
        {id:'a125_lh1Line',label:'Loss 1 Line',type:'text'},
        {id:'a125_lh1Desc',label:'Loss 1 Type / Description of Occurrence or Claim',type:'text'},
        {id:'a125_lh1ClaimDate',label:'Loss 1 Date of Claim',type:'date'},
        {id:'a125_lh1AmtPaid',label:'Loss 1 Amount Paid',type:'number'},
        {id:'a125_lh1AmtReserved',label:'Loss 1 Amount Reserved',type:'number'},
        {id:'a125_lh1Status',label:'Loss 1 Claim Status',type:'select',opts:['','Open','Closed']},
        {id:'a125_lh2Date',label:'Loss 2 Date of Occurrence',type:'date'},
        {id:'a125_lh2Line',label:'Loss 2 Line',type:'text'},
        {id:'a125_lh2Desc',label:'Loss 2 Type / Description of Occurrence or Claim',type:'text'},
        {id:'a125_lh2ClaimDate',label:'Loss 2 Date of Claim',type:'date'},
        {id:'a125_lh2AmtPaid',label:'Loss 2 Amount Paid',type:'number'},
        {id:'a125_lh2AmtReserved',label:'Loss 2 Amount Reserved',type:'number'},
        {id:'a125_lh2Status',label:'Loss 2 Claim Status',type:'select',opts:['','Open','Closed']},
        {id:'a125_lh3Date',label:'Loss 3 Date of Occurrence',type:'date'},
        {id:'a125_lh3Line',label:'Loss 3 Line',type:'text'},
        {id:'a125_lh3Desc',label:'Loss 3 Type / Description',type:'text'},
        {id:'a125_lh3AmtPaid',label:'Loss 3 Amount Paid',type:'number'},
        {id:'a125_lh3Status',label:'Loss 3 Claim Status',type:'select',opts:['','Open','Closed']},
        {id:'a125_lh4Date',label:'Loss 4 Date of Occurrence',type:'date'},
        {id:'a125_lh4Line',label:'Loss 4 Line',type:'text'},
        {id:'a125_lh4Desc',label:'Loss 4 Type / Description',type:'text'},
        {id:'a125_lh4AmtPaid',label:'Loss 4 Amount Paid',type:'number'},
        {id:'a125_lh4Status',label:'Loss 4 Claim Status',type:'select',opts:['','Open','Closed']},
        {id:'a125_lhRemarks',label:'Remarks',type:'textarea'},
        {id:'a125_lhAttachments',label:'Attachments / State Supplement(s)',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 11 - Auto Accident Sections
    // ══════════════════════════════════════════════════════════
    acc_insured: { title:'Page 1 — Your Information (Insured)', fields:[
        {id:'acc_name',label:'Your Name',type:'text',map:'name'},
        {id:'acc_addr',label:'Address',type:'text',map:'address'},
        {id:'acc_city',label:'City',type:'text',map:'city'},
        {id:'acc_state',label:'State',type:'text',map:'state'},
        {id:'acc_zip',label:'Zip',type:'text',map:'zip'},
        {id:'acc_phone',label:'Phone',type:'tel',map:'phone1'},
        {id:'acc_email',label:'Email',type:'email',map:'email'},
        {id:'acc_dl',label:'Driver License #',type:'text',map:'dlNum'},
        {id:'acc_dlState',label:'DL State',type:'text',map:'dlState'},
        {id:'acc_insCompany',label:'Insurance Company',type:'text',map:'company'},
        {id:'acc_polNum',label:'Policy Number',type:'text',map:'policyNumber'},
        {id:'acc_agentName',label:'Agent Name',type:'text'},
        {id:'acc_agentPhone',label:'Agent Phone',type:'tel'},
    ]},
    acc_otherParty: { title:'Page 1 — Other Party Information', fields:[
        {id:'acc_op_name',label:'Other Driver Name',type:'text'},
        {id:'acc_op_addr',label:'Address',type:'text'},
        {id:'acc_op_city',label:'City',type:'text'},
        {id:'acc_op_state',label:'State',type:'text'},
        {id:'acc_op_zip',label:'Zip',type:'text'},
        {id:'acc_op_phone',label:'Phone',type:'tel'},
        {id:'acc_op_dl',label:'Driver License #',type:'text'},
        {id:'acc_op_dlState',label:'DL State',type:'text'},
        {id:'acc_op_insCompany',label:'Insurance Company',type:'text'},
        {id:'acc_op_polNum',label:'Policy Number',type:'text'},
        {id:'acc_op_vehOwner',label:'Vehicle Owner (if different)',type:'text'},
    ]},
    acc_vehicleA: { title:'Page 1 — Your Vehicle', fields:[
        {id:'acc_va_year',label:'Year',type:'text'},
        {id:'acc_va_make',label:'Make',type:'text'},
        {id:'acc_va_model',label:'Model',type:'text'},
        {id:'acc_va_color',label:'Color',type:'text'},
        {id:'acc_va_vin',label:'VIN',type:'text'},
        {id:'acc_va_plate',label:'License Plate #',type:'text'},
        {id:'acc_va_plateState',label:'Plate State',type:'text'},
        {id:'acc_va_damage',label:'Damage Description',type:'textarea'},
        {id:'acc_va_driveable',label:'Driveable?',type:'select',opts:['','Yes','No']},
        {id:'acc_va_towedTo',label:'Towed To',type:'text'},
    ]},
    acc_vehicleB: { title:'Page 1 — Other Vehicle', fields:[
        {id:'acc_vb_year',label:'Year',type:'text'},
        {id:'acc_vb_make',label:'Make',type:'text'},
        {id:'acc_vb_model',label:'Model',type:'text'},
        {id:'acc_vb_color',label:'Color',type:'text'},
        {id:'acc_vb_vin',label:'VIN',type:'text'},
        {id:'acc_vb_plate',label:'License Plate #',type:'text'},
        {id:'acc_vb_plateState',label:'Plate State',type:'text'},
        {id:'acc_vb_damage',label:'Damage Description',type:'textarea'},
        {id:'acc_vb_passengers',label:'Number of Passengers',type:'number'},
    ]},
    acc_scene: { title:'Page 2 — Accident Scene Details', fields:[
        {id:'acc_date',label:'Date of Accident',type:'date'},
        {id:'acc_time',label:'Time of Accident',type:'time'},
        {id:'acc_location',label:'Location / Intersection',type:'text'},
        {id:'acc_city2',label:'City',type:'text'},
        {id:'acc_state2',label:'State',type:'text'},
        {id:'acc_roadCondition',label:'Road Condition',type:'select',opts:['','Dry','Wet','Icy','Snow','Gravel','Other']},
        {id:'acc_weather',label:'Weather',type:'select',opts:['','Clear','Rain','Snow','Fog','Overcast','Other']},
        {id:'acc_lighting',label:'Lighting',type:'select',opts:['','Daylight','Dusk','Dark - Lighted','Dark - Unlighted']},
        {id:'acc_speedA',label:'Your Speed (mph)',type:'number'},
        {id:'acc_speedB',label:'Other Speed (mph)',type:'number'},
        {id:'acc_trafficControl',label:'Traffic Control',type:'select',opts:['','Signal','Stop Sign','Yield','None','Other']},
        {id:'acc_description',label:'Description of Accident',type:'textarea'},
    ]},
    acc_witnesses: { title:'Page 2 — Witnesses', fields:[
        {id:'acc_w1_name',label:'Witness 1 Name',type:'text'},
        {id:'acc_w1_phone',label:'Witness 1 Phone',type:'tel'},
        {id:'acc_w1_addr',label:'Witness 1 Address',type:'text'},
        {id:'acc_w2_name',label:'Witness 2 Name',type:'text'},
        {id:'acc_w2_phone',label:'Witness 2 Phone',type:'tel'},
        {id:'acc_w2_addr',label:'Witness 2 Address',type:'text'},
    ]},
    acc_police: { title:'Page 2 — Police Report', fields:[
        {id:'acc_policeReport',label:'Police Report Filed?',type:'select',opts:['','Yes','No']},
        {id:'acc_policeReportNum',label:'Report Number',type:'text'},
        {id:'acc_policeDept',label:'Department',type:'text'},
        {id:'acc_officerName',label:'Officer Name / Badge #',type:'text'},
        {id:'acc_citation',label:'Citation Issued?',type:'select',opts:['','Yes - To You','Yes - To Other','No']},
        {id:'acc_citationDesc',label:'Citation Description',type:'text'},
    ]},
    acc_injuries: { title:'Page 2 — Injuries', fields:[
        {id:'acc_inj_yourInjury',label:'Your Injuries',type:'textarea'},
        {id:'acc_inj_yourTreat',label:'Treated At',type:'text'},
        {id:'acc_inj_yourAmbulance',label:'Ambulance?',type:'select',opts:['','Yes','No']},
        {id:'acc_inj_passengers',label:'Passenger Injuries',type:'textarea'},
        {id:'acc_inj_otherInjury',label:'Other Party Injuries',type:'textarea'},
        {id:'acc_inj_pedestrian',label:'Pedestrian / Cyclist Injuries',type:'textarea'},
    ]},
    acc_diagram: { title:'Page 3 — Diagram & Additional Info', fields:[
        {id:'acc_diagramNotes',label:'Diagram / Sketch Notes (describe positions of vehicles, direction of travel)',type:'textarea'},
        {id:'acc_additionalInfo',label:'Additional Information',type:'textarea'},
        {id:'acc_priorDamage',label:'Prior Damage to Your Vehicle?',type:'textarea'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 12 - Exchange of Information
    // ══════════════════════════════════════════════════════════
    exch_yourInfo: { title:'Your Information', fields:[
        {id:'exch_name',label:'Your Name',type:'text',map:'name'},
        {id:'exch_addr',label:'Address',type:'text',map:'address'},
        {id:'exch_phone',label:'Phone',type:'tel',map:'phone1'},
        {id:'exch_dl',label:'Driver License #',type:'text',map:'dlNum'},
        {id:'exch_insurer',label:'Insurance Company',type:'text',map:'company'},
        {id:'exch_polNum',label:'Policy Number',type:'text',map:'policyNumber'},
        {id:'exch_vehYear',label:'Vehicle Year',type:'text'},
        {id:'exch_vehMake',label:'Vehicle Make',type:'text'},
        {id:'exch_vehModel',label:'Vehicle Model',type:'text'},
        {id:'exch_vehPlate',label:'License Plate',type:'text'},
    ]},
    exch_otherParty: { title:'Other Party Information', fields:[
        {id:'exch_op_name',label:'Name',type:'text'},
        {id:'exch_op_addr',label:'Address',type:'text'},
        {id:'exch_op_phone',label:'Phone',type:'tel'},
        {id:'exch_op_dl',label:'Driver License #',type:'text'},
        {id:'exch_op_insurer',label:'Insurance Company',type:'text'},
        {id:'exch_op_polNum',label:'Policy Number',type:'text'},
        {id:'exch_op_veh',label:'Vehicle (Year/Make/Model)',type:'text'},
        {id:'exch_op_plate',label:'License Plate',type:'text'},
    ]},
    exch_accident: { title:'Accident Details', fields:[
        {id:'exch_date',label:'Date',type:'date'},
        {id:'exch_time',label:'Time',type:'time'},
        {id:'exch_location',label:'Location',type:'text'},
        {id:'exch_desc',label:'Brief Description',type:'textarea'},
    ]},
    exch_witnesses: { title:'Witnesses', fields:[
        {id:'exch_w1',label:'Witness 1 Name & Phone',type:'text'},
        {id:'exch_w2',label:'Witness 2 Name & Phone',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 13 - Witness Card
    // ══════════════════════════════════════════════════════════
    witness_info: { title:'Witness Information', fields:[
        {id:'wit_name',label:'Witness Name',type:'text'},
        {id:'wit_addr',label:'Address',type:'text'},
        {id:'wit_city',label:'City',type:'text'},
        {id:'wit_state',label:'State',type:'text'},
        {id:'wit_zip',label:'Zip',type:'text'},
        {id:'wit_phone',label:'Phone',type:'tel'},
        {id:'wit_email',label:'Email',type:'email'},
    ]},
    witness_accident: { title:'Accident Details', fields:[
        {id:'wit_accDate',label:'Date of Accident',type:'date'},
        {id:'wit_accTime',label:'Time',type:'time'},
        {id:'wit_accLocation',label:'Location',type:'text'},
        {id:'wit_position',label:'Where Were You When You Saw the Accident?',type:'text'},
    ]},
    witness_statement: { title:'Witness Statement', fields:[
        {id:'wit_statement',label:'What Did You See? (detailed statement)',type:'textarea'},
        {id:'wit_sig',label:'Witness Signature',type:'text'},
        {id:'wit_sigDate',label:'Date',type:'date'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 24 - Certificate of Property Insurance
    // ══════════════════════════════════════════════════════════
    cert24_company: { title:'Insurance Company', fields:[
        {id:'c24_coName',label:'Company Name',type:'text',map:'company'},
        {id:'c24_coNAIC',label:'NAIC #',type:'text'},
        {id:'c24_coAddr',label:'Company Address',type:'text'},
        {id:'c24_polNum',label:'Policy Number',type:'text',map:'policyNumber'},
        {id:'c24_effDate',label:'Effective Date',type:'date',map:'effDate'},
        {id:'c24_expDate',label:'Expiration Date',type:'date',map:'expirationDate'},
    ]},
    cert24_property: { title:'Property Information', fields:[
        {id:'c24_propAddr',label:'Property Location',type:'text',map:'address'},
        {id:'c24_propCity',label:'City',type:'text',map:'city'},
        {id:'c24_propState',label:'State',type:'text',map:'state'},
        {id:'c24_propZip',label:'Zip',type:'text',map:'zip'},
        {id:'c24_propDesc',label:'Description of Property',type:'textarea'},
    ]},
    cert24_coverage: { title:'Coverage', fields:[
        {id:'c24_covA',label:'Coverage A - Dwelling',type:'number'},
        {id:'c24_covB',label:'Coverage B - Other Structures',type:'number'},
        {id:'c24_covC',label:'Coverage C - Personal Property',type:'number'},
        {id:'c24_covD',label:'Coverage D - Loss of Use',type:'number'},
        {id:'c24_covE',label:'Coverage E - Personal Liability',type:'number'},
        {id:'c24_covF',label:'Coverage F - Medical Payments',type:'number'},
        {id:'c24_deductible',label:'Deductible',type:'text'},
        {id:'c24_hurricane',label:'Hurricane Deductible',type:'text'},
        {id:'c24_flood',label:'Flood Coverage',type:'select',opts:['','Yes','No']},
        {id:'c24_floodPol',label:'Flood Policy Number',type:'text'},
    ]},
    cert24_lossPayee: { title:'Loss Payee', fields:[
        {id:'c24_lpName',label:'Loss Payee Name',type:'text'},
        {id:'c24_lpAddr',label:'Address',type:'text'},
        {id:'c24_lpCity',label:'City',type:'text'},
        {id:'c24_lpState',label:'State',type:'text'},
        {id:'c24_lpZip',label:'Zip',type:'text'},
        {id:'c24_lpLoan',label:'Loan #',type:'text'},
    ]},
    cert24_mortgagee: { title:'Mortgagee', fields:[
        {id:'c24_mtgName',label:'Mortgagee Name',type:'text'},
        {id:'c24_mtgAddr',label:'Address',type:'text'},
        {id:'c24_mtgCity',label:'City',type:'text'},
        {id:'c24_mtgState',label:'State',type:'text'},
        {id:'c24_mtgZip',label:'Zip',type:'text'},
        {id:'c24_mtgLoan',label:'Loan Number',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 45 - Commercial App Supplement
    // ══════════════════════════════════════════════════════════
    acord45_nature: { title:'Nature of Business', fields:[
        {id:'a45_bizType',label:'Type of Business',type:'text'},
        {id:'a45_bizDesc',label:'Full Description of Business Operations',type:'textarea'},
        {id:'a45_yearsExp',label:'Years Experience in This Business',type:'number'},
        {id:'a45_prevBiz',label:'Previous Business (if less than 3 years)',type:'text'},
    ]},
    acord45_premises: { title:'Premises Information', fields:[
        {id:'a45_sqft',label:'Total Square Footage',type:'number'},
        {id:'a45_floors',label:'Number of Floors',type:'number'},
        {id:'a45_yrBuilt',label:'Year Built',type:'text'},
        {id:'a45_construction',label:'Construction Type',type:'select',opts:['','Frame','Masonry','Non-Combustible','Fire Resistive']},
        {id:'a45_sprinklered',label:'Sprinklered?',type:'select',opts:['','Yes - Full','Yes - Partial','No']},
        {id:'a45_alarmType',label:'Alarm Type',type:'select',opts:['','Central Station','Local','None']},
        {id:'a45_occupied',label:'% Occupied by Insured',type:'number'},
    ]},
    acord45_employees: { title:'Employee Information', fields:[
        {id:'a45_ftEmp',label:'Full-Time Employees',type:'number'},
        {id:'a45_ptEmp',label:'Part-Time Employees',type:'number'},
        {id:'a45_seasonal',label:'Seasonal Employees',type:'number'},
        {id:'a45_volunteers',label:'Volunteers',type:'number'},
        {id:'a45_annPayroll',label:'Annual Payroll',type:'number'},
    ]},
    acord45_subcontractors: { title:'Subcontractors', fields:[
        {id:'a45_useSubs',label:'Use Subcontractors?',type:'select',opts:['','Yes','No']},
        {id:'a45_subCost',label:'Annual Cost of Subcontracted Work',type:'number'},
        {id:'a45_subCOI',label:'Require COI from Subs?',type:'select',opts:['','Yes','No']},
        {id:'a45_subAddlInsured',label:'Named as Additional Insured on Sub Policies?',type:'select',opts:['','Yes','No']},
    ]},
    acord45_loss: { title:'Loss History (5 Years)', fields:[
        {id:'a45_loss1Date',label:'Loss 1 Date',type:'date'},
        {id:'a45_loss1Desc',label:'Loss 1 Description',type:'text'},
        {id:'a45_loss1Amt',label:'Loss 1 Amount',type:'number'},
        {id:'a45_loss1Status',label:'Loss 1 Status',type:'select',opts:['','Open','Closed']},
        {id:'a45_loss2Date',label:'Loss 2 Date',type:'date'},
        {id:'a45_loss2Desc',label:'Loss 2 Description',type:'text'},
        {id:'a45_loss2Amt',label:'Loss 2 Amount',type:'number'},
        {id:'a45_loss3Date',label:'Loss 3 Date',type:'date'},
        {id:'a45_loss3Desc',label:'Loss 3 Description',type:'text'},
        {id:'a45_loss3Amt',label:'Loss 3 Amount',type:'number'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 50 - Home Daycare
    // ══════════════════════════════════════════════════════════
    acord50_daycare: { title:'Daycare Operations', fields:[
        {id:'a50_name',label:'Daycare Name',type:'text'},
        {id:'a50_license',label:'License Number',type:'text'},
        {id:'a50_maxChildren',label:'Max # of Children',type:'number'},
        {id:'a50_ageRange',label:'Age Range of Children',type:'text'},
        {id:'a50_hours',label:'Hours of Operation',type:'text'},
        {id:'a50_yearsOp',label:'Years Operating',type:'number'},
    ]},
    acord50_employees: { title:'Staff', fields:[
        {id:'a50_ftStaff',label:'Full-Time Staff',type:'number'},
        {id:'a50_ptStaff',label:'Part-Time Staff',type:'number'},
        {id:'a50_bgChecks',label:'Background Checks Completed?',type:'select',opts:['','Yes','No']},
        {id:'a50_cprTrained',label:'CPR/First Aid Training?',type:'select',opts:['','Yes','No']},
    ]},
    acord50_safety: { title:'Safety', fields:[
        {id:'a50_fenced',label:'Fenced Play Area?',type:'select',opts:['','Yes','No']},
        {id:'a50_pool',label:'Pool/Water Features?',type:'select',opts:['','Yes','No']},
        {id:'a50_poolFenced',label:'Pool Fenced/Locked?',type:'select',opts:['','Yes','No','N/A']},
        {id:'a50_animals',label:'Animals on Premises?',type:'select',opts:['','Yes','No']},
        {id:'a50_transport',label:'Transport Children?',type:'select',opts:['','Yes','No']},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 83 FL - Florida Personal Umbrella (multi-page)
    // ══════════════════════════════════════════════════════════
    acord83_underlying_auto: { title:'Page 1 — Underlying Auto Insurance', fields:[
        {id:'a83_autoCarrier',label:'Auto Insurance Company',type:'text',map:'company'},
        {id:'a83_autoPol',label:'Auto Policy Number',type:'text',map:'policyNumber'},
        {id:'a83_autoBI',label:'BI Limits',type:'text'},
        {id:'a83_autoPD',label:'PD Limit',type:'text'},
        {id:'a83_autoUM',label:'UM/UIM Limits',type:'text'},
        {id:'a83_autoEffDate',label:'Effective Date',type:'date',map:'effDate'},
        {id:'a83_autoExpDate',label:'Expiration Date',type:'date',map:'expirationDate'},
        {id:'a83_numVehicles',label:'Number of Vehicles',type:'number'},
        {id:'a83_numDrivers',label:'Number of Drivers',type:'number'},
    ]},
    acord83_underlying_home: { title:'Page 1 — Underlying Homeowners Insurance', fields:[
        {id:'a83_homeCarrier',label:'Homeowners Insurance Company',type:'text'},
        {id:'a83_homePol',label:'Policy Number',type:'text'},
        {id:'a83_homeLiability',label:'Personal Liability Limit',type:'text'},
        {id:'a83_homeMedPay',label:'Medical Payments',type:'text'},
        {id:'a83_homeEffDate',label:'Effective Date',type:'date'},
        {id:'a83_homeExpDate',label:'Expiration Date',type:'date'},
    ]},
    acord83_underlying_watercraft: { title:'Page 2 — Underlying Watercraft / Other', fields:[
        {id:'a83_wcCarrier',label:'Watercraft Insurance Company',type:'text'},
        {id:'a83_wcPol',label:'Policy Number',type:'text'},
        {id:'a83_wcLiability',label:'Liability Limit',type:'text'},
        {id:'a83_otherUnderlying',label:'Other Underlying Policies (describe)',type:'textarea'},
    ]},
    acord83_limits: { title:'Page 2 — Umbrella Limits Requested', fields:[
        {id:'a83_umbLimit',label:'Umbrella Limit Requested',type:'select',opts:['','$1,000,000','$2,000,000','$3,000,000','$5,000,000','$10,000,000']},
        {id:'a83_sIR',label:'Self-Insured Retention',type:'text'},
        {id:'a83_umbEffDate',label:'Effective Date',type:'date'},
        {id:'a83_umbTerm',label:'Term',type:'select',opts:['','Annual','Semi-Annual']},
    ]},
    acord83_drivers: { title:'Page 2 — Drivers in Household', fields:[
        {id:'a83_d1Name',label:'Driver 1 Name',type:'text',map:'name'},
        {id:'a83_d1DOB',label:'DOB',type:'date',map:'dob'},
        {id:'a83_d1DL',label:'License #',type:'text',map:'dlNum'},
        {id:'a83_d1Violations',label:'Violations/Accidents (3 yrs)',type:'text'},
        {id:'a83_d2Name',label:'Driver 2 Name',type:'text'},
        {id:'a83_d2DOB',label:'DOB',type:'date'},
        {id:'a83_d2DL',label:'License #',type:'text'},
        {id:'a83_d2Violations',label:'Violations/Accidents (3 yrs)',type:'text'},
        {id:'a83_d3Name',label:'Driver 3 Name',type:'text'},
        {id:'a83_d3DOB',label:'DOB',type:'date'},
        {id:'a83_d3DL',label:'License #',type:'text'},
    ]},
    acord83_residences: { title:'Page 3 — Residences', fields:[
        {id:'a83_res1Addr',label:'Residence 1 Address',type:'text',map:'address'},
        {id:'a83_res1City',label:'City',type:'text',map:'city'},
        {id:'a83_res1State',label:'State',type:'text',map:'state'},
        {id:'a83_res1Occ',label:'Occupancy',type:'select',opts:['','Owner','Tenant','Seasonal']},
        {id:'a83_res2Addr',label:'Residence 2 Address',type:'text'},
        {id:'a83_res2City',label:'City',type:'text'},
        {id:'a83_res2State',label:'State',type:'text'},
        {id:'a83_res2Occ',label:'Occupancy',type:'select',opts:['','Owner','Tenant','Seasonal']},
        {id:'a83_rentalProp',label:'Own Any Rental Properties?',type:'select',opts:['','Yes','No']},
        {id:'a83_rentalUnits',label:'Number of Rental Units',type:'number'},
    ]},
    acord83_claims: { title:'Page 3 — Claims History', fields:[
        {id:'a83_priorUmb',label:'Prior Umbrella Carrier',type:'text'},
        {id:'a83_priorUmbPol',label:'Prior Umbrella Policy #',type:'text'},
        {id:'a83_claimsLast5',label:'Any Claims in Last 5 Years?',type:'select',opts:['','Yes','No']},
        {id:'a83_c1Date',label:'Claim 1 Date',type:'date'},
        {id:'a83_c1Desc',label:'Claim 1 Description',type:'text'},
        {id:'a83_c1Amt',label:'Claim 1 Amount',type:'number'},
        {id:'a83_c2Date',label:'Claim 2 Date',type:'date'},
        {id:'a83_c2Desc',label:'Claim 2 Description',type:'text'},
        {id:'a83_c2Amt',label:'Claim 2 Amount',type:'number'},
        {id:'a83_declined',label:'Ever Declined/Cancelled/Non-Renewed?',type:'select',opts:['','Yes','No']},
        {id:'a83_declinedDetail',label:'Details',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 101 - Additional Remarks
    // ══════════════════════════════════════════════════════════
    acord101_ref: { title:'Form Reference', fields:[
        {id:'a101_agency',label:'Agency',type:'text',defaultVal:'Universal Insurance Brokers'},
        {id:'a101_polNum',label:'Policy Number',type:'text',map:'policyNumber'},
        {id:'a101_carrier',label:'Carrier',type:'text',map:'company'},
        {id:'a101_namedInsured',label:'Named Insured',type:'text',map:'name'},
        {id:'a101_effDate',label:'Effective Date',type:'date',map:'effDate'},
        {id:'a101_formRef',label:'This Remarks Schedule Relates To (Form #)',type:'text'},
        {id:'a101_sectionRef',label:'Section / Field Reference',type:'text'},
    ]},
    acord101_remarks: { title:'Remarks (Use for additional space)', fields:[
        {id:'a101_remarks',label:'Additional Remarks',type:'textarea'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 103 - Personal Auto Additional Resident/Driver
    // ══════════════════════════════════════════════════════════
    acord103_resident1: { title:'Page 1 — Additional Resident 1', fields:[
        {id:'a103_r1Name',label:'Name',type:'text'},
        {id:'a103_r1DOB',label:'Date of Birth',type:'date'},
        {id:'a103_r1Relation',label:'Relationship',type:'select',opts:['','Spouse','Child','Parent','Sibling','Other']},
        {id:'a103_r1Gender',label:'Gender',type:'select',opts:['','Male','Female']},
        {id:'a103_r1Marital',label:'Marital Status',type:'select',opts:['','Single','Married','Divorced','Widowed']},
        {id:'a103_r1Licensed',label:'Licensed Driver?',type:'select',opts:['','Yes','No']},
        {id:'a103_r1DL',label:'License #',type:'text'},
        {id:'a103_r1DLState',label:'DL State',type:'text',defaultVal:'FL'},
        {id:'a103_r1Excluded',label:'Excluded from Policy?',type:'select',opts:['','Yes','No']},
    ]},
    acord103_resident2: { title:'Page 1 — Additional Resident 2', fields:[
        {id:'a103_r2Name',label:'Name',type:'text'},
        {id:'a103_r2DOB',label:'Date of Birth',type:'date'},
        {id:'a103_r2Relation',label:'Relationship',type:'select',opts:['','Spouse','Child','Parent','Sibling','Other']},
        {id:'a103_r2Gender',label:'Gender',type:'select',opts:['','Male','Female']},
        {id:'a103_r2Marital',label:'Marital Status',type:'select',opts:['','Single','Married','Divorced','Widowed']},
        {id:'a103_r2Licensed',label:'Licensed Driver?',type:'select',opts:['','Yes','No']},
        {id:'a103_r2DL',label:'License #',type:'text'},
        {id:'a103_r2DLState',label:'DL State',type:'text',defaultVal:'FL'},
    ]},
    acord103_resident3: { title:'Page 2 — Additional Resident 3', fields:[
        {id:'a103_r3Name',label:'Name',type:'text'},
        {id:'a103_r3DOB',label:'Date of Birth',type:'date'},
        {id:'a103_r3Relation',label:'Relationship',type:'select',opts:['','Spouse','Child','Parent','Sibling','Other']},
        {id:'a103_r3Gender',label:'Gender',type:'select',opts:['','Male','Female']},
        {id:'a103_r3Licensed',label:'Licensed Driver?',type:'select',opts:['','Yes','No']},
        {id:'a103_r3DL',label:'License #',type:'text'},
    ]},
    acord103_driver_detail1: { title:'Page 2 — Driver Details (SR-22 / Violations)', fields:[
        {id:'a103_dd1Name',label:'Driver Name',type:'text'},
        {id:'a103_dd1SR22',label:'SR-22 Filing Required?',type:'select',opts:['','Yes','No']},
        {id:'a103_dd1Vio1Date',label:'Violation 1 Date',type:'date'},
        {id:'a103_dd1Vio1Desc',label:'Violation 1 Description',type:'text'},
        {id:'a103_dd1Vio2Date',label:'Violation 2 Date',type:'date'},
        {id:'a103_dd1Vio2Desc',label:'Violation 2 Description',type:'text'},
        {id:'a103_dd1Acc1Date',label:'Accident 1 Date',type:'date'},
        {id:'a103_dd1Acc1Desc',label:'Accident 1 Description',type:'text'},
        {id:'a103_dd1Acc1Amt',label:'Accident 1 Amount',type:'number'},
    ]},
    acord103_driver_detail2: { title:'Page 2 — Driver Details 2', fields:[
        {id:'a103_dd2Name',label:'Driver Name',type:'text'},
        {id:'a103_dd2SR22',label:'SR-22 Filing Required?',type:'select',opts:['','Yes','No']},
        {id:'a103_dd2Vio1Date',label:'Violation 1 Date',type:'date'},
        {id:'a103_dd2Vio1Desc',label:'Violation 1 Description',type:'text'},
        {id:'a103_dd2Acc1Date',label:'Accident 1 Date',type:'date'},
        {id:'a103_dd2Acc1Desc',label:'Accident 1 Description',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 105 - Apartment Building Supplement
    // ══════════════════════════════════════════════════════════
    acord105_building: { title:'Building Information', fields:[
        {id:'a105_addr',label:'Building Address',type:'text',map:'address'},
        {id:'a105_city',label:'City',type:'text',map:'city'},
        {id:'a105_state',label:'State',type:'text',map:'state'},
        {id:'a105_zip',label:'Zip',type:'text',map:'zip'},
        {id:'a105_yrBuilt',label:'Year Built',type:'text'},
        {id:'a105_stories',label:'Number of Stories',type:'number'},
        {id:'a105_construction',label:'Construction Type',type:'select',opts:['','Frame','Masonry','Non-Combustible','Fire Resistive']},
        {id:'a105_roofType',label:'Roof Type',type:'select',opts:['','Shingle','Tile','Metal','Flat/Built-up','Other']},
        {id:'a105_roofAge',label:'Roof Year',type:'text'},
    ]},
    acord105_units: { title:'Unit Information', fields:[
        {id:'a105_totalUnits',label:'Total Number of Units',type:'number'},
        {id:'a105_occupied',label:'Number Occupied',type:'number'},
        {id:'a105_vacant',label:'Number Vacant',type:'number'},
        {id:'a105_commercial',label:'Any Commercial Units?',type:'select',opts:['','Yes','No']},
        {id:'a105_commDesc',label:'Commercial Unit Description',type:'text'},
        {id:'a105_avgRent',label:'Average Monthly Rent',type:'number'},
        {id:'a105_annGrossIncome',label:'Annual Gross Rental Income',type:'number'},
    ]},
    acord105_safety: { title:'Safety & Systems', fields:[
        {id:'a105_sprinklers',label:'Sprinkler System?',type:'select',opts:['','Yes - All','Yes - Partial','No']},
        {id:'a105_fireAlarm',label:'Fire Alarm System?',type:'select',opts:['','Central Station','Local','Smoke Detectors Only','None']},
        {id:'a105_security',label:'Security System?',type:'select',opts:['','Yes','No']},
        {id:'a105_pool',label:'Swimming Pool?',type:'select',opts:['','Yes','No']},
        {id:'a105_poolFenced',label:'Pool Fenced/Gated?',type:'select',opts:['','Yes','No','N/A']},
        {id:'a105_elevator',label:'Elevator?',type:'select',opts:['','Yes','No']},
        {id:'a105_laundry',label:'Laundry Facilities?',type:'select',opts:['','In-Unit','Common Area','None']},
    ]},
    acord105_maintenance: { title:'Maintenance & Management', fields:[
        {id:'a105_managed',label:'Professionally Managed?',type:'select',opts:['','Yes','No']},
        {id:'a105_mgmtCo',label:'Management Company Name',type:'text'},
        {id:'a105_onSiteMgr',label:'On-Site Manager?',type:'select',opts:['','Yes','No']},
        {id:'a105_maintenance',label:'Maintenance Staff',type:'number'},
        {id:'a105_lastRenovation',label:'Last Major Renovation',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 125 FL - Florida Commercial (multi-page)
    // ══════════════════════════════════════════════════════════
    acord125_contact: { title:'Page 1 — Contact Information', fields:[
        {id:'a125_phone',label:'Business Phone',type:'tel',map:'phone1'},
        {id:'a125_fax',label:'Fax',type:'tel'},
        {id:'a125_email',label:'Email',type:'email',map:'email'},
        {id:'a125_website',label:'Website',type:'text'},
        {id:'a125_entityType',label:'Entity Type',type:'select',opts:['','Individual','Corporation','LLC','Partnership','Joint Venture','Trust','Non-Profit','Other']},
        {id:'a125_stateInc',label:'State of Incorporation',type:'text',defaultVal:'FL'},
        {id:'a125_dateInc',label:'Date of Incorporation',type:'date'},
        {id:'a125_fein',label:'FEIN',type:'text'},
    ]},
    acord125_premises_p1: { title:'Page 2 — Premises Location 1', fields:[
        {id:'a125_loc1Addr',label:'Location 1 Address',type:'text',map:'address'},
        {id:'a125_loc1City',label:'City',type:'text',map:'city'},
        {id:'a125_loc1State',label:'State',type:'text',map:'state'},
        {id:'a125_loc1Zip',label:'Zip',type:'text',map:'zip'},
        {id:'a125_loc1County',label:'County',type:'text'},
        {id:'a125_loc1Occupied',label:'Interest',type:'select',opts:['','Owner','Tenant','Both']},
        {id:'a125_loc1SqFt',label:'Square Footage',type:'number'},
        {id:'a125_loc1yrBuilt',label:'Year Built',type:'text'},
        {id:'a125_loc1Construction',label:'Construction',type:'select',opts:['','Frame','Joisted Masonry','Non-Combustible','Masonry NC','Mod Fire Resistive','Fire Resistive']},
        {id:'a125_loc1Stories',label:'Stories',type:'number'},
        {id:'a125_loc1Basement',label:'Basement?',type:'select',opts:['','Yes','No']},
        {id:'a125_loc1Sprinkler',label:'Sprinklered?',type:'select',opts:['','Yes - Full','Yes - Partial','No']},
    ]},
    acord125_premises_p2: { title:'Page 2 — Premises Location 2', fields:[
        {id:'a125_loc2Addr',label:'Location 2 Address',type:'text'},
        {id:'a125_loc2City',label:'City',type:'text'},
        {id:'a125_loc2State',label:'State',type:'text'},
        {id:'a125_loc2Zip',label:'Zip',type:'text'},
        {id:'a125_loc2SqFt',label:'Square Footage',type:'number'},
        {id:'a125_loc2yrBuilt',label:'Year Built',type:'text'},
        {id:'a125_loc2Construction',label:'Construction',type:'select',opts:['','Frame','Joisted Masonry','Non-Combustible','Masonry NC','Fire Resistive']},
    ]},
    acord125_priorCarrier: { title:'Page 3 — Prior Carrier Information', fields:[
        {id:'a125_priorGL',label:'Prior GL Carrier',type:'text'},
        {id:'a125_priorGLPol',label:'GL Policy #',type:'text'},
        {id:'a125_priorGLPrem',label:'GL Premium',type:'number'},
        {id:'a125_priorGLExp',label:'GL Expiration Date',type:'date'},
        {id:'a125_priorProp',label:'Prior Property Carrier',type:'text'},
        {id:'a125_priorPropPol',label:'Property Policy #',type:'text'},
        {id:'a125_priorPropPrem',label:'Property Premium',type:'number'},
        {id:'a125_priorAuto',label:'Prior Auto Carrier',type:'text'},
        {id:'a125_priorAutoPol',label:'Auto Policy #',type:'text'},
        {id:'a125_priorWC',label:'Prior WC Carrier',type:'text'},
        {id:'a125_priorWCPol',label:'WC Policy #',type:'text'},
        {id:'a125_priorUmb',label:'Prior Umbrella Carrier',type:'text'},
        {id:'a125_priorUmbPol',label:'Umbrella Policy #',type:'text'},
        {id:'a125_yearsWithPrior',label:'Years with Prior Carrier',type:'number'},
        {id:'a125_reasonChange',label:'Reason for Change',type:'text'},
    ]},
    acord125_lossHistory: { title:'Page 3 — Loss History (5 Years)', fields:[
        {id:'a125_l1Date',label:'Loss 1 Date',type:'date'},
        {id:'a125_l1Type',label:'Type (GL/Prop/Auto/WC)',type:'text'},
        {id:'a125_l1Desc',label:'Description',type:'text'},
        {id:'a125_l1AmtPaid',label:'Amount Paid',type:'number'},
        {id:'a125_l1AmtReserved',label:'Amount Reserved',type:'number'},
        {id:'a125_l1Status',label:'Status',type:'select',opts:['','Open','Closed']},
        {id:'a125_l2Date',label:'Loss 2 Date',type:'date'},
        {id:'a125_l2Type',label:'Type',type:'text'},
        {id:'a125_l2Desc',label:'Description',type:'text'},
        {id:'a125_l2AmtPaid',label:'Amount Paid',type:'number'},
        {id:'a125_l3Date',label:'Loss 3 Date',type:'date'},
        {id:'a125_l3Type',label:'Type',type:'text'},
        {id:'a125_l3Desc',label:'Description',type:'text'},
        {id:'a125_l3AmtPaid',label:'Amount Paid',type:'number'},
        {id:'a125_l4Date',label:'Loss 4 Date',type:'date'},
        {id:'a125_l4Desc',label:'Description',type:'text'},
        {id:'a125_l4AmtPaid',label:'Amount Paid',type:'number'},
    ]},
    acord125_generalInfo: { title:'Page 4 — General Information', fields:[
        {id:'a125_anyLawsuits',label:'Any Pending Lawsuits?',type:'select',opts:['','Yes','No']},
        {id:'a125_lawsuitDetails',label:'Lawsuit Details',type:'textarea'},
        {id:'a125_bankruptcy',label:'Bankruptcy in Last 5 Years?',type:'select',opts:['','Yes','No']},
        {id:'a125_declined',label:'Ever Declined/Cancelled/Non-Renewed?',type:'select',opts:['','Yes','No']},
        {id:'a125_declinedDetail',label:'Details',type:'text'},
        {id:'a125_anyChanges',label:'Any Business Changes Anticipated?',type:'select',opts:['','Yes','No']},
        {id:'a125_changeDetail',label:'Change Details',type:'textarea'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 128 - Garage and Dealers (multi-page)
    // ══════════════════════════════════════════════════════════
    acord128_operations: { title:'Page 1 — Garage Operations', fields:[
        {id:'a128_opType',label:'Type of Operations',type:'select',opts:['','New Car Dealer','Used Car Dealer','Repair Shop','Body Shop','Service Station','Parking Garage','Car Wash','Towing','Other']},
        {id:'a128_opDesc',label:'Full Description of Operations',type:'textarea'},
        {id:'a128_franch',label:'Franchise/Brand',type:'text'},
        {id:'a128_numBays',label:'Number of Service Bays',type:'number'},
        {id:'a128_annGross',label:'Annual Gross Sales',type:'number'},
        {id:'a128_numNewSold',label:'# New Vehicles Sold Annually',type:'number'},
        {id:'a128_numUsedSold',label:'# Used Vehicles Sold Annually',type:'number'},
        {id:'a128_maxVehiclesOnLot',label:'Max Vehicles on Lot',type:'number'},
    ]},
    acord128_premises: { title:'Page 1 — Premises', fields:[
        {id:'a128_addr',label:'Location Address',type:'text',map:'address'},
        {id:'a128_city',label:'City',type:'text',map:'city'},
        {id:'a128_state',label:'State',type:'text',map:'state'},
        {id:'a128_zip',label:'Zip',type:'text',map:'zip'},
        {id:'a128_sqft',label:'Total Square Footage',type:'number'},
        {id:'a128_lotSqft',label:'Lot Size (sq ft)',type:'number'},
        {id:'a128_fenced',label:'Lot Fenced?',type:'select',opts:['','Yes','No']},
        {id:'a128_lighted',label:'Lot Lighted?',type:'select',opts:['','Yes','No']},
        {id:'a128_security',label:'Security System?',type:'select',opts:['','Yes','No']},
    ]},
    acord128_coverage: { title:'Page 2 — Coverage', fields:[
        {id:'a128_gkBI',label:'Garagekeepers BI Limit',type:'text'},
        {id:'a128_gkPD',label:'Garagekeepers PD Limit',type:'text'},
        {id:'a128_gkCompDed',label:'Garagekeepers Comp Deductible',type:'text'},
        {id:'a128_gkCollDed',label:'Garagekeepers Coll Deductible',type:'text'},
        {id:'a128_maxAnyOneVeh',label:'Max Value Any One Vehicle',type:'number'},
        {id:'a128_dealersOpen',label:'Dealers Open Lot',type:'number'},
        {id:'a128_falseP',label:'False Pretense Coverage',type:'select',opts:['','Yes','No']},
        {id:'a128_demoUse',label:'Demo / Test Drive Coverage',type:'select',opts:['','Yes','No']},
    ]},
    acord128_employees: { title:'Page 2 — Employees', fields:[
        {id:'a128_totalEmp',label:'Total Employees',type:'number'},
        {id:'a128_mechanics',label:'# Mechanics',type:'number'},
        {id:'a128_salespeople',label:'# Salespeople',type:'number'},
        {id:'a128_drivers',label:'# Drivers (pickup/delivery)',type:'number'},
        {id:'a128_empMVR',label:'MVRs Obtained for All?',type:'select',opts:['','Yes','No']},
    ]},
    acord128_sublet: { title:'Page 2 — Sublet Work', fields:[
        {id:'a128_subletWork',label:'Any Sublet Work?',type:'select',opts:['','Yes','No']},
        {id:'a128_subletDesc',label:'Description of Sublet Work',type:'text'},
        {id:'a128_subletAmt',label:'Annual Sublet Amount',type:'number'},
        {id:'a128_subletCOI',label:'Require COI from Sublet?',type:'select',opts:['','Yes','No']},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 129 - Vehicle Schedule (5 vehicles)
    // ══════════════════════════════════════════════════════════
    acord129_veh1: { title:'Vehicle 1', fields:[
        {id:'a129_v1Year',label:'Year',type:'text'},
        {id:'a129_v1Make',label:'Make',type:'text'},
        {id:'a129_v1Model',label:'Model',type:'text'},
        {id:'a129_v1VIN',label:'VIN',type:'text'},
        {id:'a129_v1GVW',label:'GVW',type:'text'},
        {id:'a129_v1Cost',label:'Cost New / Actual Value',type:'number'},
        {id:'a129_v1Use',label:'Use',type:'select',opts:['','Service','Commercial','Retail','Pleasure','Farm']},
        {id:'a129_v1Radius',label:'Radius of Operation',type:'select',opts:['','Local (0-50)','Intermediate (50-200)','Long Distance (200+)']},
        {id:'a129_v1BI',label:'BI Limits',type:'text'},
        {id:'a129_v1PD',label:'PD Limit',type:'text'},
        {id:'a129_v1CompDed',label:'Comp Ded',type:'text'},
        {id:'a129_v1CollDed',label:'Coll Ded',type:'text'},
        {id:'a129_v1Hired',label:'Hired?',type:'select',opts:['','Yes','No']},
    ]},
    acord129_veh2: { title:'Vehicle 2', fields:[
        {id:'a129_v2Year',label:'Year',type:'text'},{id:'a129_v2Make',label:'Make',type:'text'},{id:'a129_v2Model',label:'Model',type:'text'},
        {id:'a129_v2VIN',label:'VIN',type:'text'},{id:'a129_v2GVW',label:'GVW',type:'text'},{id:'a129_v2Cost',label:'Cost/Value',type:'number'},
        {id:'a129_v2Use',label:'Use',type:'select',opts:['','Service','Commercial','Retail','Pleasure','Farm']},
        {id:'a129_v2BI',label:'BI',type:'text'},{id:'a129_v2PD',label:'PD',type:'text'},{id:'a129_v2CompDed',label:'Comp Ded',type:'text'},{id:'a129_v2CollDed',label:'Coll Ded',type:'text'},
    ]},
    acord129_veh3: { title:'Vehicle 3', fields:[
        {id:'a129_v3Year',label:'Year',type:'text'},{id:'a129_v3Make',label:'Make',type:'text'},{id:'a129_v3Model',label:'Model',type:'text'},
        {id:'a129_v3VIN',label:'VIN',type:'text'},{id:'a129_v3GVW',label:'GVW',type:'text'},{id:'a129_v3Cost',label:'Cost/Value',type:'number'},
        {id:'a129_v3Use',label:'Use',type:'select',opts:['','Service','Commercial','Retail','Pleasure','Farm']},
        {id:'a129_v3BI',label:'BI',type:'text'},{id:'a129_v3PD',label:'PD',type:'text'},{id:'a129_v3CompDed',label:'Comp Ded',type:'text'},{id:'a129_v3CollDed',label:'Coll Ded',type:'text'},
    ]},
    acord129_veh4: { title:'Vehicle 4', fields:[
        {id:'a129_v4Year',label:'Year',type:'text'},{id:'a129_v4Make',label:'Make',type:'text'},{id:'a129_v4Model',label:'Model',type:'text'},
        {id:'a129_v4VIN',label:'VIN',type:'text'},{id:'a129_v4GVW',label:'GVW',type:'text'},{id:'a129_v4Cost',label:'Cost/Value',type:'number'},
        {id:'a129_v4Use',label:'Use',type:'select',opts:['','Service','Commercial','Retail','Pleasure','Farm']},
        {id:'a129_v4BI',label:'BI',type:'text'},{id:'a129_v4PD',label:'PD',type:'text'},{id:'a129_v4CompDed',label:'Comp Ded',type:'text'},{id:'a129_v4CollDed',label:'Coll Ded',type:'text'},
    ]},
    acord129_veh5: { title:'Vehicle 5', fields:[
        {id:'a129_v5Year',label:'Year',type:'text'},{id:'a129_v5Make',label:'Make',type:'text'},{id:'a129_v5Model',label:'Model',type:'text'},
        {id:'a129_v5VIN',label:'VIN',type:'text'},{id:'a129_v5GVW',label:'GVW',type:'text'},{id:'a129_v5Cost',label:'Cost/Value',type:'number'},
        {id:'a129_v5Use',label:'Use',type:'select',opts:['','Service','Commercial','Retail','Pleasure','Farm']},
        {id:'a129_v5BI',label:'BI',type:'text'},{id:'a129_v5PD',label:'PD',type:'text'},{id:'a129_v5CompDed',label:'Comp Ded',type:'text'},{id:'a129_v5CollDed',label:'Coll Ded',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 130 FL - Florida Workers Comp (multi-page)
    // ══════════════════════════════════════════════════════════
    acord130_ownership: { title:'Page 1 — Ownership', fields:[
        {id:'a130_entityType',label:'Entity Type',type:'select',opts:['','Individual','Corporation','LLC','Partnership','Joint Venture','Trust','Non-Profit']},
        {id:'a130_stateInc',label:'State of Incorporation',type:'text',defaultVal:'FL'},
        {id:'a130_fein',label:'FEIN',type:'text'},
        {id:'a130_yearEstablished',label:'Year Established',type:'text'},
    ]},
    acord130_ratingInfo: { title:'Page 1 — Rating Information', fields:[
        {id:'a130_expMod',label:'Experience Modification Factor',type:'text'},
        {id:'a130_expModEffDate',label:'Mod Effective Date',type:'date'},
        {id:'a130_interstate',label:'Interstate?',type:'select',opts:['','Yes','No']},
        {id:'a130_numStates',label:'Number of States',type:'number'},
        {id:'a130_otherStates',label:'Other States',type:'text'},
    ]},
    acord130_class1: { title:'Page 2 — Classification 1', fields:[
        {id:'a130_c1Code',label:'Class Code',type:'text'},
        {id:'a130_c1Desc',label:'Description',type:'text'},
        {id:'a130_c1NumEmp',label:'# Employees',type:'number'},
        {id:'a130_c1FT',label:'Full-Time',type:'number'},
        {id:'a130_c1PT',label:'Part-Time',type:'number'},
        {id:'a130_c1Payroll',label:'Annual Remuneration',type:'number'},
        {id:'a130_c1Rate',label:'Rate',type:'number'},
        {id:'a130_c1Premium',label:'Estimated Premium',type:'number'},
    ]},
    acord130_class2: { title:'Page 2 — Classification 2', fields:[
        {id:'a130_c2Code',label:'Class Code',type:'text'},
        {id:'a130_c2Desc',label:'Description',type:'text'},
        {id:'a130_c2NumEmp',label:'# Employees',type:'number'},
        {id:'a130_c2Payroll',label:'Annual Remuneration',type:'number'},
        {id:'a130_c2Rate',label:'Rate',type:'number'},
        {id:'a130_c2Premium',label:'Estimated Premium',type:'number'},
    ]},
    acord130_class3: { title:'Page 2 — Classification 3', fields:[
        {id:'a130_c3Code',label:'Class Code',type:'text'},
        {id:'a130_c3Desc',label:'Description',type:'text'},
        {id:'a130_c3NumEmp',label:'# Employees',type:'number'},
        {id:'a130_c3Payroll',label:'Annual Remuneration',type:'number'},
        {id:'a130_c3Rate',label:'Rate',type:'number'},
    ]},
    acord130_priorCarrier: { title:'Page 3 — Prior Carrier', fields:[
        {id:'a130_priorCarrier1',label:'Prior Carrier (Current)',type:'text'},
        {id:'a130_priorPol1',label:'Policy Number',type:'text'},
        {id:'a130_priorEff1',label:'Effective Date',type:'date'},
        {id:'a130_priorExp1',label:'Expiration Date',type:'date'},
        {id:'a130_priorPrem1',label:'Annual Premium',type:'number'},
        {id:'a130_priorCarrier2',label:'Prior Carrier (Previous Year)',type:'text'},
        {id:'a130_priorPol2',label:'Policy Number',type:'text'},
        {id:'a130_priorPrem2',label:'Annual Premium',type:'number'},
        {id:'a130_priorCarrier3',label:'Prior Carrier (2 Years Ago)',type:'text'},
        {id:'a130_priorPol3',label:'Policy Number',type:'text'},
        {id:'a130_priorPrem3',label:'Annual Premium',type:'number'},
    ]},
    acord130_lossHistory: { title:'Page 3 — Loss History (5 Years)', fields:[
        {id:'a130_l1Year',label:'Year 1',type:'text'},
        {id:'a130_l1NumClaims',label:'# Claims',type:'number'},
        {id:'a130_l1Incurred',label:'Total Incurred',type:'number'},
        {id:'a130_l2Year',label:'Year 2',type:'text'},
        {id:'a130_l2NumClaims',label:'# Claims',type:'number'},
        {id:'a130_l2Incurred',label:'Total Incurred',type:'number'},
        {id:'a130_l3Year',label:'Year 3',type:'text'},
        {id:'a130_l3NumClaims',label:'# Claims',type:'number'},
        {id:'a130_l3Incurred',label:'Total Incurred',type:'number'},
        {id:'a130_l4Year',label:'Year 4',type:'text'},
        {id:'a130_l4NumClaims',label:'# Claims',type:'number'},
        {id:'a130_l4Incurred',label:'Total Incurred',type:'number'},
        {id:'a130_l5Year',label:'Year 5',type:'text'},
        {id:'a130_l5NumClaims',label:'# Claims',type:'number'},
        {id:'a130_l5Incurred',label:'Total Incurred',type:'number'},
    ]},
    acord130_stateInfo_fl: { title:'Page 4 — Florida-Specific Information', fields:[
        {id:'a130_fl_drugFree',label:'Drug-Free Workplace Program?',type:'select',opts:['','Yes','No']},
        {id:'a130_fl_drugFreeDiscount',label:'Drug-Free Discount Applied?',type:'select',opts:['','Yes','No']},
        {id:'a130_fl_safetyDiscount',label:'Safety Program Credit?',type:'select',opts:['','Yes','No']},
        {id:'a130_fl_deductible',label:'WC Deductible Elected',type:'select',opts:['','None','$1,000','$2,500','$5,000','$10,000']},
        {id:'a130_fl_managed',label:'Managed Care Arrangement',type:'select',opts:['','Yes','No']},
        {id:'a130_fl_leased',label:'Any Leased Employees?',type:'select',opts:['','Yes','No']},
        {id:'a130_fl_leasedFrom',label:'PEO / Leasing Company',type:'text'},
        {id:'a130_fl_subExcluded',label:'Subcontractors - Workers Excluded?',type:'select',opts:['','Yes','No']},
    ]},
    acord130_officers: { title:'Page 4 — Officers / Partners / Members', fields:[
        {id:'a130_off1Name',label:'Officer 1 Name',type:'text'},
        {id:'a130_off1Title',label:'Title',type:'text'},
        {id:'a130_off1Owner',label:'Ownership %',type:'number'},
        {id:'a130_off1Incl',label:'Included/Excluded',type:'select',opts:['','Included','Excluded']},
        {id:'a130_off1Duties',label:'Duties',type:'text'},
        {id:'a130_off1Payroll',label:'Annual Payroll',type:'number'},
        {id:'a130_off2Name',label:'Officer 2 Name',type:'text'},
        {id:'a130_off2Title',label:'Title',type:'text'},
        {id:'a130_off2Owner',label:'Ownership %',type:'number'},
        {id:'a130_off2Incl',label:'Included/Excluded',type:'select',opts:['','Included','Excluded']},
        {id:'a130_off2Duties',label:'Duties',type:'text'},
        {id:'a130_off2Payroll',label:'Annual Payroll',type:'number'},
        {id:'a130_off3Name',label:'Officer 3 Name',type:'text'},
        {id:'a130_off3Title',label:'Title',type:'text'},
        {id:'a130_off3Owner',label:'Ownership %',type:'number'},
        {id:'a130_off3Incl',label:'Included/Excluded',type:'select',opts:['','Included','Excluded']},
    ]},
    acord130_subcontractors: { title:'Page 5 — Subcontractors', fields:[
        {id:'a130_useSubs',label:'Use Subcontractors?',type:'select',opts:['','Yes','No']},
        {id:'a130_subCost',label:'Annual Cost of Subcontracted Work',type:'number'},
        {id:'a130_subUninsured',label:'Any Uninsured Subcontractors?',type:'select',opts:['','Yes','No']},
        {id:'a130_subCOI',label:'Certificates of Insurance Required?',type:'select',opts:['','Yes','No']},
        {id:'a130_subWCRequired',label:'WC Required from All Subs?',type:'select',opts:['','Yes','No']},
    ]},
    acord130_safetyProgram: { title:'Page 5 — Safety Program', fields:[
        {id:'a130_safetyProgram',label:'Written Safety Program?',type:'select',opts:['','Yes','No']},
        {id:'a130_safetyOfficer',label:'Designated Safety Officer',type:'text'},
        {id:'a130_safetyMeetings',label:'Regular Safety Meetings?',type:'select',opts:['','Yes','No']},
        {id:'a130_safetyTraining',label:'New Employee Safety Training?',type:'select',opts:['','Yes','No']},
        {id:'a130_ppe',label:'PPE Provided?',type:'select',opts:['','Yes','No']},
        {id:'a130_firstAid',label:'First Aid Kits on Site?',type:'select',opts:['','Yes','No']},
        {id:'a130_osha',label:'OSHA Violations in Last 3 Years?',type:'select',opts:['','Yes','No']},
        {id:'a130_oshaDetail',label:'OSHA Violation Details',type:'textarea'},
    ]},

    // ACORD 130 Additional Locations
    acord130_addloc1: { title:'Additional Location 1', fields:[
        {id:'a130_al1Addr',label:'Address',type:'text'},{id:'a130_al1City',label:'City',type:'text'},{id:'a130_al1State',label:'State',type:'text'},{id:'a130_al1Zip',label:'Zip',type:'text'},
        {id:'a130_al1NumEmp',label:'# Employees',type:'number'},{id:'a130_al1Payroll',label:'Total Payroll',type:'number'},
    ]},
    acord130_addloc2: { title:'Additional Location 2', fields:[
        {id:'a130_al2Addr',label:'Address',type:'text'},{id:'a130_al2City',label:'City',type:'text'},{id:'a130_al2State',label:'State',type:'text'},{id:'a130_al2Zip',label:'Zip',type:'text'},
        {id:'a130_al2NumEmp',label:'# Employees',type:'number'},{id:'a130_al2Payroll',label:'Total Payroll',type:'number'},
    ]},
    acord130_addloc3: { title:'Additional Location 3', fields:[
        {id:'a130_al3Addr',label:'Address',type:'text'},{id:'a130_al3City',label:'City',type:'text'},{id:'a130_al3State',label:'State',type:'text'},{id:'a130_al3Zip',label:'Zip',type:'text'},
        {id:'a130_al3NumEmp',label:'# Employees',type:'number'},{id:'a130_al3Payroll',label:'Total Payroll',type:'number'},
    ]},
    acord130_addlClass1: { title:'Additional Location Classifications 1', fields:[
        {id:'a130_alc1Code',label:'Class Code',type:'text'},{id:'a130_alc1Desc',label:'Description',type:'text'},{id:'a130_alc1Payroll',label:'Payroll',type:'number'},
    ]},
    acord130_addlClass2: { title:'Additional Location Classifications 2', fields:[
        {id:'a130_alc2Code',label:'Class Code',type:'text'},{id:'a130_alc2Desc',label:'Description',type:'text'},{id:'a130_alc2Payroll',label:'Payroll',type:'number'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 140 - Additional Locations
    // ══════════════════════════════════════════════════════════
    acord140_loc2: { title:'Location 2', fields:[
        {id:'a140_l2Addr',label:'Address',type:'text'},{id:'a140_l2City',label:'City',type:'text'},{id:'a140_l2State',label:'State',type:'text'},{id:'a140_l2Zip',label:'Zip',type:'text'},
        {id:'a140_l2YrBuilt',label:'Year Built',type:'text'},{id:'a140_l2SqFt',label:'Square Footage',type:'number'},{id:'a140_l2Stories',label:'Stories',type:'number'},
        {id:'a140_l2Construction',label:'Construction',type:'select',opts:['','Frame','Joisted Masonry','Non-Combustible','Fire Resistive']},
        {id:'a140_l2Occupancy',label:'Occupancy',type:'text'},
    ]},
    acord140_loc3: { title:'Location 3', fields:[
        {id:'a140_l3Addr',label:'Address',type:'text'},{id:'a140_l3City',label:'City',type:'text'},{id:'a140_l3State',label:'State',type:'text'},{id:'a140_l3Zip',label:'Zip',type:'text'},
        {id:'a140_l3YrBuilt',label:'Year Built',type:'text'},{id:'a140_l3SqFt',label:'Square Footage',type:'number'},
        {id:'a140_l3Construction',label:'Construction',type:'select',opts:['','Frame','Joisted Masonry','Non-Combustible','Fire Resistive']},
    ]},
    acord140_loc2_building: { title:'Location 2 Building Values', fields:[
        {id:'a140_l2BldgVal',label:'Building Value',type:'number'},{id:'a140_l2BPP',label:'BPP Value',type:'number'},
        {id:'a140_l2BI',label:'Business Income',type:'number'},{id:'a140_l2EE',label:'Extra Expense',type:'number'},
    ]},
    acord140_loc3_building: { title:'Location 3 Building Values', fields:[
        {id:'a140_l3BldgVal',label:'Building Value',type:'number'},{id:'a140_l3BPP',label:'BPP Value',type:'number'},
        {id:'a140_l3BI',label:'Business Income',type:'number'},{id:'a140_l3EE',label:'Extra Expense',type:'number'},
    ]},
    acord140_addl_coverage: { title:'Additional Location Coverage', fields:[
        {id:'a140_addlCoins',label:'Coinsurance %',type:'select',opts:['','80%','90%','100%']},
        {id:'a140_addlValuation',label:'Valuation',type:'select',opts:['','Replacement Cost','Actual Cash Value','Agreed Value','Functional Replacement']},
        {id:'a140_addlCause',label:'Cause of Loss',type:'select',opts:['','Basic','Broad','Special']},
        {id:'a140_addlDeductible',label:'Deductible',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 175 - Commercial Lines Checklist
    // ══════════════════════════════════════════════════════════
    acord175_checklist: { title:'Policy Checklist', fields:[
        {id:'a175_gl',label:'General Liability',type:'select',opts:['','Included','Not Included','Separate Policy']},
        {id:'a175_property',label:'Property',type:'select',opts:['','Included','Not Included','Separate Policy']},
        {id:'a175_auto',label:'Commercial Auto',type:'select',opts:['','Included','Not Included','Separate Policy']},
        {id:'a175_wc',label:'Workers Compensation',type:'select',opts:['','Included','Not Included','Separate Policy']},
        {id:'a175_umbrella',label:'Umbrella / Excess',type:'select',opts:['','Included','Not Included','Separate Policy']},
        {id:'a175_crime',label:'Crime',type:'select',opts:['','Included','Not Included']},
        {id:'a175_epli',label:'EPLI',type:'select',opts:['','Included','Not Included']},
        {id:'a175_cyber',label:'Cyber Liability',type:'select',opts:['','Included','Not Included']},
        {id:'a175_do',label:'D&O',type:'select',opts:['','Included','Not Included']},
        {id:'a175_profLiab',label:'Professional Liability',type:'select',opts:['','Included','Not Included']},
        {id:'a175_im',label:'Inland Marine',type:'select',opts:['','Included','Not Included']},
    ]},
    acord175_endorsements: { title:'Endorsements', fields:[
        {id:'a175_addlInsured',label:'Additional Insured Endorsements',type:'textarea'},
        {id:'a175_waiverSub',label:'Waiver of Subrogation',type:'textarea'},
        {id:'a175_primNonContrib',label:'Primary & Non-Contributory',type:'textarea'},
        {id:'a175_otherEndorsements',label:'Other Endorsements',type:'textarea'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 211 - Professional Liability
    // ══════════════════════════════════════════════════════════
    acord211_profInfo: { title:'Professional Information', fields:[
        {id:'a211_profType',label:'Type of Professional Service',type:'text'},
        {id:'a211_yearsExp',label:'Years of Professional Experience',type:'number'},
        {id:'a211_licenses',label:'Professional Licenses Held',type:'text'},
        {id:'a211_numProf',label:'# Licensed Professionals',type:'number'},
        {id:'a211_annRevenue',label:'Annual Gross Revenue',type:'number'},
        {id:'a211_annBillings',label:'Annual Billings',type:'number'},
        {id:'a211_largestProject',label:'Largest Single Project/Contract',type:'number'},
        {id:'a211_contracts',label:'Use Written Contracts?',type:'select',opts:['','Always','Usually','Sometimes','Never']},
    ]},
    acord211_claims: { title:'Claims History', fields:[
        {id:'a211_anyClaimsEver',label:'Any Claims/Suits Ever?',type:'select',opts:['','Yes','No']},
        {id:'a211_claimsLast5',label:'# Claims Last 5 Years',type:'number'},
        {id:'a211_c1Date',label:'Claim 1 Date',type:'date'},
        {id:'a211_c1Desc',label:'Description',type:'text'},
        {id:'a211_c1Amt',label:'Amount',type:'number'},
        {id:'a211_c1Status',label:'Status',type:'select',opts:['','Open','Closed','Reserved']},
        {id:'a211_c2Date',label:'Claim 2 Date',type:'date'},
        {id:'a211_c2Desc',label:'Description',type:'text'},
        {id:'a211_c2Amt',label:'Amount',type:'number'},
        {id:'a211_awareClaim',label:'Aware of Any Potential Claims?',type:'select',opts:['','Yes','No']},
        {id:'a211_awareDetail',label:'Details',type:'textarea'},
    ]},
    acord211_coverage: { title:'Coverage Requested', fields:[
        {id:'a211_limit',label:'Per Claim Limit',type:'select',opts:['','$250,000','$500,000','$1,000,000','$2,000,000','$5,000,000']},
        {id:'a211_aggregate',label:'Aggregate Limit',type:'select',opts:['','$500,000','$1,000,000','$2,000,000','$5,000,000','$10,000,000']},
        {id:'a211_deductible',label:'Deductible',type:'select',opts:['','$1,000','$2,500','$5,000','$10,000','$25,000']},
        {id:'a211_retro',label:'Retroactive Date',type:'date'},
        {id:'a211_priorCarrier',label:'Prior Carrier',type:'text'},
        {id:'a211_priorLimit',label:'Prior Limits',type:'text'},
        {id:'a211_priorPrem',label:'Prior Premium',type:'number'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 501 - Surety Report of Execution
    // ══════════════════════════════════════════════════════════
    acord501_principal: { title:'Principal', fields:[
        {id:'a501_prinName',label:'Principal Name',type:'text',map:'name'},
        {id:'a501_prinAddr',label:'Address',type:'text',map:'address'},
        {id:'a501_prinCity',label:'City',type:'text',map:'city'},
        {id:'a501_prinState',label:'State',type:'text',map:'state'},
        {id:'a501_prinZip',label:'Zip',type:'text',map:'zip'},
    ]},
    acord501_surety: { title:'Surety Company', fields:[
        {id:'a501_suretyName',label:'Surety Company',type:'text'},
        {id:'a501_suretyAddr',label:'Address',type:'text'},
        {id:'a501_attorneyInFact',label:'Attorney-in-Fact',type:'text'},
    ]},
    acord501_bond: { title:'Bond Information', fields:[
        {id:'a501_bondNum',label:'Bond Number',type:'text'},
        {id:'a501_bondType',label:'Type of Bond',type:'text'},
        {id:'a501_bondAmt',label:'Bond Amount',type:'number'},
        {id:'a501_bondPrem',label:'Premium',type:'number'},
        {id:'a501_obligee',label:'Obligee',type:'text'},
        {id:'a501_obligeeAddr',label:'Obligee Address',type:'text'},
        {id:'a501_effDate',label:'Effective Date',type:'date'},
        {id:'a501_expDate',label:'Expiration Date',type:'date'},
    ]},
    acord501_execution: { title:'Execution Details', fields:[
        {id:'a501_execDate',label:'Date of Execution',type:'date'},
        {id:'a501_execPlace',label:'Place of Execution',type:'text'},
        {id:'a501_witnessName',label:'Witness Name',type:'text'},
        {id:'a501_notaryName',label:'Notary Public Name',type:'text'},
        {id:'a501_notaryComm',label:'Commission Expiration',type:'date'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 610 - Premium Payment Supplement
    // ══════════════════════════════════════════════════════════
    acord610_payment: { title:'Payment Information', fields:[
        {id:'a610_totalPrem',label:'Total Policy Premium',type:'number',map:'premium'},
        {id:'a610_payPlan',label:'Payment Plan',type:'select',opts:['','Annual','Semi-Annual','Quarterly','Monthly','10-Pay','9-Pay','Other']},
        {id:'a610_downPayment',label:'Down Payment Amount',type:'number'},
        {id:'a610_downPayDate',label:'Down Payment Due Date',type:'date'},
        {id:'a610_payMethod',label:'Payment Method',type:'select',opts:['','Check','EFT/ACH','Credit Card','Premium Finance','Direct Bill','Agency Bill']},
    ]},
    acord610_installments: { title:'Installment Schedule', fields:[
        {id:'a610_inst1Date',label:'Installment 1 Due',type:'date'},{id:'a610_inst1Amt',label:'Amount',type:'number'},
        {id:'a610_inst2Date',label:'Installment 2 Due',type:'date'},{id:'a610_inst2Amt',label:'Amount',type:'number'},
        {id:'a610_inst3Date',label:'Installment 3 Due',type:'date'},{id:'a610_inst3Amt',label:'Amount',type:'number'},
        {id:'a610_inst4Date',label:'Installment 4 Due',type:'date'},{id:'a610_inst4Amt',label:'Amount',type:'number'},
        {id:'a610_inst5Date',label:'Installment 5 Due',type:'date'},{id:'a610_inst5Amt',label:'Amount',type:'number'},
        {id:'a610_inst6Date',label:'Installment 6 Due',type:'date'},{id:'a610_inst6Amt',label:'Amount',type:'number'},
    ]},
    acord610_financeCompany: { title:'Premium Finance Company', fields:[
        {id:'a610_finCo',label:'Finance Company Name',type:'text'},
        {id:'a610_finAddr',label:'Address',type:'text'},
        {id:'a610_finPhone',label:'Phone',type:'tel'},
        {id:'a610_finAcct',label:'Account Number',type:'text'},
        {id:'a610_finAmt',label:'Amount Financed',type:'number'},
        {id:'a610_finRate',label:'Interest Rate %',type:'number'},
        {id:'a610_finTerm',label:'Term (months)',type:'number'},
        {id:'a610_finMonthly',label:'Monthly Payment',type:'number'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 807 - Directors & Officers (multi-page)
    // ══════════════════════════════════════════════════════════
    acord807_orgInfo: { title:'Page 1 — Organization Information', fields:[
        {id:'a807_orgType',label:'Type of Organization',type:'select',opts:['','For-Profit Corporation','Non-Profit','LLC','Partnership','Association','Other']},
        {id:'a807_stateInc',label:'State of Incorporation',type:'text',defaultVal:'FL'},
        {id:'a807_dateInc',label:'Date of Incorporation',type:'date'},
        {id:'a807_publicPrivate',label:'Public or Private?',type:'select',opts:['','Public','Private']},
        {id:'a807_stockExchange',label:'Stock Exchange (if public)',type:'text'},
        {id:'a807_annRevenue',label:'Total Annual Revenue',type:'number'},
        {id:'a807_totalAssets',label:'Total Assets',type:'number'},
        {id:'a807_numEmp',label:'Total Employees',type:'number'},
        {id:'a807_numSubs',label:'Number of Subsidiaries',type:'number'},
        {id:'a807_subNames',label:'Subsidiary Names',type:'textarea'},
    ]},
    acord807_directors: { title:'Page 2 — Directors & Officers', fields:[
        {id:'a807_d1Name',label:'Director/Officer 1 Name',type:'text'},
        {id:'a807_d1Title',label:'Title',type:'text'},
        {id:'a807_d1Since',label:'Serving Since',type:'date'},
        {id:'a807_d1Compensation',label:'Annual Compensation',type:'number'},
        {id:'a807_d2Name',label:'Director/Officer 2 Name',type:'text'},
        {id:'a807_d2Title',label:'Title',type:'text'},
        {id:'a807_d2Since',label:'Serving Since',type:'date'},
        {id:'a807_d3Name',label:'Director/Officer 3 Name',type:'text'},
        {id:'a807_d3Title',label:'Title',type:'text'},
        {id:'a807_d4Name',label:'Director/Officer 4 Name',type:'text'},
        {id:'a807_d4Title',label:'Title',type:'text'},
        {id:'a807_d5Name',label:'Director/Officer 5 Name',type:'text'},
        {id:'a807_d5Title',label:'Title',type:'text'},
        {id:'a807_totalBoard',label:'Total Board Members',type:'number'},
        {id:'a807_indepBoard',label:'# Independent Board Members',type:'number'},
    ]},
    acord807_claims: { title:'Page 3 — Claims / Prior Coverage', fields:[
        {id:'a807_anyClaims',label:'Any Claims/Suits Last 5 Years?',type:'select',opts:['','Yes','No']},
        {id:'a807_c1Date',label:'Claim 1 Date',type:'date'},
        {id:'a807_c1Desc',label:'Description',type:'text'},
        {id:'a807_c1Amt',label:'Amount',type:'number'},
        {id:'a807_c1Status',label:'Status',type:'select',opts:['','Open','Closed']},
        {id:'a807_awarePotential',label:'Aware of Potential Claims?',type:'select',opts:['','Yes','No']},
        {id:'a807_awareDetail',label:'Details',type:'textarea'},
        {id:'a807_priorCarrier',label:'Prior D&O Carrier',type:'text'},
        {id:'a807_priorLimit',label:'Prior Limit',type:'text'},
        {id:'a807_priorRetro',label:'Retroactive Date',type:'date'},
        {id:'a807_priorPrem',label:'Prior Premium',type:'number'},
    ]},
    acord807_coverage: { title:'Page 3 — Coverage Requested', fields:[
        {id:'a807_limit',label:'Limit of Liability',type:'select',opts:['','$500,000','$1,000,000','$2,000,000','$5,000,000','$10,000,000']},
        {id:'a807_retention',label:'Retention / Deductible',type:'select',opts:['','$0','$5,000','$10,000','$25,000','$50,000']},
        {id:'a807_sideA',label:'Side A (Non-Indemnifiable)',type:'select',opts:['','Included','Not Included']},
        {id:'a807_sideB',label:'Side B (Corporate Reimbursement)',type:'select',opts:['','Included','Not Included']},
        {id:'a807_sideC',label:'Side C (Entity Coverage)',type:'select',opts:['','Included','Not Included']},
        {id:'a807_epli',label:'Include EPLI?',type:'select',opts:['','Yes','No']},
        {id:'a807_fiduciary',label:'Include Fiduciary?',type:'select',opts:['','Yes','No']},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 810 - Business Income / Extra Expense
    // ══════════════════════════════════════════════════════════
    acord810_income: { title:'Business Income', fields:[
        {id:'a810_annGross',label:'Annual Gross Sales/Revenue',type:'number'},
        {id:'a810_annPayroll',label:'Annual Payroll',type:'number'},
        {id:'a810_annExpenses',label:'Annual Operating Expenses',type:'number'},
        {id:'a810_netIncome',label:'Net Income (Profit)',type:'number'},
        {id:'a810_ordPayroll',label:'Ordinary Payroll Amount',type:'number'},
        {id:'a810_ordPayrollDays',label:'Ordinary Payroll # of Days',type:'number'},
    ]},
    acord810_expenses: { title:'Extra Expense', fields:[
        {id:'a810_extraExpEst',label:'Estimated Extra Expense if Shutdown',type:'number'},
        {id:'a810_tempLocCost',label:'Temp Location Cost (monthly)',type:'number'},
        {id:'a810_equipRental',label:'Equipment Rental Cost (monthly)',type:'number'},
        {id:'a810_maxDowntime',label:'Estimated Max Downtime (months)',type:'number'},
    ]},
    acord810_rental: { title:'Rental Value', fields:[
        {id:'a810_rentalIncome',label:'Monthly Rental Income',type:'number'},
        {id:'a810_annRentalIncome',label:'Annual Rental Income',type:'number'},
        {id:'a810_numUnits',label:'Number of Rental Units',type:'number'},
        {id:'a810_avgVacancy',label:'Average Vacancy Rate %',type:'number'},
    ]},
    acord810_coverage: { title:'Coverage Options', fields:[
        {id:'a810_biLimit',label:'Business Income Limit',type:'number'},
        {id:'a810_eeLimit',label:'Extra Expense Limit',type:'number'},
        {id:'a810_rentalLimit',label:'Rental Value Limit',type:'number'},
        {id:'a810_coinsurance',label:'Coinsurance %',type:'select',opts:['','50%','60%','70%','80%','90%','100%']},
        {id:'a810_waitPeriod',label:'Waiting Period',type:'select',opts:['','24 hours','48 hours','72 hours']},
        {id:'a810_indemnity',label:'Period of Indemnity',type:'select',opts:['','12 months','18 months','24 months','Actual Loss Sustained']},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 811 - Value Reporting
    // ══════════════════════════════════════════════════════════
    acord811_loc1: { title:'Location 1 Values', fields:[
        {id:'a811_l1Addr',label:'Address',type:'text',map:'address'},
        {id:'a811_l1Bldg',label:'Building Value',type:'number'},
        {id:'a811_l1BPP',label:'BPP Value',type:'number'},
        {id:'a811_l1Stock',label:'Stock / Inventory',type:'number'},
        {id:'a811_l1Total',label:'Total Values',type:'number'},
    ]},
    acord811_loc2: { title:'Location 2 Values', fields:[
        {id:'a811_l2Addr',label:'Address',type:'text'},
        {id:'a811_l2Bldg',label:'Building Value',type:'number'},
        {id:'a811_l2BPP',label:'BPP Value',type:'number'},
        {id:'a811_l2Stock',label:'Stock / Inventory',type:'number'},
        {id:'a811_l2Total',label:'Total Values',type:'number'},
    ]},
    acord811_values: { title:'Reporting Summary', fields:[
        {id:'a811_reportDate',label:'Report Date',type:'date'},
        {id:'a811_reportPeriod',label:'Report Period',type:'select',opts:['','Monthly','Quarterly','Semi-Annual','Annual']},
        {id:'a811_totalAllLocs',label:'Total All Locations',type:'number'},
        {id:'a811_maxAnyOneLoc',label:'Max Value Any One Location',type:'number'},
        {id:'a811_preparedBy',label:'Prepared By',type:'text'},
        {id:'a811_preparedTitle',label:'Title',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 819 - Producer Appointment
    // ══════════════════════════════════════════════════════════
    acord819_producer: { title:'Producer Information', fields:[
        {id:'a819_prodName',label:'Producer / Agent Name',type:'text'},
        {id:'a819_prodAgency',label:'Agency Name',type:'text',defaultVal:'Universal Insurance Brokers'},
        {id:'a819_prodAddr',label:'Address',type:'text'},
        {id:'a819_prodCity',label:'City',type:'text'},
        {id:'a819_prodState',label:'State',type:'text',defaultVal:'FL'},
        {id:'a819_prodZip',label:'Zip',type:'text'},
        {id:'a819_prodSSN',label:'SSN / Tax ID',type:'text'},
        {id:'a819_prodDOB',label:'Date of Birth',type:'date'},
        {id:'a819_prodLicNum',label:'License Number',type:'text'},
        {id:'a819_prodLicState',label:'License State',type:'text',defaultVal:'FL'},
        {id:'a819_prodLicExp',label:'License Expiration',type:'date'},
        {id:'a819_prodEO',label:'E&O Insurance Carrier',type:'text'},
        {id:'a819_prodEOPol',label:'E&O Policy Number',type:'text'},
        {id:'a819_prodEOExp',label:'E&O Expiration',type:'date'},
    ]},
    acord819_company: { title:'Company Information', fields:[
        {id:'a819_coName',label:'Insurance Company Name',type:'text'},
        {id:'a819_coNAIC',label:'NAIC Code',type:'text'},
        {id:'a819_coAddr',label:'Company Address',type:'text'},
    ]},
    acord819_appointment: { title:'Appointment Details', fields:[
        {id:'a819_action',label:'Action',type:'select',opts:['','New Appointment','Termination','Change']},
        {id:'a819_effDate',label:'Effective Date',type:'date'},
        {id:'a819_termDate',label:'Termination Date (if applicable)',type:'date'},
        {id:'a819_termReason',label:'Reason for Termination',type:'select',opts:['','Voluntary','Involuntary - Cause','Involuntary - Other','Mutual Agreement']},
        {id:'a819_termDetail',label:'Termination Details',type:'textarea'},
    ]},
    acord819_linesAuth: { title:'Lines of Authority', fields:[
        {id:'a819_propCas',label:'Property & Casualty',type:'select',opts:['','Yes','No']},
        {id:'a819_life',label:'Life',type:'select',opts:['','Yes','No']},
        {id:'a819_health',label:'Health',type:'select',opts:['','Yes','No']},
        {id:'a819_surety',label:'Surety',type:'select',opts:['','Yes','No']},
        {id:'a819_variable',label:'Variable Products',type:'select',opts:['','Yes','No']},
        {id:'a819_otherLines',label:'Other Lines',type:'text'},
    ]},

    // ══════════════════════════════════════════════════════════
    // ACORD 823 - Misc Professional Liability
    // ══════════════════════════════════════════════════════════
    acord823_profInfo: { title:'Professional Information', fields:[
        {id:'a823_profType',label:'Type of Professional',type:'text'},
        {id:'a823_specialty',label:'Specialty / Area of Practice',type:'text'},
        {id:'a823_yearsExp',label:'Years Experience',type:'number'},
        {id:'a823_numPractitioners',label:'# Practitioners',type:'number'},
        {id:'a823_annRevenue',label:'Annual Revenue',type:'number'},
        {id:'a823_annFees',label:'Annual Professional Fees',type:'number'},
    ]},
    acord823_services: { title:'Services Provided', fields:[
        {id:'a823_svcDesc',label:'Description of Services',type:'textarea'},
        {id:'a823_clientTypes',label:'Types of Clients Served',type:'textarea'},
        {id:'a823_contracts',label:'Written Contracts Used?',type:'select',opts:['','Always','Usually','Sometimes','Never']},
        {id:'a823_engagementLetters',label:'Engagement Letters Used?',type:'select',opts:['','Always','Usually','Sometimes','Never']},
        {id:'a823_peerReview',label:'Subject to Peer Review?',type:'select',opts:['','Yes','No']},
    ]},
    acord823_claims: { title:'Claims', fields:[
        {id:'a823_anyClaims',label:'Any Claims Last 5 Years?',type:'select',opts:['','Yes','No']},
        {id:'a823_c1Date',label:'Claim 1 Date',type:'date'},
        {id:'a823_c1Desc',label:'Description',type:'text'},
        {id:'a823_c1Amt',label:'Amount',type:'number'},
        {id:'a823_c2Date',label:'Claim 2 Date',type:'date'},
        {id:'a823_c2Desc',label:'Description',type:'text'},
        {id:'a823_c2Amt',label:'Amount',type:'number'},
        {id:'a823_declined',label:'Ever Declined/Cancelled?',type:'select',opts:['','Yes','No']},
    ]},
    acord823_coverage: { title:'Coverage', fields:[
        {id:'a823_limit',label:'Per Claim Limit',type:'select',opts:['','$250,000','$500,000','$1,000,000','$2,000,000','$5,000,000']},
        {id:'a823_agg',label:'Aggregate',type:'select',opts:['','$500,000','$1,000,000','$2,000,000','$5,000,000','$10,000,000']},
        {id:'a823_deductible',label:'Deductible',type:'select',opts:['','$1,000','$2,500','$5,000','$10,000','$25,000']},
        {id:'a823_retro',label:'Retroactive Date',type:'date'},
        {id:'a823_priorCarrier',label:'Prior Carrier',type:'text'},
        {id:'a823_priorPrem',label:'Prior Premium',type:'number'},
    ]},

    // ══════════════════════════════════════════════════════════
    // Custom Forms
    // ══════════════════════════════════════════════════════════
    cancelLetter_details: { title:'Cancellation Letter Details', fields:[
        {id:'cl_priorCarrier',label:'Prior Insurance Company',type:'text'},
        {id:'cl_priorPol',label:'Prior Policy Number',type:'text'},
        {id:'cl_priorEffDate',label:'Prior Policy Effective Date',type:'date'},
        {id:'cl_priorExpDate',label:'Prior Policy Expiration Date',type:'date'},
        {id:'cl_cancelDate',label:'Requested Cancellation Date',type:'date'},
        {id:'cl_reason',label:'Reason for Cancellation',type:'select',opts:['','Replaced with New Policy','Sold Property','Vehicle Sold','No Longer Needed','Other']},
        {id:'cl_newCarrier',label:'New Insurance Company',type:'text'},
        {id:'cl_newPolNum',label:'New Policy Number',type:'text'},
        {id:'cl_newEffDate',label:'New Policy Effective Date',type:'date'},
        {id:'cl_refundMethod',label:'Refund Method',type:'select',opts:['','Check','EFT','Credit to Account']},
        {id:'cl_additionalNotes',label:'Additional Notes',type:'textarea'},
    ]},

    cargo_operations: { title:'Operations', fields:[
        {id:'cg_opType',label:'Type of Trucking Operations',type:'select',opts:['','For Hire','Private','Both']},
        {id:'cg_authority',label:'Operating Authority / MC #',type:'text'},
        {id:'cg_dot',label:'DOT #',type:'text'},
        {id:'cg_radius',label:'Radius of Operations',type:'select',opts:['','Local (0-100 mi)','Regional (100-500 mi)','Long Haul (500+ mi)','Nationwide']},
        {id:'cg_numPowerUnits',label:'# Power Units',type:'number'},
        {id:'cg_numTrailers',label:'# Trailers',type:'number'},
        {id:'cg_numDrivers',label:'# Drivers',type:'number'},
        {id:'cg_annMiles',label:'Total Annual Miles',type:'number'},
        {id:'cg_annRevenue',label:'Annual Gross Revenue',type:'number'},
    ]},
    cargo_vehicles: { title:'Vehicle Schedule', fields:[
        {id:'cg_v1Year',label:'Unit 1 Year',type:'text'},{id:'cg_v1Make',label:'Make',type:'text'},{id:'cg_v1Model',label:'Model',type:'text'},
        {id:'cg_v1VIN',label:'VIN',type:'text'},{id:'cg_v1GVW',label:'GVW',type:'text'},{id:'cg_v1Value',label:'Value',type:'number'},
        {id:'cg_v2Year',label:'Unit 2 Year',type:'text'},{id:'cg_v2Make',label:'Make',type:'text'},{id:'cg_v2Model',label:'Model',type:'text'},
        {id:'cg_v2VIN',label:'VIN',type:'text'},{id:'cg_v2GVW',label:'GVW',type:'text'},{id:'cg_v2Value',label:'Value',type:'number'},
        {id:'cg_v3Year',label:'Unit 3 Year',type:'text'},{id:'cg_v3Make',label:'Make',type:'text'},{id:'cg_v3Model',label:'Model',type:'text'},
        {id:'cg_v3VIN',label:'VIN',type:'text'},{id:'cg_v3GVW',label:'GVW',type:'text'},{id:'cg_v3Value',label:'Value',type:'number'},
    ]},
    cargo_drivers: { title:'Driver Information', fields:[
        {id:'cg_d1Name',label:'Driver 1 Name',type:'text'},{id:'cg_d1DOB',label:'DOB',type:'date'},{id:'cg_d1DL',label:'CDL #',type:'text'},
        {id:'cg_d1DLState',label:'State',type:'text',defaultVal:'FL'},{id:'cg_d1Exp',label:'Years CDL Experience',type:'number'},
        {id:'cg_d1MVR',label:'MVR Clean?',type:'select',opts:['','Yes','No']},
        {id:'cg_d2Name',label:'Driver 2 Name',type:'text'},{id:'cg_d2DOB',label:'DOB',type:'date'},{id:'cg_d2DL',label:'CDL #',type:'text'},
        {id:'cg_d2DLState',label:'State',type:'text'},{id:'cg_d2Exp',label:'Years CDL Experience',type:'number'},
        {id:'cg_d3Name',label:'Driver 3 Name',type:'text'},{id:'cg_d3DOB',label:'DOB',type:'date'},{id:'cg_d3DL',label:'CDL #',type:'text'},
    ]},
    cargo_commodities: { title:'Commodities Hauled', fields:[
        {id:'cg_comm1',label:'Commodity 1',type:'text'},
        {id:'cg_comm1Pct',label:'% of Hauls',type:'number'},
        {id:'cg_comm1MaxLoad',label:'Max Load Value',type:'number'},
        {id:'cg_comm2',label:'Commodity 2',type:'text'},
        {id:'cg_comm2Pct',label:'% of Hauls',type:'number'},
        {id:'cg_comm2MaxLoad',label:'Max Load Value',type:'number'},
        {id:'cg_comm3',label:'Commodity 3',type:'text'},
        {id:'cg_comm3Pct',label:'% of Hauls',type:'number'},
        {id:'cg_hazmat',label:'Haul Hazmat?',type:'select',opts:['','Yes','No']},
        {id:'cg_hazmatDesc',label:'Hazmat Description',type:'text'},
        {id:'cg_refrig',label:'Refrigerated?',type:'select',opts:['','Yes','No']},
    ]},
    cargo_coverage: { title:'Coverage', fields:[
        {id:'cg_alBI',label:'Auto Liability BI',type:'text'},
        {id:'cg_alPD',label:'Auto Liability PD',type:'text'},
        {id:'cg_alCSL',label:'Combined Single Limit',type:'text'},
        {id:'cg_cargoLimit',label:'Cargo Coverage Limit',type:'number'},
        {id:'cg_cargoDeduct',label:'Cargo Deductible',type:'text'},
        {id:'cg_reefer',label:'Reefer Breakdown Coverage',type:'select',opts:['','Yes','No']},
        {id:'cg_trailer',label:'Trailer Interchange Coverage',type:'select',opts:['','Yes','No']},
        {id:'cg_pollution',label:'Pollution Liability',type:'select',opts:['','Yes','No']},
        {id:'cg_genLiab',label:'General Liability',type:'select',opts:['','Yes','No']},
        {id:'cg_physDam',label:'Physical Damage',type:'select',opts:['','Comp + Coll','Comp Only','None']},
    ]},
    cargo_lossHistory: { title:'Loss History (3 Years)', fields:[
        {id:'cg_l1Year',label:'Year 1',type:'text'},{id:'cg_l1Claims',label:'# Claims',type:'number'},{id:'cg_l1Incurred',label:'Total Incurred',type:'number'},
        {id:'cg_l2Year',label:'Year 2',type:'text'},{id:'cg_l2Claims',label:'# Claims',type:'number'},{id:'cg_l2Incurred',label:'Total Incurred',type:'number'},
        {id:'cg_l3Year',label:'Year 3',type:'text'},{id:'cg_l3Claims',label:'# Claims',type:'number'},{id:'cg_l3Incurred',label:'Total Incurred',type:'number'},
    ]},

    // Safepoint Restaurant
    sp_restaurant: { title:'Restaurant Information', fields:[
        {id:'sp_restName',label:'Restaurant Name',type:'text'},
        {id:'sp_cuisine',label:'Type of Cuisine',type:'text'},
        {id:'sp_seating',label:'Seating Capacity',type:'number'},
        {id:'sp_annSales',label:'Annual Food/Beverage Sales',type:'number'},
        {id:'sp_liquorPct',label:'Liquor Sales % of Total',type:'number'},
        {id:'sp_hoursOp',label:'Hours of Operation',type:'text'},
        {id:'sp_daysOpen',label:'Days Open Per Week',type:'number'},
        {id:'sp_delivery',label:'Delivery Service?',type:'select',opts:['','Yes','No']},
        {id:'sp_catering',label:'Catering?',type:'select',opts:['','Yes','No']},
    ]},
    sp_operations: { title:'Operations', fields:[
        {id:'sp_deepFryer',label:'Deep Fryer?',type:'select',opts:['','Yes','No']},
        {id:'sp_grill',label:'Open Flame Grill?',type:'select',opts:['','Yes','No']},
        {id:'sp_hood',label:'Exhaust Hood System?',type:'select',opts:['','Yes','No']},
        {id:'sp_hoodInsp',label:'Hood System Last Inspected',type:'date'},
        {id:'sp_ansulSystem',label:'Ansul/Suppression System?',type:'select',opts:['','Yes','No']},
        {id:'sp_ansulInsp',label:'Suppression Last Inspected',type:'date'},
        {id:'sp_playground',label:'Playground Equipment?',type:'select',opts:['','Yes','No']},
        {id:'sp_entertainment',label:'Entertainment/Dancing?',type:'select',opts:['','Yes','No']},
    ]},
    sp_safety: { title:'Safety', fields:[
        {id:'sp_fireExt',label:'Fire Extinguishers?',type:'select',opts:['','Yes','No']},
        {id:'sp_fireAlarm',label:'Fire Alarm?',type:'select',opts:['','Yes','No']},
        {id:'sp_sprinkler',label:'Sprinkler System?',type:'select',opts:['','Yes','No']},
        {id:'sp_floorMats',label:'Non-Slip Floor Mats?',type:'select',opts:['','Yes','No']},
        {id:'sp_healthInsp',label:'Last Health Inspection Date',type:'date'},
        {id:'sp_healthScore',label:'Health Inspection Score',type:'text'},
    ]},
    sp_coverage: { title:'Coverage Requested', fields:[
        {id:'sp_propLimit',label:'Building / BPP Limit',type:'number'},
        {id:'sp_glLimit',label:'GL Limit',type:'text'},
        {id:'sp_liquorLiab',label:'Liquor Liability',type:'select',opts:['','Yes','No']},
        {id:'sp_spoilage',label:'Spoilage Coverage',type:'select',opts:['','Yes','No']},
        {id:'sp_equipBreak',label:'Equipment Breakdown',type:'select',opts:['','Yes','No']},
        {id:'sp_signCoverage',label:'Sign Coverage',type:'select',opts:['','Yes','No']},
    ]},

    // Colony Specialty Property
    colony_property: { title:'Property Details', fields:[
        {id:'col_propAddr',label:'Property Address',type:'text',map:'address'},
        {id:'col_propCity',label:'City',type:'text',map:'city'},
        {id:'col_propState',label:'State',type:'text',map:'state'},
        {id:'col_propZip',label:'Zip',type:'text',map:'zip'},
        {id:'col_propType',label:'Property Type',type:'select',opts:['','Commercial','Residential','Industrial','Vacant Land','Mixed Use']},
        {id:'col_yrBuilt',label:'Year Built',type:'text'},
        {id:'col_sqft',label:'Total Square Footage',type:'number'},
        {id:'col_stories',label:'Stories',type:'number'},
    ]},
    colony_construction: { title:'Construction', fields:[
        {id:'col_constType',label:'Construction Type',type:'select',opts:['','Frame','Masonry','Non-Combustible','Fire Resistive']},
        {id:'col_roofType',label:'Roof Type',type:'select',opts:['','Shingle','Tile','Metal','Flat/Built-up','TPO','Other']},
        {id:'col_roofYear',label:'Roof Year / Last Replaced',type:'text'},
        {id:'col_electrical',label:'Electrical Updated',type:'text'},
        {id:'col_plumbing',label:'Plumbing Updated',type:'text'},
        {id:'col_hvac',label:'HVAC Updated',type:'text'},
        {id:'col_wiring',label:'Wiring Type',type:'select',opts:['','Copper','Aluminum','Knob & Tube','Unknown']},
    ]},
    colony_protection: { title:'Protection', fields:[
        {id:'col_fireStation',label:'Distance to Fire Station (miles)',type:'number'},
        {id:'col_fireHydrant',label:'Distance to Fire Hydrant (feet)',type:'number'},
        {id:'col_protClass',label:'Protection Class',type:'text'},
        {id:'col_alarm',label:'Alarm System',type:'select',opts:['','Central Station','Local','None']},
        {id:'col_sprinkler',label:'Sprinkler',type:'select',opts:['','Full','Partial','None']},
        {id:'col_deadbolts',label:'Deadbolt Locks',type:'select',opts:['','Yes','No']},
        {id:'col_gatedComm',label:'Gated Community?',type:'select',opts:['','Yes','No']},
        {id:'col_hurricane',label:'Hurricane Shutters/Impact Windows?',type:'select',opts:['','Shutters','Impact Windows','Both','None']},
    ]},
    colony_occupancy: { title:'Occupancy', fields:[
        {id:'col_occupancy',label:'Occupancy Type',type:'select',opts:['','Owner-Occupied','Tenant-Occupied','Vacant','Under Construction','Seasonal']},
        {id:'col_vacantMonths',label:'If Seasonal/Vacant - Months Vacant',type:'number'},
        {id:'col_numTenants',label:'Number of Tenants',type:'number'},
        {id:'col_commercialUse',label:'Any Commercial Use?',type:'select',opts:['','Yes','No']},
        {id:'col_commDesc',label:'Commercial Use Description',type:'text'},
    ]},
    colony_loss: { title:'Loss History', fields:[
        {id:'col_anyLoss5yr',label:'Any Losses Last 5 Years?',type:'select',opts:['','Yes','No']},
        {id:'col_l1Date',label:'Loss 1 Date',type:'date'},
        {id:'col_l1Type',label:'Type (Fire/Water/Wind/Theft)',type:'text'},
        {id:'col_l1Amt',label:'Amount',type:'number'},
        {id:'col_l2Date',label:'Loss 2 Date',type:'date'},
        {id:'col_l2Type',label:'Type',type:'text'},
        {id:'col_l2Amt',label:'Amount',type:'number'},
    ]},

    // Align General Contractors
    align_operations: { title:'Contractor Operations', fields:[
        {id:'al_opType',label:'Type of Contractor',type:'text'},
        {id:'al_opDesc',label:'Full Description of Operations',type:'textarea'},
        {id:'al_yearsInBiz',label:'Years in Business',type:'number'},
        {id:'al_annRevenue',label:'Annual Gross Revenue',type:'number'},
        {id:'al_largestProject',label:'Largest Single Project Value',type:'number'},
        {id:'al_avgProjectSize',label:'Average Project Size',type:'number'},
        {id:'al_workHeight',label:'Max Working Height (feet)',type:'number'},
        {id:'al_residential',label:'% Residential',type:'number'},
        {id:'al_commercial',label:'% Commercial',type:'number'},
        {id:'al_newConst',label:'% New Construction',type:'number'},
        {id:'al_remodel',label:'% Remodel/Renovation',type:'number'},
    ]},
    align_subcontractors: { title:'Subcontractor Management', fields:[
        {id:'al_useSubs',label:'Use Subcontractors?',type:'select',opts:['','Yes','No']},
        {id:'al_subPct',label:'% of Work Subcontracted',type:'number'},
        {id:'al_subAnnCost',label:'Annual Sub Costs',type:'number'},
        {id:'al_subCOI',label:'Require COI from All Subs?',type:'select',opts:['','Yes','No']},
        {id:'al_subAddlInsured',label:'Named as Additional Insured?',type:'select',opts:['','Yes','No']},
        {id:'al_subWC',label:'Require WC from All Subs?',type:'select',opts:['','Yes','No']},
        {id:'al_subContracts',label:'Written Contracts with Subs?',type:'select',opts:['','Always','Usually','Sometimes','Never']},
    ]},
    align_coverage: { title:'Coverage Requested', fields:[
        {id:'al_glLimit',label:'GL Occurrence Limit',type:'text'},
        {id:'al_glAggregate',label:'GL Aggregate',type:'text'},
        {id:'al_prodOps',label:'Products/Completed Operations',type:'text'},
        {id:'al_profLiab',label:'Professional Liability',type:'select',opts:['','Yes','No']},
        {id:'al_pollution',label:'Contractors Pollution',type:'select',opts:['','Yes','No']},
        {id:'al_toolsEquip',label:'Tools & Equipment Coverage',type:'number'},
        {id:'al_installationFloater',label:'Installation Floater',type:'select',opts:['','Yes','No']},
        {id:'al_buildersRisk',label:'Builders Risk',type:'select',opts:['','Yes','No']},
    ]},
    align_lossHistory: { title:'Loss History', fields:[
        {id:'al_l1Date',label:'Loss 1 Date',type:'date'},{id:'al_l1Desc',label:'Description',type:'text'},{id:'al_l1Amt',label:'Amount',type:'number'},
        {id:'al_l2Date',label:'Loss 2 Date',type:'date'},{id:'al_l2Desc',label:'Description',type:'text'},{id:'al_l2Amt',label:'Amount',type:'number'},
        {id:'al_l3Date',label:'Loss 3 Date',type:'date'},{id:'al_l3Desc',label:'Description',type:'text'},{id:'al_l3Amt',label:'Amount',type:'number'},
    ]},

    // ENCORE New Client
    encore_account: { title:'Account Setup', fields:[
        {id:'enc_acctType',label:'Account Type',type:'select',opts:['','Individual','Business','Non-Profit']},
        {id:'enc_referredBy',label:'Referred By',type:'text'},
        {id:'enc_assignedAgent',label:'Assigned Agent',type:'text'},
        {id:'enc_assignedCSR',label:'Assigned CSR',type:'text'},
    ]},
    encore_billing: { title:'Billing Preferences', fields:[
        {id:'enc_billMethod',label:'Billing Method',type:'select',opts:['','Direct Bill','Agency Bill','Premium Finance']},
        {id:'enc_payMethod',label:'Payment Method',type:'select',opts:['','Check','EFT/ACH','Credit Card','Cash']},
        {id:'enc_billEmail',label:'Billing Email',type:'email',map:'email'},
        {id:'enc_autopay',label:'Auto-Pay Enrolled?',type:'select',opts:['','Yes','No']},
    ]},
    encore_policies: { title:'Policies to Enroll', fields:[
        {id:'enc_pol1Type',label:'Policy 1 Type',type:'text'},
        {id:'enc_pol1Carrier',label:'Carrier',type:'text'},
        {id:'enc_pol1PolNum',label:'Policy #',type:'text'},
        {id:'enc_pol1EffDate',label:'Effective',type:'date'},
        {id:'enc_pol2Type',label:'Policy 2 Type',type:'text'},
        {id:'enc_pol2Carrier',label:'Carrier',type:'text'},
        {id:'enc_pol2PolNum',label:'Policy #',type:'text'},
        {id:'enc_pol2EffDate',label:'Effective',type:'date'},
        {id:'enc_pol3Type',label:'Policy 3 Type',type:'text'},
        {id:'enc_pol3Carrier',label:'Carrier',type:'text'},
        {id:'enc_pol3PolNum',label:'Policy #',type:'text'},
    ]},
};

function acordGetClientMapping() {
    if (!amsActiveKey) return {};
    const contacts = amsGetClientData();
    const contact = contacts[amsActiveKey] || {};
    const client = amsClientIndex[amsActiveKey];
    const policies = client?.policies || [];
    const latestPolicy = policies[0] || {};

    return {
        name: ((contact.firstName || '') + ' ' + (contact.lastName || '')).trim() || client?.displayName || '',
        address: contact.address || '',
        city: contact.city || '',
        state: contact.state || '',
        zip: contact.zip || '',
        phone1: contact.phone1 || '',
        phone2: contact.phone2 || '',
        email: contact.email || '',
        dob: contact.dob || '',
        ssn4: contact.ssn4 || '',
        gender: contact.gender || '',
        marital: contact.marital || '',
        dlNum: contact.dlNum || '',
        dlState: contact.dlState || '',
        dlExp: contact.dlExp || '',
        policyNumber: latestPolicy.policyNumber || '',
        effDate: latestPolicy.effDate || '',
        expirationDate: latestPolicy.expirationDate || '',
        company: latestPolicy.company || '',
        lineOfBusiness: latestPolicy.lineOfBusiness || '',
        premium: latestPolicy.basePremium || latestPolicy.totalPremium || '',
    };
}

function acordRenderFormsList() {
    const el = document.getElementById('acordFormsList');
    if (!el) return;

    const search = (document.getElementById('acordFormSearch')?.value || '').toLowerCase();
    const cat = document.getElementById('acordFormCat')?.value || '';

    let forms = ACORD_FORMS;
    if (cat) forms = forms.filter(f => f.cat === cat);
    if (search) forms = forms.filter(f => (f.num + ' ' + f.name).toLowerCase().includes(search));

    if (!forms.length) {
        el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-400);">No forms match your search.</div>';
        return;
    }

    const catColors = {
        app:'#4299e1', auto:'#48bb78', home:'#ed8936', commercial:'#9f7aea',
        general:'#718096', claims:'#e53e3e', cert:'#38b2ac', life:'#d69e2e'
    };

    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
        ${forms.map(f => `
            <div style="border:1px solid var(--gray-200);border-radius:10px;padding:16px;cursor:pointer;transition:all .2s;background:#fff;"
                 onmouseover="this.style.borderColor='${catColors[f.cat]||'var(--blue)'}';this.style.boxShadow='0 2px 8px rgba(0,0,0,.08)';"
                 onmouseout="this.style.borderColor='var(--gray-200)';this.style.boxShadow='none';"
                 onclick="acordOpenForm('${f.id}')">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    <div style="font-size:24px;">${f.icon}</div>
                    <div>
                        <div style="font-weight:700;font-size:13px;color:var(--navy);">${amsEscHtml(f.num)}</div>
                        <span style="font-size:9px;padding:1px 6px;border-radius:3px;background:${catColors[f.cat]||'#718096'}20;color:${catColors[f.cat]||'#718096'};font-weight:600;">${amsEscHtml(f.catLabel)}</span>
                    </div>
                </div>
                <div style="font-size:12px;color:var(--gray-500);line-height:1.4;">${amsEscHtml(f.name)}</div>
                <div style="margin-top:8px;font-size:10px;color:var(--gray-400);">${f.sections.length} sections</div>
            </div>
        `).join('')}
    </div>`;
}

function acordFilterForms() {
    acordRenderFormsList();
}

function acordOpenForm(formId) {
    const form = ACORD_FORMS.find(f => f.id === formId);
    if (!form) return;

    const mapping = acordGetClientMapping();
    const savedForms = JSON.parse(localStorage.getItem('acordSavedForms') || '{}');
    const savedData = savedForms[amsActiveKey + '_' + formId] || {};

    let sectionsHtml = '';
    form.sections.forEach(secKey => {
        const sec = ACORD_FORM_SECTIONS[secKey];
        if (!sec) return;

        sectionsHtml += `<div style="margin-bottom:20px;">
            <h4 style="font-size:13px;color:var(--navy);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--gray-200);">${amsEscHtml(sec.title)}</h4>
            <div style="display:grid;grid-template-columns:${sec.fields.some(f => f.type === 'textarea') ? '1fr' : '1fr 1fr'};gap:10px;">
                ${sec.fields.map(f => {
                    const savedVal = savedData[f.id] || '';
                    const mappedVal = savedVal || (f.map ? mapping[f.map] || '' : '') || f.defaultVal || '';
                    const inputId = 'af_' + f.id;

                    let input = '';
                    if (f.type === 'textarea') {
                        input = `<textarea id="${inputId}" style="width:100%;padding:7px 10px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;min-height:60px;resize:vertical;box-sizing:border-box;font-family:inherit;">${amsEscHtml(mappedVal)}</textarea>`;
                    } else if (f.type === 'select') {
                        input = `<select id="${inputId}" style="width:100%;padding:7px 10px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;box-sizing:border-box;">
                            ${(f.opts || []).map(o => `<option value="${amsEscHtml(o)}"${o === mappedVal ? ' selected' : ''}>${amsEscHtml(o || '— Select —')}</option>`).join('')}
                        </select>`;
                    } else {
                        input = `<input type="${f.type}" id="${inputId}" value="${amsEscHtml(mappedVal)}" style="width:100%;padding:7px 10px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;box-sizing:border-box;">`;
                    }

                    const hasMapped = f.map && mapping[f.map];
                    return `<div${f.type === 'textarea' ? ' style="grid-column:1/-1;"' : ''}>
                        <label style="font-size:10px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:3px;">
                            ${amsEscHtml(f.label)}
                            ${hasMapped ? '<span style="color:var(--green);font-size:9px;"> ✓ auto-filled</span>' : ''}
                        </label>
                        ${input}
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    });

    const modal = document.createElement('div');
    modal.id = 'acordFormModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:800px;width:95%;max-height:90vh;display:flex;flex-direction:column;" onclick="event.stopPropagation()">
            <div style="padding:20px 24px;border-bottom:1px solid var(--gray-200);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <div>
                    <h2 style="font-size:18px;color:var(--navy);margin:0;">${form.icon} ${amsEscHtml(form.num)} — ${amsEscHtml(form.name)}</h2>
                    <p style="font-size:11px;color:var(--gray-400);margin:4px 0 0;">Fields marked with ✓ were auto-filled from client data. All fields are editable.</p>
                </div>
                <button onclick="document.getElementById('acordFormModal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400);padding:4px 8px;">✕</button>
            </div>
            <div style="padding:24px;overflow-y:auto;flex:1;">
                ${sectionsHtml}
            </div>
            <div style="padding:14px 24px;border-top:1px solid var(--gray-200);display:flex;gap:8px;justify-content:space-between;flex-shrink:0;">
                <div style="display:flex;gap:8px;">
                    <button onclick="acordAutoFill('${formId}')" style="padding:8px 16px;background:var(--blue-pale);color:var(--navy);border:1px solid var(--blue);border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">🔄 Re-fill from Client</button>
                    <button onclick="acordClearForm('${formId}')" style="padding:8px 16px;background:#fff;color:var(--gray-500);border:1px solid var(--gray-200);border-radius:6px;font-size:12px;cursor:pointer;">Clear All</button>
                </div>
                <div style="display:flex;gap:8px;">
                    <button onclick="acordSaveForm('${formId}')" style="padding:8px 16px;background:var(--navy);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">💾 Save Draft</button>
                    <button onclick="acordPrintForm('${formId}')" style="padding:8px 16px;background:var(--green);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">🖨 Print / PDF</button>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);
}

function acordAutoFill(formId) {
    const form = ACORD_FORMS.find(f => f.id === formId);
    if (!form) return;
    const mapping = acordGetClientMapping();

    form.sections.forEach(secKey => {
        const sec = ACORD_FORM_SECTIONS[secKey];
        if (!sec) return;
        sec.fields.forEach(f => {
            if (f.map && mapping[f.map]) {
                const el = document.getElementById('af_' + f.id);
                if (el) el.value = mapping[f.map];
            }
            if (f.defaultVal) {
                const el = document.getElementById('af_' + f.id);
                if (el && !el.value) el.value = f.defaultVal;
            }
        });
    });
}

function acordClearForm(formId) {
    const form = ACORD_FORMS.find(f => f.id === formId);
    if (!form) return;
    if (!confirm('Clear all fields in this form?')) return;

    form.sections.forEach(secKey => {
        const sec = ACORD_FORM_SECTIONS[secKey];
        if (!sec) return;
        sec.fields.forEach(f => {
            const el = document.getElementById('af_' + f.id);
            if (el) el.value = '';
        });
    });
}

function acordSaveForm(formId) {
    const form = ACORD_FORMS.find(f => f.id === formId);
    if (!form || !amsActiveKey) return;

    const data = {};
    form.sections.forEach(secKey => {
        const sec = ACORD_FORM_SECTIONS[secKey];
        if (!sec) return;
        sec.fields.forEach(f => {
            const el = document.getElementById('af_' + f.id);
            if (el && el.value) data[f.id] = el.value;
        });
    });

    const savedForms = JSON.parse(localStorage.getItem('acordSavedForms') || '{}');
    savedForms[amsActiveKey + '_' + formId] = data;
    localStorage.setItem('acordSavedForms', JSON.stringify(savedForms));
    alert('Draft saved for ' + form.num + '!');
}

function acordPrintForm(formId) {
    const form = ACORD_FORMS.find(f => f.id === formId);
    if (!form) return;

    let html = `<!DOCTYPE html><html><head><title>${form.num} - ${form.name}</title>
    <style>
        body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;font-size:11px;color:#333;}
        h1{font-size:18px;border-bottom:3px solid #1a365d;padding-bottom:8px;color:#1a365d;}
        h2{font-size:14px;color:#1a365d;margin:16px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px;}
        .form-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;}
        .form-header .agency{text-align:right;font-size:10px;color:#666;}
        .field-row{display:flex;gap:12px;margin-bottom:6px;}
        .field{flex:1;}
        .field label{font-weight:bold;font-size:9px;text-transform:uppercase;color:#666;display:block;}
        .field .val{border-bottom:1px solid #999;min-height:16px;padding:2px 0;font-size:11px;}
        .full-width{width:100%;}
        .footer{margin-top:30px;border-top:2px solid #1a365d;padding-top:10px;font-size:9px;color:#666;display:flex;justify-content:space-between;}
        @media print{body{padding:0;margin:10mm;}}
    </style></head><body>
    <div class="form-header">
        <div><h1>${form.num}<br><span style="font-size:13px;font-weight:normal;">${form.name}</span></h1></div>
        <div class="agency">Universal Insurance Brokers<br>admin@universalinsurancebroker.com<br>Date: ${new Date().toLocaleDateString()}</div>
    </div>`;

    form.sections.forEach(secKey => {
        const sec = ACORD_FORM_SECTIONS[secKey];
        if (!sec) return;
        html += `<h2>${sec.title}</h2>`;

        const fields = sec.fields;
        for (let i = 0; i < fields.length; i += 2) {
            const f1 = fields[i];
            const f2 = fields[i + 1];
            const v1 = document.getElementById('af_' + f1.id)?.value || '';

            if (f1.type === 'textarea') {
                html += `<div class="field full-width" style="margin-bottom:8px;"><label>${f1.label}</label><div class="val" style="min-height:40px;white-space:pre-wrap;">${amsEscHtml(v1)}</div></div>`;
                if (f2) {
                    i--;
                }
            } else if (f2) {
                const v2 = document.getElementById('af_' + f2.id)?.value || '';
                html += `<div class="field-row"><div class="field"><label>${f1.label}</label><div class="val">${amsEscHtml(v1)}</div></div>`;
                if (f2.type === 'textarea') {
                    html += `</div><div class="field full-width" style="margin-bottom:8px;"><label>${f2.label}</label><div class="val" style="min-height:40px;white-space:pre-wrap;">${amsEscHtml(v2)}</div></div>`;
                } else {
                    html += `<div class="field"><label>${f2.label}</label><div class="val">${amsEscHtml(v2)}</div></div></div>`;
                }
            } else {
                html += `<div class="field-row"><div class="field"><label>${f1.label}</label><div class="val">${amsEscHtml(v1)}</div></div><div class="field"></div></div>`;
            }
        }
    });

    html += `<div class="footer"><div>Generated by UIB AMS — ${form.num}</div><div>Page 1 of 1</div></div></body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
}
