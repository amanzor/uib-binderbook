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
        agencyCommission:     n('mp_agencyCommission'),
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
        localStorage.setItem('binderData', JSON.stringify(binder));
        
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
    localStorage.setItem('binderData', JSON.stringify(filtered));
    
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
