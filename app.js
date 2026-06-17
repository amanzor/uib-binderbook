// ============================================================
// GOOGLE DRIVE SYNC
// ============================================================
const DRIVE_API_URL = "https://script.google.com/macros/s/AKfycbypm1A3G5Wgf4onwSU-yk6FbmTOA-9in7HcFrg0YWL6UBdhNj4di7yVDNlflLYwaehI/exec";
const SYNC_KEYS = ['binderData', 'agentMasterData', 'commissionData', 'carrierMasterData', 'agentCredentials', 'prospectData', 'verificationLogs', 'commissionStatements'];

async function driveGet(key) {
    try {
        const res = await fetch(`${DRIVE_API_URL}?key=${key}`);
        const json = await res.json();
        return json.success && json.data !== null ? json.data : null;
    } catch (e) {
        console.warn(`Drive read failed for ${key}:`, e);
        return null;
    }
}

async function driveSet(key, value) {
    try {
        await fetch(DRIVE_API_URL, {
            method: 'POST',
            body: JSON.stringify({ key, value })
        });
    } catch (e) {
        console.warn(`Drive write failed for ${key}:`, e);
    }
}

// Keys that should never be overwritten by a Drive pull.
const DRIVE_PULL_SKIP = new Set([]);

async function syncFromDrive() {
    const banner = document.getElementById('syncBanner');
    if (banner) banner.style.display = 'flex';
    for (const key of SYNC_KEYS) {
        if (DRIVE_PULL_SKIP.has(key)) continue; // preserve local credentials
        const data = await driveGet(key);
        if (data !== null) {
            _origSetItem(key, JSON.stringify(data)); // bypass override to avoid write-back loop
        }
    }
    if (banner) banner.style.display = 'none';
}

async function syncToDrive(key, value) {
    await driveSet(key, value);
}

// Wrap localStorage.setItem to auto-sync to Drive
const _origSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
    _origSetItem(key, value);
    if (SYNC_KEYS.includes(key)) {
        try { driveSet(key, JSON.parse(value)); } catch(e) {}
    }
};

// Auto-poll Drive every 30 seconds and refresh the current view
function startAutoSync() {
    setInterval(async () => {
        await syncFromDrive();

        // Reload allData and carrierMasterData from localStorage after sync
        const freshData = JSON.parse(localStorage.getItem('binderData'));
        const freshCarriers = JSON.parse(localStorage.getItem('carrierMasterData'));
        if (freshData) allData = freshData;
        if (freshCarriers) { carrierMasterData = freshCarriers; refreshAllCarrierDropdowns(); }

        // Refresh whichever view is currently active
        if (currentRole === 'admin') {
            loadAdminDashboard();
        } else if (currentRole === 'agent') {
            loadAgentData();
        }

        // Flash the sync indicator briefly
        const banner = document.getElementById('syncBanner');
        if (banner) {
            banner.style.display = 'flex';
            setTimeout(() => { banner.style.display = 'none'; }, 1500);
        }
    }, 30000); // every 30 seconds
}
// ============================================================

// Data Management
let currentUser = null;
let currentRole = null;
let allData = JSON.parse(localStorage.getItem('binderData')) || [];
let carrierMasterData = JSON.parse(localStorage.getItem('carrierMasterData')) || {};

// ── Eastern Time helpers ──────────────────────────────────────
const _ET = 'America/New_York';

// Returns "YYYY-MM-DD" in ET  (used for date inputs)
function getEasternDateString() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: _ET }).formatToParts(new Date());
    const get = t => p.find(x => x.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

// Returns "05/18/2026, 9:47 PM ET"  (stored with each entry)
function getEasternTimestamp() {
    const p = new Intl.DateTimeFormat('en-US', {
        timeZone: _ET,
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
    }).formatToParts(new Date());
    const get = t => p.find(x => x.type === t).value;
    return `${get('month')}/${get('day')}/${get('year')}, ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')} ET`;
}

// Returns "May 2026" in ET
function getEasternMonthYear() {
    const p = new Intl.DateTimeFormat('en-US', {
        timeZone: _ET, month: 'long', year: 'numeric'
    }).formatToParts(new Date());
    const get = t => p.find(x => x.type === t).value;
    return `${get('month')} ${get('year')}`;
}

// Returns the 4-digit year in ET
function getEasternYear() {
    return parseInt(new Intl.DateTimeFormat('en-CA', { timeZone: _ET }).formatToParts(new Date()).find(x => x.type === 'year').value, 10);
}

// Returns "05/18/2026  9:47 PM ET"  (shown in readonly fields)
function getEasternDateTimeDisplay() {
    const p = new Intl.DateTimeFormat('en-US', {
        timeZone: _ET,
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    }).formatToParts(new Date());
    const get = t => p.find(x => x.type === t).value;
    return `${get('month')}/${get('day')}/${get('year')}  ${get('hour')}:${get('minute')} ${get('dayPeriod')} ET`;
}

// ── All Lines of Business — matches the policy entry dropdown ─
const ALL_LOBS = [
    "BOP", "Boat", "Builders Risk", "Business Owner", "Classic Collectors",
    "Commercial Auto", "Commercial Property", "Excess Liability", "Flood",
    "Garage Keepers", "General Liability", "Home Owners DP1", "Home Owners DP2",
    "Home Owners DP3", "Home Owners H3", "Home Owners H4", "Home Owners H6",
    "Home Owners H8", "Inland Marine", "Motorcycle/ATV", "Personal Auto",
    "Professional Liability", "Surety Bond", "Trucking", "Umbrella", "Workers Comp"
];

let _lobSelectCounter = 0;

function createLobMultiSelectHTML(selectedLobs = []) {
    const selected = Array.isArray(selectedLobs) ? selectedLobs : (selectedLobs ? [selectedLobs] : []);
    const id = 'lobms_' + (++_lobSelectCounter);
    const allChecked = selected.length === ALL_LOBS.length;
    const checkboxes = ALL_LOBS.map(lob => {
        const checked = selected.includes(lob) ? 'checked' : '';
        return `<label><input type="checkbox" value="${lob}" ${checked} onchange="updateLobBtn('${id}')"> ${lob}</label>`;
    }).join('');
    const btnLabel = selected.length === 0 ? 'Select LOB(s)' :
                     selected.length === ALL_LOBS.length ? 'All LOBs' :
                     selected.length === 1 ? selected[0] :
                     selected.length + ' selected';
    return `<div class="lob-multiselect" id="${id}">
        <button type="button" class="lob-multiselect-btn" onclick="toggleLobDropdown('${id}')">${btnLabel} ▾</button>
        <div class="lob-dropdown">
            <label style="border-bottom:1px solid #ddd; font-weight:600; background:#f5f5f5;">
                <input type="checkbox" id="${id}_all" ${allChecked ? 'checked' : ''} onchange="toggleLobSelectAll('${id}')"> Select All
            </label>
            ${checkboxes}
        </div>
    </div>`;
}

// Helper: find a LOB dropdown by its container id, whether in DOM or teleported to body
function _findLobDropdown(id) {
    return document.querySelector(`.lob-dropdown[data-lob-id="${id}"]`)
        || document.getElementById(id)?.querySelector('.lob-dropdown');
}

// Helper: return a teleported dropdown back to its source container
function _returnLobDropdown(d) {
    const srcId = d.dataset.lobId;
    if (srcId && d.parentNode === document.body) {
        const src = document.getElementById(srcId);
        if (src) src.appendChild(d);
    }
    d.classList.remove('open');
}

function toggleLobDropdown(id) {
    const container = document.getElementById(id);
    const btn = container.querySelector('.lob-multiselect-btn');
    const dropdown = _findLobDropdown(id);
    const isOpen = dropdown.classList.contains('open');

    // Close all open dropdowns and return them to their source containers
    document.querySelectorAll('.lob-dropdown.open').forEach(d => _returnLobDropdown(d));

    if (!isOpen) {
        // Tag and teleport to <body> so position:fixed is relative to the viewport,
        // not any transformed ancestor (e.g. animated modal-content)
        dropdown.dataset.lobId = id;
        if (dropdown.parentNode !== document.body) {
            document.body.appendChild(dropdown);
        }

        const rect = btn.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropH = 240;

        dropdown.style.position = 'fixed';
        dropdown.style.left  = rect.left + 'px';
        dropdown.style.width = Math.max(rect.width, 220) + 'px';

        if (spaceBelow >= dropH || spaceBelow >= 120) {
            dropdown.style.top    = (rect.bottom + 2) + 'px';
            dropdown.style.bottom = 'auto';
        } else {
            dropdown.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
            dropdown.style.top    = 'auto';
        }

        dropdown.classList.add('open');
    }
}

function toggleLobSelectAll(id) {
    const dropdown = _findLobDropdown(id);
    if (!dropdown) return;
    const selectAllCb = document.getElementById(id + '_all');
    dropdown.querySelectorAll('input[type=checkbox]:not(#' + id + '_all)').forEach(cb => {
        cb.checked = selectAllCb.checked;
    });
    updateLobBtn(id);
}

function updateLobBtn(id) {
    const container = document.getElementById(id);
    const dropdown = _findLobDropdown(id);
    if (!container || !dropdown) return;
    const allCbs = Array.from(dropdown.querySelectorAll('input[type=checkbox]:not(#' + id + '_all)'));
    const checked = allCbs.filter(cb => cb.checked).map(cb => cb.value);
    const selectAllCb = document.getElementById(id + '_all');
    if (selectAllCb) selectAllCb.checked = checked.length === ALL_LOBS.length;
    const btn = container.querySelector('.lob-multiselect-btn');
    if (btn) btn.textContent = checked.length === 0               ? 'Select LOB(s) ▾' :
                               checked.length === ALL_LOBS.length ? 'All LOBs ▾' :
                               checked.length === 1               ? checked[0] + ' ▾' :
                               checked.length + ' selected ▾';
}

function getLobSelections(rowEl) {
    const multiselect = rowEl.querySelector('.lob-multiselect');
    if (!multiselect) return [];
    const dropdown = _findLobDropdown(multiselect.id);
    if (!dropdown) return [];
    return Array.from(dropdown.querySelectorAll('input[type=checkbox]:checked'))
        .filter(cb => !cb.id.endsWith('_all'))
        .map(cb => cb.value);
}

// Close LOB dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.lob-multiselect') && !e.target.closest('.lob-dropdown')) {
        document.querySelectorAll('.lob-dropdown.open').forEach(d => _returnLobDropdown(d));
    }
});

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxdgftX1s0VD0UqEpt0oKASpEeob_B4J6nwkYpVmNPn54kxYT910ly7NI9ab5RRW1o-tQ/exec';

const SHEET_HEADERS = [
    'id','agent','customerName','source','policyType','lineOfBusiness','company','mga',
    'down','agencyFee','basePremium','agencyCommission','agentCommissionShare',
    'totalPremium','paymentType','paymentMethod2','policyNumber','binderNumber',
    'entryDate','effDate','term','timestamp','status'
];

async function loadFromSheet() {
    try {
        const res = await fetch(`${SCRIPT_URL}?action=getAll`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            allData = data;
            localStorage.setItem('binderData', JSON.stringify(allData));
        } else if (Array.isArray(data) && data.length === 0 && allData.length > 0) {
            // Sheet is empty but we have local data — migrate it up
            for (const entry of allData) {
                syncToSheet('save', { entry });
            }
        }
    } catch (e) {
        console.warn('Google Sheets load failed, using local data:', e);
    }
}

async function syncToSheet(action, payload) {
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action, ...payload })
        });
    } catch (e) {
        console.warn('Google Sheets sync failed:', e);
    }
}

const AGENTS = ['Alberto Manzor', 'Randy Diaz', 'Amanda Montano', 'Uriel Rendon', 'Jorge Castro', 'Lazaro Reigoza'];

function getAllAgents() {
    const fromCreds  = Object.keys(JSON.parse(localStorage.getItem('agentCredentials') || '{}'));
    const fromMaster = Object.keys(JSON.parse(localStorage.getItem('agentMasterData')  || '{}'));
    return [...new Set([...AGENTS, ...fromCreds, ...fromMaster])].sort();
}

// Initialize credentials — structure: { "Agent Name": { email, password } }
function initializeCredentials() {
    let credentials = JSON.parse(localStorage.getItem('agentCredentials'));

    // Start with empty object if nothing stored yet
    if (!credentials || typeof credentials !== 'object') {
        credentials = {};
    }

    let changed = false;

    // Per-entry migration: fix any individual entry still stored as a plain string
    // — does NOT touch entries that are already in {email, password} format
    Object.keys(credentials).forEach(agent => {
        if (typeof credentials[agent] === 'string') {
            credentials[agent] = { email: '', password: credentials[agent] };
            changed = true;
        }
    });

    // Add a default entry ONLY for agents that have no entry at all yet
    // — never overwrites an existing entry, so saved emails are never lost
    AGENTS.forEach(agent => {
        if (!credentials[agent]) {
            credentials[agent] = { email: '', password: agent.split(' ')[0].toLowerCase() };
            changed = true;
        }
    });

    // Persist only if something actually changed; use _origSetItem to bypass
    // the Drive-push proxy so we don't push during cold init
    if (changed) {
        _origSetItem('agentCredentials', JSON.stringify(credentials));
    }

    return credentials;
}

// ── Agent Email Login ──────────────────────────────────────────
function openAgentEmailLogin() {
    // Login form is now inline on loginSection — just ensure it's visible and focused
    showSection('loginSection');
    const saved = localStorage.getItem('rememberedAgentEmail') || '';
    const emailField = document.getElementById('agentLoginEmail');
    const passField  = document.getElementById('agentLoginPassword');
    const errEl      = document.getElementById('agentLoginError');
    const rememberBox = document.getElementById('rememberAgentEmail');
    if (emailField) emailField.value = saved;
    if (passField)  passField.value  = '';
    if (errEl)      errEl.style.display = 'none';
    if (rememberBox) rememberBox.checked = !!saved;
    setTimeout(() => {
        if (saved) { passField?.focus(); } else { emailField?.focus(); }
    }, 80);
}

function closeAgentEmailLogin() {
    // No-op — login form is now inline, not a modal
}

function togglePasswordVisibility(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const showing = inp.type === 'text';
    inp.type = showing ? 'password' : 'text';
    const icon = btn.querySelector('i[data-lucide]');
    if (icon) { icon.setAttribute('data-lucide', showing ? 'eye' : 'eye-off'); lucide.createIcons(); }
}

function submitAgentEmailLogin(e) {
    e.preventDefault();
    const email    = document.getElementById('agentLoginEmail').value.trim().toLowerCase();
    const password = document.getElementById('agentLoginPassword').value;
    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    const errEl = document.getElementById('agentLoginError');

    // Match by email + password only — same logic as AMS login
    let matched = null;
    Object.entries(credentials).forEach(([name, data]) => {
        const storedEmail = (typeof data === 'object' ? data.email : '') || '';
        const storedPass  = (typeof data === 'object' ? data.password : data) || '';
        if (storedEmail.toLowerCase() === email && storedPass === password) matched = name;
    });

    const match = matched ? [matched, credentials[matched]] : null;

    if (!match) {
        errEl.textContent = 'Incorrect email or password. Please try again.';
        errEl.style.display = 'block';
        return;
    }

    const agentName = match[0];
    errEl.style.display = 'none';

    const remember = document.getElementById('rememberAgentEmail')?.checked;
    if (remember) {
        localStorage.setItem('rememberedAgentEmail', email);
    } else {
        localStorage.removeItem('rememberedAgentEmail');
    }

    closeAgentEmailLogin();
    showAgentSection(agentName);
    loadFromSheet().then(() => {
        loadAgentData();
        populateAgentFilter();
        generateBinderNumber();
    });
}

// ── Credential Manager (Admin) ─────────────────────────────────
function openCredentialManager() {
    // Close any open modals
    document.getElementById('agentManagementModal')?.classList.remove('active');
    document.getElementById('credentialManagerModal')?.classList.remove('active');
    // Navigate to the credentials page section
    showSection('credentialsSection');
    renderCredentialListPage();
    refreshIcons();
    if (window.UIBMotion) UIBMotion.animateSection(document.getElementById('credentialsSection'));
}

function closeCredentialManager() {
    // Legacy — now just goes back to admin
    showSection('adminSection');
    refreshIcons();
}

function renderCredentialList() {
    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    const container   = document.getElementById('credentialList');

    container.innerHTML = AGENTS.map(agent => {
        const cred = credentials[agent] || { email: '', password: '' };
        return `
        <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:12px;">
            <div style="font-weight:700;color:var(--navy);margin-bottom:10px;font-size:14px;"><i data-lucide="user"></i> ${agent}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                <div>
                    <label style="font-size:12px;color:var(--gray-500);font-weight:600;display:block;margin-bottom:4px;">Email (username)</label>
                    <input type="email" id="cred_email_${agent.replace(/\s+/g,'_')}"
                        value="${cred.email || ''}" placeholder="agent@email.com"
                        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:13px;">
                </div>
                <div>
                    <label style="font-size:12px;color:var(--gray-500);font-weight:600;display:block;margin-bottom:4px;">Password</label>
                    <input type="text" id="cred_pass_${agent.replace(/\s+/g,'_')}"
                        value="${cred.password || ''}" placeholder="Enter password"
                        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:13px;">
                </div>
            </div>
            <button class="btn-primary btn-sm" onclick="saveAgentCredential('${agent}')"><i data-lucide="save"></i> Save</button>
        </div>`;
    }).join('');
    refreshIcons();
}

function renderCredentialListPage() {
    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    const container   = document.getElementById('credentialListPage');
    if (!container) return;

    // Get all agents — include extras added via "Add Agent Credential"
    const allAgents = Array.from(new Set([...AGENTS, ...Object.keys(credentials)]));

    container.innerHTML = allAgents.map(agent => {
        const cred = credentials[agent] || { email: '', password: '' };
        const key  = agent.replace(/\s+/g, '_');
        return `
        <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <span style="font-weight:700;color:var(--navy);font-size:14px;"><i data-lucide="user"></i> ${agent}</span>
                <span id="cred_status_${key}" style="font-size:12px;color:var(--success);font-weight:600;opacity:0;transition:opacity .3s;">✓ Saved</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div>
                    <label style="font-size:12px;color:var(--gray-500);font-weight:600;display:block;margin-bottom:4px;">Email (username)</label>
                    <input type="email" id="page_cred_email_${key}"
                        value="${cred.email || ''}" placeholder="agent@email.com"
                        oninput="autoSaveCredential('${agent}')"
                        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:13px;">
                </div>
                <div>
                    <label style="font-size:12px;color:var(--gray-500);font-weight:600;display:block;margin-bottom:4px;">Password</label>
                    <input type="text" id="page_cred_pass_${key}"
                        value="${cred.password || ''}" placeholder="Enter password"
                        oninput="autoSaveCredential('${agent}')"
                        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:13px;">
                </div>
            </div>
        </div>`;
    }).join('');
    refreshIcons();

    // Always push current credentials to Drive when the page opens —
    // ensures Drive stays in sync even if no field is changed.
    if (Object.keys(credentials).length > 0) {
        driveSet('agentCredentials', credentials);
    }
}

function autoSaveCredential(agent) {
    const key   = agent.replace(/\s+/g, '_');
    const email = document.getElementById(`page_cred_email_${key}`)?.value.trim() || '';
    const pass  = document.getElementById(`page_cred_pass_${key}`)?.value.trim() || '';

    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    credentials[agent] = { email, password: pass };
    localStorage.setItem('agentCredentials', JSON.stringify(credentials));
    driveSet('agentCredentials', credentials);

    // Flash the ✓ Saved indicator
    const status = document.getElementById(`cred_status_${key}`);
    if (status) {
        status.style.opacity = '1';
        clearTimeout(status._hideTimer);
        status._hideTimer = setTimeout(() => { status.style.opacity = '0'; }, 2000);
    }
}

function openAddCredentialModal() {
    const m = document.getElementById('addCredentialModal');
    m.classList.add('active');
    document.getElementById('newCredAgent').value = '';
    document.getElementById('newCredEmail').value = '';
    document.getElementById('newCredPassword').value = '';
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    refreshIcons();
}

function closeAddCredentialModal() {
    document.getElementById('addCredentialModal').classList.remove('active');
}

function submitAddCredential(e) {
    e.preventDefault();
    const agent = document.getElementById('newCredAgent').value.trim();
    const email = document.getElementById('newCredEmail').value.trim();
    const pass  = document.getElementById('newCredPassword').value.trim();

    if (!agent || !email || !pass) {
        alert('Please fill in all fields.');
        return;
    }

    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    credentials[agent] = { email, password: pass };
    localStorage.setItem('agentCredentials', JSON.stringify(credentials));
    driveSet('agentCredentials', credentials);

    closeAddCredentialModal();
    renderCredentialListPage();
    refreshIcons();
}

function saveAgentCredential(agent) {
    const key   = agent.replace(/\s+/g, '_');
    const email = document.getElementById(`cred_email_${key}`)?.value.trim() || '';
    const pass  = document.getElementById(`cred_pass_${key}`)?.value.trim() || '';

    if (!email || !pass) {
        alert('Please enter both email and password.');
        return;
    }

    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    credentials[agent] = { email, password: pass };
    localStorage.setItem('agentCredentials', JSON.stringify(credentials));
    driveSet('agentCredentials', credentials);
    alert(`✓ Credentials saved for ${agent}`);
}

// Render all <i data-lucide> tags into SVGs (call after any DOM update)
function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initializeCommissionData();
    initializeCarrierData();
    binderInitDB(); // IndexedDB for AMS file system (shared with ams.html)
    refreshAllCarrierDropdowns();
    initializeAgentData();
    initializeCommissionStatements();
    setTodayDate();

    // Agency Commission = Carrier Rate % × Base Premium (auto, readonly)
    // Agent Commission  = (Agency Fee + Agency Commission) × 50% (auto, readonly)
    ['basePremium', 'company', 'lineOfBusiness', 'paymentType', 'policyType'].forEach(id => {
        document.getElementById(id)?.addEventListener('input',  autoCalculateCommission);
        document.getElementById(id)?.addEventListener('change', autoCalculateCommission);
    });
    document.getElementById('agencyFee')?.addEventListener('input',  calculateAgentCommission);
    document.getElementById('agencyFee')?.addEventListener('change', calculateAgentCommission);

    refreshIcons();

    if (window.UIBMotion) {
        UIBMotion.animateHeader();
        UIBMotion.addRippleToButtons();
    }

    // Pull credentials from Drive before login — 4 s timeout so a slow/dead
    // Drive never leaves the button permanently disabled.
    initializeCredentials();
    initializeAgentButtons();
    if (window.UIBMotion) UIBMotion.animateAgentCards();

    (async () => {
        const loginBtn = document.getElementById('loginSignInBtn');
        const btnOrigHTML = loginBtn ? loginBtn.innerHTML : '';
        if (loginBtn) { loginBtn.disabled = true; loginBtn.innerHTML = 'Loading…'; }

        try {
            const timeout  = new Promise(res => setTimeout(() => res(null), 4000));
            const driveData = await Promise.race([driveGet('agentCredentials'), timeout]);
            if (driveData && typeof driveData === 'object' && Object.keys(driveData).length > 0) {
                _origSetItem('agentCredentials', JSON.stringify(driveData));
                initializeCredentials(); // re-run so any new agents are added
                initializeAgentButtons();
            }
        } catch(e) { /* Drive unavailable — use whatever is already local */ }

        if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = btnOrigHTML; refreshIcons(); }

        // Continue syncing all other data in background
        syncFromDrive().then(() => refreshIcons());
        startAutoSync();
    })();
});

function calculateAgentCommission() {
    const fee        = parseFloat(document.getElementById('agencyFee')?.value) || 0;
    const commission = parseFloat(document.getElementById('agencyCommission')?.value) || 0;
    const agentShare = parseFloat(((fee + commission) * 0.5).toFixed(2));
    const field = document.getElementById('agentCommission');
    if (field) field.value = agentShare > 0 ? agentShare : '';
}

function autoCalculateCommission() {
    const basePremium = parseFloat(document.getElementById('basePremium')?.value) || 0;
    const carrier     = document.getElementById('company')?.value;
    const lob         = document.getElementById('lineOfBusiness')?.value;
    const paymentType = document.getElementById('paymentType')?.value;
    const policyType  = document.getElementById('policyType')?.value;
    const breakdown   = document.getElementById('commissionBreakdown');
    const commField   = document.getElementById('agencyCommission');

    if (basePremium <= 0 || !carrier || !lob || !paymentType) {
        if (commField) commField.value = '';
        if (breakdown) { breakdown.style.display = 'none'; breakdown.textContent = ''; }
        calculateAgentCommission();
        return;
    }

    const rate = getCommissionRate(carrier, lob, paymentType, policyType);

    if (rate > 0) {
        const agencyComm = parseFloat((basePremium * (rate / 100)).toFixed(2));
        if (commField) commField.value = agencyComm;

        if (breakdown) {
            breakdown.innerHTML = `🔒 $${basePremium.toLocaleString()} × ${rate}% = <strong>$${agencyComm.toLocaleString()}</strong>`;
            breakdown.style.display = 'block';
        }
    } else {
        if (commField) commField.value = '';
        if (breakdown) {
            breakdown.innerHTML = `⚠️ No commission rule found for this carrier / LOB / payment type`;
            breakdown.style.display = 'block';
            breakdown.style.color = '#92400e';
            breakdown.style.background = '#fef3c7';
        }
    }

    calculateAgentCommission();
}

function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
}

function initializeAgentButtons() {
    const agentList = document.getElementById('agentList');
    if (!agentList) return;
    agentList.innerHTML = '';

    getAllAgents().forEach(agent => {
        const btn = document.createElement('button');
        btn.className = 'agent-btn';
        btn.innerHTML = `
            <div class="agent-avatar">${getInitials(agent)}</div>
            <span>${agent}</span>
        `;
        btn.onclick = () => showAgentLoginModal(agent);
        agentList.appendChild(btn);
    });
    refreshIcons();
    if (window.UIBMotion) UIBMotion.animateAgentCards();
}

function showAgentLoginModal(agent) {
    // Navigate to login section and pre-fill the agent's username
    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    const cred = credentials[agent] || {};
    const username = cred.email || agent.toLowerCase();
    showSection('loginSection');
    const emailField = document.getElementById('agentLoginEmail');
    const passField  = document.getElementById('agentLoginPassword');
    const errEl      = document.getElementById('agentLoginError');
    if (emailField) emailField.value = username;
    if (passField)  passField.value  = '';
    if (errEl)      errEl.style.display = 'none';
    refreshIcons();
    setTimeout(() => passField?.focus(), 120);
}

function closeAgentLoginModal() {
    document.getElementById('agentLoginModal').classList.remove('active');
}

document.getElementById('agentLoginForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const agent = document.getElementById('selectedAgent').value;
    const password = document.getElementById('agentPassword').value;
    const credentials = JSON.parse(localStorage.getItem('agentCredentials'));

    const storedPass = typeof credentials[agent] === 'object' ? credentials[agent]?.password : credentials[agent];
    if (storedPass === password) {
        closeAgentLoginModal();
        showAgentSection(agent);
        loadFromSheet().then(() => {
            loadAgentData();
            populateAgentFilter();
            generateBinderNumber();
        });
    } else {
        alert('Incorrect password');
        document.getElementById('agentPassword').value = '';
        document.getElementById('agentPassword').focus();
    }
});

function showAgentSection(agent) {
    currentUser = agent;
    currentRole = 'agent';
    showSection('agentSection');
    document.getElementById('userDisplay').textContent = `👤 Agent: ${agent}`;
    document.getElementById('agentForm').reset();
    setTodayDate();
    generateBinderNumber();
}

function setTodayDate() {
    // Capture the exact moment the form is opened in Eastern Time
    const dateStr    = getEasternDateString();      // YYYY-MM-DD — for filtering/grouping
    const displayStr = getEasternDateTimeDisplay();  // "05/22/2026  2:30 PM ET" — shown to agent

    // Hidden field keeps YYYY-MM-DD so all month/year filtering still works
    const hidden = document.getElementById('entryDate');
    if (hidden) hidden.value = dateStr;

    // Visible read-only field shows full date + time so agent sees exact open timestamp
    const display = document.getElementById('entryDateDisplay');
    if (display) display.value = displayStr;
}

function generateBinderNumber() {
    if (!currentUser) return;

    const year = getEasternYear();
    const agentInitials = currentUser.split(' ').map(n => n[0]).join('').toUpperCase();

    // Count entries for this agent in this year
    const agentEntries = allData.filter(d =>
        d.agent === currentUser &&
        d.entryDate.startsWith(year.toString())
    );

    const count = agentEntries.length + 1;
    const binderNumber = `${agentInitials}-${year}-${String(count).padStart(3, '0')}`;

    const binderField = document.getElementById('binderNumber');
    if (binderField) {
        binderField.value = binderNumber;
    }
}

// Admin Login
function showAdminLogin() {
    const modal = document.getElementById('adminLoginModal');
    modal.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(modal);
    document.getElementById('adminPassword').focus();
}

function closeAdminLoginModal() {
    document.getElementById('adminLoginModal').classList.remove('active');
    document.getElementById('adminPassword').value = '';
}

document.getElementById('adminLoginForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('adminPassword').value;
    if (password === 'admin123') {
        currentUser = 'Admin';
        currentRole = 'admin';
        closeAdminLoginModal();
        showSection('adminSection');
        loadFromSheet().then(() => loadAdminDashboard());
    } else {
        alert('Incorrect password');
        document.getElementById('adminPassword').value = '';
        document.getElementById('adminPassword').focus();
    }
});

function logout() {
    currentUser = null;
    currentRole = null;
    showSection('loginSection');
    initializeAgentButtons();
}

// UI Navigation
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(sectionId);
    el.classList.add('active');
    if (window.UIBMotion) {
        UIBMotion.animateSection(el);
        UIBMotion.animateUserInfoBar(el);
        UIBMotion.addRippleToButtons();
    }
}

// Form Handling
document.getElementById('agentForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveEntry();
});

document.getElementById('editForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    updateEntry();
});

function saveEntry() {
    const entry = {
        id: Date.now(),
        agent: currentUser,
        customerName: document.getElementById('customerName').value,
        contactName: document.getElementById('contactName').value,
        source: document.getElementById('source').value,
        referredBy: document.getElementById('referredBy').value,
        policyType: document.getElementById('policyType').value,
        lineOfBusiness: document.getElementById('lineOfBusiness').value,
        company: document.getElementById('company').value,
        mga: document.getElementById('mga').value,
        down: parseFloat(document.getElementById('down').value) || 0,
        agencyFee: parseFloat(document.getElementById('agencyFee').value) || 0,
        basePremium: parseFloat(document.getElementById('basePremium').value),
        agencyCommission: parseFloat(document.getElementById('agencyCommission').value) || 0,
        totalPremium: parseFloat(document.getElementById('totalPremium').value),
        paymentType: document.getElementById('paymentType').value,
        paymentMethod2: document.getElementById('paymentMethod2').value,
        policyNumber: document.getElementById('policyNumber').value,
        binderNumber: document.getElementById('binderNumber').value,
        entryDate: document.getElementById('entryDate').value,
        entryDateDisplay: document.getElementById('entryDateDisplay')?.value || '',
        effDate: document.getElementById('effDate').value,
        term: document.getElementById('term').value,
        location: document.getElementById('salesLocationSelect')?.value || _selectedSalesLocation || '',
        drivers: collectDriverRows(),
        vehicles: collectVehicleRows(),
        timestamp: getEasternTimestamp()
    };
    entry.agentCommissionShare = parseFloat(((entry.agencyFee + entry.agencyCommission) * 0.5).toFixed(2));

    // Duplicate guard — block if same agent + customer + policy# + company + date already exists
    const isDupe = allData.some(d =>
        d.agent === entry.agent &&
        d.customerName === entry.customerName &&
        d.policyNumber === entry.policyNumber &&
        d.company === entry.company &&
        d.entryDate === entry.entryDate
    );
    if (isDupe) {
        alert('⚠️ Duplicate entry detected — an entry with the same customer, policy #, company, and date already exists. Entry was not saved.');
        return;
    }

    allData.push(entry);
    localStorage.setItem('binderData', JSON.stringify(allData));

    // Auto-sync this entry's contact info to AMS (drivers, vehicles, agent, etc.)
    syncEntryToAMS(entry);

    // Calculate and store commission based on base premium
    const premium     = entry.basePremium;
    const carrier     = entry.company;
    const lob         = entry.lineOfBusiness;
    const paymentType = entry.paymentType || 'Monthly Paid';
    const policyType  = entry.policyType  || 'New';
    const agent       = entry.agent;

    const rate = getCommissionRate(carrier, lob, paymentType, policyType);

    if (rate > 0) {
        const commission = calculateCommission(premium, rate, entry.agencyFee || 0);
        const month = new Date(entry.entryDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        const carrierType = paymentType === 'Monthly Paid' ? 'monthlyPaidCommissionCarriers' : 'grossPaidCarriers';

        // Load current commission data
        let commData = JSON.parse(localStorage.getItem('commissionData')) || {};

        // Initialize structures if needed
        if (!commData[agent]) {
            commData[agent] = {
                monthlyPaidCommissionCarriers: {},
                grossPaidCarriers: {}
            };
        }

        if (!commData[agent][carrierType]) {
            commData[agent][carrierType] = {};
        }

        if (!commData[agent][carrierType][carrier]) {
            commData[agent][carrierType][carrier] = {};
        }

        // Accumulate into same carrier/month bucket (multiple policies → sum)
        const existing = commData[agent][carrierType][carrier][month];
        if (existing) {
            existing.amount   = parseFloat((existing.amount + commission).toFixed(2));
            existing.premium  = parseFloat((existing.premium + premium).toFixed(2));
            // Merge LOB label if different
            if (existing.lob && existing.lob !== lob && !existing.lob.includes(lob)) {
                existing.lob = existing.lob + ', ' + lob;
            }
        } else {
            commData[agent][carrierType][carrier][month] = {
                amount:  commission,
                lob:     lob,
                rate:    rate,
                premium: premium
            };
        }

        // Save updated commission data
        localStorage.setItem('commissionData', JSON.stringify(commData));
        commissionData = commData;
    }

    // Save any pending files attached from the new entry form
    if (_pendingEntryFiles.length > 0) {
        binderSavePendingFiles(entry.customerName, entry.id);
    }

    showSuccess();
    document.getElementById('agentForm').reset();
    document.getElementById('agentCommission').value = '';
    // Hide auto-calc breakdown labels
    const rateLabel = document.getElementById('commissionRateLabel');
    const breakdown = document.getElementById('commissionBreakdown');
    if (rateLabel) { rateLabel.style.display = 'none'; rateLabel.textContent = ''; }
    if (breakdown) { breakdown.style.display = 'none'; breakdown.textContent = ''; }
    closeDailySalesModal();
    setTodayDate();
    loadAgentData();
}

// ── Daily Verification Log ────────────────────────────────────
const _vlSigPads = {};

let _vlSelectedDealer = '';

function openDailyVerificationModal() {
    const m = document.getElementById('dealerSelectModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
}

function selectDealerAndOpenLog(dealerName) {
    _vlSelectedDealer = dealerName;

    // Close dealer picker
    document.getElementById('dealerSelectModal').classList.remove('active');

    // Set dealer name everywhere in the form
    document.getElementById('vl_dealerDisplay').textContent = dealerName;
    document.querySelectorAll('#dailyVerificationModal .vl-dealer').forEach(el => {
        el.textContent = dealerName;
    });

    // Set today's date and show date+time display
    document.getElementById('vl_date').value = getEasternDateString();
    const dtDisplay = document.getElementById('vl_dateTimeDisplay');
    if (dtDisplay) dtDisplay.textContent = '🕐 ' + getEasternDateTimeDisplay();

    // Populate agent dropdown
    const sel = document.getElementById('vl_agent');
    sel.innerHTML = '<option value="">Select Agent</option>' +
        getAllAgents().map(a => `<option value="${a}">${a}</option>`).join('');

    document.getElementById('verificationSuccessMsg').style.display = 'none';
    const vlModal = document.getElementById('dailyVerificationModal');
    vlModal.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(vlModal);

    // Init signature pads after modal is visible
    setTimeout(() => {
        initSignaturePad('vl_customerSigCanvas');
        initSignaturePad('vl_agentSigCanvas');
    }, 100);

    // Sync agent name when dropdown changes
    document.getElementById('vl_agent').onchange = function() {
        document.getElementById('vl_verifiedBy').value = this.value;
    };
}

function closeDailyVerificationModal() {
    document.getElementById('dailyVerificationModal').classList.remove('active');
    resetVerificationForm();
}

function resetVerificationForm() {
    document.getElementById('verificationForm').reset();
    clearSignaturePad('vl_customerSigCanvas');
    clearSignaturePad('vl_agentSigCanvas');
    document.getElementById('vl_verifiedBy').value = '';
    document.getElementById('vl_date').value = getEasternDateString();
    const dtDisplay = document.getElementById('vl_dateTimeDisplay');
    if (dtDisplay) dtDisplay.textContent = '🕐 ' + getEasternDateTimeDisplay();
}

function initSignaturePad(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#003399';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let drawing = false;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const src = e.touches ? e.touches[0] : e;
        return {
            x: (src.clientX - rect.left) * scaleX,
            y: (src.clientY - rect.top)  * scaleY
        };
    }

    function start(e) { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e)  { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    function stop()   { drawing = false; }

    // Remove old listeners before re-adding
    const clone = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(clone, canvas);
    const c = document.getElementById(canvasId);
    const cx = c.getContext('2d');
    cx.strokeStyle = '#003399'; cx.lineWidth = 2; cx.lineCap = 'round'; cx.lineJoin = 'round';

    function getPos2(e) {
        const rect = c.getBoundingClientRect();
        const scaleX = c.width / rect.width;
        const scaleY = c.height / rect.height;
        const src = e.touches ? e.touches[0] : e;
        return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
    }
    let d = false;
    c.addEventListener('mousedown',  e => { d = true; const p = getPos2(e); cx.beginPath(); cx.moveTo(p.x, p.y); });
    c.addEventListener('mousemove',  e => { if (!d) return; const p = getPos2(e); cx.lineTo(p.x, p.y); cx.stroke(); });
    c.addEventListener('mouseup',    () => d = false);
    c.addEventListener('mouseleave', () => d = false);
    c.addEventListener('touchstart', e => { e.preventDefault(); d = true; const p = getPos2(e); cx.beginPath(); cx.moveTo(p.x, p.y); }, { passive: false });
    c.addEventListener('touchmove',  e => { e.preventDefault(); if (!d) return; const p = getPos2(e); cx.lineTo(p.x, p.y); cx.stroke(); }, { passive: false });
    c.addEventListener('touchend',   () => d = false);
}

function clearSignaturePad(canvasId) {
    const c = document.getElementById(canvasId);
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

function isCanvasBlank(canvasId) {
    const c = document.getElementById(canvasId);
    if (!c) return true;
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return !data.some(v => v !== 0);
}

function saveVerificationLog(e) {
    e.preventDefault();

    if (isCanvasBlank('vl_customerSigCanvas')) {
        alert('Please provide the customer signature.');
        return;
    }
    if (isCanvasBlank('vl_agentSigCanvas')) {
        alert('Please provide the agent/CSR signature.');
        return;
    }

    const date          = document.getElementById('vl_date').value;
    const agent         = document.getElementById('vl_agent').value;
    const customerName  = document.getElementById('vl_customerName').value.trim();
    const ack           = document.querySelector('input[name="vl_ack"]:checked')?.value;
    const permission    = document.querySelector('input[name="vl_permission"]:checked')?.value;
    const agentConfirm  = document.querySelector('input[name="vl_agentConfirm"]:checked')?.value;
    const customerSig   = document.getElementById('vl_customerSigCanvas').toDataURL('image/png');
    const agentSig      = document.getElementById('vl_agentSigCanvas').toDataURL('image/png');

    const entry = {
        id:            'VL-' + Date.now(),
        date,
        dealer:        _vlSelectedDealer,
        customerName,
        agent,
        acknowledged:  ack,
        permissionToFollowUp: permission,
        agentConfirmed: agentConfirm,
        customerSig,
        agentSig,
        timestamp:     getEasternTimestamp()
    };

    const logs = JSON.parse(localStorage.getItem('verificationLogs')) || [];
    logs.push(entry);
    localStorage.setItem('verificationLogs', JSON.stringify(logs));

    // Generate and download the completed form
    downloadVerificationForm(entry);

    document.getElementById('verificationSuccessMsg').style.display = 'block';
    setTimeout(() => {
        document.getElementById('verificationSuccessMsg').style.display = 'none';
        closeDailyVerificationModal();
    }, 2500);

    // Refresh list if logs section is open
    if (document.getElementById('verificationLogsSection')?.classList.contains('active')) {
        renderVerificationLogsTable();
    }
}

function downloadVerificationForm(entry) {
    const formatted = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const dealer = entry.dealer || 'Dealer';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Verification Log - ${entry.customerName} - ${entry.date}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; padding: 40px; max-width: 720px; margin: 0 auto; }
  .logo-area { text-align:center; margin-bottom:28px; }
  .logo-area h1 { font-size:20px; color:#003399; letter-spacing:1px; }
  .logo-area p  { font-size:11px; color:#555; margin-top:4px; }
  h2 { font-size:14px; text-align:center; text-transform:uppercase; letter-spacing:1px; margin-bottom:16px; color:#003399; border-bottom:2px solid #003399; padding-bottom:6px; }
  .section { border:1px solid #ccc; border-radius:6px; padding:20px; margin-bottom:24px; }
  .legal { font-size:12.5px; line-height:1.75; text-align:justify; }
  .legal p { margin-bottom:10px; }
  .field-row { display:flex; gap:40px; margin-top:20px; flex-wrap:wrap; }
  .field { flex:1; min-width:200px; }
  .field label { font-size:12px; font-weight:bold; display:block; margin-bottom:4px; }
  .field .line { border-bottom:1px solid #333; height:24px; }
  .sig-img { max-width:100%; height:60px; border-bottom:1px solid #333; display:block; }
  .yn { font-size:13px; margin-top:12px; }
  .yn span { display:inline-block; width:90px; border-bottom:1px solid #333; margin-right:16px; text-align:center; padding-bottom:2px; }
  .meta { text-align:right; font-size:11px; color:#777; margin-bottom:20px; }
  @media print { body { padding:20px; } }
</style>
</head>
<body>
<div class="logo-area">
  <h1>Universal Insurance Brokers</h1>
  <p>Licensed Insurance Agency — State of Florida</p>
</div>
<p class="meta">Dealer: ${dealer} &nbsp;|&nbsp; Date: ${formatted} &nbsp;|&nbsp; Agent/CSR: ${entry.agent} &nbsp;|&nbsp; Entry ID: ${entry.id}</p>

<!-- Form 1 -->
<div class="section">
  <h2>Notice and Customer Acknowledgement Form</h2>
  <div class="legal">
    <p><strong>${dealer}</strong> and <strong>Universal Insurance Brokers</strong> wish to inform you that there is no affiliation or other connection between <strong>Universal Insurance Brokers</strong> and <strong>${dealer}</strong>. <strong>${dealer}</strong> leases floor space to <strong>Universal Insurance Brokers</strong>, which is an independently owned and operated, licensed insurance agency doing business in the State of Florida. The purpose of <strong>Universal Insurance Brokers</strong> is to help their clients with their insurance transfer or provide options if none exists. Representatives of <strong>Universal Insurance Brokers</strong> are not employees or agents of and have no affiliation or connection with <strong>${dealer}</strong>.</p>
    <p><strong>${dealer}</strong> does not require any of its customers to obtain insurance coverage from <strong>Universal Insurance Brokers</strong>, or any other particular insurer, agent, or broker. <strong>${dealer}</strong> does not negotiate any insurance policy through <strong>Universal Insurance Brokers</strong>, or any other insurer, agent, or broker. The choice of a particular insurer, agent, or broker, and the negotiation of any insurance policy, is entirely for you, the Customer, to make.</p>
    <p><strong>${dealer}</strong> does not receive any fee, commission, royalty, percentage, or similar payment from any revenue that <strong>Universal Insurance Brokers</strong> earns from the sale or servicing of any insurance policy or any other insurance product.</p>
  </div>
  <div class="field-row">
    <div class="field"><label>Customer Name</label><div class="line" style="padding-top:4px;">${entry.customerName}</div></div>
    <div class="field"><label>Customer Acknowledges</label><div class="line" style="padding-top:4px;">${entry.acknowledged}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Customer Signature</label><img src="${entry.customerSig}" class="sig-img" alt="Customer Signature"></div>
  </div>
</div>

<!-- Form 2 -->
<div class="section">
  <h2>Permission Form</h2>
  <div class="legal">
    <p>"I consent and agree that <strong>Universal Insurance Brokers</strong> (and its affiliates, agents and assigns) may contact me by telephone at any telephone number associated with my account that I provide now or in the future, including cellular phones, wireless telephone numbers or any other wireless devices, regardless of whether I incur charges as a result. I expressly consent and agree to <strong>Universal Insurance Brokers</strong> and its affiliates, agents and assigns, contacting me by the following methods including, but not limited to, any telephone dialing system, sending text messages or e-mails using any e-mail address I provide now or in the future, using manual calling methods, pre-recorded/artificial voice messages and/or use of an automatic dialing device or system, as applicable. I understand that my consent is not a condition of purchase."</p>
  </div>
  <p class="yn" style="margin-top:16px;"><strong>Permission to follow up:</strong> &nbsp; ${entry.permissionToFollowUp === 'Yes' ? '<span>✓ Yes</span>' : '<span>Yes</span>'} ${entry.permissionToFollowUp === 'No' ? '<span>✓ No</span>' : '<span>No</span>'}</p>
  <div class="field-row" style="margin-top:20px;">
    <div class="field"><label>Customer Name</label><div class="line" style="padding-top:4px;">${entry.customerName}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Customer Signature</label><img src="${entry.customerSig}" class="sig-img" alt="Customer Signature"></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Verified By</label><div class="line" style="padding-top:4px;">${entry.agent}</div></div>
    <div class="field"><label>Agent/CSR Signature Dated</label><div class="line" style="padding-top:4px;">${formatted}</div></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Agent / CSR Signature</label><img src="${entry.agentSig}" class="sig-img" alt="Agent Signature"></div>
  </div>
  <p class="yn" style="margin-top:16px;"><strong>Agent/CSR confirms forms presented:</strong> &nbsp; ${entry.agentConfirmed === 'Yes' ? '<span>✓ Yes</span>' : '<span>Yes</span>'} ${entry.agentConfirmed === 'No' ? '<span>✓ No</span>' : '<span>No</span>'}</p>
</div>

<script>window.onload = () => window.print();<\/script>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `VerificationLog-${entry.customerName.replace(/\s+/g,'-')}-${entry.date}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── New Prospect ──────────────────────────────────────────────
function openLeadEntryModal() {
    const m = document.getElementById('leadEntryModal');
    m.classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}
function closeLeadEntryModal() {
    document.getElementById('leadEntryModal').classList.remove('active');
}

function openNewProspectModal() {
    const m = document.getElementById('newProspectModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    // Set today's date + time (ET)
    document.getElementById('prospectDateAdded').value = getEasternDateTimeDisplay();

    // Populate Source and Referred By dropdowns
    populateSourceDropdown('prospectSource', '');
    populateProspectReferralDropdown('');

    // Build agent multi-select checkboxes
    const agents = getAllAgents();
    const box = document.getElementById('prospectAgentCheckboxes');
    if (box) {
        box.innerHTML = agents.map(a => `
            <label style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;font-size:14px;color:#374151;border-bottom:1px solid #f3f4f6;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
                <input type="checkbox" class="prospect-agent-cb" value="${a}" onchange="prospectAgentUpdateDisplay()" style="width:15px;height:15px;accent-color:#1d4ed8;cursor:pointer;">
                ${a}
            </label>`).join('');
    }
    // Reset state
    document.getElementById('prospectAgentSelectAll').checked = false;
    prospectAgentUpdateDisplay();

    document.getElementById('prospectSuccessMsg').style.display = 'none';
}

function closeNewProspectModal() {
    document.getElementById('newProspectModal').classList.remove('active');
    document.getElementById('prospectForm').reset();
    document.getElementById('prospectNewSourceRow').style.display   = 'none';
    document.getElementById('prospectNewReferralRow').style.display = 'none';
    document.getElementById('prospectAgentDropdown').style.display  = 'none';
    document.querySelectorAll('.prospect-agent-cb').forEach(cb => cb.checked = false);
    document.getElementById('prospectAgentSelectAll').checked = false;
    prospectAgentUpdateDisplay();
    document.getElementById('prospectSuccessMsg').style.display = 'none';
}

function saveProspect(e) {
    e.preventDefault();
    const prospect = {
        id:          'PROS-' + Date.now(),
        firstName:   document.getElementById('prospectFirstName').value.trim(),
        lastName:    document.getElementById('prospectLastName').value.trim(),
        phone:       document.getElementById('prospectPhone').value.trim(),
        email:       document.getElementById('prospectEmail').value.trim(),
        lob:         document.getElementById('prospectLOB').value,
        source:      document.getElementById('prospectSource').value,
        referredBy:  document.getElementById('prospectReferredBy').value.trim(),
        agent:       prospectAgentGetSelected().join(', '),
        followUpDate:document.getElementById('prospectFollowUpDate').value,
        dateAdded:   getEasternDateTimeDisplay(),
        notes:       document.getElementById('prospectNotes').value.trim(),
        status:      'Open'
    };

    const prospects = JSON.parse(localStorage.getItem('prospectData')) || [];
    prospects.push(prospect);
    localStorage.setItem('prospectData', JSON.stringify(prospects));

    document.getElementById('prospectForm').reset();
    document.getElementById('prospectDateAdded').value = getEasternDateTimeDisplay();
    document.querySelectorAll('.prospect-agent-cb').forEach(cb => cb.checked = false);
    document.getElementById('prospectAgentSelectAll').checked = false;
    prospectAgentUpdateDisplay();
    const msg = document.getElementById('prospectSuccessMsg');
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);

    // Refresh list if prospects section is open
    if (document.getElementById('prospectsSection')?.classList.contains('active')) {
        renderProspectsTable();
    }
}

// ── Prospects List Section ─────────────────────────────────────
function showProspectsSection() {
    showSection('prospectsSection');
    renderProspectsTable();
    refreshIcons();
    if (window.UIBMotion) UIBMotion.animateSection(document.getElementById('prospectsSection'));
}

function renderProspectsTable() {
    const prospects = JSON.parse(localStorage.getItem('prospectData')) || [];
    const search    = (document.getElementById('prospectSearch')?.value || '').toLowerCase();
    const agentF    = document.getElementById('prospectFilterAgent')?.value || '';
    const statusF   = document.getElementById('prospectFilterStatus')?.value || '';

    const filtered = prospects.filter(p => {
        const name = `${p.firstName} ${p.lastName}`.toLowerCase();
        const matchSearch = !search ||
            name.includes(search) ||
            (p.phone || '').toLowerCase().includes(search) ||
            (p.email || '').toLowerCase().includes(search) ||
            (p.lob || '').toLowerCase().includes(search);
        const matchAgent  = !agentF  || p.agent === agentF;
        const matchStatus = !statusF || p.status === statusF;
        return matchSearch && matchAgent && matchStatus;
    });

    // Sort newest first
    filtered.sort((a, b) => b.id.localeCompare(a.id));

    const tbody = document.getElementById('prospectsTableBody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--gray-400);padding:32px;">No prospects found.</td></tr>';
        document.getElementById('prospectCount').textContent = '';
        return;
    }

    const statusColors = {
        'Open':      'background:#eff6ff;color:#1d4ed8;',
        'Contacted': 'background:#fef9c3;color:#854d0e;',
        'Quoted':    'background:#f0fdf4;color:#166534;',
        'Closed':    'background:#d1fae5;color:#065f46;',
        'Lost':      'background:#fef2f2;color:#991b1b;'
    };

    tbody.innerHTML = filtered.map(p => {
        const fullName  = `${p.firstName || ''} ${p.lastName || ''}`.trim();
        const sStyle    = statusColors[p.status] || '';
        const followUp  = p.followUpDate ? new Date(p.followUpDate + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
        return `<tr>
            <td style="font-weight:600;">${fullName}</td>
            <td>${p.phone || '—'}</td>
            <td>${p.email || '—'}</td>
            <td>${p.lob || '—'}</td>
            <td>${p.source || '—'}</td>
            <td>${p.agent || '—'}</td>
            <td>${followUp}</td>
            <td><span style="padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;${sStyle}">${p.status || 'Open'}</span></td>
            <td style="font-size:12px;color:var(--gray-500);">${p.dateAdded || '—'}</td>
            <td style="max-width:200px;font-size:12px;color:var(--gray-600);">${p.notes || '—'}</td>
        </tr>`;
    }).join('');

    document.getElementById('prospectCount').textContent =
        `Showing ${filtered.length} of ${prospects.length} prospect${prospects.length !== 1 ? 's' : ''}`;

    if (window.UIBMotion) UIBMotion.animateTableRows(tbody);
}

// ── Verification Logs Section ──────────────────────────────────
function showVerificationLogsSection() {
    showSection('verificationLogsSection');
    renderVerificationLogsTable();
    refreshIcons();
    if (window.UIBMotion) UIBMotion.animateSection(document.getElementById('verificationLogsSection'));
}

function renderVerificationLogsTable() {
    const logs    = JSON.parse(localStorage.getItem('verificationLogs')) || [];
    const search  = (document.getElementById('vlSearch')?.value || '').toLowerCase();
    const agentF  = document.getElementById('vlFilterAgent')?.value || '';
    const dealerF = document.getElementById('vlFilterDealer')?.value || '';

    const filtered = logs.filter(l => {
        const matchSearch = !search || (l.customerName || '').toLowerCase().includes(search);
        const matchAgent  = !agentF  || l.agent === agentF;
        const matchDealer = !dealerF || l.dealer === dealerF;
        return matchSearch && matchAgent && matchDealer;
    });

    // Sort newest first
    filtered.sort((a, b) => b.id.localeCompare(a.id));

    const tbody = document.getElementById('vlTableBody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:32px;">No verification logs found.</td></tr>';
        document.getElementById('vlCount').textContent = '';
        return;
    }

    const yesStyle = 'background:#d1fae5;color:#065f46;';
    const noStyle  = 'background:#fef2f2;color:#991b1b;';

    tbody.innerHTML = filtered.map(l => {
        const ackStyle  = l.acknowledged   === 'yes' ? yesStyle : noStyle;
        const permStyle = l.permissionToFollowUp === 'yes' ? yesStyle : noStyle;
        const confStyle = l.agentConfirmed === 'yes' ? yesStyle : noStyle;
        const badge = (val, style) =>
            `<span style="padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;${style}">${val === 'yes' ? 'Yes' : 'No'}</span>`;
        return `<tr>
            <td>${l.date || '—'}</td>
            <td>${l.agent || '—'}</td>
            <td style="font-weight:600;">${l.customerName || '—'}</td>
            <td>${l.dealer || '—'}</td>
            <td>${badge(l.acknowledged, ackStyle)}</td>
            <td>${badge(l.permissionToFollowUp, permStyle)}</td>
            <td>${badge(l.agentConfirmed, confStyle)}</td>
            <td style="font-size:12px;color:var(--gray-500);">${l.timestamp || '—'}</td>
            <td><button class="btn-sm btn-secondary" onclick="redownloadVerificationLog('${l.id}')"><i data-lucide="download"></i> Download</button></td>
        </tr>`;
    }).join('');

    document.getElementById('vlCount').textContent =
        `Showing ${filtered.length} of ${logs.length} log${logs.length !== 1 ? 's' : ''}`;

    refreshIcons();
    if (window.UIBMotion) UIBMotion.animateTableRows(tbody);
}

function redownloadVerificationLog(id) {
    const logs  = JSON.parse(localStorage.getItem('verificationLogs')) || [];
    const entry = logs.find(l => l.id === id);
    if (entry) downloadVerificationForm(entry);
}

// ── Daily Sales Entry Modal ────────────────────────────────────
let _selectedSalesLocation = '';
// Tracks which select id should auto-select the carrier name after a carrier save
let _carrierFormAutoSelect = null;

function openDailySalesModal() {
    _selectedSalesLocation = '';
    const locSel = document.getElementById('salesLocationSelect');
    if (locSel) locSel.value = '';
    setTodayDate();
    generateBinderNumber();
    refreshAllCarrierDropdowns();
    populateSourceDropdown('source', '');
    resetDriversVehicles();
    const m = document.getElementById('dailySalesModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    setTimeout(() => locSel?.focus(), 120);
}

function selectLocationAndOpenSales(location) {
    // Legacy — no longer used but kept for safety
    _selectedSalesLocation = location;
}

function closeDailySalesModal() {
    document.getElementById('dailySalesModal').classList.remove('active');
    _selectedSalesLocation = '';
    const locSel = document.getElementById('salesLocationSelect');
    if (locSel) locSel.value = '';
    clientLookupClear();
    // Clear any pending files that weren't saved
    _pendingEntryFiles = [];
    binderUpdateAttachButton();
    // Clear auto-calculated commission display
    const comm = document.getElementById('agencyCommission');
    const agent = document.getElementById('agentCommission');
    const label = document.getElementById('commissionRateLabel');
    const breakdown = document.getElementById('commissionBreakdown');
    if (comm) comm.value = '';
    if (agent) agent.value = '';
    if (label) { label.style.display = 'none'; label.textContent = ''; }
    if (breakdown) { breakdown.style.display = 'none'; breakdown.textContent = ''; }
}

// ── Source Dropdown Management ───────────────────────────────────────────────
const DEFAULT_SOURCES = ['Referral','Walk-In','Online','Phone','Repeat Client','Social Media','Agent Referral','Other'];

function getCustomSources() {
    try { return JSON.parse(localStorage.getItem('customSources')) || []; } catch(e) { return []; }
}

function saveCustomSources(arr) {
    localStorage.setItem('customSources', JSON.stringify(arr));
}

function populateSourceDropdown(selectId, selectedValue) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const all = [...DEFAULT_SOURCES, ...getCustomSources().filter(s => !DEFAULT_SOURCES.includes(s))];
    sel.innerHTML = '<option value="">Select Source</option>' +
        all.map(s => `<option value="${s}"${s===selectedValue?' selected':''}>${s}</option>`).join('') +
        '<option value="__add_new__">＋ Add New Source…</option>';
}

function sourceDropdownChanged(sel) {
    if (sel.value === '__add_new__') {
        sel.value = '';
        openAddSourceModal();
    }
}

// ── Edit Modal: Source + Referral ＋ buttons ──────────────────

function editSourceDropdownChanged(sel) {
    if (sel.value === '__add_new__') {
        sel.value = '';
        openEditAddSourceModal();
    }
}

function openEditAddSourceModal() {
    const row = document.getElementById('editNewSourceRow');
    const inp = document.getElementById('editNewSourceInput');
    if (row) { row.style.display = 'block'; }
    if (inp) { inp.value = ''; inp.focus(); }
}

function cancelEditNewSource() {
    const row = document.getElementById('editNewSourceRow');
    if (row) row.style.display = 'none';
}

function saveEditNewSource() {
    const inp = document.getElementById('editNewSourceInput');
    const val = (inp?.value || '').trim();
    if (!val) { inp?.focus(); return; }
    const customs = getCustomSources();
    const all = [...DEFAULT_SOURCES, ...customs];
    if (!all.map(s => s.toLowerCase()).includes(val.toLowerCase())) {
        customs.push(val);
        saveCustomSources(customs);
    }
    populateSourceDropdown('editSource', val);
    cancelEditNewSource();
}

function openEditAddReferralModal() {
    const row = document.getElementById('editNewReferralRow');
    const inp = document.getElementById('editNewReferralInput');
    if (row) { row.style.display = 'block'; }
    if (inp) { inp.value = ''; inp.focus(); }
}

function cancelEditNewReferral() {
    const row = document.getElementById('editNewReferralRow');
    if (row) row.style.display = 'none';
}

function saveEditNewReferral() {
    const inp = document.getElementById('editNewReferralInput');
    const val = (inp?.value || '').trim();
    if (!val) { inp?.focus(); return; }
    const customs = getCustomReferrals();
    if (!customs.map(r => r.toLowerCase()).includes(val.toLowerCase())) {
        customs.push(val);
        saveCustomReferrals(customs);
    }
    populateEditReferralDropdown(val);
    cancelEditNewReferral();
}

function populateEditReferralDropdown(selectedValue) {
    const sel = document.getElementById('editReferredBy');
    if (!sel) return;
    const customs = getCustomReferrals();
    sel.innerHTML = '<option value="">— None —</option>' +
        customs.map(r => `<option value="${r}"${r === selectedValue ? ' selected' : ''}>${r}</option>`).join('');
}

function openAddSourceModal() {
    const row = document.getElementById('newSourceRow');
    const inp = document.getElementById('newSourceInput');
    if (row) { row.style.display = 'block'; }
    if (inp) { inp.value = ''; inp.focus(); }
}

function cancelNewSource() {
    const row = document.getElementById('newSourceRow');
    if (row) row.style.display = 'none';
}

function saveNewSource() {
    const inp = document.getElementById('newSourceInput');
    const val = (inp?.value || '').trim();
    if (!val) { inp?.focus(); return; }

    const customs = getCustomSources();
    const all = [...DEFAULT_SOURCES, ...customs];
    if (all.map(s => s.toLowerCase()).includes(val.toLowerCase())) {
        // Already exists — just select it
        populateSourceDropdown('source', val);
        document.getElementById('source').value = val;
        cancelNewSource();
        return;
    }

    customs.push(val);
    saveCustomSources(customs);
    populateSourceDropdown('source', val);
    document.getElementById('source').value = val;
    cancelNewSource();
}

// ── Client Lookup Search ──────────────────────────────────────────────────────
function clientLookupSearch(query) {
    const clearBtn = document.getElementById('clientLookupClear');
    const resultsDiv = document.getElementById('clientLookupResults');
    if (!resultsDiv) return;

    if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

    const q = query.trim().toLowerCase();
    if (q.length < 2) {
        resultsDiv.innerHTML = '';
        return;
    }

    // Search allData for matching customer names
    const matches = {};
    (allData || []).forEach(e => {
        const name = (e.customerName || '').trim();
        if (!name) return;
        if (name.toLowerCase().includes(q)) {
            if (!matches[name]) matches[name] = [];
            matches[name].push(e);
        }
    });

    const names = Object.keys(matches);

    if (names.length === 0) {
        resultsDiv.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;font-size:13px;color:#166534;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                <span><strong>No existing client found</strong> — this appears to be a new client. Go ahead!</span>
            </div>`;
        return;
    }

    const rows = names.slice(0, 8).map(name => {
        const entries = matches[name];
        const latest  = entries.sort((a,b) => (b.entryDate||'').localeCompare(a.entryDate||''))[0];
        const count   = entries.length;
        const carrier = latest.company || '—';
        const lob     = latest.lineOfBusiness || '—';
        const date    = latest.entryDate ? latest.entryDate.slice(0,10) : '—';
        const agent   = latest.agent || '—';
        const safeName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        return `
            <div onclick="clientLookupSelect('${safeName}')"
                style="display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-radius:7px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;margin-bottom:5px;transition:background .12s;"
                onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#fff'">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:2px;">${lob} · ${carrier} · Last: ${date} · Agent: ${agent}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:10px;">
                    <span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;">${count} ${count===1?'policy':'policies'}</span>
                    <span style="background:linear-gradient(to right,#1d4ed8,#2563eb);color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;">Select</span>
                </div>
            </div>`;
    }).join('');

    const more = names.length > 8 ? `<div style="font-size:11px;color:#94a3b8;text-align:center;padding:4px;">…and ${names.length - 8} more results</div>` : '';

    resultsDiv.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:#0369a1;margin-bottom:5px;padding:0 2px;">
            ⚠️ ${names.length} existing client${names.length>1?'s':''} found — select to auto-fill, or continue typing a new name
        </div>
        ${rows}${more}`;
}

function clientLookupSelect(name) {
    const input = document.getElementById('customerName');
    if (input) {
        input.value = name;
        input.dispatchEvent(new Event('input'));
        // Highlight the field briefly
        input.style.transition = 'box-shadow .3s';
        input.style.boxShadow = '0 0 0 3px rgba(29,78,216,.35)';
        setTimeout(() => input.style.boxShadow = '', 1200);
    }
    // Show returning-client badge in results
    const resultsDiv = document.getElementById('clientLookupResults');
    if (resultsDiv) {
        resultsDiv.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;font-size:13px;color:#1d4ed8;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span><strong>Returning client:</strong> "${name}" — Customer Name field has been filled in.</span>
            </div>`;
    }
    const clearBtn = document.getElementById('clientLookupInput');
    if (clearBtn) clearBtn.value = name;
}

// ── Agent Portal Universal Search ────────────────────────────

let _agentSearchTimer = null;

function agentGlobalSearchRun(query) {
    const clearBtn = document.getElementById('agentGlobalSearchClearBtn');
    const results  = document.getElementById('agentGlobalSearchResults');
    if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';
    if (!results) return;

    clearTimeout(_agentSearchTimer);
    const q = query.trim().toLowerCase();

    if (q.length < 2) {
        results.innerHTML = '';
        return;
    }

    _agentSearchTimer = setTimeout(() => {
        const matches = (allData || []).filter(e => {
            return (e.customerName   || '').toLowerCase().includes(q) ||
                   (e.company        || '').toLowerCase().includes(q) ||
                   (e.policyNumber   || '').toLowerCase().includes(q) ||
                   (e.binderNumber   || '').toLowerCase().includes(q) ||
                   (e.lineOfBusiness || '').toLowerCase().includes(q) ||
                   (e.agent          || '').toLowerCase().includes(q) ||
                   (e.location       || '').toLowerCase().includes(q) ||
                   (e.policyType     || '').toLowerCase().includes(q) ||
                   (e.source         || '').toLowerCase().includes(q);
        }).sort((a, b) => (b.entryDate || '').localeCompare(a.entryDate || ''));

        if (matches.length === 0) {
            results.innerHTML = `<div style="padding:12px 14px;background:#fff;border-radius:8px;font-size:13px;color:#64748b;border:1px solid #e5e7eb;">No entries found for "<strong>${q}</strong>"</div>`;
            return;
        }

        const shown = matches.slice(0, 50);
        const rows  = shown.map(e => `
            <tr style="font-size:13px;">
                <td style="white-space:nowrap;color:#64748b;">${formatDate(e.entryDate)}</td>
                <td style="font-weight:600;color:#1e293b;">${e.customerName || '—'}</td>
                <td><span style="background:#eff6ff;color:#1d4ed8;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700;">${e.agent || '—'}</span></td>
                <td style="color:#374151;">${e.policyType || '—'}</td>
                <td style="color:#374151;">${e.lineOfBusiness || '—'}</td>
                <td style="font-weight:600;">${e.company || '—'}</td>
                <td style="font-family:monospace;font-size:12px;">${e.policyNumber || '—'}</td>
                <td style="font-weight:700;color:#0d1f3c;">$${parseFloat(e.totalPremium || 0).toFixed(2)}</td>
                <td style="color:#64748b;font-size:12px;">${e.location || '—'}</td>
            </tr>`).join('');

        const more = matches.length > 50 ? `<div style="padding:8px 14px;font-size:12px;color:#94a3b8;text-align:center;">Showing 50 of ${matches.length} results — refine your search for more</div>` : '';

        results.innerHTML = `
            <div style="font-size:12px;font-weight:600;color:#0369a1;margin-bottom:8px;padding:0 2px;">
                ${matches.length} result${matches.length !== 1 ? 's' : ''} found
            </div>
            <div style="overflow-x:auto;border-radius:10px;border:1px solid #e5e7eb;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.06);">
                <table style="width:100%;border-collapse:collapse;min-width:700px;">
                    <thead>
                        <tr style="background:#f8fafc;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Date</th>
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Customer</th>
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Agent</th>
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Type</th>
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">LOB</th>
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Carrier</th>
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Policy #</th>
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Premium</th>
                            <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb;">Location</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
            ${more}`;
    }, 200);
}

function agentGlobalSearchClear() {
    const inp  = document.getElementById('agentGlobalSearch');
    const btn  = document.getElementById('agentGlobalSearchClearBtn');
    const res  = document.getElementById('agentGlobalSearchResults');
    if (inp) inp.value = '';
    if (btn) btn.style.display = 'none';
    if (res) res.innerHTML = '';
}

// ── Customer Name Autocomplete (BinderBook + AMS) ─────────────

let _cnDropdownIndex = -1;

function customerNameAutocomplete(query) {
    const dd = document.getElementById('customerNameDropdown');
    if (!dd) return;
    const q = query.trim().toLowerCase();
    if (q.length < 2) { dd.style.display = 'none'; return; }

    // --- BinderBook matches ---
    const bbMatches = {};
    (allData || []).forEach(e => {
        const name = (e.customerName || '').trim();
        if (name.toLowerCase().includes(q)) {
            if (!bbMatches[name]) bbMatches[name] = [];
            bbMatches[name].push(e);
        }
    });

    // --- AMS matches ---
    const amsContacts = JSON.parse(localStorage.getItem('amsClientData') || '{}');
    const amsMatches  = {};
    Object.entries(amsContacts).forEach(([key, contact]) => {
        const name = contact.name || contact.displayName || key;
        if (name.toLowerCase().includes(q)) {
            amsMatches[name] = contact;
        }
    });

    // Merge: start with BinderBook names, add AMS-only names
    const allNames = new Map();
    Object.keys(bbMatches).forEach(n => allNames.set(n, { bb: bbMatches[n], ams: null }));
    Object.keys(amsMatches).forEach(n => {
        const key = n;
        if (allNames.has(key)) { allNames.get(key).ams = amsMatches[n]; }
        else allNames.set(key, { bb: null, ams: amsMatches[n] });
    });

    if (allNames.size === 0) { dd.style.display = 'none'; return; }

    _cnDropdownIndex = -1;
    const items = [...allNames.entries()].slice(0, 10);
    dd.innerHTML = items.map(([name, src], i) => {
        const bbCount  = src.bb ? src.bb.length : 0;
        const latest   = src.bb ? src.bb.sort((a,b)=>(b.entryDate||'').localeCompare(a.entryDate||''))[0] : null;
        const lob      = latest?.lineOfBusiness || '';
        const agent    = latest?.agent || '';
        const badges   = [];
        if (bbCount > 0) badges.push(`<span style="background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;padding:1px 7px;border-radius:10px;">📋 ${bbCount} ${bbCount===1?'policy':'policies'}</span>`);
        if (src.ams)     badges.push(`<span style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:1px 7px;border-radius:10px;">🏢 AMS</span>`);
        const sub = [lob, agent].filter(Boolean).join(' · ');
        return `<div class="cn-dd-item" data-name="${name.replace(/"/g,'&quot;')}" data-index="${i}"
            onclick="customerNameSelect('${name.replace(/'/g,"\\'")}') "
            onmouseenter="customerNameDropdownHighlight(${i})"
            style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="min-width:0;">
                <div style="font-size:14px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
                ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:1px;">${sub}</div>` : ''}
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0;">${badges.join('')}</div>
        </div>`;
    }).join('');

    dd.style.display = 'block';
}

function customerNameSelect(name) {
    const inp = document.getElementById('customerName');
    if (inp) { inp.value = name; inp.dispatchEvent(new Event('input')); }
    customerNameDropdownHide();
    // Also sync the existing lookup bar
    const lu = document.getElementById('clientLookupInput');
    if (lu) { lu.value = name; clientLookupSearch(name); }
}

function customerNameDropdownHide() {
    const dd = document.getElementById('customerNameDropdown');
    if (dd) dd.style.display = 'none';
    _cnDropdownIndex = -1;
}

function customerNameDropdownHighlight(index) {
    _cnDropdownIndex = index;
    document.querySelectorAll('.cn-dd-item').forEach((el, i) => {
        el.style.background = i === index ? '#eff6ff' : '';
    });
}

function customerNameDropdownKeyNav(e) {
    const items = document.querySelectorAll('.cn-dd-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        _cnDropdownIndex = Math.min(_cnDropdownIndex + 1, items.length - 1);
        customerNameDropdownHighlight(_cnDropdownIndex);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _cnDropdownIndex = Math.max(_cnDropdownIndex - 1, 0);
        customerNameDropdownHighlight(_cnDropdownIndex);
    } else if (e.key === 'Enter' && _cnDropdownIndex >= 0) {
        e.preventDefault();
        const name = items[_cnDropdownIndex]?.dataset?.name;
        if (name) customerNameSelect(name);
    } else if (e.key === 'Escape') {
        customerNameDropdownHide();
    }
}

function clientLookupClear() {
    const inp = document.getElementById('clientLookupInput');
    const res = document.getElementById('clientLookupResults');
    const btn = document.getElementById('clientLookupClear');
    if (inp) inp.value = '';
    if (res) res.innerHTML = '';
    if (btn) btn.style.display = 'none';
}

function showSuccess() {
    const msg = document.getElementById('successMessage');
    if (window.UIBMotion) {
        msg.classList.add('show');
        UIBMotion.animateSuccess(msg);
    } else {
        msg.classList.add('show');
        setTimeout(() => msg.classList.remove('show'), 3000);
    }
}

// Agent Data Display
function loadAgentData() {
    const month = document.getElementById('agentFilter')?.value || '';
    const query = (document.getElementById('agentSubmissionSearch')?.value || '').trim().toLowerCase();

    let entries = allData.filter(d => d.agent === currentUser);
    if (month) entries = entries.filter(d => d.entryDate && d.entryDate.startsWith(month));
    if (query) {
        entries = entries.filter(d => {
            const haystack = [
                d.customerName, d.contactName, d.company, d.mga,
                d.policyNumber, d.binderNumber, d.lineOfBusiness,
                d.policyType, d.location, d.entryDateDisplay
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(query);
        });
    }

    renderAgentTable(entries);
    apdInit();
}

function renderAgentTable(entries) {
    const tbody = document.getElementById('agentTable');
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-data">No entries yet</td></tr>';
        return;
    }

    tbody.innerHTML = entries.map(entry => `
        <tr>
            <td>${formatDate(entry.entryDate)}</td>
            <td>${entry.customerName}</td>
            <td>${entry.policyType}</td>
            <td>${entry.lineOfBusiness}</td>
            <td>${entry.company}</td>
            <td>${entry.policyNumber || '-'}</td>
            <td>$${entry.totalPremium.toFixed(2)}</td>
            <td style="white-space:nowrap;">
                <button class="btn-primary btn-sm" onclick="openEditModal(${entry.id})" style="margin-right:2px;"><i data-lucide="pencil"></i> Edit</button>
                <button class="btn-success btn-sm" onclick="binderOpenFileModal(${entry.id}, ${JSON.stringify(entry.customerName)})" data-binder-file-btn="${entry.id}" title="Manage Files" style="margin-right:2px;background:#059669;"><i data-lucide="folder-open"></i></button>
                <button class="btn-danger btn-sm" onclick="deleteEntry(${entry.id})"><i data-lucide="trash-2"></i> Delete</button>
            </td>
        </tr>
    `).join('');
    refreshIcons();
    if (window.UIBMotion) UIBMotion.animateTableRows(document.getElementById('agentTable'));
}

function filterAgentData() {
    const month = document.getElementById('agentFilter').value;
    if (!month) {
        loadAgentData();
        return;
    }

    const agentEntries = allData.filter(d =>
        d.agent === currentUser &&
        d.entryDate.startsWith(month)
    );
    renderAgentTable(agentEntries);
}

function resetAgentFilter() {
    document.getElementById('agentFilter').value = '';
    const search = document.getElementById('agentSubmissionSearch');
    if (search) search.value = '';
    loadAgentData();
}

function searchAgentSubmissions() {
    const query = (document.getElementById('agentSubmissionSearch')?.value || '').trim().toLowerCase();
    const month = document.getElementById('agentFilter')?.value || '';

    let entries = allData.filter(d => d.agent === currentUser);
    if (month) entries = entries.filter(d => d.entryDate && d.entryDate.startsWith(month));

    if (query) {
        entries = entries.filter(d => {
            const haystack = [
                d.customerName, d.contactName, d.company, d.mga,
                d.policyNumber, d.binderNumber, d.lineOfBusiness,
                d.policyType, d.location, d.entryDateDisplay
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(query);
        });
    }

    renderAgentTable(entries);
}

// Admin Dashboard
function loadAdminDashboard() {
    // One-time migration: set all Uriel Rendon entries to Gross Paid
    if (!localStorage.getItem('migration_uriel_gross_paid')) {
        const before = allData.length;
        let changed = 0;
        allData = allData.map(e => {
            if (e.agent !== 'Uriel Rendon') return e;
            const premium   = parseFloat(e.basePremium || e.totalPremium) || 0;
            const agencyFee = parseFloat(e.agencyFee) || 0;
            const rate      = getCommissionRate(e.company, e.lineOfBusiness, 'Gross Paid', e.policyType || 'New');
            const agencyComm = rate > 0 ? parseFloat((premium * (rate / 100)).toFixed(2)) : (e.agencyCommission || 0);
            const agentShare = parseFloat(((agencyFee + agencyComm) * 0.5).toFixed(2));
            changed++;
            return { ...e, paymentType: 'Gross Paid', agencyCommission: agencyComm, agentCommissionShare: agentShare };
        });
        if (changed > 0) {
            localStorage.setItem('binderData', JSON.stringify(allData));
            driveSet('binderData', allData);
            recalculateAllCommissions();
        }
        localStorage.setItem('migration_uriel_gross_paid', '1');
    }

    populateAgentFilter();
    renderAdminStats();
    renderCharts();
    renderAdminTable(allData);
}

function populateAgentFilter() {
    const select = document.getElementById('agentFilter');
    if (!select) return;

    // Get agents from master list
    const agentMasterData = JSON.parse(localStorage.getItem('agentMasterData')) || {};
    const masterAgents = Object.keys(agentMasterData);

    // Also get any agents from existing entries (in case any exist outside master list)
    const entryAgents = [...new Set(allData.map(d => d.agent).filter(Boolean))];

    // Combine both sources, deduplicate, and sort alphabetically
    const allAgents = [...new Set([...masterAgents, ...entryAgents])].sort();

    select.innerHTML = '<option value="">All Agents</option>';
    allAgents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent;
        option.textContent = agent;
        select.appendChild(option);
    });
}

function renderAdminStats() {
    const filteredData = getFilteredData();

    const stats = {
        totalPremium: filteredData.reduce((sum, d) => sum + d.totalPremium, 0),
        totalEntries: filteredData.length,
        totalAgents: new Set(filteredData.map(d => d.agent)).size,
        avgPremium: filteredData.length > 0 ? filteredData.reduce((sum, d) => sum + d.totalPremium, 0) / filteredData.length : 0
    };

    const statsGrid = document.getElementById('statsGrid');
    statsGrid.innerHTML = `
        <div class="stat-card">
            <h4>Total Premium Revenue</h4>
            <div class="number">$${stats.totalPremium.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
        </div>
        <div class="stat-card">
            <h4>Total Entries</h4>
            <div class="number">${stats.totalEntries}</div>
        </div>
        <div class="stat-card">
            <h4>Active Agents</h4>
            <div class="number">${stats.totalAgents}</div>
        </div>
        <div class="stat-card">
            <h4>Average Premium</h4>
            <div class="number">$${stats.avgPremium.toFixed(2)}</div>
        </div>
    `;
    if (window.UIBMotion) UIBMotion.animateStatCards();
}

function renderCharts() {
    const filteredData = getFilteredData();

    // Agent Chart
    const agentData = {};
    filteredData.forEach(d => {
        agentData[d.agent] = (agentData[d.agent] || 0) + d.totalPremium;
    });

    const agentChart = document.getElementById('agentChart');
    const agentMax = Math.max(...Object.values(agentData)) || 1;
    agentChart.innerHTML = Object.entries(agentData)
        .map(([agent, total]) => {
            const pct = ((total / agentMax) * 100).toFixed(1) + '%';
            return `
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <strong>${agent}</strong>
                    <span>$${total.toFixed(2)}</span>
                </div>
                <div style="background: var(--gray-200); border-radius: 6px; height: 24px; overflow: hidden;">
                    <div data-chart-bar="${pct}" style="background: linear-gradient(90deg, var(--blue) 0%, var(--blue-light) 100%); height: 100%; border-radius: 6px; width: 0%;">
                    </div>
                </div>
            </div>`;
        }).join('');
    if (window.UIBMotion) UIBMotion.animateChartBars(agentChart);

    // Business Chart
    const businessData = {};
    filteredData.forEach(d => {
        businessData[d.lineOfBusiness] = (businessData[d.lineOfBusiness] || 0) + d.totalPremium;
    });

    const businessChart = document.getElementById('businessChart');
    const bizMax = Math.max(...Object.values(businessData)) || 1;
    businessChart.innerHTML = Object.entries(businessData)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([business, total]) => {
            const pct = ((total / bizMax) * 100).toFixed(1) + '%';
            return `
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <strong>${business}</strong>
                    <span>$${total.toFixed(2)}</span>
                </div>
                <div style="background: var(--gray-200); border-radius: 6px; height: 24px; overflow: hidden;">
                    <div data-chart-bar="${pct}" style="background: linear-gradient(90deg, var(--purple) 0%, var(--blue-light) 100%); height: 100%; border-radius: 6px; width: 0%;">
                    </div>
                </div>
            </div>`;
        }).join('');
    if (window.UIBMotion) UIBMotion.animateChartBars(businessChart);
}

function renderAdminTable(entries) {
    const tbody   = document.getElementById('adminTable');
    const sortBy  = document.getElementById('adminSortBy')?.value || 'entryDate';
    const showEff = sortBy === 'effDate';

    if (entries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${showEff ? 13 : 12}" class="no-data">No data available</td></tr>`;
        return;
    }

    tbody.innerHTML = entries.map(entry => {
        const primaryDate = showEff
            ? formatDate(entry.effDate || entry.entryDate)
            : formatDate(entry.entryDate);
        const secondaryDate = showEff
            ? `<td style="color:var(--gray-400);font-size:12px;">${formatDate(entry.entryDate)}</td>`
            : '';

        return `
        <tr>
            <td><strong>${entry.agent}</strong></td>
            <td>${primaryDate}</td>
            ${secondaryDate}
            <td>${entry.customerName}</td>
            <td>${entry.policyType}</td>
            <td>${entry.lineOfBusiness}</td>
            <td>${entry.company}</td>
            <td>${entry.mga || '-'}</td>
            <td>${entry.policyNumber || '-'}</td>
            <td>${entry.binderNumber}</td>
            <td>$${entry.totalPremium.toFixed(2)}</td>
            <td style="white-space:nowrap;">
                <button class="btn-primary btn-sm" onclick="openEditModal(${entry.id})" style="margin-right:2px;"><i data-lucide="pencil"></i> Edit</button>
                <button class="btn-success btn-sm" onclick="binderOpenFileModal(${entry.id}, ${JSON.stringify(entry.customerName)})" data-binder-file-btn="${entry.id}" title="Manage Files" style="margin-right:2px;background:#059669;"><i data-lucide="folder-open"></i></button>
                <button class="btn-danger btn-sm" onclick="deleteEntry(${entry.id})"><i data-lucide="trash-2"></i> Delete</button>
            </td>
        </tr>`;
    }).join('');
    refreshIcons();
    if (window.UIBMotion) UIBMotion.animateTableRows(document.getElementById('adminTable'));
}

function filterAdminData() {
    const data = getFilteredData();
    renderAdminTable(data);
    renderAdminStats();
    renderCharts();
}

function resetAdminFilter() {
    document.getElementById('agentFilter').value  = '';
    document.getElementById('monthFilter').value  = '';
    const sb = document.getElementById('adminSortBy');
    const sd = document.getElementById('adminSortDir');
    if (sb) sb.value = 'entryDate';
    if (sd) sd.value = 'desc';
    const hdr  = document.getElementById('adminDateColHeader');
    const hdr2 = document.getElementById('adminDateColHeader2');
    if (hdr)  hdr.textContent       = 'Date Entered';
    if (hdr2) hdr2.style.display    = 'none';
    loadAdminDashboard();
}

function getFilteredData() {
    const agent   = document.getElementById('agentFilter')?.value  || '';
    const month   = document.getElementById('monthFilter')?.value  || '';
    const sortBy  = document.getElementById('adminSortBy')?.value  || 'entryDate';
    const sortDir = document.getElementById('adminSortDir')?.value || 'desc';

    let filtered = allData;

    if (agent) filtered = filtered.filter(d => d.agent === agent);

    if (month) {
        // Filter against whichever date field is selected for sorting
        filtered = filtered.filter(d => {
            const dateField = sortBy === 'effDate' ? (d.effDate || d.entryDate) : d.entryDate;
            return dateField && dateField.startsWith(month);
        });
    }

    // Sort by selected date field
    filtered = [...filtered].sort((a, b) => {
        const da = new Date((sortBy === 'effDate' ? (a.effDate || a.entryDate) : a.entryDate) || '1970-01-01');
        const db = new Date((sortBy === 'effDate' ? (b.effDate || b.entryDate) : b.entryDate) || '1970-01-01');
        return sortDir === 'asc' ? da - db : db - da;
    });

    // Update column header label to reflect active sort field
    const hdr  = document.getElementById('adminDateColHeader');
    const hdr2 = document.getElementById('adminDateColHeader2');
    if (hdr) {
        if (sortBy === 'effDate') {
            hdr.textContent  = 'Eff. Date';
            if (hdr2) hdr2.style.display = 'table-cell';
        } else {
            hdr.textContent  = 'Date Entered';
            if (hdr2) hdr2.style.display = 'none';
        }
    }

    return filtered;
}

// Edit & Delete
let editingId = null;

function openEditModal(id) {
    editingId = id;
    const entry = allData.find(d => d.id === id);
    if (!entry) return;
    refreshAllCarrierDropdowns(); // ensure options are current before setting value
    populateSourceDropdown('editSource', entry.source || '');
    populateEditReferralDropdown(entry.referredBy || '');
    cancelEditNewSource();
    cancelEditNewReferral();
    document.getElementById('editCustomerName').value = entry.customerName || '';
    document.getElementById('editSource').value = entry.source || '';
    document.getElementById('editPolicyType').value = entry.policyType || '';
    document.getElementById('editLineOfBusiness').value = entry.lineOfBusiness || '';
    document.getElementById('editCompany').value = entry.company || '';
    document.getElementById('editMga').value = entry.mga || '';
    document.getElementById('editDown').value = entry.down || '';
    document.getElementById('editAgencyFee').value = entry.agencyFee || '';
    document.getElementById('editBasePremium').value = entry.basePremium || '';
    document.getElementById('editTotalPremium').value = entry.totalPremium || '';
    document.getElementById('editPaymentMethod').value = entry.paymentMethod || '';
    document.getElementById('editPaymentMethod2').value = entry.paymentMethod2 || '';
    document.getElementById('editPolicyNumber').value = entry.policyNumber || '';
    document.getElementById('editEntryDate').value = entry.entryDate || '';
    document.getElementById('editEffDate').value = entry.effDate || '';
    document.getElementById('editTerm').value = entry.term || '';
    document.getElementById('editAgencyCommission').value = entry.agencyCommission || '';
    document.getElementById('editPaymentType').value = entry.paymentType || '';
    document.getElementById('editStatus').value = entry.status || '';
    document.getElementById('editModal').classList.add('active');
}

function closeModal() {
    document.getElementById('editModal').classList.remove('active');
    editingId = null;
}

function updateEntry() {
    const entry = allData.find(d => d.id === editingId);
    if (!entry) return;
    entry.customerName = document.getElementById('editCustomerName').value;
    entry.source = document.getElementById('editSource').value;
    entry.referredBy = document.getElementById('editReferredBy').value;
    entry.policyType = document.getElementById('editPolicyType').value;
    entry.lineOfBusiness = document.getElementById('editLineOfBusiness').value;
    entry.company = document.getElementById('editCompany').value;
    entry.mga = document.getElementById('editMga').value;
    entry.down = parseFloat(document.getElementById('editDown').value) || 0;
    entry.agencyFee = parseFloat(document.getElementById('editAgencyFee').value) || 0;
    entry.basePremium = parseFloat(document.getElementById('editBasePremium').value) || 0;
    entry.totalPremium = parseFloat(document.getElementById('editTotalPremium').value) || 0;
    entry.paymentMethod = document.getElementById('editPaymentMethod').value;
    entry.paymentMethod2 = document.getElementById('editPaymentMethod2').value;
    entry.policyNumber = document.getElementById('editPolicyNumber').value;
    entry.entryDate = document.getElementById('editEntryDate').value;
    entry.effDate = document.getElementById('editEffDate').value;
    entry.term = document.getElementById('editTerm').value;
    entry.agencyCommission = parseFloat(document.getElementById('editAgencyCommission').value) || 0;
    entry.paymentType = document.getElementById('editPaymentType').value;
    entry.status = document.getElementById('editStatus').value;
    entry.agentCommissionShare = parseFloat(((entry.agencyFee + entry.agencyCommission) * 0.5).toFixed(2));
    localStorage.setItem('binderData', JSON.stringify(allData));
    // Re-sync to AMS so any contact/source/agent changes propagate
    if (typeof syncEntryToAMS === 'function') syncEntryToAMS(entry);
    closeModal();
    if (currentRole === 'agent') loadAgentData(); else loadAdminDashboard();
}

function deleteEntry(id) {
    if (confirm('Are you sure you want to delete this entry?')) {
        allData = allData.filter(d => d.id !== id);
        localStorage.setItem('binderData', JSON.stringify(allData));
        if (currentRole === 'agent') {
            loadAgentData();
        } else {
            loadAdminDashboard();
        }
    }
}

// Export Functions
function exportAgentData() {
    const entries = allData.filter(d => d.agent === currentUser);
    exportToCSV(entries, `${currentUser}_sales.csv`);
}

function exportAllData() {
    exportToCSV(allData, 'all_sales.csv');
}

function exportToCSV(entries, filename) {
    if (entries.length === 0) {
        alert('No data to export');
        return;
    }

    const headers = ['Agent', 'Date', 'Customer', 'Source', 'Policy Type', 'Line of Business', 'Company', 'Down', 'Agency Fee', 'Base Premium', 'Agency Commission', 'Total Premium', 'Payment Method', 'Second Payment Method', 'Commission Type', 'Policy #', 'Binder #', 'Term', 'Status'];

    const rows = entries.map(e => [
        e.agent,
        e.entryDate,
        e.customerName,
        e.source || '',
        e.policyType,
        e.lineOfBusiness,
        e.company,
        e.down,
        e.agencyFee || 0,
        e.basePremium,
        e.agencyCommission || 0,
        e.totalPremium,
        e.paymentMethod || '',
        e.paymentMethod2 || '',
        e.paymentType,
        e.policyNumber,
        e.binderNumber,
        e.term,
        e.status
    ]);

    const csv = [headers, ...rows].map(r => r.map(cell => `"${cell}"`).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
}

function exportToExcel() {
    exportAllData();
}

// Utility Functions
function formatDate(dateStr) {
    if (!dateStr) return '—';
    // Append T12:00:00 so YYYY-MM-DD strings are parsed as local noon, not UTC
    // midnight — prevents the date appearing one day earlier in ET/other western zones
    const safe = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00';
    return new Date(safe).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function clearAllData() {
    if (confirm('⚠️ This will permanently delete ALL data! Are you sure?')) {
        if (confirm('Are you REALLY sure? This cannot be undone!')) {
            allData = [];
            localStorage.setItem('binderData', JSON.stringify(allData));
            loadAdminDashboard();
            alert('All data cleared');
        }
    }
}

function clearAllEntries() {
    if (confirm('⚠️ This will permanently delete ALL agent entries! Are you sure?')) {
        if (confirm('Are you REALLY sure? This cannot be undone!')) {
            // Clear the allData (policy entries for all agents)
            allData = {};
            localStorage.setItem('allData', JSON.stringify(allData));
            loadAdminDashboard();
            alert('All agent entries cleared');
        }
    }
}

// Commission Data Management
let commissionData = {};

function initializeCommissionData() {
    // Only seed if nothing is stored yet — never overwrite real data
    if (!localStorage.getItem('commissionData')) {
        _origSetItem('commissionData', JSON.stringify({}));
    }
    commissionData = JSON.parse(localStorage.getItem('commissionData')) || {};
}

function loadCommissionData() {
    const stored = localStorage.getItem('commissionData');
    if (stored) {
        return JSON.parse(stored);
    }
    return commissionData;
}

// Default 10 % catch-all rules applied to every carrier with no rules
const DEFAULT_COMMISSION_RULES = [
    { lineOfBusiness: ALL_LOBS, paymentType: 'Monthly Paid', newRate: 10, renewRate: 10 },
    { lineOfBusiness: ALL_LOBS, paymentType: 'Gross Paid',   newRate: 10, renewRate: 10 }
];

function initializeCarrierData() {
    const defaultCarriers = [
        "AIG", "Admiral", "AmWins", "American Tradition", "Ascendant", "Atunne", "Avatar",
        "Bristol West", "Brit Global", "Citizens", "Edison", "FedNat", "Florida Penninsula",
        "Foremost Star", "Gainsco", "Granada", "Grundy", "Guard", "Hagerty", "Heritage",
        "Hiscox", "Hudson", "Imperial Flood", "Infinity", "Johnson&Johnson", "Kemper Insurance",
        "Mercury", "Monarch", "Mount Vernon Fire", "NICO", "National General", "Next Insurance",
        "Ocean Harbor", "Peoples Trust", "ProPronto", "Progressive", "Responssive Auto",
        "Scottdale", "Southern Oak", "State National", "Swifft", "TYPTAP", "The Hearth",
        "Tokio Marine", "UPC", "USLI", "United Auto", "United Specialty", "Universal North",
        "Universal P&C", "Windhaven", "Wright Flood"
    ];

    const stored = localStorage.getItem('carrierMasterData');
    let carrierData = stored ? JSON.parse(stored) : {};

    let updated = false;

    // Seed any missing default carriers
    defaultCarriers.forEach(name => {
        if (!carrierData[name]) {
            carrierData[name] = {
                carrierName:   name,
                phoneNumbers:  ["", "", ""],
                emails:        { underwriting: "", general: "", miscellaneous: "" },
                commissionRules: JSON.parse(JSON.stringify(DEFAULT_COMMISSION_RULES))
            };
            updated = true;
        }
    });

    // Migration: fill 10 % default rules into any carrier that still has none
    Object.keys(carrierData).forEach(name => {
        if (!carrierData[name].commissionRules || carrierData[name].commissionRules.length === 0) {
            carrierData[name].commissionRules = JSON.parse(JSON.stringify(DEFAULT_COMMISSION_RULES));
            updated = true;
        }
    });

    carrierMasterData = carrierData;
    if (!stored || updated) {
        _origSetItem('carrierMasterData', JSON.stringify(carrierData));
        driveSet('carrierMasterData', carrierData);
    }
}

// ── Carrier Dropdown Sync ────────────────────────────────────────────────────
// Rebuilds every carrier <select> across the whole app from carrierMasterData.
// Call this after any carrier add / edit / delete.
function refreshAllCarrierDropdowns() {
    const carriers = Object.keys(carrierMasterData || {}).sort();
    const targets = [
        { id: 'company',         placeholder: 'Select Company' },
        { id: 'editCompany',     placeholder: 'Select Company' },
        { id: 'uicManualCarrier', placeholder: '— Select Carrier —' },
    ];
    targets.forEach(({ id, placeholder }) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = `<option value="">${placeholder}</option>` +
            carriers.map(c => `<option value="${c}"${c === prev ? ' selected' : ''}>${c}</option>`).join('');
    });
}

// Quick-add carrier from the Manual Entry form "+" button
function uicQuickAddCarrier() {
    const name = prompt('Enter new carrier name:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const carriers = JSON.parse(localStorage.getItem('carrierMasterData')) || {};
    if (carriers[trimmed]) {
        alert(`"${trimmed}" already exists in the carrier list.`);
        return;
    }
    carriers[trimmed] = {
        carrierName:     trimmed,
        phoneNumbers:    ['', '', ''],
        emails:          { underwriting: '', general: '', miscellaneous: '' },
        commissionRules: JSON.parse(JSON.stringify(DEFAULT_COMMISSION_RULES))
    };
    localStorage.setItem('carrierMasterData', JSON.stringify(carriers));
    carrierMasterData = carriers;
    refreshAllCarrierDropdowns();
    // Auto-select the new carrier in the manual entry form
    const sel = document.getElementById('uicManualCarrier');
    if (sel) { sel.value = trimmed; uicAutoCalcManualCommission(); }
}

// Password Management
function showPasswordManagement() {
    document.getElementById('passwordManagementModal').classList.add('active');
    loadPasswordManagementTable();
}

function closePasswordManagementModal() {
    document.getElementById('passwordManagementModal').classList.remove('active');
}

function loadPasswordManagementTable() {
    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    const tbody = document.getElementById('passwordTable');

    tbody.innerHTML = getAllAgents().map(agent => {
        // Support both old flat-string format and new {email, password} format
        const cred = credentials[agent];
        const pw   = typeof cred === 'object' ? (cred?.password || '') : (cred || '');
        return `
        <tr>
            <td>${agent}</td>
            <td>
                <input type="password" value="${pw}" id="pwd_${agent}" class="password-input">
            </td>
            <td>
                <button class="btn-success btn-sm" onclick="updateAgentPassword('${agent}')">Update</button>
            </td>
        </tr>`;
    }).join('');
}

function updateAgentPassword(agent) {
    const newPassword = document.getElementById(`pwd_${agent}`)?.value?.trim();
    if (!newPassword) {
        alert('Password cannot be empty');
        return;
    }

    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    const existing    = credentials[agent];

    // Preserve email from stored record — never blank it out
    let email = '';
    if (typeof existing === 'object' && existing !== null) {
        email = existing.email || '';
    }

    // Also check the credential list page inputs in case the admin has typed
    // a new email there but hasn't saved yet
    const key = agent.replace(/\s+/g, '_');
    const pageEmailInput = document.getElementById(`page_cred_email_${key}`);
    if (pageEmailInput && pageEmailInput.value.trim()) {
        email = pageEmailInput.value.trim();
    }

    credentials[agent] = { email, password: newPassword };
    localStorage.setItem('agentCredentials', JSON.stringify(credentials));
    alert(`Password updated for ${agent}`);
    loadPasswordManagementTable();
}

// Carrier Management Functions
function showCarrierManagement() {
    const m = document.getElementById('carrierManagementModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    loadCarrierList();
}

function closeCarrierManagement() {
    document.getElementById('carrierManagementModal').classList.remove('active');
}

function loadCarrierList() {
    const tbody = document.getElementById('carrierListTable');
    const carriers = JSON.parse(localStorage.getItem('carrierMasterData')) || {};
    const carrierNames = Object.keys(carriers).sort();

    if (carrierNames.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">No carriers added yet</td></tr>';
        return;
    }

    tbody.innerHTML = carrierNames.map(name => {
        const carrier = carriers[name];
        const rulesCount = carrier.commissionRules ? carrier.commissionRules.length : 0;
        return `<tr>
            <td><strong>${name}</strong></td>
            <td>${carrier.phoneNumbers && carrier.phoneNumbers[0] ? carrier.phoneNumbers[0] : '-'}</td>
            <td>${carrier.emails && carrier.emails.general ? carrier.emails.general : '-'}</td>
            <td>${rulesCount} rule(s)</td>
            <td>
                <button class="btn-secondary" onclick="editCarrier('${name}')" style="padding: 5px 10px; font-size: 12px; margin-right: 5px;"><i data-lucide="pencil"></i> Edit</button>
                <button class="btn-danger" onclick="deleteCarrier('${name}')" style="padding: 5px 10px; font-size: 12px;"><i data-lucide="trash-2"></i> Delete</button>
            </td>
        </tr>`;
    }).join('');
    refreshIcons();
}

function openAddCarrierModal(targetSelectId) {
    // Remember which dropdown should auto-select the new carrier after save
    _carrierFormAutoSelect = targetSelectId || null;
    document.getElementById('carrierFormTitle').textContent = 'Add New Carrier';
    document.getElementById('carrierForm').reset();
    document.getElementById('commissionRulesTable').innerHTML = '<tr><td colspan="5" class="no-data" style="text-align: center;">No commission rules yet. Click "Add Rule" to add one.</td></tr>';
    const m = document.getElementById('addEditCarrierModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    document.getElementById('carrierName').focus();
}

function closeAddEditCarrierModal() {
    document.getElementById('addEditCarrierModal').classList.remove('active');
}

function editCarrier(carrierName) {
    _carrierFormAutoSelect = null; // editing existing — no auto-select needed
    const carriers = JSON.parse(localStorage.getItem('carrierMasterData')) || {};
    const carrier = carriers[carrierName];

    if (!carrier) {
        alert('Carrier not found');
        return;
    }

    document.getElementById('carrierFormTitle').textContent = `Edit Carrier - ${carrierName}`;
    document.getElementById('carrierName').value = carrierName;
    document.getElementById('carrierPhone1').value = carrier.phoneNumbers && carrier.phoneNumbers[0] ? carrier.phoneNumbers[0] : '';
    document.getElementById('carrierPhone2').value = carrier.phoneNumbers && carrier.phoneNumbers[1] ? carrier.phoneNumbers[1] : '';
    document.getElementById('carrierPhone3').value = carrier.phoneNumbers && carrier.phoneNumbers[2] ? carrier.phoneNumbers[2] : '';
    document.getElementById('carrierEmailUnderwriting').value = carrier.emails && carrier.emails.underwriting ? carrier.emails.underwriting : '';
    document.getElementById('carrierEmailGeneral').value = carrier.emails && carrier.emails.general ? carrier.emails.general : '';
    document.getElementById('carrierEmailMiscellaneous').value = carrier.emails && carrier.emails.miscellaneous ? carrier.emails.miscellaneous : '';

    // Load commission rules
    const rulesTable = document.getElementById('commissionRulesTable');
    if (carrier.commissionRules && carrier.commissionRules.length > 0) {
        rulesTable.innerHTML = '';
        carrier.commissionRules.forEach((rule) => {
            const lobs = Array.isArray(rule.lineOfBusiness) ? rule.lineOfBusiness : (rule.lineOfBusiness ? [rule.lineOfBusiness] : []);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="padding:6px 8px; vertical-align:middle;">${createLobMultiSelectHTML(lobs)}</td>
                <td style="padding:6px 8px; vertical-align:middle;">
                    <select style="width:100%; padding:5px 8px; font-size:13px; box-sizing:border-box;">
                        <option value="Monthly Paid" ${rule.paymentType === 'Monthly Paid' ? 'selected' : ''}>Monthly Paid</option>
                        <option value="Gross Paid" ${rule.paymentType === 'Gross Paid' ? 'selected' : ''}>Gross Paid</option>
                    </select>
                </td>
                <td style="padding:6px 8px; vertical-align:middle; text-align:center;"><input type="number" step="0.1" value="${rule.newRate ?? rule.commissionRate ?? ''}" placeholder="0.0" style="width:100%; padding:5px; font-size:13px; text-align:center; box-sizing:border-box;" /></td>
                <td style="padding:6px 8px; vertical-align:middle; text-align:center;"><input type="number" step="0.1" value="${rule.renewRate ?? ''}" placeholder="0.0" style="width:100%; padding:5px; font-size:13px; text-align:center; box-sizing:border-box;" /></td>
                <td style="padding:6px 8px; vertical-align:middle; text-align:center;"><button type="button" class="btn-danger" onclick="removeCommissionRuleRow(this)" style="padding:4px 8px; font-size:12px;">❌</button></td>
            `;
            rulesTable.appendChild(row);
        });
    } else {
        rulesTable.innerHTML = '<tr><td colspan="5" class="no-data" style="text-align: center;">No commission rules yet. Click "Add Rule" to add one.</td></tr>';
    }

    document.getElementById('addEditCarrierModal').classList.add('active');
}

function deleteCarrier(carrierName) {
    if (confirm(`Are you sure you want to delete "${carrierName}" and all its commission rules?`)) {
        const carriers = JSON.parse(localStorage.getItem('carrierMasterData')) || {};
        delete carriers[carrierName];
        carrierMasterData = carriers;
        localStorage.setItem('carrierMasterData', JSON.stringify(carriers));
        loadCarrierList();
        refreshAllCarrierDropdowns();
        alert(`Carrier "${carrierName}" deleted successfully`);
    }
}

// Commission Rules Management
function addCommissionRuleRow() {
    const rulesTable = document.getElementById('commissionRulesTable');
    const isEmpty = rulesTable.querySelector('td[colspan]');
    if (isEmpty) rulesTable.innerHTML = '';

    const newRow = document.createElement('tr');
    newRow.innerHTML = `
        <td style="padding:6px 8px; vertical-align:middle;">${createLobMultiSelectHTML([])}</td>
        <td style="padding:6px 8px; vertical-align:middle;">
            <select style="width:100%; padding:5px 8px; font-size:13px; box-sizing:border-box;">
                <option value="">Select Type</option>
                <option value="Monthly Paid">Monthly Paid</option>
                <option value="Gross Paid">Gross Paid</option>
            </select>
        </td>
        <td style="padding:6px 8px; vertical-align:middle; text-align:center;"><input type="number" step="0.1" placeholder="0.0" style="width:100%; padding:5px; font-size:13px; text-align:center; box-sizing:border-box;" /></td>
        <td style="padding:6px 8px; vertical-align:middle; text-align:center;"><input type="number" step="0.1" placeholder="0.0" style="width:100%; padding:5px; font-size:13px; text-align:center; box-sizing:border-box;" /></td>
        <td style="padding:6px 8px; vertical-align:middle; text-align:center;"><button type="button" class="btn-danger" onclick="removeCommissionRuleRow(this)" style="padding:4px 8px; font-size:12px;">❌</button></td>
    `;

    rulesTable.appendChild(newRow);
}

function removeCommissionRuleRow(button) {
    const rulesTable = document.getElementById('commissionRulesTable');
    button.parentElement.parentElement.remove();

    if (rulesTable.children.length === 0) {
        rulesTable.innerHTML = '<tr><td colspan="5" class="no-data" style="text-align: center;">No commission rules yet. Click "Add Rule" to add one.</td></tr>';
    }
}

// Form Submission for Carrier
document.getElementById('carrierForm')?.addEventListener('submit', (e) => {
    e.preventDefault();

    const carrierName = document.getElementById('carrierName').value.trim();
    if (!carrierName) {
        alert('Carrier name is required');
        return;
    }

    // Collect commission rules from table rows
    const rulesTable = document.getElementById('commissionRulesTable');
    const rules = [];

    rulesTable.querySelectorAll('tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) return; // skip empty-state row
        const lobs        = getLobSelections(row);
        const paymentType = cells[1].querySelector('select')?.value;
        const newRate     = parseFloat(cells[2].querySelector('input')?.value);
        const renewRate   = parseFloat(cells[3].querySelector('input')?.value);

        if (lobs.length > 0 && paymentType && (!isNaN(newRate) || !isNaN(renewRate))) {
            rules.push({
                lineOfBusiness: lobs,
                paymentType:    paymentType,
                newRate:        isNaN(newRate)   ? null : newRate,
                renewRate:      isNaN(renewRate) ? null : renewRate
            });
        }
    });

    // Create carrier object
    const carrier = {
        carrierName: carrierName,
        phoneNumbers: [
            document.getElementById('carrierPhone1').value || '',
            document.getElementById('carrierPhone2').value || '',
            document.getElementById('carrierPhone3').value || ''
        ],
        emails: {
            underwriting: document.getElementById('carrierEmailUnderwriting').value || '',
            general: document.getElementById('carrierEmailGeneral').value || '',
            miscellaneous: document.getElementById('carrierEmailMiscellaneous').value || ''
        },
        commissionRules: rules
    };

    // Save to localStorage
    const carriers = JSON.parse(localStorage.getItem('carrierMasterData')) || {};
    carriers[carrierName] = carrier;
    localStorage.setItem('carrierMasterData', JSON.stringify(carriers));

    // Update global variable
    carrierMasterData = carriers;

    closeAddEditCarrierModal();
    loadCarrierList();
    refreshAllCarrierDropdowns();

    // Auto-select the new/edited carrier in the dropdown that triggered this modal
    if (_carrierFormAutoSelect) {
        const sel = document.getElementById(_carrierFormAutoSelect);
        if (sel) sel.value = carrierName;
        _carrierFormAutoSelect = null;
    }

    alert(`Carrier "${carrierName}" saved successfully!`);

    // Trigger recalculation of commissions for existing policies
    recalculateAllCommissions();
});

// ===========================
// AGENT MANAGEMENT FUNCTIONS
// ===========================

// Initialize agent data in localStorage
function initializeAgentData() {
    if (!localStorage.getItem('agentMasterData')) {
        localStorage.setItem('agentMasterData', JSON.stringify({}));
    }
}

// Show Agent Management Modal
function showAgentManagement() {
    const m = document.getElementById('agentManagementModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    loadAgentList();
}

// Close Agent Management Modal
function closeAgentManagement() {
    document.getElementById('agentManagementModal').classList.remove('active');
}

// Load and display agent list
function loadAgentList() {
    const agents = JSON.parse(localStorage.getItem('agentMasterData')) || {};
    const tbody = document.getElementById('agentListTable');

    if (Object.keys(agents).length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">No agents added yet</td></tr>';
        return;
    }

    let tableHTML = '';
    Object.entries(agents).forEach(([agentName, agentData]) => {
        const licenses = agentData.licenses ? agentData.licenses.join(', ') : '-';
        tableHTML += `<tr>
            <td>${agentData.name || agentName}</td>
            <td>${agentData.email || '-'}</td>
            <td>${agentData.phone || '-'}</td>
            <td>${licenses}</td>
            <td>
                <button class="btn-primary btn-sm" onclick="editAgent('${agentName}')"><i data-lucide="pencil"></i> Edit</button>
                <button class="btn-danger btn-sm" onclick="deleteAgent('${agentName}')"><i data-lucide="trash-2"></i> Delete</button>
            </td>
        </tr>`;
    });

    tbody.innerHTML = tableHTML;
    refreshIcons();
}

// Open Add Agent Modal
function openAddAgentModal() {
    document.getElementById('agentFormTitle').textContent = 'Add New Agent';
    document.getElementById('manageAgentForm').reset();
    document.getElementById('manageAgentForm').dataset.editingAgent = '';
    document.querySelectorAll('.licenseCheckbox').forEach(cb => cb.checked = false);
    document.getElementById('docStatusMessage').innerHTML = '';
    document.getElementById('addEditAgentModal').classList.add('active');
}

// Close Add/Edit Agent Modal
function closeAddEditAgentModal() {
    document.getElementById('addEditAgentModal').classList.remove('active');
}

// Edit Agent - Load existing data into form
function editAgent(agentName) {
    const agents = JSON.parse(localStorage.getItem('agentMasterData')) || {};
    const agent = agents[agentName];

    if (!agent) {
        alert('Agent not found');
        return;
    }

    document.getElementById('agentFormTitle').textContent = `Edit Agent: ${agent.name}`;
    document.getElementById('agentName').value = agent.name || '';
    document.getElementById('agentAddress').value = agent.address || '';
    document.getElementById('agentDOB').value = agent.dob || '';
    document.getElementById('agentEmail').value = agent.email || '';
    document.getElementById('agentPhone').value = agent.phone || '';

    // Set selected licenses
    document.querySelectorAll('.licenseCheckbox').forEach(cb => {
        cb.checked = agent.licenses && agent.licenses.includes(cb.value);
    });

    // Show current documentation status
    if (agent.documentationPath) {
        document.getElementById('docStatusMessage').innerHTML =
            `<span style="color: green;">✓ Documentation uploaded: ${agent.documentationFileName}</span>`;
    } else {
        document.getElementById('docStatusMessage').innerHTML = '';
    }

    document.getElementById('manageAgentForm').dataset.editingAgent = agentName;
    document.getElementById('addEditAgentModal').classList.add('active');
}

// Delete Agent
function deleteAgent(agentName) {
    if (!confirm(`Are you sure you want to delete agent "${agentName}"?`)) {
        return;
    }

    const agents = JSON.parse(localStorage.getItem('agentMasterData')) || {};
    delete agents[agentName];
    localStorage.setItem('agentMasterData', JSON.stringify(agents));
    loadAgentList();
    alert(`Agent "${agentName}" deleted successfully!`);
}

// Handle agent form submission
document.getElementById('manageAgentForm')?.addEventListener('submit', (e) => {
    e.preventDefault();

    const agentName = document.getElementById('agentName').value.trim();
    const address = document.getElementById('agentAddress').value.trim();
    const dob = document.getElementById('agentDOB').value;
    const email = document.getElementById('agentEmail').value.trim();
    const phone = document.getElementById('agentPhone').value.trim();
    const docFile = document.getElementById('agentDocumentation').files[0];

    // Get selected licenses
    const selectedLicenses = Array.from(document.querySelectorAll('.licenseCheckbox:checked')).map(cb => cb.value);

    if (!agentName || !address || !dob || !email || !phone || selectedLicenses.length === 0) {
        alert('Please fill in all required fields and select at least one license type');
        return;
    }

    // Get existing agents data
    const agents = JSON.parse(localStorage.getItem('agentMasterData')) || {};
    const isEditing = e.target.dataset.editingAgent;

    // Handle documentation upload
    let documentationPath = '';
    let documentationFileName = '';

    if (docFile) {
        // For now, store file metadata (in production, you'd upload to server)
        documentationFileName = docFile.name;
        documentationPath = `docs/${agentName}/${docFile.name}`;
        console.log(`File would be uploaded: ${documentationPath}`);
    } else if (isEditing && agents[isEditing] && agents[isEditing].documentationPath) {
        // Keep existing documentation if not replacing
        documentationPath = agents[isEditing].documentationPath;
        documentationFileName = agents[isEditing].documentationFileName;
    }

    // Create/update agent object
    const agentData = {
        name: agentName,
        address: address,
        dob: dob,
        email: email,
        phone: phone,
        licenses: selectedLicenses,
        documentationPath: documentationPath,
        documentationFileName: documentationFileName,
        createdAt: isEditing ? (agents[isEditing]?.createdAt || getEasternTimestamp()) : getEasternTimestamp(),
        updatedAt: getEasternTimestamp()
    };

    // If editing, remove old entry and use new name
    if (isEditing && isEditing !== agentName) {
        delete agents[isEditing];
    }

    // Save agent
    agents[agentName] = agentData;
    localStorage.setItem('agentMasterData', JSON.stringify(agents));

    alert(`Agent "${agentName}" saved successfully!`);
    closeAddEditAgentModal();
    loadAgentList();
});

// Commission Calculation Functions
function getCommissionRate(carrierName, lob, paymentType, policyType) {
    const carriers = JSON.parse(localStorage.getItem('carrierMasterData')) || {};
    const carrier = carriers[carrierName];

    if (!carrier || !carrier.commissionRules) {
        return 0;
    }

    const rule = carrier.commissionRules.find(r => {
        const rLobs = Array.isArray(r.lineOfBusiness) ? r.lineOfBusiness : [r.lineOfBusiness];
        return rLobs.includes(lob) && r.paymentType === paymentType;
    });

    if (!rule) return 0;

    // Determine if this is a renewal based on policyType
    const isRenewal = policyType === 'Renewal' || policyType === 'Renew A-B';

    if (isRenewal) {
        // Use renewRate if set, fallback to newRate, then legacy commissionRate
        return rule.renewRate ?? rule.newRate ?? rule.commissionRate ?? 0;
    } else {
        // New / Rewrite — use newRate, fallback to legacy commissionRate
        return rule.newRate ?? rule.commissionRate ?? 0;
    }
}

function calculateCommission(premium, rate, agencyFee = 0) {
    // Commission = (Base Premium × Carrier Rate% + Agency Fee) × 0.5
    return parseFloat(((premium * (rate / 100) + agencyFee) * 0.5).toFixed(2));
}

function getMonthYear() {
    return getEasternMonthYear();
}

// ── Agent Payment Type Patch ──────────────────────────────────────────────────
function setAgentPaymentType(agentName, paymentType) {
    const total   = allData.length;
    const matches = allData.filter(e => e.agent === agentName).length;
    if (matches === 0) { alert(`No entries found for agent: ${agentName}`); return; }

    if (!confirm(
        `Set ALL ${matches.toLocaleString()} entries for "${agentName}" to ${paymentType}?\n\n` +
        `Commissions will be recalculated after the update.\n\nClick OK to proceed.`
    )) return;

    allData = allData.map(e => {
        if (e.agent !== agentName) return e;
        const premium  = parseFloat(e.basePremium || e.totalPremium) || 0;
        const agencyFee= parseFloat(e.agencyFee) || 0;
        const rate     = getCommissionRate(e.company, e.lineOfBusiness, paymentType, e.policyType || 'New');
        const agencyComm  = rate > 0 ? parseFloat((premium * (rate / 100)).toFixed(2)) : (e.agencyCommission || 0);
        const agentShare  = parseFloat(((agencyFee + agencyComm) * 0.5).toFixed(2));
        return { ...e, paymentType, agencyCommission: agencyComm, agentCommissionShare: agentShare };
    });

    localStorage.setItem('binderData', JSON.stringify(allData));
    driveSet('binderData', allData);
    recalculateAllCommissions();

    if (typeof loadAdminData === 'function') loadAdminData();
    if (typeof apdInit       === 'function') apdInit();

    alert(`✅ Done! ${matches.toLocaleString()} entries for "${agentName}" updated to ${paymentType}.`);
}

// ── Retroactive Commission Recalculation ─────────────────────────────────────
async function recalculateAllBinderCommissions() {
    const total = allData.length;
    if (!confirm(
        `Recalculate commissions for ALL ${total.toLocaleString()} entries?\n\n` +
        `• Agency Commission = Carrier Rule % × Base Premium\n` +
        `• Agent Commission  = (Agency Fee + Agency Commission) × 50%\n` +
        `• Entries with no matching carrier rule will be skipped\n\n` +
        `Click OK to proceed.`
    )) return;

    let updated = 0, skipped = 0;

    const newData = allData.map(e => {
        const premium     = parseFloat(e.basePremium || e.totalPremium) || 0;
        const carrier     = e.company      || '';
        const lob         = e.lineOfBusiness || '';
        const paymentType = e.paymentType  || 'Monthly Paid';
        const policyType  = e.policyType   || 'New';
        const agencyFee   = parseFloat(e.agencyFee) || 0;

        if (premium <= 0 || !carrier || !lob || !paymentType) { skipped++; return e; }

        const rate = getCommissionRate(carrier, lob, paymentType, policyType);
        if (rate <= 0) { skipped++; return e; }

        const agencyComm  = parseFloat((premium * (rate / 100)).toFixed(2));
        const agentShare  = parseFloat(((agencyFee + agencyComm) * 0.5).toFixed(2));
        updated++;
        return { ...e, agencyCommission: agencyComm, agentCommissionShare: agentShare };
    });

    allData = newData;
    localStorage.setItem('binderData', JSON.stringify(newData));
    driveSet('binderData', newData);

    // Also rebuild commissionData dashboard store
    recalculateAllCommissions();

    // Refresh views
    if (typeof loadAdminData      === 'function') loadAdminData();
    if (typeof loadAgentData      === 'function') loadAgentData();
    if (typeof apdInit            === 'function') apdInit();

    alert(
        `✅ Recalculation complete!\n\n` +
        `• ${updated.toLocaleString()} entries updated\n` +
        `• ${skipped.toLocaleString()} entries skipped (no matching carrier rule)\n` +
        `• Total entries: ${total.toLocaleString()}`
    );
}

function recalculateAllCommissions() {
    const allPolicies = JSON.parse(localStorage.getItem('binderData')) || [];

    // Rebuild from scratch — start with an empty slate
    let newCommissionData = {};

    allPolicies.forEach(policy => {
        const agent       = policy.agent;
        const carrier     = policy.company;
        const lob         = policy.lineOfBusiness;
        // Use basePremium (same field as savePolicyEntry) — fall back to totalPremium for legacy records
        const premium     = parseFloat(policy.basePremium || policy.totalPremium) || 0;
        const paymentType = policy.paymentType || 'Monthly Paid';
        const policyType  = policy.policyType  || 'New';
        const month       = policy.entryDate
            ? new Date(policy.entryDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
            : getMonthYear();

        if (!agent || !carrier || !lob || premium <= 0) return;

        const agencyFee   = parseFloat(policy.agencyFee) || 0;
        const rate = getCommissionRate(carrier, lob, paymentType, policyType);
        if (rate <= 0) return;

        const commission  = calculateCommission(premium, rate, agencyFee);
        const carrierType = paymentType === 'Monthly Paid' ? 'monthlyPaidCommissionCarriers' : 'grossPaidCarriers';

        // Build nested structure
        if (!newCommissionData[agent])                          newCommissionData[agent] = { monthlyPaidCommissionCarriers: {}, grossPaidCarriers: {} };
        if (!newCommissionData[agent][carrierType])             newCommissionData[agent][carrierType] = {};
        if (!newCommissionData[agent][carrierType][carrier])    newCommissionData[agent][carrierType][carrier] = {};

        // Accumulate — multiple policies same carrier/month add together
        const existing = newCommissionData[agent][carrierType][carrier][month];
        if (existing) {
            existing.amount  = parseFloat((existing.amount + commission).toFixed(2));
            existing.premium = parseFloat((existing.premium + premium).toFixed(2));
            if (existing.lob && existing.lob !== lob && !existing.lob.includes(lob)) {
                existing.lob = existing.lob + ', ' + lob;
            }
        } else {
            newCommissionData[agent][carrierType][carrier][month] = { amount: commission, lob, rate, premium };
        }
    });

    // Persist and refresh any open dashboard
    commissionData = newCommissionData;
    localStorage.setItem('commissionData', JSON.stringify(newCommissionData));

    // Refresh dashboard if it's open
    const dashModal = document.getElementById('commissionDashboardModal');
    if (dashModal && dashModal.classList.contains('active')) {
        displayAllCommissions(newCommissionData);
    }
}

// Commission Dashboard Functions
function showCommissionDashboard() {
    const m = document.getElementById('commissionDashboardModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    loadCommissionDashboard();
}

function closeCommissionDashboard() {
    document.getElementById('commissionDashboardModal').classList.remove('active');
}

function clearAllCommissions() {
    if (confirm('⚠️ This will permanently delete ALL commission entries for all agents. Are you sure?')) {
        if (confirm('Are you REALLY sure? This cannot be undone!')) {
            commissionData = {};
            localStorage.setItem('commissionData', JSON.stringify({}));
            allData = allData.map(e => ({ ...e, agentCommissionShare: 0 }));
            localStorage.setItem('binderData', JSON.stringify(allData));
            // Also wipe Google Drive so old data doesn't sync back
            driveSet('commissionData', {});
            driveSet('binderData', allData);
            loadCommissionDashboard();
            alert('✅ All commission entries have been cleared.');
        }
    }
}

function loadCommissionDashboard() {
    const commissions = loadCommissionData();

    // Populate agent filter from master list + commission data
    const filterSelect = document.getElementById('commissionAgentFilter');
    const agentMasterData = JSON.parse(localStorage.getItem('agentMasterData')) || {};
    const masterAgents = Object.keys(agentMasterData);
    const commissionAgents = Object.keys(commissions);
    const allAgentNames = [...new Set([...masterAgents, ...commissionAgents])].sort();

    filterSelect.innerHTML = '<option value="">All Agents</option>';
    allAgentNames.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent;
        option.textContent = agent;
        filterSelect.appendChild(option);
    });

    displayAllCommissions(commissions);
    refreshIcons();
}

function displayAllCommissions(commissions) {
    const filterAgent = document.getElementById('commissionAgentFilter')?.value || '';

    let allCommissions = [];
    let agentTotals = {};

    // Collect all commissions from both carrier types
    for (const agent in commissions) {
        if (filterAgent && agent !== filterAgent) continue;

        if (!agentTotals[agent]) agentTotals[agent] = 0;

        const agentData = commissions[agent];
        const monthlyPaidCarriers = agentData.monthlyPaidCommissionCarriers || {};
        const grossPaidCarriers = agentData.grossPaidCarriers || {};

        // Process monthly paid commission carriers
        Object.entries(monthlyPaidCarriers).forEach(([carrier, months]) => {
            Object.entries(months).forEach(([month, entry]) => {
                const amount = typeof entry === 'object' ? entry.amount : entry;
                const lob = typeof entry === 'object' ? entry.lob : '-';
                const rate = typeof entry === 'object' ? entry.rate : 0;
                const premium = typeof entry === 'object' ? entry.premium : 0;
                allCommissions.push({
                    agent,
                    carrier,
                    lob,
                    month,
                    amount,
                    rate,
                    premium,
                    type: '📅 Monthly Paid',
                    agentTotal: 0
                });
                agentTotals[agent] += amount;
            });
        });

        // Process gross paid carriers
        Object.entries(grossPaidCarriers).forEach(([carrier, months]) => {
            Object.entries(months).forEach(([month, entry]) => {
                const amount = typeof entry === 'object' ? entry.amount : entry;
                const lob = typeof entry === 'object' ? entry.lob : '-';
                const rate = typeof entry === 'object' ? entry.rate : 0;
                const premium = typeof entry === 'object' ? entry.premium : 0;
                allCommissions.push({
                    agent,
                    carrier,
                    lob,
                    month,
                    amount,
                    rate,
                    premium,
                    type: '💰 Gross Paid',
                    agentTotal: 0
                });
                agentTotals[agent] += amount;
            });
        });
    }

    // Also collect agent commission share rows
    const filterAgentForShares = filterAgent;
    AGENTS.forEach(agent => {
        if (filterAgentForShares && agent !== filterAgentForShares) return;
        const shares = getAgentCommissionShares(agent);
        Object.entries(shares).forEach(([month, data]) => {
            if (!agentTotals[agent]) agentTotals[agent] = 0;
            allCommissions.push({
                agent,
                carrier: 'Agent Commission',
                lob: `${data.count} polic${data.count === 1 ? 'y' : 'ies'}`,
                month,
                amount: data.total,
                rate: 50,
                premium: data.combinedTotal,
                type: '🤝 Agent Share',
                agentTotal: 0,
                isAgentShare: true
            });
            agentTotals[agent] = (agentTotals[agent] || 0) + data.total;
        });
    });

    allCommissions = allCommissions.map(c => ({ ...c, agentTotal: agentTotals[c.agent] }));

    const totalCommissions = allCommissions.reduce((sum, c) => sum + c.amount, 0);
    const avgCommission = allCommissions.length > 0 ? totalCommissions / allCommissions.length : 0;
    const activeAgents = Object.keys(agentTotals).length;

    document.getElementById('totalCommissions').textContent = `$${totalCommissions.toFixed(2)}`;
    document.getElementById('avgCommission').textContent = `$${avgCommission.toFixed(2)}`;
    document.getElementById('activeCommissionAgents').textContent = activeAgents;

    const tbody = document.getElementById('commissionTable');
    if (allCommissions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-data">No commission data available</td></tr>';
        return;
    }

    tbody.innerHTML = allCommissions.map(c => {
        const commissionDisplay = c.premium > 0 && c.rate > 0
            ? `($${c.premium.toFixed(2)}×${c.rate}%)×50%=$${c.amount.toFixed(2)}`
            : `$${c.amount.toFixed(2)}`;
        const deleteBtn = c.isAgentShare
            ? `<button class="btn-danger btn-sm" onclick="deleteAgentShareByMonth('${c.agent}','${c.month}')"><i data-lucide="trash-2"></i> Delete</button>`
            : `<button class="btn-danger btn-sm" onclick="deleteCommissionEntry('${c.agent}','${c.type.includes('Monthly') ? 'monthlyPaidCommissionCarriers' : 'grossPaidCarriers'}','${c.carrier}','${c.month}')"><i data-lucide="trash-2"></i> Delete</button>`;
        return `<tr>
            <td><strong>${c.agent}</strong></td>
            <td>${c.type}</td>
            <td>${c.carrier}</td>
            <td>${c.lob}</td>
            <td>${c.month}</td>
            <td style="font-family: monospace; font-size: 0.95em;">${commissionDisplay}</td>
            <td>$${c.agentTotal.toFixed(2)}</td>
            <td>${deleteBtn}</td>
        </tr>`;
    }).join('');
    refreshIcons();
}

function deleteCommissionEntry(agent, carrierType, carrier, month) {
    if (!confirm(`Delete commission entry for ${agent} — ${carrier} (${month})?`)) return;
    const commData = JSON.parse(localStorage.getItem('commissionData')) || {};
    if (commData[agent]?.[carrierType]?.[carrier]?.[month]) {
        delete commData[agent][carrierType][carrier][month];
        if (Object.keys(commData[agent][carrierType][carrier]).length === 0)
            delete commData[agent][carrierType][carrier];
    }
    commissionData = commData;
    localStorage.setItem('commissionData', JSON.stringify(commData));
    displayAllCommissions(commData);
}

function deleteAgentShareByMonth(agent, month) {
    if (!confirm(`Delete agent commission share for ${agent} — ${month}?`)) return;
    allData = allData.map(e => {
        const entryMonth = new Date(e.entryDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        if (e.agent === agent && entryMonth === month) return { ...e, agentCommissionShare: 0 };
        return e;
    });
    localStorage.setItem('binderData', JSON.stringify(allData));
    displayAllCommissions(loadCommissionData());
}

function filterCommissions() {
    const commissions = loadCommissionData();
    displayAllCommissions(commissions);
}

function resetCommissionFilter() {
    document.getElementById('commissionAgentFilter').value = '';
    const commissions = loadCommissionData();
    displayAllCommissions(commissions);
}

// ── Universal Ins Commissions (public page) ────────────────────
let uicActiveYear = '';   // '' = All Years

function showUniversalInsCommissions() {
    showSection('universalInsCommissionsSection');
    uicActiveYear = '';
    _uicUpdateYearButtons();
    loadUniversalInsCommissions();
    if (window.UIBMotion) {
        UIBMotion.animateUserInfoBar(document.getElementById('universalInsCommissionsSection'));
        UIBMotion.animateStatCards();
    }
    refreshIcons();
}

function setUICYear(year) {
    // Toggle off if same year clicked again
    uicActiveYear = (uicActiveYear === year) ? '' : year;
    _uicUpdateYearButtons();
    // Reset month dropdown so months from other years don't linger
    const m = document.getElementById('uicMonthFilter');
    if (m) { m.innerHTML = '<option value="">All Months</option>'; }
    loadUniversalInsCommissions();
}

function _uicUpdateYearButtons() {
    ['2023','2024','2025','2026'].forEach(y => {
        const btn = document.getElementById('uicYear' + y);
        if (!btn) return;
        const active = uicActiveYear === y;
        btn.style.background    = active ? 'var(--primary)' : '';
        btn.style.color         = active ? '#fff' : '';
        btn.style.borderColor   = active ? 'var(--primary)' : '';
        btn.style.boxShadow     = active ? '0 0 0 2px rgba(59,130,246,0.25)' : '';
    });
}

function loadUniversalInsCommissions() {
    const commissions = loadCommissionData();
    const filterAgent = document.getElementById('uicAgentFilter')?.value || '';
    const filterMonth = document.getElementById('uicMonthFilter')?.value || '';
    const filterYear  = uicActiveYear;

    // Collect all rows
    let rows = [];
    let allAgents   = new Set();
    let allMonths   = new Set();
    let allCarriers = new Set();
    let totalAll = 0, totalMonthly = 0, totalGross = 0;

    for (const agent in commissions) {
        allAgents.add(agent);
        const agentData = commissions[agent];

        const processBucket = (bucket, typeLabel) => {
            Object.entries(bucket || {}).forEach(([carrier, months]) => {
                allCarriers.add(carrier);
                Object.entries(months).forEach(([month, entry]) => {
                    allMonths.add(month);
                    const amount  = typeof entry === 'object' ? (entry.amount  || 0) : (entry || 0);
                    const lob     = typeof entry === 'object' ? (entry.lob     || '-') : '-';
                    const rate    = typeof entry === 'object' ? (entry.rate    || 0)  : 0;
                    const premium = typeof entry === 'object' ? (entry.premium || 0)  : 0;
                    rows.push({ agent, type: typeLabel, carrier, lob, month, amount, rate, premium });
                    totalAll += amount;
                    if (typeLabel === '📅 Monthly Paid') totalMonthly += amount;
                    else totalGross += amount;
                });
            });
        };

        processBucket(agentData.monthlyPaidCommissionCarriers, '📅 Monthly Paid');
        processBucket(agentData.grossPaidCarriers, '💰 Gross Paid');
    }

    // Populate agent dropdown (rebuild each time so it reflects current data)
    const agentSel = document.getElementById('uicAgentFilter');
    if (agentSel) {
        const prev = agentSel.value;
        agentSel.innerHTML = '<option value="">All Agents</option>';
        [...allAgents].sort().forEach(a => {
            const o = document.createElement('option'); o.value = a; o.textContent = a;
            if (a === prev) o.selected = true;
            agentSel.appendChild(o);
        });
    }

    // Populate month dropdown — scoped to selected year
    const monthSel = document.getElementById('uicMonthFilter');
    if (monthSel) {
        const prev = monthSel.value;
        monthSel.innerHTML = '<option value="">All Months</option>';
        const monthsForYear = filterYear
            ? [...allMonths].filter(m => m.endsWith(filterYear))
            : [...allMonths];
        monthsForYear.sort().forEach(m => {
            const o = document.createElement('option'); o.value = m; o.textContent = m;
            if (m === prev) o.selected = true;
            monthSel.appendChild(o);
        });
    }

    // Apply filters
    if (filterYear)  rows = rows.filter(r => r.month.endsWith(filterYear));
    if (filterAgent) rows = rows.filter(r => r.agent === filterAgent);
    if (filterMonth) rows = rows.filter(r => r.month === filterMonth);

    // Recalculate totals after filter
    totalAll = 0; totalMonthly = 0; totalGross = 0;
    rows.forEach(r => {
        totalAll += r.amount;
        if (r.type === '📅 Monthly Paid') totalMonthly += r.amount;
        else totalGross += r.amount;
    });

    // Update stat cards
    document.getElementById('uicTotalCommissions').textContent = '$' + totalAll.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('uicMonthlyPaid').textContent     = '$' + totalMonthly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('uicGrossPaid').textContent       = '$' + totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('uicAgentCount').textContent      = [...new Set(rows.map(r => r.agent))].length;
    document.getElementById('uicCarrierCount').textContent    = [...new Set(rows.map(r => r.carrier))].length;

    // Render table
    const tbody = document.getElementById('uicTableBody');
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:32px;">No commission data found.</td></tr>';
        document.getElementById('uicRowCount').textContent = '';
        return;
    }

    // Sort: agent → month → carrier
    rows.sort((a, b) => a.agent.localeCompare(b.agent) || a.month.localeCompare(b.month) || a.carrier.localeCompare(b.carrier));

    tbody.innerHTML = rows.map((r, i) => {
        const carrierTypeKey = r.type.includes('Monthly') ? 'monthlyPaidCommissionCarriers' : 'grossPaidCarriers';
        const breakdown = r.rate > 0
            ? `<span style="font-size:11px;color:var(--gray-400);display:block;">$${r.premium.toLocaleString('en-US',{minimumFractionDigits:2})} × ${r.rate}%</span>`
            : '';
        const bg = i % 2 === 0 ? '' : 'background:#f9fafb;';
        return `<tr data-agent="${encodeURIComponent(r.agent)}" data-carriertype="${carrierTypeKey}" data-carrier="${encodeURIComponent(r.carrier)}" data-month="${encodeURIComponent(r.month)}" style="${bg}border-bottom:1px solid var(--gray-100);">
            <td style="padding:10px 12px;font-weight:600;">${r.agent}</td>
            <td style="padding:10px 12px;font-size:13px;">${r.type}</td>
            <td style="padding:10px 12px;">${r.carrier}</td>
            <td style="padding:10px 12px;font-size:13px;color:var(--gray-500);">${r.lob}</td>
            <td style="padding:10px 12px;font-size:13px;color:var(--gray-500);">${r.month}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:700;color:#059669;">
                $${r.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
                ${breakdown}
            </td>
            <td style="padding:8px 10px;text-align:center;">
                <button onclick="uicOpenCommEdit(this)"
                    style="padding:4px 10px;background:linear-gradient(to right,#1539a8,#2563eb);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;"
                    title="Edit this entry">✏️ Edit</button>
            </td>
        </tr>`;
    }).join('');

    document.getElementById('uicRowCount').textContent = `Showing ${rows.length} record${rows.length !== 1 ? 's' : ''}`;
}

function resetUICFilters() {
    uicActiveYear = '';
    _uicUpdateYearButtons();
    const a = document.getElementById('uicAgentFilter');
    const m = document.getElementById('uicMonthFilter');
    if (a) a.value = '';
    if (m) m.value = '';
    loadUniversalInsCommissions();
}

// ── UIC Commission Row Editing ─────────────────────────────────
function uicOpenCommEdit(btn) {
    const tr = btn.closest('tr');
    const agent       = decodeURIComponent(tr.dataset.agent);
    const carrierType = tr.dataset.carriertype;
    const carrier     = decodeURIComponent(tr.dataset.carrier);
    const month       = decodeURIComponent(tr.dataset.month);

    const commData = JSON.parse(localStorage.getItem('commissionData')) || {};
    const raw = commData[agent]?.[carrierType]?.[carrier]?.[month];
    if (raw === undefined) return;

    const entry   = typeof raw === 'object' ? raw : { amount: raw };
    const amount  = entry.amount  ?? 0;
    const lob     = entry.lob     ?? '';
    const rate    = entry.rate    ?? '';
    const premium = entry.premium ?? '';

    tr.style.background = '#fffbeb';
    const s = 'font-size:12px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;';
    const isMonthly = carrierType === 'monthlyPaidCommissionCarriers';

    tr.innerHTML = `
        <td style="padding:6px 10px;font-weight:600;font-size:13px;white-space:nowrap;">${agent}</td>
        <td style="padding:4px 6px;">
            <select id="uicCE_type" style="${s}width:138px;">
                <option value="monthlyPaidCommissionCarriers" ${isMonthly?'selected':''}>📅 Monthly Paid</option>
                <option value="grossPaidCarriers"             ${!isMonthly?'selected':''}>💰 Gross Paid</option>
            </select>
        </td>
        <td style="padding:4px 6px;"><input id="uicCE_carrier" type="text" value="${carrier.replace(/"/g,'&quot;')}" style="${s}width:130px;"></td>
        <td style="padding:4px 6px;"><input id="uicCE_lob"     type="text" value="${lob.replace(/"/g,'&quot;')}"     style="${s}width:120px;"></td>
        <td style="padding:4px 6px;"><input id="uicCE_month"   type="text" value="${month}"                          style="${s}width:110px;"></td>
        <td style="padding:4px 6px;">
            <div style="display:flex;flex-direction:column;gap:4px;">
                <div style="display:flex;align-items:center;gap:5px;">
                    <span style="font-size:11px;color:var(--gray-500);width:42px;">$ comm</span>
                    <input id="uicCE_amount" type="number" step="0.01" value="${amount}"  style="${s}width:90px;background:#f0fdf4;font-weight:700;color:#166534;text-align:right;">
                </div>
                <div style="display:flex;align-items:center;gap:5px;">
                    <span style="font-size:11px;color:var(--gray-500);width:42px;">$ prem</span>
                    <input id="uicCE_prem"   type="number" step="0.01" value="${premium}" style="${s}width:90px;text-align:right;">
                </div>
                <div style="display:flex;align-items:center;gap:5px;">
                    <span style="font-size:11px;color:var(--gray-500);width:42px;">rate %</span>
                    <input id="uicCE_rate"   type="number" step="0.01" value="${rate}"    style="${s}width:90px;text-align:right;" placeholder="e.g. 10">
                </div>
            </div>
        </td>
        <td style="padding:4px 8px;text-align:center;vertical-align:middle;">
            <div style="display:flex;flex-direction:column;gap:4px;align-items:center;">
                <button onclick="uicSaveCommEdit(this)"
                    style="padding:5px 12px;background:linear-gradient(to right,#047857,#10b981);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700;width:80px;">✓ Save</button>
                <button onclick="loadUniversalInsCommissions()"
                    style="padding:5px 12px;background:linear-gradient(to right,#475569,#94a3b8);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;width:80px;">✗ Cancel</button>
                <button onclick="uicDeleteCommEntry(this)"
                    style="padding:5px 12px;background:linear-gradient(to right,#7f1010,#ef4444);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;width:80px;">🗑 Delete</button>
            </div>
        </td>`;
}

function uicSaveCommEdit(btn) {
    const tr          = btn.closest('tr');
    const oldAgent    = decodeURIComponent(tr.dataset.agent);
    const oldCT       = tr.dataset.carriertype;
    const oldCarrier  = decodeURIComponent(tr.dataset.carrier);
    const oldMonth    = decodeURIComponent(tr.dataset.month);

    const g = id => document.getElementById(id);
    const newCT      = g('uicCE_type')?.value    || oldCT;
    const newCarrier = (g('uicCE_carrier')?.value || '').trim() || oldCarrier;
    const newLOB     = (g('uicCE_lob')?.value    || '').trim();
    const newMonth   = (g('uicCE_month')?.value  || '').trim()  || oldMonth;
    const newAmount  = parseFloat(g('uicCE_amount')?.value) || 0;
    const newPrem    = parseFloat(g('uicCE_prem')?.value)   || 0;
    const newRate    = parseFloat(g('uicCE_rate')?.value)   || 0;

    let cd = JSON.parse(localStorage.getItem('commissionData')) || {};

    // Remove old entry, clean up empty containers
    if (cd[oldAgent]?.[oldCT]?.[oldCarrier]) {
        delete cd[oldAgent][oldCT][oldCarrier][oldMonth];
        if (!Object.keys(cd[oldAgent][oldCT][oldCarrier]).length) delete cd[oldAgent][oldCT][oldCarrier];
        if (!Object.keys(cd[oldAgent][oldCT] || {}).length)       delete cd[oldAgent][oldCT];
    }

    // Write new entry
    cd[oldAgent]                      ??= {};
    cd[oldAgent][newCT]               ??= {};
    cd[oldAgent][newCT][newCarrier]   ??= {};
    cd[oldAgent][newCT][newCarrier][newMonth] = {
        amount: newAmount, lob: newLOB, rate: newRate, premium: newPrem
    };

    localStorage.setItem('commissionData', JSON.stringify(cd));
    commissionData = cd;
    loadUniversalInsCommissions();
}

function uicDeleteCommEntry(btn) {
    const tr         = btn.closest('tr');
    const agent      = decodeURIComponent(tr.dataset.agent);
    const carrierType= tr.dataset.carriertype;
    const carrier    = decodeURIComponent(tr.dataset.carrier);
    const month      = decodeURIComponent(tr.dataset.month);

    if (!confirm(`Delete commission entry?\n\nAgent: ${agent}\nCarrier: ${carrier}\nMonth: ${month}\n\nThis cannot be undone.`)) return;

    let cd = JSON.parse(localStorage.getItem('commissionData')) || {};
    if (cd[agent]?.[carrierType]?.[carrier]) {
        delete cd[agent][carrierType][carrier][month];
        if (!Object.keys(cd[agent][carrierType][carrier]).length) delete cd[agent][carrierType][carrier];
        if (!Object.keys(cd[agent][carrierType] || {}).length)    delete cd[agent][carrierType];
        if (!Object.keys(cd[agent] || {}).length)                 delete cd[agent];
    }
    localStorage.setItem('commissionData', JSON.stringify(cd));
    commissionData = cd;
    loadUniversalInsCommissions();
}

// ── UIC Entry Picker ───────────────────────────────────────────
let _uicPickerEntries = [];
let _uicPickerSource  = 'binder';   // 'binder' | 'excel' | 'manual'
let _uicExcelWorkbook = null;

function uicSetSource(src) {
    _uicPickerSource = src;

    // Tab underline highlight
    ['binder','excel','manual'].forEach(s => {
        const btn = document.getElementById('uicSrc' + s.charAt(0).toUpperCase() + s.slice(1) + 'Btn');
        if (!btn) return;
        const active = s === src;
        btn.style.borderBottomColor = active ? 'var(--primary)' : 'transparent';
        btn.style.color             = active ? 'var(--primary)' : 'var(--gray-500)';
        btn.style.fontWeight        = active ? '700' : '600';
    });

    // Panel visibility
    const show = id => { const el = document.getElementById(id); if (el) el.style.display = 'flex'; };
    const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
    const showBlock = id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; };

    hide('uicBinderFilters'); hide('uicExcelControls');
    hide('uicManualPanel');   hide('uicPickerTableWrap');

    const addBtn    = document.getElementById('uicAddSelectedBtn');
    const saveBtn   = document.getElementById('uicSaveManualBtn');
    const selCount  = document.getElementById('uicPickerSelCount');

    if (src === 'binder') {
        show('uicBinderFilters'); showBlock('uicPickerTableWrap');
        if (addBtn)  addBtn.style.display  = '';
        if (saveBtn) saveBtn.style.display = 'none';
        if (selCount) selCount.style.display = '';
        filterUICEntryList();
    } else if (src === 'excel') {
        showBlock('uicExcelControls'); showBlock('uicPickerTableWrap');
        if (addBtn)  addBtn.style.display  = '';
        if (saveBtn) saveBtn.style.display = 'none';
        if (selCount) selCount.style.display = '';
        // If no file yet, show placeholder
        if (!_uicExcelWorkbook) {
            const tbody = document.getElementById('uicPickerTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:40px;color:var(--gray-400);">Upload an Excel file above to load entries.</td></tr>';
            if (selCount) selCount.textContent = '0 entries selected';
        }
    } else if (src === 'manual') {
        showBlock('uicManualPanel');
        if (addBtn)  addBtn.style.display  = 'none';
        if (saveBtn) saveBtn.style.display = '';
        if (selCount) selCount.style.display = 'none';
    }

    refreshIcons();
}

function openUICEntryPicker() {
    const modal = document.getElementById('uicEntryPickerModal');
    if (!modal) return;

    // Build agent list from binder data
    const binderAgents = [...new Set((JSON.parse(localStorage.getItem('binderData')) || []).map(e => e.agent).filter(Boolean))].sort();

    // Populate binder agent filter
    const agentSel = document.getElementById('uicPickerAgentFilter');
    if (agentSel) {
        agentSel.innerHTML = '<option value="">All Agents</option>';
        binderAgents.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; agentSel.appendChild(o); });
    }

    // Populate Excel agent-assign dropdown
    const excelAgentSel = document.getElementById('uicExcelAgentAssign');
    if (excelAgentSel) {
        excelAgentSel.innerHTML = '<option value="">— Select Agent —</option>';
        binderAgents.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; excelAgentSel.appendChild(o); });
    }

    // Reset binder filters
    const search = document.getElementById('uicPickerSearch');
    if (search) search.value = '';
    const yearSel = document.getElementById('uicPickerYearFilter');
    if (yearSel) yearSel.value = '';

    // Reset Excel state
    _uicExcelWorkbook = null;
    const sheetRow = document.getElementById('uicExcelSheetRow');
    if (sheetRow) sheetRow.style.display = 'none';
    const fname = document.getElementById('uicExcelFileName');
    if (fname) { fname.textContent = ''; fname.style.display = 'none'; }
    const fileInput = document.getElementById('uicExcelFileInput');
    if (fileInput) fileInput.value = '';

    // Populate manual entry dropdowns
    const manualAgentSel = document.getElementById('uicManualAgent');
    if (manualAgentSel) {
        manualAgentSel.innerHTML = '<option value="">— Select Agent —</option>';
        binderAgents.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; manualAgentSel.appendChild(o); });
    }
    const manualLOBSel = document.getElementById('uicManualLOB');
    if (manualLOBSel) {
        manualLOBSel.innerHTML = '<option value="">— Select LOB —</option>';
        ALL_LOBS.forEach(l => { const o = document.createElement('option'); o.value = l; o.textContent = l; manualLOBSel.appendChild(o); });
    }
    // Carrier select — delegated to refreshAllCarrierDropdowns() for consistency
    refreshAllCarrierDropdowns();

    // Reset manual form
    ['uicManualAgentName','uicManualCSRName','uicManualDealerLocation',
     'uicManualClientName','uicManualDownPmt','uicManualAgencyFee','uicManualBasePrem','uicManualWrittenPrem','uicManualPolicyNum','uicManualRate','uicManualCommission']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; if (el.dataset) el.dataset.manualOverride = ''; }
        });
    const manualStatus   = document.getElementById('uicManualStatus');
    if (manualStatus) manualStatus.value = 'Active';
    const manualTxn      = document.getElementById('uicManualTransaction');
    if (manualTxn) manualTxn.value = 'New';
    const manualPmtType  = document.getElementById('uicManualPaymentType');
    if (manualPmtType) manualPmtType.value = '';
    const manualCommType = document.getElementById('uicManualCommType');
    if (manualCommType) manualCommType.value = '';
    const manualTerm     = document.getElementById('uicManualTerm');
    if (manualTerm) manualTerm.value = '';
    const rateNote = document.getElementById('uicManualRateNote');
    if (rateNote) rateNote.textContent = '';

    // Start on binder tab
    _uicPickerSource = 'binder';
    const selectAll = document.getElementById('uicPickerSelectAll');
    if (selectAll) selectAll.checked = false;

    modal.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(modal);
    uicSetSource('binder');
    refreshIcons();
}

function closeUICEntryPicker() {
    document.getElementById('uicEntryPickerModal')?.classList.remove('active');
}

// ── Manual entry helpers ──────────────────────────────────────

// Auto-update Written Premium = Base Premium + Agency Fee
function uicUpdateWrittenPrem() {
    const base = parseFloat(document.getElementById('uicManualBasePrem')?.value) || 0;
    const fee  = parseFloat(document.getElementById('uicManualAgencyFee')?.value) || 0;
    const wp   = document.getElementById('uicManualWrittenPrem');
    if (wp) wp.value = (base + fee > 0) ? (base + fee).toFixed(2) : '';
}

// Auto-convert decimal rate (e.g. 0.10 entered from spreadsheet) → percentage (10)
function uicNormalizeRate() {
    const field = document.getElementById('uicManualRate');
    if (!field) return;
    const v = parseFloat(field.value);
    if (!isNaN(v) && v > 0 && v < 1) {
        // User typed a decimal like 0.10 — convert to percentage
        field.value = parseFloat((v * 100).toFixed(4));
        field.dataset.manualOverride = '1';
        uicManualCalcFromRate();
    }
}

function uicAutoCalcManualCommission() {
    const carrier     = document.getElementById('uicManualCarrier')?.value    || '';
    const lob         = document.getElementById('uicManualLOB')?.value        || '';
    const commType    = document.getElementById('uicManualCommType')?.value   || '';  // Monthly Paid / Gross Paid
    const transaction = document.getElementById('uicManualTransaction')?.value || 'New';
    const basePrem    = parseFloat(document.getElementById('uicManualBasePrem')?.value) || 0;

    const rateNote    = document.getElementById('uicManualRateNote');
    const rateField   = document.getElementById('uicManualRate');
    const commField   = document.getElementById('uicManualCommission');

    if (!carrier || !lob || !commType || basePrem <= 0) {
        if (rateNote) rateNote.textContent = '';
        return;
    }

    const isRenewal = transaction === 'Renewal' || transaction === 'Rewrite';
    // Use Commission Type (Monthly Paid / Gross Paid) for carrier rule lookup
    const rate = getCommissionRate(carrier, lob, commType, isRenewal ? 'Renewal' : 'New');

    if (rate > 0) {
        if (rateField && !rateField.dataset.manualOverride) {
            rateField.value = rate;
        }
        const usedRate = parseFloat(rateField?.value) || rate;
        // Direct carrier commission: Base Premium × Rate% (no agency split factor here)
        const commission = parseFloat((basePrem * (usedRate / 100)).toFixed(2));
        if (commField) commField.value = commission.toFixed(2);
        if (rateNote) rateNote.textContent = `— auto (${rate}%)`;
    } else {
        if (rateNote) rateNote.textContent = '— no rule found';
    }
}

function uicManualCalcFromRate() {
    const rateField = document.getElementById('uicManualRate');
    const commField = document.getElementById('uicManualCommission');
    if (!rateField || !commField) return;
    // Mark as manually overridden so auto-calc won't overwrite it
    rateField.dataset.manualOverride = rateField.value ? '1' : '';
    const rate     = parseFloat(rateField.value) || 0;
    const basePrem = parseFloat(document.getElementById('uicManualBasePrem')?.value) || 0;
    if (rate > 0 && basePrem > 0) {
        // Direct calculation: Base × Rate% (carrier statement formula)
        commField.value = parseFloat((basePrem * (rate / 100)).toFixed(2));
    }
}

function uicSaveManualEntry() {
    const agent          = document.getElementById('uicManualAgent')?.value           || '';
    const agentName      = document.getElementById('uicManualAgentName')?.value.trim()  || '';
    const csrName        = document.getElementById('uicManualCSRName')?.value.trim()    || '';
    const dealerLocation = document.getElementById('uicManualDealerLocation')?.value.trim() || '';
    const clientName     = document.getElementById('uicManualClientName')?.value.trim() || '';
    const carrier        = document.getElementById('uicManualCarrier')?.value           || '';
    const lob            = document.getElementById('uicManualLOB')?.value               || '';
    const commType       = document.getElementById('uicManualCommType')?.value          || '';  // Monthly Paid / Gross Paid
    const paymentType    = document.getElementById('uicManualPaymentType')?.value       || '';  // EFT / Recurring / Direct
    const commission  = parseFloat(document.getElementById('uicManualCommission')?.value);
    const rate        = parseFloat(document.getElementById('uicManualRate')?.value)       || 0;
    const basePrem    = parseFloat(document.getElementById('uicManualBasePrem')?.value)   || 0;
    const agencyFee   = parseFloat(document.getElementById('uicManualAgencyFee')?.value)  || 0;
    const writtenPrem = parseFloat(document.getElementById('uicManualWrittenPrem')?.value)|| 0;
    const downPmt     = parseFloat(document.getElementById('uicManualDownPmt')?.value)    || 0;
    const term        = document.getElementById('uicManualTerm')?.value         || '';
    const policyNum   = document.getElementById('uicManualPolicyNum')?.value.trim() || '';
    const status      = document.getElementById('uicManualStatus')?.value       || '';
    const transaction = document.getElementById('uicManualTransaction')?.value  || '';

    // Validate required fields
    if (!agent)      { alert('Please select an Agent.');           return; }
    if (!clientName) { alert('Please enter a Client Name.');       return; }
    if (!carrier)    { alert('Please select a Carrier.');          return; }
    if (!lob)        { alert('Please select a Line of Business.'); return; }
    if (!commType)   { alert('Please select a Commission Type (Monthly Paid or Gross Paid).'); return; }
    if (isNaN(commission)) { alert('Please enter a Commission amount.'); return; }

    const month       = getMonthYear();
    const carrierType = commType === 'Monthly Paid' ? 'monthlyPaidCommissionCarriers' : 'grossPaidCarriers';

    let commData = JSON.parse(localStorage.getItem('commissionData')) || {};
    if (!commData[agent])                         commData[agent] = { monthlyPaidCommissionCarriers: {}, grossPaidCarriers: {} };
    if (!commData[agent][carrierType])            commData[agent][carrierType] = {};
    if (!commData[agent][carrierType][carrier])   commData[agent][carrierType][carrier] = {};

    const existing = commData[agent][carrierType][carrier][month];
    if (existing) {
        existing.amount  = parseFloat((existing.amount  + commission).toFixed(2));
        existing.premium = parseFloat((existing.premium + basePrem).toFixed(2));
        if (lob && existing.lob !== lob && !existing.lob.includes(lob)) existing.lob += ', ' + lob;
    } else {
        commData[agent][carrierType][carrier][month] = {
            amount: commission, lob, rate, premium: basePrem,
            agencyFee, writtenPrem, downPmt, term, policyNum,
            status, transaction, paymentType, clientName,
            agentName, csrName, dealerLocation
        };
    }

    localStorage.setItem('commissionData', JSON.stringify(commData));
    commissionData = commData;

    closeUICEntryPicker();
    loadUniversalInsCommissions();
    alert(`✅ Commission entry saved for ${clientName} — ${carrier} — $${commission.toFixed(2)}`);
}

// ── Excel upload path ─────────────────────────────────────────
function uicHandleExcelDrop(event) {
    event.preventDefault();
    const dz = document.getElementById('uicExcelDropZone');
    if (dz) dz.style.borderColor = 'var(--gray-200)';
    const file = event.dataTransfer?.files[0];
    if (file) _uicReadExcelFile(file);
}

function uicHandleExcelFile(event) {
    const file = event.target.files[0];
    if (file) _uicReadExcelFile(file);
    event.target.value = '';
}

function _uicReadExcelFile(file) {
    if (!window.XLSX) { alert('Excel library not loaded. Please refresh and try again.'); return; }
    const fname = document.getElementById('uicExcelFileName');
    if (fname) { fname.textContent = '📄 ' + file.name; fname.style.display = 'block'; }

    const reader = new FileReader();
    reader.onload = (e) => {
        _uicExcelWorkbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });

        // Populate sheet selector
        const sheetSel = document.getElementById('uicExcelSheetSelect');
        if (sheetSel) {
            sheetSel.innerHTML = _uicExcelWorkbook.SheetNames.map(n => `<option value="${n}">${n}</option>`).join('');
        }

        const sheetRow = document.getElementById('uicExcelSheetRow');
        if (sheetRow) sheetRow.style.display = 'flex';

        // Auto-load first sheet
        uicLoadExcelSheet();
    };
    reader.readAsArrayBuffer(file);
}

function uicLoadExcelSheet() {
    if (!_uicExcelWorkbook) return;

    const sheetName = document.getElementById('uicExcelSheetSelect')?.value;
    const agent     = document.getElementById('uicExcelAgentAssign')?.value || '';

    if (!sheetName) return;

    const ws   = _uicExcelWorkbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const parsed = csParseSheetRows(rows);

    // Normalise Excel rate: stored as decimal (0.10) → convert to % (10)
    // If already > 1 it's already a percentage — leave it.
    const toPercent = r => r > 0 && r <= 1 ? parseFloat((r * 100).toFixed(4)) : r;

    // Map parsed entries → picker entry shape
    _uicPickerEntries = parsed.entries.map(entry => ({
        customerName:       entry.clientName   || '',
        status:             entry.status       || '',
        policyType:         entry.transaction  || 'New',
        lineOfBusiness:     entry.lob          || '',
        company:            entry.carrier      || '',
        down:               entry.downPayment  || 0,
        paymentType:        entry.paymentType  || '',
        basePremium:        entry.basePremium  || 0,
        totalPremium:       entry.writtenPremium || 0,
        term:               entry.term         || '',
        policyNumber:       entry.policyNumber || '',
        agent:              agent,
        entryDate:          '',
        _sourceRate:        toPercent(entry.rate),
        _sourceCommission:  entry.commission,
        _fromExcel:         true
    }));

    const countEl = document.getElementById('uicExcelEntryCount');
    if (countEl) countEl.textContent = `${_uicPickerEntries.length} entr${_uicPickerEntries.length !== 1 ? 'ies' : 'y'} loaded`;

    const selectAll = document.getElementById('uicPickerSelectAll');
    if (selectAll) selectAll.checked = false;
    _renderUICPickerTable();
}

function filterUICEntryList() {
    const search    = (document.getElementById('uicPickerSearch')?.value || '').toLowerCase();
    const agentF    = document.getElementById('uicPickerAgentFilter')?.value || '';
    const yearF     = document.getElementById('uicPickerYearFilter')?.value  || '';

    const all = JSON.parse(localStorage.getItem('binderData')) || [];

    _uicPickerEntries = all.filter(e => {
        if (agentF && e.agent !== agentF) return false;
        if (yearF  && e.entryDate && !e.entryDate.startsWith(yearF)) return false;
        if (search) {
            const haystack = [e.customerName, e.company, e.policyNumber, e.lineOfBusiness, e.agent].join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        return true;
    });

    // Reset select-all checkbox
    const selectAll = document.getElementById('uicPickerSelectAll');
    if (selectAll) selectAll.checked = false;

    _renderUICPickerTable();
}

function _renderUICPickerTable() {
    const tbody = document.getElementById('uicPickerTableBody');
    if (!tbody) return;

    if (!_uicPickerEntries.length) {
        tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:32px;color:var(--gray-400);">No entries match your search.</td></tr>';
        document.getElementById('uicPickerSelCount').textContent = '0 entries selected';
        return;
    }

    // Transaction label: match April 26 tab values
    const txnLabel = pt => {
        if (!pt) return '-';
        const p = pt.toLowerCase();
        if (p.includes('renew')) return 'Renewal';
        if (p.includes('rewrite')) return 'Rewrite';
        if (p.includes('end'))   return 'End';
        if (p.includes('canc'))  return 'Canc';
        return 'New';
    };

    // Status label: Active / Renewed / —
    const statusLabel = pt => {
        if (!pt) return '-';
        const p = pt.toLowerCase();
        if (p.includes('renew')) return 'Renewed';
        if (p.includes('end') || p.includes('canc')) return '-';
        return 'Active';
    };

    tbody.innerHTML = _uicPickerEntries.map((e, idx) => {
        const basePrem    = parseFloat(e.basePremium)   || 0;
        const writtenPrem = parseFloat(e.totalPremium)  || basePrem;
        const downPmt     = parseFloat(e.down)          || 0;

        // For Excel entries use the sheet's own rate/commission; for binder entries calculate
        const rate       = e._fromExcel ? (e._sourceRate || 0)       : getCommissionRate(e.company, e.lineOfBusiness, e.paymentType || 'Monthly Paid', e.policyType || 'New');
        const commission = e._fromExcel ? (e._sourceCommission != null ? e._sourceCommission : null) : (rate > 0 ? calculateCommission(basePrem, rate) : null);

        const commCell = commission != null
            ? `<span style="color:#059669;font-weight:700;">$${parseFloat(commission).toFixed(2)}</span>` + (e._fromExcel ? '<span style="font-size:10px;color:var(--gray-400);display:block;">from Excel</span>' : '')
            : `<span style="color:var(--gray-400);">—</span>`;
        const rateCell = rate > 0
            ? `${rate}%`
            : `<span style="color:var(--gray-400);">—</span>`;

        const fmt = n => n > 0 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
        const bg  = idx % 2 === 0 ? '' : 'background:#f9fafb;';

        const editedBadge = (e._editCommission != null || e._editRate != null)
            ? `<span style="font-size:9px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 4px;display:block;margin-top:2px;">edited</span>` : '';

        return `<tr data-row-idx="${idx}" style="${bg}border-bottom:1px solid var(--gray-100);">
            <td style="padding:7px 10px;text-align:center;">
                <input type="checkbox" class="uic-pick-cb" data-idx="${idx}"
                    onchange="_uicUpdateSelCount()"
                    style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer;">
            </td>
            <td style="padding:7px 10px;font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;">${e.customerName || '-'}</td>
            <td style="padding:7px 10px;color:var(--gray-500);">${statusLabel(e.policyType)}</td>
            <td style="padding:7px 10px;">${txnLabel(e.policyType)}</td>
            <td style="padding:7px 10px;color:var(--gray-500);">${e.lineOfBusiness || '-'}</td>
            <td style="padding:7px 10px;">${e.company || '-'}</td>
            <td style="padding:7px 10px;text-align:right;">${downPmt > 0 ? fmt(downPmt) : '—'}</td>
            <td style="padding:7px 10px;">${e.paymentType || '-'}</td>
            <td style="padding:7px 10px;text-align:right;">${fmt(basePrem)}</td>
            <td style="padding:7px 10px;text-align:right;">${fmt(writtenPrem)}</td>
            <td style="padding:7px 10px;text-align:center;">${e.term || '—'}</td>
            <td style="padding:7px 10px;color:var(--gray-500);">${e.policyNumber || '-'}</td>
            <td style="padding:7px 10px;text-align:center;">${rateCell}${editedBadge}</td>
            <td style="padding:7px 10px;text-align:right;">${commCell}${editedBadge}</td>
            <td style="padding:7px 10px;text-align:center;">
                <button onclick="uicOpenRowEdit(${idx})"
                    style="padding:3px 8px;background:linear-gradient(to right,#1539a8,#2563eb);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:3px;"
                    title="Edit this entry">✏️ Edit</button>
            </td>
        </tr>`;
    }).join('');

    document.getElementById('uicPickerSelCount').textContent = '0 entries selected';
}

function _uicUpdateSelCount() {
    const count = document.querySelectorAll('.uic-pick-cb:checked').length;
    document.getElementById('uicPickerSelCount').textContent =
        count === 0 ? '0 entries selected' : `${count} entr${count === 1 ? 'y' : 'ies'} selected`;
}

function uicOpenRowEdit(idx) {
    const e = _uicPickerEntries[idx];
    if (!e) return;

    // Preserve checkbox checked state
    const wasChecked = document.querySelector(`.uic-pick-cb[data-idx="${idx}"]`)?.checked || false;

    const targetRow = document.querySelector(`#uicPickerTableBody tr[data-row-idx="${idx}"]`);
    if (!targetRow) return;

    const s = 'font-size:11px;padding:3px 5px;border:1px solid #d1d5db;border-radius:3px;box-sizing:border-box;';
    const txnOpts  = ['New','Renewal','Rewrite','End','Canc']
        .map(v => `<option value="${v}" ${e.policyType===v?'selected':''}>${v}</option>`).join('');
    const pmtOpts  = ['Monthly Paid','Gross Paid','EFT','Direct Billing','ACH to Agency','CC-Company']
        .map(v => `<option value="${v}" ${e.paymentType===v?'selected':''}>${v}</option>`).join('');
    const termOpts = ['6','12']
        .map(v => `<option value="${v}" ${String(e.term)===v?'selected':''}>${v}</option>`).join('');

    targetRow.style.background = '#fffbeb';
    targetRow.innerHTML = `
        <td style="padding:5px 8px;text-align:center;">
            <input type="checkbox" class="uic-pick-cb" data-idx="${idx}" onchange="_uicUpdateSelCount()"
                ${wasChecked ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer;">
        </td>
        <td style="padding:5px 6px;font-weight:500;font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;">${e.customerName || '-'}</td>
        <td style="padding:3px 4px;">
            <select id="uicEdit_status_${idx}" style="${s}width:76px;">
                <option value="Active"   ${(e.status||'Active')==='Active'?'selected':''}>Active</option>
                <option value="Renewed"  ${e.status==='Renewed'?'selected':''}>Renewed</option>
                <option value="-"        ${e.status==='-'?'selected':''}>-</option>
            </select>
        </td>
        <td style="padding:3px 4px;"><select id="uicEdit_txn_${idx}" style="${s}width:82px;">${txnOpts}</select></td>
        <td style="padding:3px 4px;"><input id="uicEdit_lob_${idx}" type="text" value="${(e.lineOfBusiness||'').replace(/"/g,'&quot;')}" style="${s}width:108px;"></td>
        <td style="padding:3px 4px;"><input id="uicEdit_carrier_${idx}" type="text" value="${(e.company||'').replace(/"/g,'&quot;')}" style="${s}width:108px;"></td>
        <td style="padding:3px 4px;text-align:right;"><input id="uicEdit_down_${idx}" type="number" step="0.01" value="${parseFloat(e.down)||0}" style="${s}width:68px;text-align:right;"></td>
        <td style="padding:3px 4px;"><select id="uicEdit_pmt_${idx}" style="${s}width:102px;">${pmtOpts}</select></td>
        <td style="padding:3px 4px;text-align:right;"><input id="uicEdit_base_${idx}" type="number" step="0.01" value="${parseFloat(e.basePremium)||0}" style="${s}width:74px;text-align:right;"></td>
        <td style="padding:3px 4px;text-align:right;"><input id="uicEdit_written_${idx}" type="number" step="0.01" value="${parseFloat(e.totalPremium||e.basePremium)||0}" style="${s}width:74px;text-align:right;"></td>
        <td style="padding:3px 4px;text-align:center;"><select id="uicEdit_term_${idx}" style="${s}width:48px;">${termOpts}</select></td>
        <td style="padding:3px 4px;"><input id="uicEdit_policy_${idx}" type="text" value="${(e.policyNumber||'').replace(/"/g,'&quot;')}" style="${s}width:96px;"></td>
        <td style="padding:3px 4px;text-align:center;">
            <input id="uicEdit_rate_${idx}" type="number" step="0.01" value="${e._editRate != null ? e._editRate : ''}" placeholder="%" style="${s}width:52px;text-align:center;">
        </td>
        <td style="padding:3px 4px;text-align:right;">
            <input id="uicEdit_comm_${idx}" type="number" step="0.01" value="${e._editCommission != null ? e._editCommission : ''}" placeholder="$" style="${s}width:72px;background:#f0fdf4;font-weight:600;text-align:right;">
        </td>
        <td style="padding:3px 6px;text-align:center;">
            <div style="display:flex;gap:3px;justify-content:center;">
                <button onclick="uicSaveRowEdit(${idx})"
                    style="padding:3px 8px;background:linear-gradient(to right,#047857,#10b981);color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;font-weight:700;"
                    title="Save changes">✓</button>
                <button onclick="_renderUICPickerTable()"
                    style="padding:3px 8px;background:linear-gradient(to right,#475569,#94a3b8);color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;"
                    title="Cancel">✗</button>
            </div>
        </td>`;
}

function uicSaveRowEdit(idx) {
    const e = _uicPickerEntries[idx];
    if (!e) return;
    const g = id => document.getElementById(id);

    e.status         = g(`uicEdit_status_${idx}`)?.value        || e.status;
    e.policyType     = g(`uicEdit_txn_${idx}`)?.value           || e.policyType;
    e.lineOfBusiness = (g(`uicEdit_lob_${idx}`)?.value || '').trim()     || e.lineOfBusiness;
    e.company        = (g(`uicEdit_carrier_${idx}`)?.value || '').trim() || e.company;
    e.down           = parseFloat(g(`uicEdit_down_${idx}`)?.value)  || 0;
    e.paymentType    = g(`uicEdit_pmt_${idx}`)?.value           || e.paymentType;
    e.basePremium    = parseFloat(g(`uicEdit_base_${idx}`)?.value)   || e.basePremium;
    e.totalPremium   = parseFloat(g(`uicEdit_written_${idx}`)?.value)|| e.totalPremium;
    e.term           = g(`uicEdit_term_${idx}`)?.value          || e.term;
    e.policyNumber   = (g(`uicEdit_policy_${idx}`)?.value || '').trim();

    const rv = parseFloat(g(`uicEdit_rate_${idx}`)?.value);
    const cv = parseFloat(g(`uicEdit_comm_${idx}`)?.value);
    if (!isNaN(rv) && rv > 0) e._editRate = rv; else delete e._editRate;
    if (!isNaN(cv) && cv > 0) e._editCommission = cv; else delete e._editCommission;

    _renderUICPickerTable();
}

function toggleUICSelectAll(checked) {
    document.querySelectorAll('.uic-pick-cb').forEach(cb => { cb.checked = checked; });
    _uicUpdateSelCount();
}

function addSelectedUICEntries() {
    const checked = [...document.querySelectorAll('.uic-pick-cb:checked')];
    if (!checked.length) { alert('Please select at least one entry.'); return; }

    // If Excel source and no agent assigned, warn
    if (_uicPickerSource === 'excel') {
        const agentAssign = document.getElementById('uicExcelAgentAssign')?.value || '';
        if (!agentAssign) { alert('Please select an agent to assign these commissions to before adding.'); return; }
    }

    let commData = JSON.parse(localStorage.getItem('commissionData')) || {};
    let added = 0, skipped = 0;

    checked.forEach(cb => {
        const idx  = parseInt(cb.dataset.idx, 10);
        const e    = _uicPickerEntries[idx];
        if (!e) return;

        const premium     = parseFloat(e.basePremium) || 0;
        const carrier     = e.company;
        const lob         = e.lineOfBusiness;
        const paymentType = e.paymentType || 'Monthly Paid';
        const policyType  = e.policyType  || 'New';
        const agent       = e.agent || (document.getElementById('uicExcelAgentAssign')?.value || '');
        const month       = e.entryDate
            ? new Date(e.entryDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
            : getMonthYear();

        if (!agent || !carrier) { skipped++; return; }

        // Commission & rate: manual edit > Excel values > carrier rules
        let commission, rate;
        if (e._editCommission != null && e._editCommission > 0) {
            commission = e._editCommission;
            rate       = e._editRate || 0;
        } else if (e._fromExcel && e._sourceCommission != null) {
            commission = parseFloat(e._sourceCommission);
            rate       = e._sourceRate || 0;
        } else {
            rate = getCommissionRate(carrier, lob, paymentType, policyType);
            if (rate <= 0 || premium <= 0) { skipped++; return; }
            commission = calculateCommission(premium, rate);
        }

        if (isNaN(commission) || commission <= 0) { skipped++; return; }

        const carrierType = paymentType === 'Monthly Paid' ? 'monthlyPaidCommissionCarriers' : 'grossPaidCarriers';

        if (!commData[agent])                         commData[agent] = { monthlyPaidCommissionCarriers: {}, grossPaidCarriers: {} };
        if (!commData[agent][carrierType])            commData[agent][carrierType] = {};
        if (!commData[agent][carrierType][carrier])   commData[agent][carrierType][carrier] = {};

        const existing = commData[agent][carrierType][carrier][month];
        if (existing) {
            existing.amount  = parseFloat((existing.amount  + commission).toFixed(2));
            existing.premium = parseFloat((existing.premium + (premium || 0)).toFixed(2));
            if (lob && existing.lob !== lob && !existing.lob.includes(lob))
                existing.lob = existing.lob + ', ' + lob;
        } else {
            commData[agent][carrierType][carrier][month] = {
                amount:  parseFloat(commission.toFixed(2)),
                lob:     lob || '',
                rate:    rate,
                premium: premium || 0
            };
        }
        added++;
    });

    localStorage.setItem('commissionData', JSON.stringify(commData));
    commissionData = commData;

    closeUICEntryPicker();
    loadUniversalInsCommissions();

    const msg = added > 0
        ? `✅ Added ${added} entr${added === 1 ? 'y' : 'ies'} to commissions.` + (skipped > 0 ? ` (${skipped} skipped)` : '')
        : `⚠️ No entries added — check that entries have a carrier and commission value.`;
    alert(msg);
}

// Agent Commission Functions
function showAgentCommissions() {
    document.getElementById('agentCommissionModal').classList.add('active');
    loadAgentCommissionData();
}

function closeAgentCommissions() {
    document.getElementById('agentCommissionModal').classList.remove('active');
}

function getAgentCommissionShares(agentName) {
    const entries = allData.filter(d => d.agent === agentName && d.agentCommissionShare > 0);
    const byMonth = {};
    entries.forEach(e => {
        const month = new Date(e.entryDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        if (!byMonth[month]) byMonth[month] = { total: 0, agencyFeeTotal: 0, agencyCommissionTotal: 0, combinedTotal: 0, count: 0 };
        byMonth[month].total += e.agentCommissionShare;
        byMonth[month].agencyFeeTotal += e.agencyFee || 0;
        byMonth[month].agencyCommissionTotal += e.agencyCommission || 0;
        byMonth[month].combinedTotal += (e.agencyFee || 0) + (e.agencyCommission || 0);
        byMonth[month].count++;
    });
    return byMonth;
}

// ── Commission Detail Sort State ──
let _commDetailSortField = 'date';
let _commDetailSortDir   = 'desc';

function _getAgentPolicyEntries(agent) {
    return allData.filter(d => d.agent === agent);
}

function _entryMonth(e) {
    try {
        return new Date(e.entryDate + 'T12:00:00').toLocaleDateString('en-US', { year:'numeric', month:'long' });
    } catch(_) { return ''; }
}

function loadAgentCommissionData() {
    const agent = currentUser;
    const entries = _getAgentPolicyEntries(agent);
    const commissions = loadCommissionData();
    const agentData = commissions[agent] || { monthlyPaidCommissionCarriers:{}, grossPaidCarriers:{} };
    const monthlyPaidCarriers = agentData.monthlyPaidCommissionCarriers || {};
    const grossPaidCarriers   = agentData.grossPaidCarriers || {};

    // ── Populate dynamic filter dropdowns ──
    const allYears = new Set(), allCarriers = new Set(), allLOBs = new Set();
    entries.forEach(e => {
        const m = _entryMonth(e);
        const parts = m.split(' ');
        if (parts.length === 2) allYears.add(parts[1]);
        if (e.company) allCarriers.add(e.company);
        if (e.lineOfBusiness) allLOBs.add(e.lineOfBusiness);
    });
    // Also gather years from carrier-level commission data
    const _addCarrierYears = (carriers) => {
        Object.values(carriers).forEach(months => {
            Object.keys(months).forEach(m => { const p = m.split(' '); if (p.length === 2) allYears.add(p[1]); });
        });
    };
    _addCarrierYears(monthlyPaidCarriers);
    _addCarrierYears(grossPaidCarriers);

    const _populateSelect = (id, items, sorter) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.value;
        const sorted = [...items].sort(sorter || ((a,b) => a.localeCompare(b)));
        const firstOpt = sel.options[0]?.textContent || 'All';
        sel.innerHTML = `<option value="">${firstOpt}</option>` +
            sorted.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
    };
    _populateSelect('commFilterYear',    allYears,    (a,b) => b-a);
    _populateSelect('commFilterCarrier',  allCarriers);
    _populateSelect('commFilterLOB',      allLOBs);

    // ── Read active filters ──
    const fMonth   = document.getElementById('commFilterMonth')?.value   || '';
    const fYear    = document.getElementById('commFilterYear')?.value    || '';
    const fCarrier = document.getElementById('commFilterCarrier')?.value || '';
    const fLOB     = document.getElementById('commFilterLOB')?.value     || '';

    const monthMatches = (monthKey) => {
        if (!fMonth && !fYear) return true;
        const [mName, mYear] = monthKey.split(' ');
        if (fMonth && mName !== fMonth) return false;
        if (fYear  && mYear !== fYear)  return false;
        return true;
    };

    const entryMatches = (e) => {
        const m = _entryMonth(e);
        if (!monthMatches(m)) return false;
        if (fCarrier && e.company !== fCarrier) return false;
        if (fLOB && e.lineOfBusiness !== fLOB) return false;
        return true;
    };

    // ── Filtered policy entries (for detail view + stats) ──
    const filtered = entries.filter(entryMatches);

    // ── Stats from actual policy entries ──
    let totalAgencyComm = 0, totalAgentShare = 0, totalPolicies = filtered.length;
    filtered.forEach(e => {
        totalAgencyComm += e.agencyCommission || 0;
        totalAgentShare += e.agentCommissionShare || 0;
    });
    const grandTotal = totalAgencyComm + totalAgentShare;

    const el = (id) => document.getElementById(id);
    el('agentTotalCommissions').textContent = `$${grandTotal.toFixed(2)}`;
    el('agentCommissionCount').textContent  = totalPolicies;
    el('agentAvgCommission').textContent    = `$${(totalPolicies > 0 ? grandTotal / totalPolicies : 0).toFixed(2)}`;
    if (el('agentAgencyCommTotal')) el('agentAgencyCommTotal').textContent = `$${totalAgencyComm.toFixed(2)}`;
    if (el('agentShareTotal'))      el('agentShareTotal').textContent      = `$${totalAgentShare.toFixed(2)}`;

    // ── Summary tab (carrier-level aggregated view) ──
    const filterCarriers = (carriers) => {
        const result = {};
        Object.entries(carriers).forEach(([carrier, months]) => {
            if (fCarrier && carrier !== fCarrier) return;
            const fm = Object.fromEntries(
                Object.entries(months).filter(([month, entry]) => {
                    if (!monthMatches(month)) return false;
                    if (fLOB) {
                        const lob = typeof entry === 'object' ? entry.lob : '';
                        if (!lob.includes(fLOB)) return false;
                    }
                    return true;
                })
            );
            if (Object.keys(fm).length > 0) result[carrier] = fm;
        });
        return result;
    };

    const filteredMonthly = filterCarriers(monthlyPaidCarriers);
    const filteredGross   = filterCarriers(grossPaidCarriers);
    const agentShares     = getAgentCommissionShares(agent);
    const filteredShares  = Object.fromEntries(
        Object.entries(agentShares).filter(([month]) => monthMatches(month))
    );

    const summaryTbody = el('agentCommissionTable');
    const hasCarrierData = Object.keys(filteredMonthly).length > 0 || Object.keys(filteredGross).length > 0;
    const hasShareData   = Object.keys(filteredShares).length > 0;

    // Build per-carrier/month policy count lookup from filtered entries
    const _policyCount = {};
    filtered.forEach(e => {
        const m = _entryMonth(e);
        const key = (e.company||'unknown') + '||' + m;
        _policyCount[key] = (_policyCount[key] || 0) + 1;
    });

    const $m = (v) => v ? `$${parseFloat(v).toFixed(2)}` : '-';

    if (!hasCarrierData && !hasShareData) {
        summaryTbody.innerHTML = '<tr><td colspan="10" class="no-data">No commission data for the selected period</td></tr>';
    } else {
        let html = '';
        let gtPremium = 0, gtFee = 0, gtAgencyComm = 0, gtAgentShare = 0, gtPolicies = 0;

        const renderCarrierRows = (carriers, header, color, commType) => {
            if (Object.keys(carriers).length === 0) return;
            html += `<tr style="background-color:${color};font-weight:bold;"><td colspan="10">${header}</td></tr>`;
            Object.entries(carriers).forEach(([carrier, months]) => {
                Object.entries(months).forEach(([month, entry], idx) => {
                    const amount  = typeof entry === 'object' ? entry.amount  : entry;
                    const lob     = typeof entry === 'object' ? entry.lob     : '-';
                    const rate    = typeof entry === 'object' ? entry.rate    : 0;
                    const premium = typeof entry === 'object' ? entry.premium : 0;
                    const fee     = typeof entry === 'object' ? (entry.fee || 0) : 0;
                    const agentSh = amount;
                    const pCount  = _policyCount[carrier + '||' + month] || '-';
                    if (typeof pCount === 'number') gtPolicies += pCount;
                    gtPremium += premium; gtAgencyComm += amount; gtFee += fee; gtAgentShare += agentSh;
                    html += `<tr>
                        <td>${idx === 0 ? carrier : ''}</td>
                        <td style="font-size:12px;">${lob}</td>
                        <td style="white-space:nowrap;">${month}</td>
                        <td style="text-align:center;">${pCount}</td>
                        <td style="font-family:monospace;font-size:12px;">${$m(premium)}</td>
                        <td style="font-size:12px;color:#059669;font-weight:600;">${rate > 0 ? rate + '%' : '-'}</td>
                        <td style="font-family:monospace;font-size:12px;">${$m(fee)}</td>
                        <td style="font-family:monospace;font-size:12px;font-weight:700;color:#166534;">${$m(amount)}</td>
                        <td style="font-family:monospace;font-size:12px;font-weight:700;color:#1d4ed8;">${$m(agentSh)}</td>
                        <td style="font-size:11px;color:${commType === 'Gross' ? '#7c3aed' : '#1d4ed8'};font-weight:700;">${commType === 'Gross' ? '🔥 Gross' : '📅 Monthly'}</td>
                    </tr>`;
                });
            });
        };
        renderCarrierRows(filteredMonthly, '📅 Monthly Paid Commission Carriers', '#e3f2fd', 'Monthly');
        renderCarrierRows(filteredGross,   '💰 Gross Paid Carriers', '#f3e5f5', 'Gross');
        if (hasShareData) {
            html += `<tr style="background-color:#e8f5e9;font-weight:bold;"><td colspan="10">🤝 Agent Commission (50% of Fee + Commission)</td></tr>`;
            Object.entries(filteredShares).forEach(([month, data]) => {
                gtPolicies += data.count; gtFee += data.agencyFeeTotal; gtAgencyComm += data.agencyCommissionTotal; gtAgentShare += data.total;
                html += `<tr>
                    <td>Agent Share</td>
                    <td>—</td>
                    <td style="white-space:nowrap;">${month}</td>
                    <td style="text-align:center;">${data.count}</td>
                    <td style="font-family:monospace;font-size:12px;">—</td>
                    <td style="font-size:12px;">50%</td>
                    <td style="font-family:monospace;font-size:12px;">${$m(data.agencyFeeTotal)}</td>
                    <td style="font-family:monospace;font-size:12px;font-weight:700;color:#166534;">${$m(data.agencyCommissionTotal)}</td>
                    <td style="font-family:monospace;font-size:12px;font-weight:700;color:#1d4ed8;">${$m(data.total)}</td>
                    <td style="font-size:11px;color:#059669;font-weight:700;">🤝 Agent</td>
                </tr>`;
            });
        }
        // Grand totals row
        html += `<tr style="background:#0d1f3c;color:#fff;font-weight:700;">
            <td colspan="3" style="color:#fff;">GRAND TOTAL</td>
            <td style="text-align:center;color:#fff;">${gtPolicies}</td>
            <td style="font-family:monospace;color:#fff;">${$m(gtPremium)}</td>
            <td style="color:#fff;">—</td>
            <td style="font-family:monospace;color:#fff;">${$m(gtFee)}</td>
            <td style="font-family:monospace;color:#4ade80;">${$m(gtAgencyComm)}</td>
            <td style="font-family:monospace;color:#60a5fa;">${$m(gtAgentShare)}</td>
            <td style="color:#fff;">—</td>
        </tr>`;
        summaryTbody.innerHTML = html;
    }

    // ── Detail tab (per-policy rows) ──
    _renderCommDetailTable(filtered);
}

function _renderCommDetailTable(filtered) {
    const sortField = _commDetailSortField;
    const sortDir   = _commDetailSortDir;

    const sorted = [...filtered].sort((a, b) => {
        let va, vb;
        switch (sortField) {
            case 'date':       va = a.entryDate || ''; vb = b.entryDate || ''; break;
            case 'carrier':    va = (a.company||'').toLowerCase(); vb = (b.company||'').toLowerCase(); break;
            case 'premium':    va = a.basePremium || 0; vb = b.basePremium || 0; break;
            case 'agencyComm': va = a.agencyCommission || 0; vb = b.agencyCommission || 0; break;
            case 'agentShare': va = a.agentCommissionShare || 0; vb = b.agentCommissionShare || 0; break;
            default:           va = a.entryDate || ''; vb = b.entryDate || '';
        }
        if (typeof va === 'string') {
            const cmp = va.localeCompare(vb);
            return sortDir === 'asc' ? cmp : -cmp;
        }
        return sortDir === 'asc' ? va - vb : vb - va;
    });

    const detailTbody = document.getElementById('agentCommDetailTable');
    if (!detailTbody) return;

    if (sorted.length === 0) {
        detailTbody.innerHTML = '<tr><td colspan="12" class="no-data">No policies found for selected filters</td></tr>';
        return;
    }

    const fmt = (v) => v ? `$${parseFloat(v).toFixed(2)}` : '-';
    const rate = (e) => {
        if (!e.company || !e.lineOfBusiness || !e.paymentType || !e.policyType) return '-';
        const r = getCommissionRate(e.company, e.lineOfBusiness, e.paymentType, e.policyType);
        return r > 0 ? `${r}%` : '-';
    };

    let html = '';
    sorted.forEach(e => {
        const dateDisplay = e.entryDate ? new Date(e.entryDate + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '-';
        const typeColor = e.paymentType === 'Gross Paid' ? '#7c3aed' : '#1d4ed8';
        const typeIcon  = e.paymentType === 'Gross Paid' ? '🔥' : '📅';
        html += `<tr>
            <td style="white-space:nowrap;font-size:12px;">${dateDisplay}</td>
            <td style="font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.customerName||''}">${e.customerName || '-'}</td>
            <td style="font-size:12px;">${e.company || '-'}</td>
            <td style="font-size:12px;">${e.lineOfBusiness || '-'}</td>
            <td style="font-size:12px;">${e.policyType || '-'}</td>
            <td style="font-size:11px;color:#64748b;font-family:monospace;">${e.binderNumber || '-'}</td>
            <td style="font-family:monospace;font-size:12px;">${fmt(e.basePremium)}</td>
            <td style="font-size:12px;color:#059669;font-weight:600;">${rate(e)}</td>
            <td style="font-family:monospace;font-size:12px;font-weight:700;color:#166534;">${fmt(e.agencyCommission)}</td>
            <td style="font-family:monospace;font-size:12px;">${fmt(e.agencyFee)}</td>
            <td style="font-family:monospace;font-size:12px;font-weight:700;color:#1d4ed8;">${fmt(e.agentCommissionShare)}</td>
            <td style="font-size:11px;color:${typeColor};font-weight:700;white-space:nowrap;">${typeIcon} ${e.paymentType || '-'}</td>
        </tr>`;
    });

    // Totals row
    let tPremium = 0, tAgencyComm = 0, tFee = 0, tAgentShare = 0;
    sorted.forEach(e => {
        tPremium    += e.basePremium || 0;
        tAgencyComm += e.agencyCommission || 0;
        tFee        += e.agencyFee || 0;
        tAgentShare += e.agentCommissionShare || 0;
    });
    html += `<tr style="background:#0d1f3c;color:#fff;font-weight:700;">
        <td colspan="6" style="color:#fff;">TOTAL (${sorted.length} policies)</td>
        <td style="font-family:monospace;color:#fff;">${fmt(tPremium)}</td>
        <td style="color:#fff;">—</td>
        <td style="font-family:monospace;color:#4ade80;">${fmt(tAgencyComm)}</td>
        <td style="font-family:monospace;color:#fff;">${fmt(tFee)}</td>
        <td style="font-family:monospace;color:#60a5fa;">${fmt(tAgentShare)}</td>
        <td style="color:#fff;">—</td>
    </tr>`;

    detailTbody.innerHTML = html;
}

function commSortDetail(field) {
    if (_commDetailSortField === field) {
        _commDetailSortDir = _commDetailSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        _commDetailSortField = field;
        _commDetailSortDir = 'desc';
    }
    loadAgentCommissionData();
}

function switchCommTab(tab) {
    const summary = document.getElementById('commViewSummary');
    const detail  = document.getElementById('commViewDetail');
    const btnS    = document.getElementById('commTabSummary');
    const btnD    = document.getElementById('commTabDetail');
    if (!summary || !detail) return;

    if (tab === 'detail') {
        summary.style.display = 'none';
        detail.style.display  = 'block';
        if (btnS) { btnS.style.background = 'transparent'; btnS.style.color = '#64748b'; btnS.style.boxShadow = 'none'; }
        if (btnD) { btnD.style.background = '#fff'; btnD.style.color = '#1d4ed8'; btnD.style.boxShadow = '0 1px 3px rgba(0,0,0,.1)'; }
    } else {
        summary.style.display = 'block';
        detail.style.display  = 'none';
        if (btnS) { btnS.style.background = '#fff'; btnS.style.color = '#1d4ed8'; btnS.style.boxShadow = '0 1px 3px rgba(0,0,0,.1)'; }
        if (btnD) { btnD.style.background = 'transparent'; btnD.style.color = '#64748b'; btnD.style.boxShadow = 'none'; }
    }
}

function clearCommissionFilters() {
    ['commFilterMonth','commFilterYear','commFilterCarrier','commFilterLOB'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const sort = document.getElementById('commSortBy');
    if (sort) sort.value = 'date-desc';
    _commDetailSortField = 'date';
    _commDetailSortDir   = 'desc';
    loadAgentCommissionData();
}

function exportAgentCommissions() {
    const agent = currentUser;
    const entries = _getAgentPolicyEntries(agent);

    let csvLines = [
        `Commission Statement - ${agent}`,
        `Generated: ${getEasternDateTimeDisplay()}`,
        '',
        'Date,Customer,Carrier,LOB,Policy Type,Binder #,Base Premium,Agency Commission,Agency Fee,Agent Share (50%),Commission Type'
    ];

    let totalAgencyComm = 0, totalAgentShare = 0;
    entries.sort((a,b) => (a.entryDate||'').localeCompare(b.entryDate||'')).forEach(e => {
        const date = e.entryDate ? new Date(e.entryDate + 'T12:00:00').toLocaleDateString('en-US') : '';
        const esc = (v) => `"${(v||'').replace(/"/g,'""')}"`;
        csvLines.push([
            date, esc(e.customerName), esc(e.company), esc(e.lineOfBusiness),
            e.policyType, e.binderNumber,
            (e.basePremium||0).toFixed(2), (e.agencyCommission||0).toFixed(2),
            (e.agencyFee||0).toFixed(2), (e.agentCommissionShare||0).toFixed(2),
            e.paymentType
        ].join(','));
        totalAgencyComm += e.agencyCommission || 0;
        totalAgentShare += e.agentCommissionShare || 0;
    });

    csvLines.push('');
    csvLines.push(`TOTAL AGENCY COMMISSION,$${totalAgencyComm.toFixed(2)}`);
    csvLines.push(`TOTAL AGENT SHARE,$${totalAgentShare.toFixed(2)}`);
    csvLines.push(`GRAND TOTAL,$${(totalAgencyComm + totalAgentShare).toFixed(2)}`);

    const csv = csvLines.join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent}_commissions_${getEasternDateString()}.csv`;
    a.click();
}

function exportAgentCommissionsPDF() {
    const agent = currentUser;
    const entries = _getAgentPolicyEntries(agent);
    const sorted = [...entries].sort((a,b) => (a.entryDate||'').localeCompare(b.entryDate||''));
    const fmt = (v) => v ? `$${parseFloat(v).toFixed(2)}` : '-';

    let totalAgencyComm = 0, totalAgentShare = 0, totalPremium = 0, totalFee = 0;
    sorted.forEach(e => {
        totalAgencyComm += e.agencyCommission || 0;
        totalAgentShare += e.agentCommissionShare || 0;
        totalPremium    += e.basePremium || 0;
        totalFee        += e.agencyFee || 0;
    });

    const rows = sorted.map(e => {
        const date = e.entryDate ? new Date(e.entryDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '-';
        return `<tr>
            <td>${date}</td><td>${e.customerName||'-'}</td><td>${e.company||'-'}</td>
            <td>${e.lineOfBusiness||'-'}</td><td>${e.policyType||'-'}</td>
            <td>${fmt(e.basePremium)}</td><td>${fmt(e.agencyCommission)}</td>
            <td>${fmt(e.agencyFee)}</td><td style="font-weight:700;">${fmt(e.agentCommissionShare)}</td>
            <td>${e.paymentType||'-'}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><title>Commission Statement — ${agent}</title>
    <style>
        body{font-family:'Segoe UI',system-ui,sans-serif;margin:24px;color:#1e293b;font-size:11px;}
        h2{color:#0d1f3c;margin-bottom:4px;}
        .meta{color:#64748b;font-size:12px;margin-bottom:20px;}
        table{width:100%;border-collapse:collapse;margin-bottom:20px;}
        th{background:#0d1f3c;color:#fff;padding:8px 6px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.3px;}
        td{padding:6px;border-bottom:1px solid #e2e8f0;font-size:11px;}
        tr:nth-child(even){background:#f8fafc;}
        .totals{background:#0d1f3c;color:#fff;font-weight:700;}
        .totals td{border:none;padding:8px 6px;}
        .summary{display:flex;gap:20px;margin-bottom:20px;}
        .sbox{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;flex:1;text-align:center;}
        .sbox .lbl{font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:.5px;}
        .sbox .val{font-size:18px;font-weight:800;color:#0d1f3c;margin-top:4px;}
        @media print { body{margin:12px;} }
    </style>
    <script>window.onload = () => window.print();<\/script>
    </head><body>
    <h2>Commission Statement — ${agent}</h2>
    <div class="meta">Generated: ${getEasternDateTimeDisplay()} &middot; ${sorted.length} policies</div>
    <div class="summary">
        <div class="sbox"><div class="lbl">Total Commissions</div><div class="val">${fmt(totalAgencyComm + totalAgentShare)}</div></div>
        <div class="sbox"><div class="lbl">Agency Commission</div><div class="val">${fmt(totalAgencyComm)}</div></div>
        <div class="sbox"><div class="lbl">Agent Share (50%)</div><div class="val">${fmt(totalAgentShare)}</div></div>
        <div class="sbox"><div class="lbl">Policies</div><div class="val">${sorted.length}</div></div>
    </div>
    <table>
        <thead><tr><th>Date</th><th>Customer</th><th>Carrier</th><th>LOB</th><th>Type</th><th>Premium</th><th>Agency Comm</th><th>Fee</th><th>Agent Share</th><th>Comm Type</th></tr></thead>
        <tbody>${rows}
        <tr class="totals">
            <td colspan="5">TOTAL</td>
            <td>${fmt(totalPremium)}</td><td>${fmt(totalAgencyComm)}</td><td>${fmt(totalFee)}</td><td>${fmt(totalAgentShare)}</td><td>—</td>
        </tr></tbody>
    </table></body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
}

// ================================================================
// COMMISSION STATEMENTS — Excel Upload & Management
// ================================================================
let commissionStatements = {};
let csCurrentMonthKey = null;
let csCurrentWorkbook = null;
let csParsedPreview = null;

function initializeCommissionStatements() {
    const stored = localStorage.getItem('commissionStatements');
    commissionStatements = stored ? JSON.parse(stored) : {};
}

function saveCommissionStatements() {
    localStorage.setItem('commissionStatements', JSON.stringify(commissionStatements));
    driveSet('commissionStatements', commissionStatements);
}

// ── Navigation ────────────────────────────────────────────────
function showCommissionStatements() {
    showSection('commissionStatementsSection');
    loadCommissionStatementsList();
    if (window.UIBMotion) UIBMotion.animateStatCards();
    refreshIcons();
}

// ── Upload Modal ──────────────────────────────────────────────
function openCommissionUploadModal() {
    csResetUpload();
    const m = document.getElementById('commissionUploadModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    refreshIcons();
}

function closeCommissionUploadModal() {
    document.getElementById('commissionUploadModal').classList.remove('active');
}

function csResetUpload() {
    document.getElementById('csStep1').style.display = 'block';
    document.getElementById('csStep2').style.display = 'none';
    document.getElementById('csFileStatus').textContent = '';
    const inp = document.getElementById('csFileInput');
    if (inp) inp.value = '';
    const importBtn = document.getElementById('csImportBtn');
    if (importBtn) { importBtn.disabled = true; importBtn.style.opacity = '0.5'; }
    csCurrentWorkbook = null;
    csParsedPreview = null;
}

function handleCSFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('csFileStatus');
    statusEl.innerHTML = '⏳ Parsing file…';

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            if (!window.XLSX) {
                statusEl.innerHTML = '❌ SheetJS not loaded — please refresh and try again.';
                return;
            }
            const data = new Uint8Array(e.target.result);
            csCurrentWorkbook = XLSX.read(data, { type: 'array' });

            // Populate sheet selector (skip reconciliation / annual sheets)
            const sheetSel = document.getElementById('csSheetSelect');
            sheetSel.innerHTML = '<option value="">-- Select a month --</option>';
            const skip = ['reconcil', 'summary', 'annual', '2023 comm', '2024 comm', '2025 comm'];
            csCurrentWorkbook.SheetNames.forEach(name => {
                if (!skip.some(s => name.toLowerCase().includes(s))) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = csNormalizeSheetName(name);
                    sheetSel.appendChild(opt);
                }
            });

            document.getElementById('csStep1').style.display = 'none';
            document.getElementById('csStep2').style.display = 'block';
            document.getElementById('csPreviewArea').style.display = 'none';
            statusEl.innerHTML = `✅ <strong>${file.name}</strong> loaded — ${csCurrentWorkbook.SheetNames.length} sheets found.`;
        } catch (err) {
            statusEl.innerHTML = '❌ Could not read file: ' + err.message;
        }
    };
    reader.readAsArrayBuffer(file);
}

function csNormalizeSheetName(name) {
    const MONTHS = {
        jan:'January', feb:'February', mar:'March', marz:'March',
        apr:'April', may:'May', jun:'June', jul:'July',
        aug:'August', sept:'September', sep:'September',
        oct:'October', nov:'November', dec:'December'
    };
    const clean = name.trim();

    // "Jan25" / "Feb25"
    let m = clean.match(/^([A-Za-z]+)\s*(\d{2})$/);
    if (m) {
        const mo = MONTHS[m[1].toLowerCase()];
        if (mo) return `${mo} ${parseInt(m[2]) < 50 ? 2000 + parseInt(m[2]) : 1900 + parseInt(m[2])}`;
    }
    // "April 26" / "Oct 25"
    m = clean.match(/^([A-Za-z]+)\s+(\d{2})$/);
    if (m) {
        const mo = MONTHS[m[1].toLowerCase()];
        if (mo) return `${mo} ${parseInt(m[2]) < 50 ? 2000 + parseInt(m[2]) : 1900 + parseInt(m[2])}`;
    }
    // "Jun 2023" / "Jan 2024"
    m = clean.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
        const mo = MONTHS[m[1].toLowerCase()];
        if (mo) return `${mo} ${m[2]}`;
    }
    return clean;
}

function previewCSSheet() {
    const sheetName = document.getElementById('csSheetSelect').value;
    const previewArea = document.getElementById('csPreviewArea');
    const importBtn = document.getElementById('csImportBtn');

    if (!sheetName || !csCurrentWorkbook) {
        previewArea.style.display = 'none';
        if (importBtn) { importBtn.disabled = true; importBtn.style.opacity = '0.5'; }
        csParsedPreview = null;
        return;
    }

    const ws = csCurrentWorkbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const parsed = csParseSheetRows(rows);
    csParsedPreview = { sheetName, ...parsed };

    // Info bar
    const carrierList = Object.keys(parsed.carrierTotals);
    document.getElementById('csPreviewInfo').innerHTML =
        `<strong>${parsed.entries.length} entries</strong> across <strong>${carrierList.length} carriers</strong> &nbsp;|&nbsp; ` +
        `Gross Commission: <strong style="color:#059669;">$${parsed.grossTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong>`;

    // Carrier breakdown preview table
    const tbl = document.getElementById('csPreviewTable');
    tbl.innerHTML =
        `<thead><tr style="background:var(--gray-50);">
            <th style="padding:7px 12px;text-align:left;font-size:12px;font-weight:600;">Carrier</th>
            <th style="padding:7px 12px;text-align:center;font-size:12px;font-weight:600;">Policies</th>
            <th style="padding:7px 12px;text-align:right;font-size:12px;font-weight:600;">Commission</th>
         </tr></thead>` +
        `<tbody>${carrierList.map(c => {
            const cnt = parsed.entries.filter(e => e.carrier === c).length;
            const tot = parsed.carrierTotals[c];
            return `<tr style="border-bottom:1px solid var(--gray-100);">
                <td style="padding:7px 12px;font-size:12px;">${c}</td>
                <td style="padding:7px 12px;text-align:center;font-size:12px;">${cnt}</td>
                <td style="padding:7px 12px;text-align:right;font-size:12px;font-weight:700;color:#059669;">
                    $${tot.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
                </td>
            </tr>`;
        }).join('')}</tbody>`;

    previewArea.style.display = 'block';
    if (importBtn) { importBtn.disabled = false; importBtn.style.opacity = '1'; }
}

function importSelectedSheet() {
    if (!csParsedPreview) { alert('Please select a month sheet first.'); return; }

    const { sheetName, entries, carrierTotals, grossTotal } = csParsedPreview;
    const monthLabel = csNormalizeSheetName(sheetName);

    // Cross-reference with binder book to find agent matches
    const binder = JSON.parse(localStorage.getItem('binderData')) || [];
    entries.forEach(entry => {
        if (!entry.policyNumber) return;
        const pn = entry.policyNumber.trim().replace(/\s+/g, '').toUpperCase();
        const hit = binder.find(b => {
            const bp = (b.policyNumber || b.binderNumber || '').toString().trim().replace(/\s+/g, '').toUpperCase();
            return bp && bp === pn;
        });
        if (hit) entry.agentMatch = hit.agent || null;
    });

    commissionStatements[monthLabel] = {
        month: monthLabel,
        sheetName,
        uploadedAt: new Date().toISOString(),
        entries,
        carrierTotals,
        grossTotal,
        entryCount: entries.length
    };

    saveCommissionStatements();
    closeCommissionUploadModal();
    csCurrentMonthKey = monthLabel;
    loadCommissionStatementsList();
}

// ── Sheet Parser (April 26 format) ────────────────────────────
// Confirmed column map from April 26 sheet:
//  col[0]  = Carrier section header ('Progressive','Infinity','United','National G','Ocean','Amwins')
//  col[1]  = Client Name
//  col[2]  = Status   (Active / Renewed / null)
//  col[3]  = Transaction (New / Renewal / End / Canc)
//  col[4]  = Line of Business
//  col[5]  = Carrier full name — null on End/Canc rows, inherit currentCarrier
//  col[6]  = Down Payment
//  col[8]  = Payment Type
//  col[9]  = Base Premium (null on renewal rows → fall back to col[10])
//  col[10] = Written Premium
//  col[11] = Term (6 or 12)
//  col[13] = Policy Number
//  col[14] = Commission Rate (0.10, 0.12, 0.14…)
//  col[15] = Commission Amount  ← key field
//  col[16] = Subtotal label on summary rows ('New', 'Ren/Adj') → skip those rows
function csParseSheetRows(rows) {
    const entries       = [];
    const carrierTotals = {};
    let currentCarrier  = '';

    for (const row of rows) {
        if (!row || row.length < 16) continue;

        // ── Carrier section header ──────────────────────────────
        // col[0] non-empty string AND col[1] is null OR 'Client Name'
        if (row[0] && typeof row[0] === 'string' && row[0].trim() &&
            (!row[1] || row[1].toString().trim().toLowerCase() === 'client name')) {
            currentCarrier = row[0].trim();
            continue;
        }

        // ── Must have a client name in col[1] ────────────────────
        if (!row[1] || typeof row[1] !== 'string') continue;
        const clientName = row[1].trim();
        if (!clientName || clientName.toLowerCase() === 'client name') continue;

        // ── Skip subtotal / summary rows (col[16] is a string) ──
        if (row[16] && typeof row[16] === 'string') continue;

        // ── Commission must be a number in col[15] ───────────────
        if (typeof row[15] !== 'number') continue;

        // ── Resolve carrier ──────────────────────────────────────
        // If col[5] has a full name (most rows) use it AND update
        // currentCarrier so End/Canc rows that follow inherit it.
        if (row[5] && typeof row[5] === 'string' && row[5].trim()) {
            currentCarrier = row[5].trim();
        }

        // ── Normalize carrier abbreviations ──────────────────────
        const CARRIER_NORMALIZE = {
            'national g':       'National General',
            'national ge':      'National General',
            'national gen':     'National General',
            'natl general':     'National General',
            'natl gen':         'National General',
        };
        const _cn = (CARRIER_NORMALIZE[currentCarrier.toLowerCase()] || currentCarrier);
        currentCarrier = _cn;
        const carrier = currentCarrier;

        const entry = {
            clientName,
            status:         row[2]  ? row[2].toString().trim()  : '',
            transaction:    row[3]  ? row[3].toString().trim()  : '',
            lob:            row[4]  ? row[4].toString().trim()  : '',
            carrier,
            downPayment:    typeof row[6]  === 'number' ? row[6]  : 0,
            paymentType:    row[8]  ? row[8].toString().trim()  : '',
            basePremium:    typeof row[9]  === 'number' ? row[9]  : (typeof row[10] === 'number' ? row[10] : 0),
            writtenPremium: typeof row[10] === 'number' ? row[10] : 0,
            term:           typeof row[11] === 'number' ? row[11] : '',
            policyNumber:   row[13] != null ? row[13].toString().trim() : '',
            rate:           typeof row[14] === 'number' ? row[14] : 0,
            commission:     row[15],
            agentMatch:     null
        };

        entries.push(entry);
        if (!carrierTotals[carrier]) carrierTotals[carrier] = 0;
        carrierTotals[carrier] += row[15];
    }

    const grossTotal = entries.reduce((s, e) => s + e.commission, 0);
    return { entries, carrierTotals, grossTotal };
}

// ── List & Detail Views ───────────────────────────────────────
function loadCommissionStatementsList() {
    const months = Object.keys(commissionStatements);
    const emptyEl  = document.getElementById('csEmptyState');
    const detailEl = document.getElementById('csDetail');
    const tabsEl   = document.getElementById('csMonthTabs');

    if (!months.length) {
        emptyEl.style.display  = 'block';
        detailEl.style.display = 'none';
        tabsEl.innerHTML = '';
        return;
    }

    emptyEl.style.display = 'none';

    // Sort months chronologically
    const MO_IDX = {january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
    months.sort((a, b) => {
        const parse = s => { const p = s.split(' '); return parseInt(p[1] || 0)*13 + (MO_IDX[p[0].toLowerCase()] || 0); };
        return parse(a) - parse(b);
    });

    if (!csCurrentMonthKey || !commissionStatements[csCurrentMonthKey]) {
        csCurrentMonthKey = months[months.length - 1];
    }

    tabsEl.innerHTML = months.map(m => {
        const stmt = commissionStatements[m];
        const active = m === csCurrentMonthKey;
        return `<button onclick="csSelectMonth('${m.replace(/'/g,'\\\'')}')"
            style="padding:8px 14px;border:1px solid ${active?'var(--primary)':'var(--gray-200)'};
                   border-radius:var(--radius-sm);background:${active?'var(--primary)':'#fff'};
                   color:${active?'#fff':'var(--gray-600)'};font-size:13px;font-weight:${active?'700':'400'};
                   cursor:pointer;line-height:1.4;text-align:center;">
            ${m}
            <span style="display:block;font-size:11px;opacity:0.85;">$${stmt.grossTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </button>`;
    }).join('');

    renderCSMonthDetail(csCurrentMonthKey);
}

function csSelectMonth(monthKey) {
    csCurrentMonthKey = monthKey;
    loadCommissionStatementsList();
}

function renderCSMonthDetail(monthKey) {
    const stmt = commissionStatements[monthKey];
    if (!stmt) return;

    document.getElementById('csDetail').style.display = 'block';

    const matchedCount = stmt.entries.filter(e => e.agentMatch).length;
    const newCount     = stmt.entries.filter(e => /new/i.test(e.transaction)).length;
    const renewalCount = stmt.entries.filter(e => /renewal|renew/i.test(e.transaction)).length;
    const adjCount     = stmt.entries.length - newCount - renewalCount;

    document.getElementById('csGrossTotal').textContent    = '$' + stmt.grossTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('csPolicyCount').textContent   = stmt.entryCount;
    document.getElementById('csCarrierCount2').textContent = Object.keys(stmt.carrierTotals).length;
    document.getElementById('csMatchedCount').textContent  = matchedCount;
    document.getElementById('csNewCount').textContent      = newCount;
    document.getElementById('csRenewalCount').textContent  = renewalCount;

    // Carrier breakdown
    const breakdownBody = document.getElementById('csCarrierBreakdownBody');
    breakdownBody.innerHTML = Object.entries(stmt.carrierTotals)
        .sort((a, b) => b[1] - a[1])
        .map(([carrier, total]) => {
            const cnt = stmt.entries.filter(e => e.carrier === carrier).length;
            const pct = stmt.grossTotal !== 0 ? ((total / stmt.grossTotal) * 100).toFixed(1) : '0.0';
            const barW = Math.abs(pct);
            return `<tr style="border-bottom:1px solid var(--gray-100);">
                <td style="padding:9px 12px;font-weight:600;">${carrier}</td>
                <td style="padding:9px 12px;text-align:center;">${cnt}</td>
                <td style="padding:9px 12px;text-align:right;font-weight:700;color:${total>=0?'#059669':'#dc2626'};">
                    $${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
                </td>
                <td style="padding:9px 12px;min-width:120px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div style="flex:1;height:8px;background:var(--gray-100);border-radius:999px;overflow:hidden;">
                            <div style="height:100%;width:${barW}%;background:#059669;border-radius:999px;"></div>
                        </div>
                        <span style="font-size:11px;color:var(--gray-500);white-space:nowrap;">${pct}%</span>
                    </div>
                </td>
            </tr>`;
        }).join('');

    // Reset filters
    const csCarrFilter = document.getElementById('csCarrierFilter');
    csCarrFilter.innerHTML = '<option value="">All Carriers</option>';
    Object.keys(stmt.carrierTotals).sort().forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c;
        csCarrFilter.appendChild(o);
    });

    const csTxnFilt = document.getElementById('csTxnFilter');
    csTxnFilt.innerHTML = '<option value="">All Types</option>';
    [...new Set(stmt.entries.map(e => e.transaction).filter(Boolean))].sort().forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = t;
        csTxnFilt.appendChild(o);
    });

    renderCSEntries(monthKey);
    if (window.UIBMotion) UIBMotion.animateStatCards();
    refreshIcons();
}

function renderCSEntries(monthKey) {
    const stmt = commissionStatements[monthKey];
    if (!stmt) return;

    const filterCarrier = document.getElementById('csCarrierFilter')?.value  || '';
    const filterTxn     = document.getElementById('csTxnFilter')?.value      || '';
    const filterAgent   = document.getElementById('csAgentMatchFilter')?.value || '';

    let rows = stmt.entries;
    if (filterCarrier) rows = rows.filter(r => r.carrier === filterCarrier);
    if (filterTxn)     rows = rows.filter(r => r.transaction === filterTxn);
    if (filterAgent === 'matched')   rows = rows.filter(r =>  r.agentMatch);
    if (filterAgent === 'unmatched') rows = rows.filter(r => !r.agentMatch);

    const tbody = document.getElementById('csEntriesBody');
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--gray-400);">No entries match the current filters.</td></tr>';
        document.getElementById('csEntryCountLabel').textContent = '';
        return;
    }

    tbody.innerHTML = rows.map((e, i) => {
        const bg = i % 2 === 0 ? '' : 'background:#f9fafb;';
        const tl = e.transaction.toLowerCase();
        const txnColor = tl.includes('new')                       ? '#059669'
                       : (tl.includes('can') || tl.includes('end')) ? '#dc2626'
                       : '#6366f1';
        const commColor = e.commission >= 0 ? '#059669' : '#dc2626';
        const agentBadge = e.agentMatch
            ? `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;">${e.agentMatch}</span>`
            : `<span style="background:#f3f4f6;color:var(--gray-400);padding:2px 8px;border-radius:999px;font-size:11px;">—</span>`;

        return `<tr style="${bg}border-bottom:1px solid var(--gray-100);">
            <td style="padding:8px 10px;font-size:13px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.clientName}">${e.clientName}</td>
            <td style="padding:8px 10px;font-size:12px;color:${txnColor};font-weight:600;">${e.transaction}</td>
            <td style="padding:8px 10px;font-size:12px;">${e.carrier}</td>
            <td style="padding:8px 10px;font-size:12px;color:var(--gray-500);">${e.lob || '—'}</td>
            <td style="padding:8px 10px;font-size:12px;text-align:right;">${e.basePremium>0?'$'+e.basePremium.toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td>
            <td style="padding:8px 10px;font-size:12px;text-align:right;">${e.rate>0?(e.rate*100).toFixed(0)+'%':'—'}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:${commColor};">$${e.commission.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            <td style="padding:8px 10px;">${agentBadge}</td>
        </tr>`;
    }).join('');

    const filteredTotal = rows.reduce((s, r) => s + r.commission, 0);
    document.getElementById('csEntryCountLabel').innerHTML =
        `Showing <strong>${rows.length}</strong> of ${stmt.entryCount} entries &nbsp;|&nbsp; ` +
        `Filtered Total: <strong style="color:#059669;">$${filteredTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong>`;
}

function filterCSEntries() {
    if (csCurrentMonthKey) renderCSEntries(csCurrentMonthKey);
}

function resetCSFilters() {
    ['csCarrierFilter','csTxnFilter','csAgentMatchFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    filterCSEntries();
}

function deleteCSStatement(monthKey) {
    if (!monthKey) return;
    if (!confirm(`Delete the commission statement for ${monthKey}? This cannot be undone.`)) return;
    delete commissionStatements[monthKey];
    saveCommissionStatements();
    csCurrentMonthKey = null;
    loadCommissionStatementsList();
}

// ============================================================
// PRODUCTION DASHBOARD
// ============================================================

let _prodPeriod = 'today';
let _prodView   = 'table';
let _prodSortCol = 'entryDate';
let _prodSortDir = -1; // -1 = descending (newest first)

function showProductionDashboard() {
    const modal = document.getElementById('productionDashboardModal');
    modal.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(modal);

    // Refresh allData from localStorage in case it was updated
    allData = JSON.parse(localStorage.getItem('binderData')) || [];

    // Populate Agent filter — merge from data + registered agents
    const agentsFromData = allData.map(d => d.agent).filter(Boolean);
    const masterAgents   = Object.keys(JSON.parse(localStorage.getItem('agentMasterData'))  || {});
    const credAgents     = Object.keys(JSON.parse(localStorage.getItem('agentCredentials')) || {});
    const agents = [...new Set([...agentsFromData, ...masterAgents, ...credAgents])].sort();
    const agentSel = document.getElementById('prodAgentFilter');
    if (agentSel) agentSel.innerHTML =
        '<option value="">All Agents</option>' +
        agents.map(a => `<option value="${a}">${a}</option>`).join('');

    // Populate LOB filter
    const lobs = [...new Set(allData.map(d => d.lineOfBusiness).filter(Boolean))].sort();
    const lobSel = document.getElementById('prodLOBFilter');
    if (lobSel) lobSel.innerHTML =
        '<option value="">All LOBs</option>' +
        lobs.map(l => `<option value="${l}">${l}</option>`).join('');

    // Populate Location filter
    const locs = [...new Set(allData.map(d => d.location).filter(Boolean))].sort();
    const locSel = document.getElementById('prodLocationFilter');
    if (locSel) locSel.innerHTML =
        '<option value="">All Locations</option>' +
        locs.map(l => `<option value="${l}">${l}</option>`).join('');

    // Set default custom range (first of current month → today)
    const today = getEasternDateString();
    const firstOfMonth = today.slice(0, 7) + '-01';
    const dateFrom = document.getElementById('prodDateFrom');
    const dateTo   = document.getElementById('prodDateTo');
    if (dateFrom) dateFrom.value = firstOfMonth;
    if (dateTo)   dateTo.value   = today;

    // Reset to "today" view
    _prodPeriod  = 'today';
    _prodView    = 'table';
    _prodSortCol = 'entryDate';
    _prodSortDir = -1;
    prodSetPeriod('today');

    refreshIcons();
}

function prodSetPeriod(period) {
    _prodPeriod = period;
    ['today','month','year','all','custom'].forEach(p => {
        const tab = document.getElementById('prodTab_' + p);
        if (tab) tab.className = 'prod-tab' + (p === period ? ' prod-tab-active' : '');
    });
    const customRange = document.getElementById('prodCustomRange');
    if (customRange) customRange.style.display = period === 'custom' ? 'flex' : 'none';
    prodApplyFilters();
}

function prodGetFilteredData() {
    const today = getEasternDateString();
    const year  = today.slice(0, 4);
    const month = today.slice(0, 7);
    const agentF = document.getElementById('prodAgentFilter')?.value    || '';
    const lobF   = document.getElementById('prodLOBFilter')?.value      || '';
    const locF   = document.getElementById('prodLocationFilter')?.value || '';
    const dateFrom = document.getElementById('prodDateFrom')?.value || '';
    const dateTo   = document.getElementById('prodDateTo')?.value   || '';

    return allData.filter(d => {
        const date = (d.entryDate || '').slice(0, 10);
        if (_prodPeriod === 'today'  && date !== today)                return false;
        if (_prodPeriod === 'month'  && !date.startsWith(month))       return false;
        if (_prodPeriod === 'year'   && !date.startsWith(year))        return false;
        if (_prodPeriod === 'custom') {
            if (dateFrom && date < dateFrom) return false;
            if (dateTo   && date > dateTo)   return false;
        }
        if (agentF && d.agent           !== agentF) return false;
        if (lobF   && d.lineOfBusiness  !== lobF)   return false;
        if (locF   && (d.location || '') !== locF)  return false;
        return true;
    });
}

function prodApplyFilters() {
    const data = prodGetFilteredData();
    prodRenderStats(data);

    const sub  = document.getElementById('prodHeaderSub');
    const label = { today:'Today', month:'This Month', year:'This Year', all:'All Time', custom:'Custom Range' }[_prodPeriod] || '';
    if (sub) sub.textContent = `${data.length} polic${data.length === 1 ? 'y' : 'ies'} · ${label}`;

    if (_prodView === 'chart') {
        prodRenderChart(data);
    } else {
        prodRenderTable(data);
    }
}

function prodRenderStats(data) {
    const totalPrem  = data.reduce((s, d) => s + (parseFloat(d.totalPremium) || 0), 0);
    const totalBase  = data.reduce((s, d) => s + (parseFloat(d.basePremium)  || 0), 0);
    const avgPrem    = data.length > 0 ? totalPrem / data.length : 0;
    const agentCount = new Set(data.map(d => d.agent).filter(Boolean)).size;
    const carrCount  = new Set(data.map(d => d.company).filter(Boolean)).size;
    const fmt  = v => '$' + Math.round(v).toLocaleString();
    const fmt2 = v => '$' + v.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });

    document.getElementById('prodStatsRow').innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;">
            <div style="font-size:10px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Total Policies</div>
            <div style="font-size:28px;font-weight:800;color:#0d1f3c;line-height:1;">${data.length.toLocaleString()}</div>
            <div style="font-size:11px;color:#3b82f6;margin-top:4px;">${agentCount} agent${agentCount!==1?'s':''} · ${carrCount} carrier${carrCount!==1?'s':''}</div>
        </div>
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px 18px;">
            <div style="font-size:10px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Total Premium</div>
            <div style="font-size:28px;font-weight:800;color:#0d1f3c;line-height:1;">${fmt(totalPrem)}</div>
            <div style="font-size:11px;color:#059669;margin-top:4px;">Base: ${fmt(totalBase)}</div>
        </div>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 18px;">
            <div style="font-size:10px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Avg Premium</div>
            <div style="font-size:28px;font-weight:800;color:#0d1f3c;line-height:1;">${fmt(avgPrem)}</div>
            <div style="font-size:11px;color:#d97706;margin-top:4px;">per policy</div>
        </div>
        <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 18px;">
            <div style="font-size:10px;font-weight:700;color:#7e22ce;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Top Agent</div>
            <div style="font-size:16px;font-weight:800;color:#0d1f3c;line-height:1.2;">${prodTopAgent(data)}</div>
            <div style="font-size:11px;color:#7c3aed;margin-top:4px;">${prodTopAgentCount(data)} policies</div>
        </div>
    `;
}

function prodTopAgent(data) {
    if (data.length === 0) return '—';
    const counts = {};
    data.forEach(d => { if (d.agent) counts[d.agent] = (counts[d.agent] || 0) + 1; });
    return Object.entries(counts).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';
}
function prodTopAgentCount(data) {
    if (data.length === 0) return 0;
    const counts = {};
    data.forEach(d => { if (d.agent) counts[d.agent] = (counts[d.agent] || 0) + 1; });
    return Object.entries(counts).sort((a,b) => b[1]-a[1])[0]?.[1] || 0;
}

// ── Table View ────────────────────────────────────────────────
function prodRenderTable(data) {
    const sorted = [...data].sort((a, b) => {
        let va, vb;
        if (_prodSortCol === 'totalPremium' || _prodSortCol === 'basePremium') {
            va = parseFloat(a[_prodSortCol]) || 0;
            vb = parseFloat(b[_prodSortCol]) || 0;
        } else {
            va = (a[_prodSortCol] || '').toString().toLowerCase();
            vb = (b[_prodSortCol] || '').toString().toLowerCase();
        }
        if (va < vb) return -1 * _prodSortDir;
        if (va > vb) return  1 * _prodSortDir;
        return 0;
    });

    const th = (col, lbl, align) => {
        const arrow = _prodSortCol === col ? (_prodSortDir === -1 ? ' ↓' : ' ↑') : ' <span style="opacity:.25">↕</span>';
        return `<th onclick="prodSort('${col}')"
            style="padding:10px 12px;text-align:${align||'left'};font-weight:600;color:#334155;cursor:pointer;white-space:nowrap;user-select:none;font-size:12px;">
            ${lbl}${arrow}</th>`;
    };

    const rows = sorted.map(d => {
        const tp   = parseFloat(d.totalPremium) || 0;
        const date = (d.entryDate || '').slice(0,10);
        const disp = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
        const pnum = d.policyNumber || d.binderNumber || '—';
        const lobBadge = d.lineOfBusiness
            ? `<span style="background:#eff6ff;color:#1e40af;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap;">${d.lineOfBusiness}</span>`
            : '—';
        const typeBadge = d.policyType
            ? `<span style="background:${d.policyType==='New'?'#ecfdf5':d.policyType==='Renewal'?'#fff7ed':'#f8fafc'};color:${d.policyType==='New'?'#065f46':d.policyType==='Renewal'?'#9a3412':'#475569'};padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;">${d.policyType}</span>`
            : '—';

        return `<tr style="border-bottom:1px solid #f1f5f9;"
            onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <td style="padding:9px 12px;font-size:12px;color:#64748b;white-space:nowrap;">${disp}</td>
            <td style="padding:9px 12px;font-size:13px;font-weight:600;color:#1e40af;">${d.agent||'—'}</td>
            <td style="padding:9px 12px;font-size:13px;">${d.customerName||'—'}</td>
            <td style="padding:9px 12px;font-size:12px;color:#64748b;font-family:monospace;">${pnum}</td>
            <td style="padding:9px 12px;font-size:12px;">${d.company||'—'}</td>
            <td style="padding:9px 12px;">${lobBadge}</td>
            <td style="padding:9px 12px;">${typeBadge}</td>
            <td style="padding:9px 12px;font-size:12px;color:#64748b;">${d.location||'—'}</td>
            <td style="padding:9px 12px;font-size:13px;font-weight:700;color:#059669;text-align:right;white-space:nowrap;">
                $${tp.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
            </td>
        </tr>`;
    }).join('');

    document.getElementById('prodBody').innerHTML = `
        <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">
            <table style="width:100%;border-collapse:collapse;min-width:820px;">
                <thead>
                    <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
                        ${th('entryDate','Date')}
                        ${th('agent','Agent')}
                        ${th('customerName','Client Name')}
                        ${th('policyNumber','Policy #')}
                        ${th('company','Carrier')}
                        ${th('lineOfBusiness','LOB')}
                        ${th('policyType','Type')}
                        ${th('location','Location')}
                        ${th('totalPremium','Premium','right')}
                    </tr>
                </thead>
                <tbody>
                    ${rows || '<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8;font-size:14px;">No policies found for this period.</td></tr>'}
                </tbody>
            </table>
        </div>
        <p style="margin-top:10px;font-size:12px;color:#94a3b8;text-align:center;">
            ${sorted.length} result${sorted.length!==1?'s':''} · Click any column header to sort
        </p>
    `;
    refreshIcons();
}

function prodSort(col) {
    if (_prodSortCol === col) {
        _prodSortDir *= -1;
    } else {
        _prodSortCol = col;
        _prodSortDir = (col === 'totalPremium' || col === 'basePremium' || col === 'entryDate') ? -1 : 1;
    }
    prodRenderTable(prodGetFilteredData());
}

function prodSwitchView(view) {
    _prodView = view;
    const tBtn = document.getElementById('prodViewTable');
    const cBtn = document.getElementById('prodViewChart');
    if (tBtn) tBtn.className = (view === 'table' ? 'btn-primary' : 'btn-secondary') + ' btn-sm';
    if (cBtn) cBtn.className = (view === 'chart' ? 'btn-primary' : 'btn-secondary') + ' btn-sm';
    prodApplyFilters();
}

// ── Chart View ────────────────────────────────────────────────
function prodRenderChart(data) {
    const body     = document.getElementById('prodBody');
    const groupBy  = document.getElementById('prodChartGroupBy')?.value  || 'agent';
    const metric   = document.getElementById('prodChartMetric')?.value   || 'premium';

    // Build grouped data
    const groups = {};
    data.forEach(d => {
        let key;
        switch (groupBy) {
            case 'agent':      key = d.agent           || 'Unknown'; break;
            case 'carrier':    key = d.company          || 'Unknown'; break;
            case 'lob':        key = d.lineOfBusiness   || 'Unknown'; break;
            case 'location':   key = d.location         || 'No Location'; break;
            case 'policyType': key = d.policyType       || 'Unknown'; break;
            case 'day':
                key = d.entryDate
                    ? new Date(d.entryDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
                    : 'Unknown';
                break;
            case 'month':
                key = d.entryDate ? d.entryDate.slice(0, 7) : 'Unknown';
                break;
            default: key = d.agent || 'Unknown';
        }
        if (!groups[key]) groups[key] = { premium: 0, count: 0 };
        groups[key].premium += parseFloat(d.totalPremium) || 0;
        groups[key].count   += 1;
    });

    let barData = Object.entries(groups).map(([label, g]) => {
        const value = metric === 'count' ? g.count : metric === 'avg' ? (g.count > 0 ? g.premium / g.count : 0) : g.premium;
        return { label, value, count: g.count, premium: g.premium };
    });

    // Sort: chronological for day/month, by value otherwise
    if (groupBy === 'day' || groupBy === 'month') {
        barData.sort((a, b) => a.label < b.label ? -1 : 1);
    } else {
        barData.sort((a, b) => b.value - a.value);
    }

    const maxVal   = Math.max(...barData.map(b => b.value), 1);
    const fmtVal   = v => metric === 'count' ? v.toLocaleString() : ('$' + Math.round(v).toLocaleString());
    const metricLbl = { premium:'Total Premium ($)', count:'Number of Policies', avg:'Avg Premium ($)' }[metric] || metric;
    const groupLbl  = { agent:'Agent', carrier:'Carrier', lob:'Line of Business', location:'Location', policyType:'Policy Type', day:'Day', month:'Month' }[groupBy] || groupBy;
    const palette   = ['#1d4ed8','#059669','#7c3aed','#dc2626','#d97706','#0891b2','#be185d','#065f46','#7c2d12','#1e3a5f','#4338ca','#0f766e'];

    const barHTML = barData.length === 0
        ? '<div style="text-align:center;padding:60px;color:#94a3b8;font-size:14px;">No data for this period.</div>'
        : barData.map((b, i) => {
            const pct   = Math.max((b.value / maxVal) * 100, 2).toFixed(1);
            const color = palette[i % palette.length];
            return `<div class="prod-bar-row">
                <div class="prod-bar-label" title="${b.label}">${b.label}</div>
                <div class="prod-bar-track">
                    <div class="prod-bar-fill" style="width:${pct}%;background:${color};">
                        <span>${fmtVal(b.value)}</span>
                    </div>
                </div>
                <div class="prod-bar-count">${b.count} polic${b.count!==1?'ies':'y'}</div>
            </div>`;
        }).join('');

    body.innerHTML = `
        <!-- Chart controls -->
        <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:20px;">
            <div style="display:flex;align-items:center;gap:8px;">
                <label style="font-size:13px;font-weight:700;color:#334155;white-space:nowrap;">Group by:</label>
                <select id="prodChartGroupBy" onchange="prodApplyFilters()"
                    style="padding:7px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;min-width:160px;cursor:pointer;">
                    <option value="agent"      ${groupBy==='agent'      ?'selected':''}>Agent</option>
                    <option value="carrier"    ${groupBy==='carrier'    ?'selected':''}>Carrier</option>
                    <option value="lob"        ${groupBy==='lob'        ?'selected':''}>Line of Business</option>
                    <option value="policyType" ${groupBy==='policyType' ?'selected':''}>Policy Type</option>
                    <option value="location"   ${groupBy==='location'   ?'selected':''}>Location</option>
                    <option value="day"        ${groupBy==='day'        ?'selected':''}>Day</option>
                    <option value="month"      ${groupBy==='month'      ?'selected':''}>Month</option>
                </select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <label style="font-size:13px;font-weight:700;color:#334155;white-space:nowrap;">Show:</label>
                <select id="prodChartMetric" onchange="prodApplyFilters()"
                    style="padding:7px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;min-width:180px;cursor:pointer;">
                    <option value="premium" ${metric==='premium'?'selected':''}>Total Premium ($)</option>
                    <option value="count"   ${metric==='count'  ?'selected':''}>Number of Policies</option>
                    <option value="avg"     ${metric==='avg'    ?'selected':''}>Average Premium ($)</option>
                </select>
            </div>
            <div style="margin-left:auto;font-size:12px;color:#94a3b8;">${barData.length} group${barData.length!==1?'s':''} · ${data.length} polic${data.length!==1?'ies':'y'}</div>
        </div>

        <!-- Chart title -->
        <h4 style="font-size:14px;font-weight:700;color:#0d1f3c;margin:0 0 16px;">
            <i data-lucide="bar-chart-2" style="width:15px;height:15px;vertical-align:-2px;"></i>
            ${metricLbl} <span style="color:#64748b;font-weight:500;">by</span> ${groupLbl}
        </h4>

        <!-- Bars -->
        <div style="padding-bottom:12px;">${barHTML}</div>
    `;
    refreshIcons();
}

// ── Export ────────────────────────────────────────────────────
function prodExportCSV() {
    const data = prodGetFilteredData();
    if (data.length === 0) { alert('No data to export for this period.'); return; }

    const headers = ['Date','Agent','Client Name','Policy #','Binder #','Carrier','LOB','Policy Type','Location','Down','Agency Fee','Base Premium','Total Premium','Payment Type'];
    const rows = data.map(d => [
        d.entryDate         || '',
        d.agent             || '',
        d.customerName      || '',
        d.policyNumber      || '',
        d.binderNumber      || '',
        d.company           || '',
        d.lineOfBusiness    || '',
        d.policyType        || '',
        d.location          || '',
        d.down              || 0,
        d.agencyFee         || 0,
        d.basePremium       || 0,
        d.totalPremium      || 0,
        d.paymentType       || ''
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));

    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `production_${_prodPeriod}_${getEasternDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================
// INLINE PRODUCTION DASHBOARD (agent page — apd_ prefix)
// ============================================================

let _apdPeriod  = 'today';
let _apdView    = 'table';
let _apdSortCol = 'entryDate';
let _apdSortDir = -1;

function apdInit() {
    // Refresh allData
    allData = JSON.parse(localStorage.getItem('binderData')) || [];

    // Populate Agent filter
    const agents = [...new Set(allData.map(d => d.agent).filter(Boolean))].sort();
    const agentSel = document.getElementById('apd_agentFilter');
    if (agentSel) agentSel.innerHTML =
        '<option value="">All Agents</option>' +
        agents.map(a => `<option value="${a}">${a}</option>`).join('');

    // Populate LOB filter
    const lobs = [...new Set(allData.map(d => d.lineOfBusiness).filter(Boolean))].sort();
    const lobSel = document.getElementById('apd_lobFilter');
    if (lobSel) lobSel.innerHTML =
        '<option value="">All LOBs</option>' +
        lobs.map(l => `<option value="${l}">${l}</option>`).join('');

    // Populate Location filter
    const locs = [...new Set(allData.map(d => d.location).filter(Boolean))].sort();
    const locSel = document.getElementById('apd_locationFilter');
    if (locSel) locSel.innerHTML =
        '<option value="">All Locations</option>' +
        locs.map(l => `<option value="${l}">${l}</option>`).join('');

    // Default custom range
    const today = getEasternDateString();
    const firstOfMonth = today.slice(0, 7) + '-01';
    const dFrom = document.getElementById('apd_dateFrom');
    const dTo   = document.getElementById('apd_dateTo');
    if (dFrom && !dFrom.value) dFrom.value = firstOfMonth;
    if (dTo   && !dTo.value)   dTo.value   = today;

    _apdPeriod  = 'today';
    _apdView    = 'table';
    _apdSortCol = 'entryDate';
    _apdSortDir = -1;

    apdSetPeriod('today');
    refreshIcons();
}

function apdSetPeriod(period) {
    _apdPeriod = period;
    ['today','month','year','all','custom'].forEach(p => {
        const tab = document.getElementById('apd_tab_' + p);
        if (tab) tab.className = 'prod-tab' + (p === period ? ' prod-tab-active' : '');
    });
    const cr = document.getElementById('apd_customRange');
    if (cr) cr.style.display = period === 'custom' ? 'flex' : 'none';
    apdApplyFilters();
}

function apdGetFilteredData() {
    const today  = getEasternDateString();
    const year   = today.slice(0, 4);
    const month  = today.slice(0, 7);
    const agentF = document.getElementById('apd_agentFilter')?.value    || '';
    const lobF   = document.getElementById('apd_lobFilter')?.value      || '';
    const locF   = document.getElementById('apd_locationFilter')?.value || '';
    const dFrom  = document.getElementById('apd_dateFrom')?.value || '';
    const dTo    = document.getElementById('apd_dateTo')?.value   || '';

    return allData.filter(d => {
        const date = (d.entryDate || '').slice(0, 10);
        if (_apdPeriod === 'today'  && date !== today)            return false;
        if (_apdPeriod === 'month'  && !date.startsWith(month))   return false;
        if (_apdPeriod === 'year'   && !date.startsWith(year))    return false;
        if (_apdPeriod === 'custom') {
            if (dFrom && date < dFrom) return false;
            if (dTo   && date > dTo)   return false;
        }
        if (agentF && d.agent           !== agentF) return false;
        if (lobF   && d.lineOfBusiness  !== lobF)   return false;
        if (locF   && (d.location || '') !== locF)  return false;
        return true;
    });
}

function apdApplyFilters() {
    const data = apdGetFilteredData();
    apdRenderStats(data);

    const sub   = document.getElementById('apd_headerSub');
    const label = { today:'Today', month:'This Month', year:'This Year', all:'All Time', custom:'Custom Range' }[_apdPeriod] || '';
    if (sub) sub.textContent = `${data.length} polic${data.length === 1 ? 'y' : 'ies'} · ${label}`;

    if (_apdView === 'chart') {
        apdRenderChart(data);
    } else {
        apdRenderTable(data);
    }
}

function apdRenderStats(data) {
    const totalPrem  = data.reduce((s, d) => s + (parseFloat(d.totalPremium) || 0), 0);
    const totalBase  = data.reduce((s, d) => s + (parseFloat(d.basePremium)  || 0), 0);
    const avgPrem    = data.length > 0 ? totalPrem / data.length : 0;
    const agentCount = new Set(data.map(d => d.agent).filter(Boolean)).size;
    const carrCount  = new Set(data.map(d => d.company).filter(Boolean)).size;
    const fmt = v => '$' + Math.round(v).toLocaleString();

    document.getElementById('apd_statsRow').innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;">
            <div style="font-size:10px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Total Policies</div>
            <div style="font-size:26px;font-weight:800;color:#0d1f3c;line-height:1;">${data.length.toLocaleString()}</div>
            <div style="font-size:11px;color:#3b82f6;margin-top:3px;">${agentCount} agent${agentCount!==1?'s':''} · ${carrCount} carrier${carrCount!==1?'s':''}</div>
        </div>
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:12px 16px;">
            <div style="font-size:10px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Total Premium</div>
            <div style="font-size:26px;font-weight:800;color:#0d1f3c;line-height:1;">${fmt(totalPrem)}</div>
            <div style="font-size:11px;color:#059669;margin-top:3px;">Base: ${fmt(totalBase)}</div>
        </div>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;">
            <div style="font-size:10px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Avg Premium</div>
            <div style="font-size:26px;font-weight:800;color:#0d1f3c;line-height:1;">${fmt(avgPrem)}</div>
            <div style="font-size:11px;color:#d97706;margin-top:3px;">per policy</div>
        </div>
        <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:10px;padding:12px 16px;">
            <div style="font-size:10px;font-weight:700;color:#7e22ce;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Top Agent</div>
            <div style="font-size:16px;font-weight:800;color:#0d1f3c;line-height:1.2;">${prodTopAgent(data)}</div>
            <div style="font-size:11px;color:#7c3aed;margin-top:3px;">${prodTopAgentCount(data)} policies</div>
        </div>
    `;
}

function apdRenderTable(data) {
    const sorted = [...data].sort((a, b) => {
        let va, vb;
        if (_apdSortCol === 'totalPremium' || _apdSortCol === 'basePremium') {
            va = parseFloat(a[_apdSortCol]) || 0;
            vb = parseFloat(b[_apdSortCol]) || 0;
        } else {
            va = (a[_apdSortCol] || '').toString().toLowerCase();
            vb = (b[_apdSortCol] || '').toString().toLowerCase();
        }
        if (va < vb) return -1 * _apdSortDir;
        if (va > vb) return  1 * _apdSortDir;
        return 0;
    });

    const th = (col, lbl, align) => {
        const arrow = _apdSortCol === col ? (_apdSortDir === -1 ? ' ↓' : ' ↑') : ' <span style="opacity:.25">↕</span>';
        return `<th onclick="apdSort('${col}')"
            style="padding:10px 12px;text-align:${align||'left'};font-weight:600;color:#334155;cursor:pointer;white-space:nowrap;user-select:none;font-size:12px;">
            ${lbl}${arrow}</th>`;
    };

    const rows = sorted.map(d => {
        const tp   = parseFloat(d.totalPremium) || 0;
        const date = (d.entryDate || '').slice(0,10);
        const disp = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
        const pnum = d.policyNumber || d.binderNumber || '—';
        const lobBadge = d.lineOfBusiness
            ? `<span style="background:#eff6ff;color:#1e40af;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap;">${d.lineOfBusiness}</span>`
            : '—';
        const typeBadge = d.policyType
            ? `<span style="background:${d.policyType==='New'?'#ecfdf5':d.policyType==='Renewal'?'#fff7ed':'#f8fafc'};color:${d.policyType==='New'?'#065f46':d.policyType==='Renewal'?'#9a3412':'#475569'};padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;">${d.policyType}</span>`
            : '—';
        return `<tr style="border-bottom:1px solid #f1f5f9;"
            onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
            <td style="padding:9px 12px;font-size:12px;color:#64748b;white-space:nowrap;">${disp}</td>
            <td style="padding:9px 12px;font-size:13px;font-weight:600;color:#1e40af;">${d.agent||'—'}</td>
            <td style="padding:9px 12px;font-size:13px;">${d.customerName||'—'}</td>
            <td style="padding:9px 12px;font-size:12px;color:#64748b;font-family:monospace;">${pnum}</td>
            <td style="padding:9px 12px;font-size:12px;">${d.company||'—'}</td>
            <td style="padding:9px 12px;">${lobBadge}</td>
            <td style="padding:9px 12px;">${typeBadge}</td>
            <td style="padding:9px 12px;font-size:12px;color:#64748b;">${d.location||'—'}</td>
            <td style="padding:9px 12px;font-size:13px;font-weight:700;color:#059669;text-align:right;white-space:nowrap;">
                $${tp.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
            </td>
        </tr>`;
    }).join('');

    document.getElementById('apd_body').innerHTML = `
        <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">
            <table style="width:100%;border-collapse:collapse;min-width:820px;">
                <thead>
                    <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
                        ${th('entryDate','Date')}
                        ${th('agent','Agent')}
                        ${th('customerName','Client Name')}
                        ${th('policyNumber','Policy #')}
                        ${th('company','Carrier')}
                        ${th('lineOfBusiness','LOB')}
                        ${th('policyType','Type')}
                        ${th('location','Location')}
                        ${th('totalPremium','Premium','right')}
                    </tr>
                </thead>
                <tbody>
                    ${rows || '<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8;font-size:14px;">No policies found for this period.</td></tr>'}
                </tbody>
            </table>
        </div>
        <p style="margin-top:10px;font-size:12px;color:#94a3b8;text-align:center;">
            ${sorted.length} result${sorted.length!==1?'s':''} · Click any column header to sort
        </p>
    `;
    refreshIcons();
}

function apdSort(col) {
    if (_apdSortCol === col) {
        _apdSortDir *= -1;
    } else {
        _apdSortCol = col;
        _apdSortDir = (col === 'totalPremium' || col === 'basePremium' || col === 'entryDate') ? -1 : 1;
    }
    apdRenderTable(apdGetFilteredData());
}

function apdSwitchView(view) {
    _apdView = view;
    const tBtn = document.getElementById('apd_viewTable');
    const cBtn = document.getElementById('apd_viewChart');
    if (tBtn) tBtn.className = (view === 'table' ? 'btn-primary' : 'btn-secondary') + ' btn-sm';
    if (cBtn) cBtn.className = (view === 'chart' ? 'btn-primary' : 'btn-secondary') + ' btn-sm';
    apdApplyFilters();
}

function apdRenderChart(data) {
    const body    = document.getElementById('apd_body');
    const groupBy = document.getElementById('apd_chartGroupBy')?.value || 'agent';
    const metric  = document.getElementById('apd_chartMetric')?.value  || 'premium';

    const groups = {};
    data.forEach(d => {
        let key;
        switch (groupBy) {
            case 'agent':      key = d.agent           || 'Unknown'; break;
            case 'carrier':    key = d.company          || 'Unknown'; break;
            case 'lob':        key = d.lineOfBusiness   || 'Unknown'; break;
            case 'location':   key = d.location         || 'No Location'; break;
            case 'policyType': key = d.policyType       || 'Unknown'; break;
            case 'day':
                key = d.entryDate
                    ? new Date(d.entryDate + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
                    : 'Unknown';
                break;
            case 'month':
                key = d.entryDate ? d.entryDate.slice(0, 7) : 'Unknown';
                break;
            default: key = d.agent || 'Unknown';
        }
        if (!groups[key]) groups[key] = { premium: 0, count: 0 };
        groups[key].premium += parseFloat(d.totalPremium) || 0;
        groups[key].count   += 1;
    });

    let barData = Object.entries(groups).map(([label, g]) => {
        const value = metric === 'count' ? g.count : metric === 'avg' ? (g.count > 0 ? g.premium / g.count : 0) : g.premium;
        return { label, value, count: g.count, premium: g.premium };
    });

    if (groupBy === 'day' || groupBy === 'month') {
        barData.sort((a, b) => a.label < b.label ? -1 : 1);
    } else {
        barData.sort((a, b) => b.value - a.value);
    }

    const maxVal    = Math.max(...barData.map(b => b.value), 1);
    const fmtVal    = v => metric === 'count' ? v.toLocaleString() : ('$' + Math.round(v).toLocaleString());
    const metricLbl = { premium:'Total Premium ($)', count:'Number of Policies', avg:'Avg Premium ($)' }[metric] || metric;
    const groupLbl  = { agent:'Agent', carrier:'Carrier', lob:'Line of Business', location:'Location', policyType:'Policy Type', day:'Day', month:'Month' }[groupBy] || groupBy;
    const palette   = ['#1d4ed8','#059669','#7c3aed','#dc2626','#d97706','#0891b2','#be185d','#065f46','#7c2d12','#1e3a5f','#4338ca','#0f766e'];

    const barHTML = barData.length === 0
        ? '<div style="text-align:center;padding:60px;color:#94a3b8;font-size:14px;">No data for this period.</div>'
        : barData.map((b, i) => {
            const pct   = Math.max((b.value / maxVal) * 100, 2).toFixed(1);
            const color = palette[i % palette.length];
            return `<div class="prod-bar-row">
                <div class="prod-bar-label" title="${b.label}">${b.label}</div>
                <div class="prod-bar-track">
                    <div class="prod-bar-fill" style="width:${pct}%;background:${color};">
                        <span>${fmtVal(b.value)}</span>
                    </div>
                </div>
                <div class="prod-bar-count">${b.count} polic${b.count!==1?'ies':'y'}</div>
            </div>`;
        }).join('');

    body.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:20px;">
            <div style="display:flex;align-items:center;gap:8px;">
                <label style="font-size:13px;font-weight:700;color:#334155;white-space:nowrap;">Group by:</label>
                <select id="apd_chartGroupBy" onchange="apdApplyFilters()"
                    style="padding:7px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;min-width:160px;cursor:pointer;">
                    <option value="agent"      ${groupBy==='agent'      ?'selected':''}>Agent</option>
                    <option value="carrier"    ${groupBy==='carrier'    ?'selected':''}>Carrier</option>
                    <option value="lob"        ${groupBy==='lob'        ?'selected':''}>Line of Business</option>
                    <option value="policyType" ${groupBy==='policyType' ?'selected':''}>Policy Type</option>
                    <option value="location"   ${groupBy==='location'   ?'selected':''}>Location</option>
                    <option value="day"        ${groupBy==='day'        ?'selected':''}>Day</option>
                    <option value="month"      ${groupBy==='month'      ?'selected':''}>Month</option>
                </select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <label style="font-size:13px;font-weight:700;color:#334155;white-space:nowrap;">Show:</label>
                <select id="apd_chartMetric" onchange="apdApplyFilters()"
                    style="padding:7px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;min-width:180px;cursor:pointer;">
                    <option value="premium" ${metric==='premium'?'selected':''}>Total Premium ($)</option>
                    <option value="count"   ${metric==='count'  ?'selected':''}>Number of Policies</option>
                    <option value="avg"     ${metric==='avg'    ?'selected':''}>Average Premium ($)</option>
                </select>
            </div>
            <div style="margin-left:auto;font-size:12px;color:#94a3b8;">${barData.length} group${barData.length!==1?'s':''} · ${data.length} polic${data.length!==1?'ies':'y'}</div>
        </div>
        <h4 style="font-size:14px;font-weight:700;color:#0d1f3c;margin:0 0 16px;">
            <i data-lucide="bar-chart-2" style="width:15px;height:15px;vertical-align:-2px;"></i>
            ${metricLbl} <span style="color:#64748b;font-weight:500;">by</span> ${groupLbl}
        </h4>
        <div style="padding-bottom:12px;">${barHTML}</div>
    `;
    refreshIcons();
}

function apdExportCSV() {
    const data = apdGetFilteredData();
    if (data.length === 0) { alert('No data to export for this period.'); return; }

    const headers = ['Date','Agent','Client Name','Policy #','Binder #','Carrier','LOB','Policy Type','Location','Down','Agency Fee','Base Premium','Total Premium','Payment Type'];
    const rows = data.map(d => [
        d.entryDate         || '',
        d.agent             || '',
        d.customerName      || '',
        d.policyNumber      || '',
        d.binderNumber      || '',
        d.company           || '',
        d.lineOfBusiness    || '',
        d.policyType        || '',
        d.location          || '',
        d.down              || 0,
        d.agencyFee         || 0,
        d.basePremium       || 0,
        d.totalPremium      || 0,
        d.paymentType       || ''
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));

    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `production_agent_${_apdPeriod}_${getEasternDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Binder Book May 26 Bulk Import ───────────────────────────────────────────
async function importBinderMay26Data() {
    const confirmed = confirm(
        'Import Binder Book May 26 entries?\n\n' +
        '• 40 policy entries (May 2026)\n' +
        '• Agents: Uriel Rendon, Lazaro Reigosa Cruz, Amanda Montano, Randy Diaz\n' +
        '• Personal Auto, Commercial, and other lines\n' +
        '• Existing entries with matching IDs will be skipped (safe to re-run)\n\n' +
        'Click OK to proceed.'
    );
    if (!confirmed) return;

    let importData;
    try {
        const resp = await fetch('binder_may26_import.json?v=20260524');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        importData = await resp.json();
    } catch (err) {
        alert('Failed to load binder_may26_import.json: ' + err.message);
        return;
    }

    let existing = [];
    try { existing = JSON.parse(localStorage.getItem('binderData')) || []; } catch (e) { existing = []; }

    const existingIds = new Set(existing.map(e => e.id));
    const newEntries  = importData.filter(e => !existingIds.has(e.id));

    if (newEntries.length === 0) {
        alert('All Binder Book May 26 entries already exist. Nothing was imported.');
        return;
    }

    const merged = [...existing, ...newEntries];
    localStorage.setItem('binderData', JSON.stringify(merged));
    allData = merged;

    alert(
        `✅ Import complete!\n\n` +
        `• ${newEntries.length} new entries added\n` +
        `• ${importData.length - newEntries.length} duplicates skipped\n` +
        `• Total records now: ${merged.length}`
    );

    if (typeof loadAdminData === 'function') loadAdminData();
    if (typeof apdInit     === 'function') apdInit();
    if (typeof prodApplyFilters === 'function') prodApplyFilters();
}

// ── Jorge Castro Bulk Import ─────────────────────────────────────────────────
async function importJorgeCastroData() {
    const confirmed = confirm(
        'Import Jorge Castro commission data?\n\n' +
        '• 3,428 policy entries (Jun 2023 – Apr 2026)\n' +
        '• Location: Doral\n' +
        '• Existing entries with matching IDs will be skipped (safe to re-run)\n\n' +
        'Click OK to proceed.'
    );
    if (!confirmed) return;

    let importData;
    try {
        const resp = await fetch('jorge_import.json?v=20260522');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        importData = await resp.json();
    } catch (err) {
        alert('Failed to load jorge_import.json: ' + err.message);
        return;
    }

    // Load current binderData
    let existing = [];
    try {
        existing = JSON.parse(localStorage.getItem('binderData')) || [];
    } catch (e) {
        existing = [];
    }

    // Deduplicate by ID
    const existingIds = new Set(existing.map(e => e.id));
    const newEntries  = importData.filter(e => !existingIds.has(e.id));

    if (newEntries.length === 0) {
        alert('All Jorge Castro entries already exist in the system. Nothing was imported.');
        return;
    }

    const merged = [...existing, ...newEntries];
    localStorage.setItem('binderData', JSON.stringify(merged));
    allData = merged;

    alert(
        `✅ Import complete!\n\n` +
        `• ${newEntries.length} new entries added\n` +
        `• ${importData.length - newEntries.length} duplicates skipped\n` +
        `• Total records now: ${merged.length}`
    );

    // Refresh admin view if active
    if (typeof loadAdminData === 'function') loadAdminData();
    if (typeof apdInit     === 'function') apdInit();
    if (typeof prodApplyFilters === 'function') prodApplyFilters();
}

// ============================================================
// BINDER FILE SYSTEM — IndexedDB integration with UIB AMS
// Shares the same 'UIB_AMS_Files' DB as ams.html so files
// uploaded here are visible in the AMS client view and vice versa.
// ============================================================

let binderDB = null;
let _binderFileModalClientKey = '';
let _binderFileModalEntryId   = null;
let _binderFileIsPendingMode  = false;
let _pendingEntryFiles        = [];   // files queued for a new entry not yet saved

// ── DB helpers ───────────────────────────────────────────────

function binderInitDB() {
    return new Promise((resolve) => {
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
        req.onsuccess = e => { binderDB = e.target.result; resolve(binderDB); };
        req.onerror   = e => { console.warn('Binder IndexedDB error:', e.target.error); resolve(null); };
    });
}

function binderClientKey(name) {
    return (name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function binderDBGetFiles(clientKey) {
    return new Promise((resolve) => {
        if (!binderDB) { resolve([]); return; }
        const tx  = binderDB.transaction('files', 'readonly');
        const req = tx.objectStore('files').index('clientKey').getAll(clientKey);
        req.onsuccess = e => resolve(e.target.result || []);
        req.onerror   = () => resolve([]);
    });
}

function binderDBAddFile(record) {
    return new Promise((resolve, reject) => {
        if (!binderDB) { reject('DB not ready'); return; }
        const tx  = binderDB.transaction('files', 'readwrite');
        const req = tx.objectStore('files').add(record);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function binderDBDeleteFile(id) {
    return new Promise((resolve, reject) => {
        if (!binderDB) { reject('DB not ready'); return; }
        const tx  = binderDB.transaction('files', 'readwrite');
        const req = tx.objectStore('files').delete(id);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
    });
}

// ── Modal helpers ─────────────────────────────────────────────

/** Open the file modal for a SAVED entry (admin or agent table row) */
function binderOpenFileModal(entryId, customerName) {
    _binderFileIsPendingMode  = false;
    _binderFileModalClientKey = binderClientKey(customerName);
    _binderFileModalEntryId   = entryId;
    document.getElementById('binderFileClientNameText').textContent = customerName;
    document.getElementById('binderFileInput').value  = '';
    document.getElementById('binderUploadStatus').style.display = 'none';
    const modal = document.getElementById('binderFileModal');
    modal.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(modal);
    refreshIcons();
    binderLoadFileList();
}

/** Open the file modal from the NEW ENTRY FORM before saving */
function binderOpenPendingFileModal() {
    _binderFileIsPendingMode = true;
    _binderFileModalEntryId  = null;
    const name = (document.getElementById('customerName')?.value || '').trim();
    _binderFileModalClientKey = binderClientKey(name);
    document.getElementById('binderFileClientNameText').textContent = name || '(Enter customer name in form first)';
    document.getElementById('binderFileInput').value  = '';
    document.getElementById('binderUploadStatus').style.display = 'none';
    const modal = document.getElementById('binderFileModal');
    modal.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(modal);
    refreshIcons();
    binderShowPendingFiles();
}

function binderCloseFileModal() {
    document.getElementById('binderFileModal').classList.remove('active');
}

// ── File list rendering ───────────────────────────────────────

async function binderLoadFileList() {
    if (_binderFileIsPendingMode) { binderShowPendingFiles(); return; }
    const container = document.getElementById('binderFileList');
    container.innerHTML = '<div style="color:#9ca3af;font-style:italic;text-align:center;padding:16px;">Loading files…</div>';
    if (!binderDB) await binderInitDB();
    const files = await binderDBGetFiles(_binderFileModalClientKey);
    if (files.length === 0) {
        container.innerHTML = '<div style="color:#9ca3af;font-style:italic;text-align:center;padding:16px;">No files uploaded for this client yet.</div>';
        return;
    }
    container.innerHTML = files.map(f => `
        <div style="display:flex;align-items:center;gap:6px;padding:8px 6px;border-bottom:1px solid #e5e7eb;font-size:13px;">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(f.name)}">📄 ${escHtml(f.name)}</span>
            <span style="color:#6b7280;font-size:12px;white-space:nowrap;padding:2px 6px;background:#f3f4f6;border-radius:4px;">${escHtml(f.category || 'Other')}</span>
            <span style="color:#9ca3af;font-size:11px;white-space:nowrap;">${new Date(f.uploadedAt).toLocaleDateString()}</span>
            <button class="btn-primary btn-sm" onclick="binderDownloadFile(${f.id})" style="padding:3px 8px;font-size:11px;" title="Download">⬇️</button>
            <button class="btn-danger btn-sm" onclick="binderDeleteFile(${f.id})" style="padding:3px 8px;font-size:11px;" title="Delete">🗑️</button>
        </div>
    `).join('');
}

function binderShowPendingFiles() {
    const container = document.getElementById('binderFileList');
    if (_pendingEntryFiles.length === 0) {
        container.innerHTML = '<div style="color:#9ca3af;font-style:italic;text-align:center;padding:16px;">No files queued yet. Select files below — they\'ll be saved when you save the entry.</div>';
        return;
    }
    container.innerHTML = _pendingEntryFiles.map((pf, i) => `
        <div style="display:flex;align-items:center;gap:6px;padding:8px 6px;border-bottom:1px solid #e5e7eb;font-size:13px;">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(pf.name)}">📄 ${escHtml(pf.name)}</span>
            <span style="color:#6b7280;font-size:12px;white-space:nowrap;padding:2px 6px;background:#f3f4f6;border-radius:4px;">${escHtml(pf.category)}</span>
            <span style="color:#9ca3af;font-size:11px;white-space:nowrap;">${(pf.size / 1024).toFixed(1)} KB</span>
            <button class="btn-danger btn-sm" onclick="binderRemovePendingFile(${i})" style="padding:3px 8px;font-size:11px;" title="Remove">🗑️</button>
        </div>
    `).join('');
}

function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Upload (saved entries) ────────────────────────────────────

async function binderDoUpload() {
    if (_binderFileIsPendingMode) { binderAddPendingFiles(); return; }

    const fileInput = document.getElementById('binderFileInput');
    const category  = document.getElementById('binderFileCategory').value;
    const statusDiv = document.getElementById('binderUploadStatus');
    const uploadBtn = document.getElementById('binderUploadBtn');
    const files     = fileInput.files;

    if (!files || files.length === 0) { alert('Please select at least one file to upload.'); return; }
    if (!binderDB) await binderInitDB();

    uploadBtn.disabled    = true;
    uploadBtn.textContent = 'Uploading…';
    statusDiv.style.display = 'none';

    let uploaded = 0;
    for (const file of files) {
        try {
            const buffer = await file.arrayBuffer();
            await binderDBAddFile({
                clientKey:  _binderFileModalClientKey,
                name:       file.name,
                path:       '',
                fullPath:   file.name,
                type:       file.type || 'application/octet-stream',
                size:       file.size,
                category:   category,
                uploadedAt: new Date().toISOString(),
                uploadedBy: currentUser || 'Agent',
                data:       buffer
            });
            uploaded++;
        } catch (err) {
            console.warn('Failed to upload:', file.name, err);
        }
    }

    uploadBtn.disabled     = false;
    uploadBtn.innerHTML    = '<i data-lucide="upload"></i> Upload Files';
    fileInput.value        = '';
    statusDiv.style.display = 'block';
    statusDiv.textContent  = `✅ ${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded successfully!`;
    refreshIcons();
    await binderLoadFileList();
    if (_binderFileModalEntryId) binderUpdateFileBadge(_binderFileModalEntryId, _binderFileModalClientKey);
}

// ── Queue files for pending new entry ────────────────────────

function binderAddPendingFiles() {
    const fileInput = document.getElementById('binderFileInput');
    const category  = document.getElementById('binderFileCategory').value;
    const statusDiv = document.getElementById('binderUploadStatus');
    const files     = fileInput.files;

    if (!files || files.length === 0) { alert('Please select at least one file.'); return; }

    for (const file of files) {
        _pendingEntryFiles.push({ file, name: file.name, category, size: file.size });
    }
    fileInput.value = '';
    statusDiv.style.display = 'block';
    statusDiv.textContent   = `✅ ${files.length} file${files.length !== 1 ? 's' : ''} queued — will upload when you save the entry.`;
    binderShowPendingFiles();
    binderUpdateAttachButton();
}

function binderRemovePendingFile(index) {
    _pendingEntryFiles.splice(index, 1);
    binderShowPendingFiles();
    binderUpdateAttachButton();
}

function binderUpdateAttachButton() {
    const btn   = document.getElementById('binderAttachBtn');
    const badge = document.getElementById('binderAttachBadge');
    if (!btn) return;
    const count = _pendingEntryFiles.length;
    if (count > 0) {
        btn.innerHTML = `📎 ${count} File${count !== 1 ? 's' : ''} Attached`;
        btn.style.background = '#059669';
        if (badge) { badge.textContent = count; badge.style.display = 'inline'; }
    } else {
        btn.innerHTML = '📎 Attach Files';
        btn.style.background = '';
        if (badge) badge.style.display = 'none';
    }
}

// ── Save pending files after entry is created ─────────────────

async function binderSavePendingFiles(customerName, entryId) {
    if (_pendingEntryFiles.length === 0) return;
    if (!binderDB) await binderInitDB();
    const clientKey = binderClientKey(customerName);
    for (const pf of _pendingEntryFiles) {
        try {
            const buffer = await pf.file.arrayBuffer();
            await binderDBAddFile({
                clientKey,
                name:       pf.name,
                path:       '',
                fullPath:   pf.name,
                type:       pf.file.type || 'application/octet-stream',
                size:       pf.size,
                category:   pf.category,
                uploadedAt: new Date().toISOString(),
                uploadedBy: currentUser || 'Agent',
                data:       buffer
            });
        } catch (err) {
            console.warn('Failed to save pending file:', pf.name, err);
        }
    }
    _pendingEntryFiles = [];
    binderUpdateAttachButton();
}

// ── Download & delete from modal ─────────────────────────────

async function binderDownloadFile(fileId) {
    if (!binderDB) await binderInitDB();
    const tx  = binderDB.transaction('files', 'readonly');
    const req = tx.objectStore('files').get(fileId);
    req.onsuccess = e => {
        const f = e.target.result;
        if (!f) return;
        const blob = new Blob([f.data], { type: f.type });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
}

async function binderDeleteFile(fileId) {
    if (!confirm('Delete this file? This cannot be undone.')) return;
    try {
        await binderDBDeleteFile(fileId);
        await binderLoadFileList();
        if (_binderFileModalEntryId) binderUpdateFileBadge(_binderFileModalEntryId, _binderFileModalClientKey);
    } catch (err) {
        alert('Error deleting file: ' + err);
    }
}

// ── Update file-count badge on table row button ───────────────

async function binderUpdateFileBadge(entryId, clientKey) {
    if (!binderDB) return;
    const files = await binderDBGetFiles(clientKey);
    const btn   = document.querySelector(`[data-binder-file-btn="${entryId}"]`);
    if (!btn) return;
    const count = files.length;
    btn.innerHTML = count > 0
        ? `<i data-lucide="folder-open"></i> <span style="font-size:11px;font-weight:700;">${count}</span>`
        : '<i data-lucide="folder-open"></i>';
    btn.title = count > 0 ? `${count} file${count !== 1 ? 's' : ''} — Click to manage` : 'Upload files';
    refreshIcons();
}

// ============================================================
// PROSPECT AGENT MULTI-SELECT
// ============================================================

function toggleProspectAgentDropdown() {
    const dd = document.getElementById('prospectAgentDropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    if (dd.style.display === 'block') refreshIcons();
}

function prospectAgentToggleAll(cb) {
    document.querySelectorAll('.prospect-agent-cb').forEach(c => c.checked = cb.checked);
    prospectAgentUpdateDisplay();
}

function prospectAgentUpdateDisplay() {
    const selected = prospectAgentGetSelected();
    const display  = document.getElementById('prospectAgentDisplay');
    const allCbs   = document.querySelectorAll('.prospect-agent-cb');
    const allEl    = document.getElementById('prospectAgentSelectAll');
    if (!display) return;
    if (selected.length === 0) {
        display.textContent = 'Select Agent(s)';
        display.style.color = '#9ca3af';
    } else if (selected.length === allCbs.length) {
        display.textContent = 'All Agents';
        display.style.color = '#374151';
        if (allEl) allEl.checked = true;
    } else {
        display.textContent = selected.join(', ');
        display.style.color = '#374151';
        if (allEl) allEl.checked = false;
    }
}

function prospectAgentGetSelected() {
    return [...document.querySelectorAll('.prospect-agent-cb:checked')].map(cb => cb.value);
}

// Close prospect agent dropdown when clicking outside
document.addEventListener('click', e => {
    const wrapper = document.getElementById('prospectAgentWrapper');
    const dd      = document.getElementById('prospectAgentDropdown');
    if (wrapper && dd && !wrapper.contains(e.target)) {
        dd.style.display = 'none';
    }
});

// ============================================================
// PROSPECT FORM — SOURCE + REFERRED BY ADD-NEW
// ============================================================

// ── Source (reuses the shared customSources store) ────────────

function prospectSourceChanged(sel) {
    if (sel.value === '__add_new__') {
        sel.value = '';
        openProspectAddSource();
    }
}

function openProspectAddSource() {
    const row = document.getElementById('prospectNewSourceRow');
    const inp = document.getElementById('prospectNewSourceInput');
    if (row) row.style.display = 'block';
    if (inp) { inp.value = ''; inp.focus(); }
}

function cancelProspectNewSource() {
    document.getElementById('prospectNewSourceRow').style.display = 'none';
}

function saveProspectNewSource() {
    const inp = document.getElementById('prospectNewSourceInput');
    const val = (inp?.value || '').trim();
    if (!val) { inp?.focus(); return; }

    const customs = getCustomSources();
    const all     = [...DEFAULT_SOURCES, ...customs];
    if (!all.map(s => s.toLowerCase()).includes(val.toLowerCase())) {
        customs.push(val);
        saveCustomSources(customs);
    }
    populateSourceDropdown('prospectSource', val);
    document.getElementById('prospectSource').value = val;
    cancelProspectNewSource();
}

// ── Referred By (own customReferrals store) ───────────────────

function getCustomReferrals() {
    try { return JSON.parse(localStorage.getItem('customReferrals')) || []; } catch(e) { return []; }
}

function saveCustomReferrals(arr) {
    localStorage.setItem('customReferrals', JSON.stringify(arr));
}

function populateProspectReferralDropdown(selectedValue) {
    const sel = document.getElementById('prospectReferredBy');
    if (!sel) return;
    const referrals = getCustomReferrals();
    sel.innerHTML = '<option value="">Select or add referral…</option>' +
        referrals.map(r => `<option value="${r}"${r === selectedValue ? ' selected' : ''}>${r}</option>`).join('') +
        '<option value="__add_new__">＋ Add New Referral…</option>';
}

function prospectReferralChanged(sel) {
    if (sel.value === '__add_new__') {
        sel.value = '';
        openProspectAddReferral();
    }
}

function openProspectAddReferral() {
    const row = document.getElementById('prospectNewReferralRow');
    const inp = document.getElementById('prospectNewReferralInput');
    if (row) row.style.display = 'block';
    if (inp) { inp.value = ''; inp.focus(); }
}

function cancelProspectNewReferral() {
    document.getElementById('prospectNewReferralRow').style.display = 'none';
}

function saveProspectNewReferral() {
    const inp = document.getElementById('prospectNewReferralInput');
    const val = (inp?.value || '').trim();
    if (!val) { inp?.focus(); return; }

    const referrals = getCustomReferrals();
    if (!referrals.map(r => r.toLowerCase()).includes(val.toLowerCase())) {
        referrals.push(val);
        saveCustomReferrals(referrals);
    }
    populateProspectReferralDropdown(val);
    document.getElementById('prospectReferredBy').value = val;
    cancelProspectNewReferral();
}

// ============================================================
// CLAUDE AI CHAT — Routed through Google Apps Script
// ============================================================

const CLAUDE_MODEL = 'claude-opus-4-8';
let _claudeMessages = [];           // chat history [{role, content}]
let _claudePendingPdf = null;       // {name, base64} queued for next send
let _claudeBusy = false;

function claudeShowBubble() {
    const btn = document.getElementById('claudeBubbleBtn');
    if (btn) btn.style.display = 'flex';
}

function claudeHideBubble() {
    const btn = document.getElementById('claudeBubbleBtn');
    if (btn) btn.style.display = 'none';
}

function claudeOpenPanel() {
    const panel = document.getElementById('claudeChatPanel');
    if (!panel) return;
    panel.style.display = 'flex';
    if (_claudeMessages.length === 0) {
        claudeAddMessage('assistant', `👋 Hi ${currentUser || 'there'}! I'm your UIB AI assistant. I can:

• Answer questions about your binder data ("how many policies did Amanda write this month?")
• Help draft emails and explanations
• **Extract a sales entry from a PDF** — click 📎 to upload a policy doc and I'll pre-fill the form

How can I help?`);
    }
    setTimeout(() => document.getElementById('claudeChatInput')?.focus(), 100);
}

function claudeClosePanel() {
    const panel = document.getElementById('claudeChatPanel');
    if (panel) panel.style.display = 'none';
}

function claudeNewConversation() {
    _claudeMessages = [];
    _claudePendingPdf = null;
    document.getElementById('claudeChatMessages').innerHTML = '';
    document.getElementById('claudeFilePreview').style.display = 'none';
    claudeOpenPanel();
}

function claudeAddMessage(role, text, isHtml) {
    const box = document.getElementById('claudeChatMessages');
    if (!box) return;
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.style.cssText = `align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:88%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.45;${isUser ? 'background:linear-gradient(135deg,#D97757,#c2410c);color:#fff;' : 'background:#fff;color:#1f2937;border:1px solid #e5e7eb;'};word-wrap:break-word;white-space:pre-wrap;`;
    if (isHtml) div.innerHTML = text;
    else div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

function claudeBuildBinderContext() {
    try {
        const data = allData || [];
        const totals = {};
        const recent = data.slice(-20).reverse().map(e =>
            `${e.entryDate} | ${e.agent} | ${e.customerName} | ${e.company} | $${e.totalPremium}`
        );
        data.forEach(e => {
            const a = e.agent || 'unknown';
            if (!totals[a]) totals[a] = { count: 0, premium: 0 };
            totals[a].count++;
            totals[a].premium += parseFloat(e.totalPremium || 0);
        });
        const byAgent = Object.entries(totals)
            .map(([a, t]) => `${a}: ${t.count} entries, $${t.premium.toFixed(0)} premium`)
            .join('\n');
        return `Current user: ${currentUser || amsCurrentUser || 'Unknown'} (role: ${currentRole || amsCurrentRole || 'agent'})
Total entries in BinderBook: ${data.length}

By agent (lifetime):
${byAgent}

20 most recent entries:
${recent.join('\n')}`;
    } catch (e) {
        return `Current user: ${currentUser || 'Unknown'}. (Data context unavailable: ${e.message})`;
    }
}

function claudeHandlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
        alert('Please upload a PDF file.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result.split(',')[1]; // strip data:application/pdf;base64,
        _claudePendingPdf = { name: file.name, base64 };
        const preview = document.getElementById('claudeFilePreview');
        preview.style.display = 'block';
        preview.innerHTML = `📎 <strong>${file.name}</strong> attached — type "extract sales entry" or any question, then Send.`;
        document.getElementById('claudeChatInput').focus();
    };
    reader.readAsDataURL(file);
    event.target.value = ''; // allow re-upload of same file
}

async function claudeSendMessage() {
    if (_claudeBusy) return;
    const input = document.getElementById('claudeChatInput');
    let userText = (input?.value || '').trim();
    const hasPdf = _claudePendingPdf !== null;

    if (!userText && !hasPdf) return;
    if (!userText && hasPdf) userText = 'Extract the sales entry data from this PDF and create a new entry for me.';

    // Render user message
    let displayText = userText;
    if (hasPdf) displayText = `📎 ${_claudePendingPdf.name}\n${userText}`;
    claudeAddMessage('user', displayText);
    input.value = '';
    document.getElementById('claudeFilePreview').style.display = 'none';

    // Build content blocks
    const content = [];
    if (hasPdf) {
        content.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: _claudePendingPdf.base64 }
        });
    }
    content.push({ type: 'text', text: userText });

    const pdfWasAttached = hasPdf;
    const pdfFileName = hasPdf ? _claudePendingPdf.name : null;
    _claudeMessages.push({ role: 'user', content });
    _claudePendingPdf = null;

    // Loading bubble
    _claudeBusy = true;
    const sendBtn = document.getElementById('claudeSendBtn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }
    const loadingDiv = claudeAddMessage('assistant', '✨ Thinking…');

    try {
        const systemPrompt = claudeBuildSystemPrompt(pdfWasAttached);
        const reply = await claudeCallAPI(systemPrompt, _claudeMessages);

        loadingDiv.remove();
        const replyText = reply.text || '(no response)';
        _claudeMessages.push({ role: 'assistant', content: replyText });

        // Check if reply contains a sales entry extraction JSON
        const extracted = pdfWasAttached ? claudeTryParseEntry(replyText) : null;
        if (extracted) {
            if (!window._claudeExtractions) window._claudeExtractions = [];
            window._claudeExtractions.push(extracted);
            const _extIdx = window._claudeExtractions.length - 1;
            const msg = claudeAddMessage('assistant', '');
            msg.innerHTML = claudeRenderMarkdown(replyText) +
                `<div style="margin-top:14px;padding:12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;">
                    <div style="font-weight:700;color:#15803d;margin-bottom:8px;">✓ Sales entry extracted</div>
                    <div style="font-size:12px;color:#166534;margin-bottom:10px;">PDF: ${pdfFileName}</div>
                    <button onclick="claudePrefillEntry(window._claudeExtractions[${_extIdx}])"
                        style="background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;">
                        📋 Open Daily Sales Entry with these values
                    </button>
                </div>`;
        } else {
            claudeAddMessage('assistant', claudeRenderMarkdown(replyText), true);
        }
    } catch (err) {
        loadingDiv.remove();
        claudeAddMessage('assistant', `❌ Error: ${err.message}\n\nMake sure the Google Apps Script has been updated with the Claude proxy.`);
    } finally {
        _claudeBusy = false;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
    }
}

function claudeBuildSystemPrompt(pdfMode) {
    const context = claudeBuildBinderContext();
    const base = `You are the AI assistant for UIB BinderBook — an insurance binder tracking system for Universal Insurance Brokers. You help insurance agents with their daily work.

CONTEXT — BinderBook current state:
${context}

GUIDELINES:
- Be concise and practical. Insurance agents are busy.
- When asked about data, reference the actual numbers from the context above.
- If you don't have enough data to answer, say so.
- For data-driven answers, show numbers in a clear format.`;

    if (pdfMode) {
        return base + `

PDF EXTRACTION MODE — be exhaustive:
The user has uploaded a PDF (likely an insurance binder, declaration page, or policy document).
Extract EVERY field you can find — customer info, policy details, financials, drivers, AND vehicles.
Do not skip fields just because they appear later in the document.

Respond with a JSON object wrapped in \`\`\`json fences. The JSON must be the LAST thing in your response.

Full JSON shape (omit any field you can't find — don't make values up):
\`\`\`json
{
  "customerName": "string (primary insured / business name)",
  "contactName": "string (if separate contact listed)",
  "source": "string (e.g. Referral, Walk-In, Online, Phone, Repeat Client)",
  "referredBy": "string (name of referrer if mentioned)",

  "policyType": "New|Rewrite|Renewal|Renew A-B",
  "lineOfBusiness": "exact match preferred: BOP, Boat, Builders Risk, Business Owner, Classic Collectors, Commercial Auto, Commercial Property, Excess Liability, Flood, Garage Keepers, General Liability, Home Owners DP1/DP2/DP3/H3/H4/H6/H8, Inland Marine, Motorcycle/ATV, Non-Trucking Liability, Personal Auto, Pollution Liability, Professional Liability, Surety Bond, Trucking, Umbrella, Workers Comp",
  "company": "string (insurance carrier name)",
  "mga": "string (MGA / Premium Finance company)",
  "policyNumber": "string",
  "binderNumber": "string",

  "down": number,
  "agencyFee": number,
  "basePremium": number,
  "totalPremium": number,
  "agencyCommission": number,
  "paymentMethod": "CC-Agency|CC-Client|CC-Company|Cash|Check|ACH to Agency|Direct Billing|EFT|Escrow|Money Order|Premium Finance",
  "paymentMethod2": "same options as above (if a second method appears)",
  "paymentType": "Monthly Paid|Gross Paid",

  "effDate": "YYYY-MM-DD (effective date)",
  "expirationDate": "YYYY-MM-DD",
  "term": "6|12",

  "drivers": [
    {
      "firstName": "string",
      "lastName": "string",
      "dob": "YYYY-MM-DD",
      "dl": "string (driver license number)"
    }
  ],
  "vehicles": [
    {
      "year": "string or number",
      "make": "string (e.g. Toyota, Ford, Honda)",
      "model": "string (e.g. Camry, F-150)",
      "vin": "string (17 chars, uppercase)"
    }
  ]
}
\`\`\`

EXTRACTION TIPS:
- Auto policies usually list multiple drivers in a "Drivers / Named Insureds" or "Operators" section. Extract every one.
- Auto policies list vehicles in a "Vehicles", "Schedule of Autos", "Covered Autos", or "Insured Vehicles" section. Extract every one — including year, make, model, and the 17-character VIN.
- Home / commercial property policies usually have no drivers or vehicles — leave those arrays empty rather than inventing entries.
- If the PDF shows a date as MM/DD/YYYY, convert to YYYY-MM-DD.
- For VINs, strip spaces and uppercase the result.

Before the JSON, give a brief 2-3 sentence summary of what you found (carrier, # of drivers, # of vehicles, premium). The current agent (${currentUser || amsCurrentUser}) will be auto-assigned to the entry.`;
    }
    return base;
}

async function claudeCallAPI(systemPrompt, messages) {
    const payload = {
        action: 'claude',
        body: {
            model: CLAUDE_MODEL,
            max_tokens: 4096,
            system: systemPrompt,
            messages: messages.map(m => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : m.content
            }))
        }
    };

    const res = await fetch(DRIVE_API_URL, {
        method: 'POST',
        body: JSON.stringify(payload)
    });

    // Read as text first so we can see what GAS actually returned
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error(`Apps Script returned non-JSON: ${raw.slice(0, 200)}`); }

    // GAS error envelope (action not handled, key missing, permission error, etc.)
    if (data.success === false) {
        const errStr = String(data.error || JSON.stringify(data));
        if (/UrlFetchApp|external_request|permission to call/i.test(errStr)) {
            throw new Error(`Apps Script needs permission to make external HTTPS calls.\n\nFIX (one-time, ~30 sec):\n1. Open your Apps Script (script.google.com)\n2. From the function dropdown at the top, select "handleClaudeRequest"\n3. Click ▶ Run\n4. Google will show "Authorization required" → click Review permissions\n5. Pick your Google account → Advanced → "Go to project (unsafe)" → Allow\n6. The function will run (you can ignore any "data is undefined" error)\n7. Deploy → Manage deployments → ✏️ → New version → Deploy\n8. Reload BinderBook and try again.`);
        }
        if (/No key provided/i.test(errStr)) {
            throw new Error(`Apps Script doesn't recognize action="claude". → The doPost function is missing the Claude check. Re-add the 3 lines and redeploy as "New version".`);
        }
        throw new Error(`Apps Script error: ${errStr}`);
    }
    // Claude API error envelope
    if (data.error) {
        const t = data.error.type || '';
        const m = data.error.message || JSON.stringify(data.error);
        if (t === 'authentication_error') {
            throw new Error(`Claude API: invalid API key. Paste your real sk-ant-... key into handleClaudeRequest in the Apps Script.`);
        }
        throw new Error(`Claude API ${t}: ${m}`);
    }
    if (!data.content || !data.content.length) {
        throw new Error(`Empty response from Claude. Raw: ${raw.slice(0, 300)}`);
    }

    const textBlock = data.content.find(b => b.type === 'text');
    return { text: textBlock ? textBlock.text : '', raw: data };
}

// Diagnostic test — run `claudeTest()` in the browser console to verify
// the full chain: browser → Apps Script → Claude API → browser.
window.claudeTest = async function() {
    console.group('🔍 Claude AI Connection Test');
    console.log('Apps Script URL:', DRIVE_API_URL);
    console.log('Model:', CLAUDE_MODEL);
    console.log('Sending minimal test message…');

    const payload = {
        action: 'claude',
        body: {
            model: CLAUDE_MODEL,
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Reply with just the word PONG and nothing else.' }]
        }
    };

    try {
        const res = await fetch(DRIVE_API_URL, { method: 'POST', body: JSON.stringify(payload) });
        console.log('HTTP status:', res.status);
        const raw = await res.text();
        console.log('Raw response (first 500 chars):', raw.slice(0, 500));

        let data;
        try { data = JSON.parse(raw); }
        catch (e) {
            console.error('❌ Apps Script did not return JSON.');
            console.error('Likely cause: Your Apps Script is not deployed, or returned an HTML error page.');
            console.groupEnd();
            return;
        }

        if (data.success === false) {
            console.error('❌ Apps Script rejected the request:', data.error);
            console.error('Likely cause: Your doPost is not recognizing action="claude".');
            console.error('Fix: Re-check that you added `if (body.action === "claude") return handleClaudeRequest(body);` at the top of doPost, then redeploy as NEW version.');
            console.groupEnd();
            return;
        }
        if (data.error) {
            console.error('❌ Claude API error:', data.error);
            if (data.error.type === 'authentication_error') {
                console.error('Fix: Replace sk-ant-PASTE-YOUR-KEY-HERE in handleClaudeRequest with your real Claude API key.');
            }
            console.groupEnd();
            return;
        }
        if (data.content && data.content[0] && data.content[0].text) {
            console.log('✅ SUCCESS! Claude replied:', data.content[0].text);
            console.log('Tokens used:', data.usage);
            console.groupEnd();
            return;
        }
        console.warn('Unexpected response shape:', data);
    } catch (err) {
        console.error('❌ Network/fetch error:', err);
        console.error('Likely cause: Apps Script URL is wrong or your network is blocking it.');
    }
    console.groupEnd();
};

function claudeTryParseEntry(text) {
    const match = text.match(/```json\s*([\s\S]*?)```/);
    if (!match) return null;
    try {
        const obj = JSON.parse(match[1]);
        if (obj.customerName || obj.policyNumber || obj.totalPremium) return obj;
    } catch (e) { /* ignore */ }
    return null;
}

// Ensure a carrier exists in carrierMasterData; create with default rules if missing
function claudeEnsureCarrier(name) {
    if (!name) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    // Case-insensitive lookup first to avoid duplicates like "AIG" vs "Aig"
    const existing = Object.keys(carrierMasterData || {})
        .find(k => k.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing; // already there — return canonical key

    if (!carrierMasterData) carrierMasterData = {};
    carrierMasterData[trimmed] = {
        carrierName:   trimmed,
        phoneNumbers:  ["", "", ""],
        emails:        { underwriting: "", general: "", miscellaneous: "" },
        commissionRules: JSON.parse(JSON.stringify(DEFAULT_COMMISSION_RULES))
    };
    localStorage.setItem('carrierMasterData', JSON.stringify(carrierMasterData));
    if (typeof driveSet === 'function') driveSet('carrierMasterData', carrierMasterData);
    if (typeof refreshAllCarrierDropdowns === 'function') refreshAllCarrierDropdowns();
    return trimmed;
}

// Ensure a source value exists in custom sources so the dropdown can show it
function claudeEnsureSource(name) {
    if (!name) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    const all = [...DEFAULT_SOURCES, ...getCustomSources()];
    const existing = all.find(s => s.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const customs = getCustomSources();
    customs.push(trimmed);
    saveCustomSources(customs);
    if (typeof populateSourceDropdown === 'function') populateSourceDropdown('source', trimmed);
    return trimmed;
}

function claudePrefillEntry(extracted) {
    claudeClosePanel();
    openDailySalesModal();
    setTimeout(() => {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el && val !== undefined && val !== null && val !== '') el.value = val;
        };

        // Auto-assign location based on agent
        const autoLocation = (currentUser === 'Jorge Castro') ? 'Franchise' : 'Hialeah Office';
        const locSel = document.getElementById('salesLocationSelect');
        if (locSel && !locSel.value) {
            locSel.value = autoLocation;
            _selectedSalesLocation = autoLocation;
        }
        const autoAdded = []; // track what we created so we can tell the user

        // Auto-add carrier to master list if missing, then prep the dropdown
        if (extracted.company) {
            const before = Object.keys(carrierMasterData || {}).find(k => k.toLowerCase() === extracted.company.toLowerCase());
            const canonical = claudeEnsureCarrier(extracted.company);
            if (canonical && !before) autoAdded.push(`new carrier "${canonical}"`);
            extracted.company = canonical || extracted.company;
        }

        // Auto-add source to custom sources if missing
        if (extracted.source) {
            const beforeS = [...DEFAULT_SOURCES, ...getCustomSources()].find(s => s.toLowerCase() === extracted.source.toLowerCase());
            const canonicalSource = claudeEnsureSource(extracted.source);
            if (canonicalSource && !beforeS) autoAdded.push(`new source "${canonicalSource}"`);
            extracted.source = canonicalSource || extracted.source;
        }

        // Customer + source
        setVal('customerName',  extracted.customerName);
        setVal('contactName',   extracted.contactName);
        setVal('source',        extracted.source);
        setVal('referredBy',    extracted.referredBy);

        // Policy
        setVal('policyType',    extracted.policyType);
        setVal('lineOfBusiness',extracted.lineOfBusiness);
        setVal('company',       extracted.company);
        setVal('mga',           extracted.mga);
        setVal('policyNumber',  extracted.policyNumber);
        // Note: binderNumber is auto-generated, don't override
        setVal('effDate',       extracted.effDate);
        setVal('term',          extracted.term);

        // Financial
        setVal('down',             extracted.down);
        setVal('agencyFee',        extracted.agencyFee);
        setVal('basePremium',      extracted.basePremium);
        setVal('totalPremium',     extracted.totalPremium);
        setVal('paymentMethod',    extracted.paymentMethod);
        setVal('paymentMethod2',   extracted.paymentMethod2);
        setVal('paymentType',      extracted.paymentType);

        // Drivers — clear and repopulate from extraction
        if (Array.isArray(extracted.drivers) && extracted.drivers.length > 0) {
            const dc = document.getElementById('driversContainer');
            if (dc) dc.innerHTML = '';
            _driverRowCounter = 0;
            extracted.drivers.forEach(d => addDriverRow(d));
            if (typeof updateDriversEmptyState === 'function') updateDriversEmptyState();
        }

        // Vehicles — clear and repopulate from extraction
        if (Array.isArray(extracted.vehicles) && extracted.vehicles.length > 0) {
            const vc = document.getElementById('vehiclesContainer');
            if (vc) vc.innerHTML = '';
            _vehicleRowCounter = 0;
            extracted.vehicles.forEach(v => addVehicleRow(v));
            if (typeof updateVehiclesEmptyState === 'function') updateVehiclesEmptyState();
        }

        if (typeof autoCalculateCommission === 'function') autoCalculateCommission();

        // Validate required fields — auto-save if all present
        setTimeout(() => claudeMaybeAutoSubmit(extracted, autoAdded), 300);
    }, 250);
}

function claudeMaybeAutoSubmit(extracted, autoAdded) {
    // The fields the form requires to save (matches the HTML `required` attrs)
    // Note: Source and Referred By are now optional.
    const requiredFields = [
        { id: 'customerName',   label: 'Customer Name' },
        { id: 'policyType',     label: 'Policy Type' },
        { id: 'lineOfBusiness', label: 'Line of Business' },
        { id: 'company',        label: 'Insurance Company' },
        { id: 'basePremium',    label: 'Base Premium' },
        { id: 'totalPremium',   label: 'Total Premium' },
        { id: 'paymentMethod',  label: 'Payment Method' },
        { id: 'effDate',        label: 'Effective Date' },
        { id: 'term',           label: 'Term' },
        { id: 'paymentType',    label: 'Commission Type' }
    ];
    // Location is also required by the entry's design
    const locSel = document.getElementById('salesLocationSelect');
    const hasLocation = locSel && locSel.value;

    const missing = requiredFields.filter(f => {
        const el = document.getElementById(f.id);
        return !el || !el.value || el.value.toString().trim() === '';
    });

    if (!hasLocation) {
        missing.unshift({ id: 'salesLocationSelect', label: 'Office Location' });
    }

    const counts = {
        drivers:  document.querySelectorAll('#driversContainer .driver-row').length,
        vehicles: document.querySelectorAll('#vehiclesContainer .vehicle-row').length
    };

    if (missing.length === 0) {
        claudeShowToast(`✓ Prefilled from PDF · ${counts.drivers} driver${counts.drivers !== 1 ? 's' : ''} · ${counts.vehicles} vehicle${counts.vehicles !== 1 ? 's' : ''}${autoAdded.length ? ' · auto-added ' + autoAdded.join(', ') : ''}\nPlease review the entry and click Save Policy Entry.`, 'success');
    } else {
        const missingLabels = missing.map(f => f.label).join(', ');
        // Highlight the first missing field
        const firstMissing = document.getElementById(missing[0].id);
        if (firstMissing) {
            firstMissing.style.transition = 'box-shadow .3s, border-color .3s';
            firstMissing.style.boxShadow = '0 0 0 3px rgba(220,38,38,.25)';
            firstMissing.style.borderColor = '#dc2626';
            firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => firstMissing.focus(), 600);
            setTimeout(() => {
                firstMissing.style.boxShadow = '';
                firstMissing.style.borderColor = '';
            }, 4000);
        }
        claudeShowToast(`✓ Prefilled what I could from PDF${autoAdded.length ? ' (auto-added ' + autoAdded.join(', ') + ')' : ''}.\nPlease fill in: ${missingLabels}\nThen click Save Policy Entry.`, 'info');
    }
}

function claudeShowToast(text, kind) {
    const colors = {
        success: 'linear-gradient(135deg,#16a34a,#15803d)',
        warn:    'linear-gradient(135deg,#f59e0b,#d97706)',
        info:    'linear-gradient(135deg,#2563eb,#1d4ed8)'
    };
    const msg = document.createElement('div');
    msg.style.cssText = `position:fixed;top:80px;right:24px;z-index:10020;background:${colors[kind] || colors.info};color:#fff;padding:14px 20px;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.3);font-weight:600;font-size:13px;max-width:380px;white-space:pre-line;line-height:1.5;`;
    msg.textContent = text;
    document.body.appendChild(msg);
    setTimeout(() => { msg.style.opacity = '0'; msg.style.transition = 'opacity .4s'; }, 5500);
    setTimeout(() => msg.remove(), 6000);
}

function claudeRenderMarkdown(text) {
    // Minimal markdown: bold, italic, code, line breaks, lists
    let html = text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/```json[\s\S]*?```/g, '') // strip extraction JSON from display
        .replace(/```([\s\S]*?)```/g, '<pre style="background:#f3f4f6;padding:8px;border-radius:6px;font-size:12px;overflow-x:auto;">$1</pre>')
        .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:12px;">$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|\n)- (.+)/g, '$1• $2')
        .replace(/\n/g, '<br>');
    return html.trim();
}

// Show bubble whenever an agent or admin section is active
function claudeUpdateBubbleVisibility() {
    const shouldShow = !!(currentUser || amsCurrentUser) &&
        !document.getElementById('loginSection')?.classList?.contains('active');
    if (shouldShow) claudeShowBubble();
    else claudeHideBubble();
}

// ── Inline chat (lives below the universal search section) ──

let _claudeInlineMessages = [];
let _claudeInlinePendingPdf = null;
let _claudeInlineBusy = false;

function claudeInlineAddMessage(role, text, isHtml) {
    const box = document.getElementById('claudeInlineMessages');
    if (!box) return null;
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.style.cssText = `align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:88%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.5;${isUser ? 'background:linear-gradient(135deg,#D97757,#c2410c);color:#fff;' : 'background:#f9fafb;color:#1f2937;border:1px solid #e5e7eb;'};word-wrap:break-word;white-space:pre-wrap;`;
    if (isHtml) div.innerHTML = text;
    else div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

function claudeInlineGreet() {
    const box = document.getElementById('claudeInlineMessages');
    if (!box || box.children.length > 0) return;
    claudeInlineAddMessage('assistant', `👋 Hi ${currentUser || 'there'}! Ask me anything about your binder data, or upload a PDF policy doc and I'll extract the sales entry for you.`);
}

function claudeInlineNewConversation() {
    _claudeInlineMessages = [];
    _claudeInlinePendingPdf = null;
    const box = document.getElementById('claudeInlineMessages');
    if (box) box.innerHTML = '';
    const preview = document.getElementById('claudeInlineFilePreview');
    if (preview) preview.style.display = 'none';
    claudeInlineGreet();
}

function claudeInlineHandlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
        alert('Please upload a PDF file.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result.split(',')[1];
        _claudeInlinePendingPdf = { name: file.name, base64 };
        const preview = document.getElementById('claudeInlineFilePreview');
        preview.style.display = 'block';
        preview.innerHTML = `📎 <strong>${file.name}</strong> attached — click Send to extract the sales entry.`;
        document.getElementById('claudeInlineInput').focus();
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

async function claudeInlineSendMessage() {
    if (_claudeInlineBusy) return;
    const input = document.getElementById('claudeInlineInput');
    let userText = (input?.value || '').trim();
    const hasPdf = _claudeInlinePendingPdf !== null;

    if (!userText && !hasPdf) return;
    if (!userText && hasPdf) userText = 'Extract the sales entry data from this PDF and create a new entry for me.';

    let displayText = userText;
    if (hasPdf) displayText = `📎 ${_claudeInlinePendingPdf.name}\n${userText}`;
    claudeInlineAddMessage('user', displayText);
    input.value = '';
    document.getElementById('claudeInlineFilePreview').style.display = 'none';

    const content = [];
    if (hasPdf) {
        content.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: _claudeInlinePendingPdf.base64 }
        });
    }
    content.push({ type: 'text', text: userText });

    const pdfWasAttached = hasPdf;
    const pdfFileName = hasPdf ? _claudeInlinePendingPdf.name : null;
    _claudeInlineMessages.push({ role: 'user', content });
    _claudeInlinePendingPdf = null;

    _claudeInlineBusy = true;
    const sendBtn = document.getElementById('claudeInlineSendBtn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }
    const loadingDiv = claudeInlineAddMessage('assistant', '✨ Thinking…');

    try {
        const systemPrompt = claudeBuildSystemPrompt(pdfWasAttached);
        const reply = await claudeCallAPI(systemPrompt, _claudeInlineMessages);

        loadingDiv.remove();
        const replyText = reply.text || '(no response)';
        _claudeInlineMessages.push({ role: 'assistant', content: replyText });

        const extracted = pdfWasAttached ? claudeTryParseEntry(replyText) : null;
        if (extracted) {
            if (!window._claudeExtractions) window._claudeExtractions = [];
            window._claudeExtractions.push(extracted);
            const _extIdx = window._claudeExtractions.length - 1;
            const msg = claudeInlineAddMessage('assistant', '');
            msg.innerHTML = claudeRenderMarkdown(replyText) +
                `<div style="margin-top:14px;padding:12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;">
                    <div style="font-weight:700;color:#15803d;margin-bottom:8px;">✓ Sales entry extracted</div>
                    <div style="font-size:12px;color:#166534;margin-bottom:10px;">PDF: ${pdfFileName}</div>
                    <button onclick="claudePrefillEntry(window._claudeExtractions[${_extIdx}])"
                        style="background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;">
                        📋 Open Daily Sales Entry with these values
                    </button>
                </div>`;
        } else {
            claudeInlineAddMessage('assistant', claudeRenderMarkdown(replyText), true);
        }
    } catch (err) {
        loadingDiv.remove();
        claudeInlineAddMessage('assistant', `❌ Error: ${err.message}\n\nMake sure the Google Apps Script has been updated with the Claude proxy.`);
    } finally {
        _claudeInlineBusy = false;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
    }
}

// Auto-greet on agent section load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(claudeInlineGreet, 800);
    setTimeout(claudeAdminGreet, 800);
    setTimeout(claudeSetupDragDrop, 1000);
});

// ── Drag-and-Drop support for both chat sections ──

function claudeSetupDragDrop() {
    const inline = document.getElementById('claudeInlineSection');
    const admin  = document.getElementById('claudeAdminSection');
    if (inline) claudeAttachDropZone(inline, 'agent');
    if (admin)  claudeAttachDropZone(admin, 'admin');
}

function claudeAttachDropZone(zone, mode) {
    const origBg = zone.style.background;
    const origBorder = zone.style.borderColor || '#f5c19a';

    const setActive = () => {
        zone.style.background = 'linear-gradient(135deg,#fde4cc,#fbcfa6)';
        zone.style.borderColor = '#D97757';
        zone.style.borderStyle = 'dashed';
        zone.style.borderWidth = '2.5px';
        zone.style.boxShadow = '0 0 0 4px rgba(217,119,87,.18)';
    };
    const reset = () => {
        zone.style.background = origBg;
        zone.style.borderColor = origBorder;
        zone.style.borderStyle = 'solid';
        zone.style.borderWidth = '1.5px';
        zone.style.boxShadow = '';
    };

    // Counter so dragenter/dragleave on children doesn't cause flicker
    let depth = 0;

    zone.addEventListener('dragenter', (e) => {
        if (!claudeDragHasFiles(e)) return;
        e.preventDefault();
        depth++;
        if (depth === 1) setActive();
    });

    zone.addEventListener('dragover', (e) => {
        if (!claudeDragHasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    zone.addEventListener('dragleave', (e) => {
        if (!claudeDragHasFiles(e)) return;
        depth--;
        if (depth <= 0) { depth = 0; reset(); }
    });

    zone.addEventListener('drop', (e) => {
        if (!claudeDragHasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        reset();

        const files = Array.from(e.dataTransfer.files || []);
        const pdfs = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
        const skipped = files.length - pdfs.length;

        if (pdfs.length === 0) {
            if (mode === 'agent') {
                claudeInlineAddMessage('assistant', '⚠️ Please drop a PDF file. Other file types are not supported.');
            } else {
                claudeAdminAddMessage('assistant', '⚠️ Please drop PDF files. Other file types are not supported.');
            }
            return;
        }

        if (mode === 'agent') {
            // Agent inline supports only one PDF at a time — take the first
            const file = pdfs[0];
            const reader = new FileReader();
            reader.onload = (ev) => {
                const base64 = ev.target.result.split(',')[1];
                _claudeInlinePendingPdf = { name: file.name, base64 };
                const preview = document.getElementById('claudeInlineFilePreview');
                preview.style.display = 'block';
                preview.innerHTML = `📎 <strong>${file.name}</strong> attached — click Send to extract the sales entry.` +
                    (pdfs.length > 1 ? ` <em>(${pdfs.length - 1} other PDF${pdfs.length > 2 ? 's' : ''} ignored — only one at a time here)</em>` : '');
                document.getElementById('claudeInlineInput')?.focus();
            };
            reader.readAsDataURL(file);
        } else {
            // Admin section supports multiple PDFs
            let loaded = 0;
            pdfs.forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const base64 = ev.target.result.split(',')[1];
                    _claudeAdminPendingPdfs.push({ name: file.name, base64 });
                    loaded++;
                    if (loaded === pdfs.length) {
                        claudeAdminRefreshPreview();
                        document.getElementById('claudeAdminInput')?.focus();
                    }
                };
                reader.readAsDataURL(file);
            });
            if (skipped > 0) {
                claudeAdminAddMessage('assistant', `ℹ️ ${pdfs.length} PDF${pdfs.length > 1 ? 's' : ''} added. (${skipped} non-PDF file${skipped > 1 ? 's' : ''} skipped.)`);
            }
        }
    });
}

function claudeDragHasFiles(e) {
    if (!e.dataTransfer) return false;
    const types = e.dataTransfer.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true;
    }
    return false;
}

// Prevent the browser from navigating away when a user drops outside the zones
['dragover', 'drop'].forEach(evt => {
    window.addEventListener(evt, (e) => {
        if (claudeDragHasFiles(e)) e.preventDefault();
    });
});

// ============================================================
// CLAUDE AI — Admin Commission Processor
// ============================================================

let _claudeAdminMessages = [];
let _claudeAdminPendingPdfs = []; // array of {name, base64}
let _claudeAdminBusy = false;

function claudeAdminAddMessage(role, text, isHtml) {
    const box = document.getElementById('claudeAdminMessages');
    if (!box) return null;
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.style.cssText = `align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:92%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.5;${isUser ? 'background:linear-gradient(135deg,#D97757,#c2410c);color:#fff;' : 'background:#f9fafb;color:#1f2937;border:1px solid #e5e7eb;'};word-wrap:break-word;white-space:pre-wrap;`;
    if (isHtml) div.innerHTML = text;
    else div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

function claudeAdminGreet() {
    const box = document.getElementById('claudeAdminMessages');
    if (!box || box.children.length > 0) return;
    claudeAdminAddMessage('assistant',
        `👋 Welcome, Admin! Upload one or more carrier commission statements (PDFs) using the 📎 button. I'll:

• Read each transaction from the statement
• Match it to a BinderBook entry by customer name or policy number
• Identify which agent gets credit for each
• Generate a downloadable commission breakdown per agent

You can also just ask questions about your commission data.`);
}

function claudeAdminNewConversation() {
    _claudeAdminMessages = [];
    _claudeAdminPendingPdfs = [];
    const box = document.getElementById('claudeAdminMessages');
    if (box) box.innerHTML = '';
    const preview = document.getElementById('claudeAdminFilePreview');
    if (preview) preview.style.display = 'none';
    claudeAdminGreet();
}

function claudeAdminHandlePdfUpload(event) {
    const files = Array.from(event.target.files || []);
    const pdfs = files.filter(f => f.type === 'application/pdf');
    if (pdfs.length === 0) {
        alert('Please upload PDF files only.');
        return;
    }

    let loaded = 0;
    pdfs.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result.split(',')[1];
            _claudeAdminPendingPdfs.push({ name: file.name, base64 });
            loaded++;
            if (loaded === pdfs.length) claudeAdminRefreshPreview();
        };
        reader.readAsDataURL(file);
    });
    event.target.value = '';
}

function claudeAdminRefreshPreview() {
    const preview = document.getElementById('claudeAdminFilePreview');
    if (!preview) return;
    if (_claudeAdminPendingPdfs.length === 0) {
        preview.style.display = 'none';
        return;
    }
    preview.style.display = 'block';
    const names = _claudeAdminPendingPdfs.map((p, i) =>
        `📎 ${p.name} <button onclick="claudeAdminRemovePdf(${i})" style="background:none;border:none;color:#5b21b6;cursor:pointer;font-weight:700;margin-left:4px;">✕</button>`
    ).join(' &nbsp;·&nbsp; ');
    preview.innerHTML = `<strong>${_claudeAdminPendingPdfs.length} PDF${_claudeAdminPendingPdfs.length > 1 ? 's' : ''} attached:</strong> ${names}`;
}

function claudeAdminRemovePdf(idx) {
    _claudeAdminPendingPdfs.splice(idx, 1);
    claudeAdminRefreshPreview();
}

function claudeAdminBuildBinderContext() {
    try {
        const data = (allData || []).filter(e => e.customerName);
        // Send a compact reference list — Claude needs name + policy + agent for matching
        const entries = data.slice(-500).map(e =>
            `id=${e.id}|${(e.customerName || '').trim()}|policy=${e.policyNumber || ''}|carrier=${e.company || ''}|agent=${e.agent || ''}|premium=${e.totalPremium || 0}|date=${e.entryDate || ''}`
        );
        const agentList = [...new Set(data.map(e => e.agent).filter(Boolean))];
        return `BinderBook reference data (${data.length} total entries, showing most recent 500):

Agents in system: ${agentList.join(', ')}

Entries (pipe-delimited: id|customer|policy|carrier|agent|premium|date):
${entries.join('\n')}`;
    } catch (e) {
        return `(Data context unavailable: ${e.message})`;
    }
}

function claudeAdminBuildSystemPrompt(pdfMode) {
    const context = claudeAdminBuildBinderContext();
    const base = `You are the AI commission processor for UIB BinderBook (Universal Insurance Brokers). You help the admin reconcile carrier commission statements against BinderBook sales entries.

${context}

GUIDELINES:
- Be precise. This is financial reconciliation work.
- Match transactions by policy number FIRST (highest confidence), then by customer name.
- If a customer name has multiple matches, prefer the entry with the matching carrier.
- Mark match confidence honestly: "high" (policy# exact match), "medium" (customer name + carrier match), "low" (customer name only), "none" (no match found).
- Be ready to explain your reasoning.`;

    if (pdfMode) {
        return base + `

COMMISSION STATEMENT PROCESSING MODE:
The admin has uploaded one or more carrier commission statements. Your job:

1. Identify the carrier and statement period for each PDF
2. Extract EVERY transaction line item (don't skip any)
3. Match each transaction to a BinderBook entry using the data above
4. Identify the responsible agent from the matched entry
5. Output a structured JSON summary at the end of your response

After a brief 2-3 sentence summary of what you found, output JSON in this exact shape (wrapped in \`\`\`json fences as the LAST thing in your response):

\`\`\`json
{
  "carrier": "string (carrier name from statement)",
  "statementMonth": "Month YYYY (e.g. May 2026)",
  "statementDate": "YYYY-MM-DD",
  "totalGrossCommission": number,
  "transactions": [
    {
      "customerName": "string",
      "policyNumber": "string",
      "premium": number,
      "commissionAmount": number,
      "matchedEntryId": number_or_null,
      "matchedAgent": "string_or_null",
      "matchConfidence": "high|medium|low|none",
      "notes": "string (optional explanation)"
    }
  ],
  "agentTotals": {
    "Agent Name": {
      "transactionCount": number,
      "totalCommission": number
    }
  }
}
\`\`\`

If multiple PDFs are uploaded, output one JSON block per carrier statement, separated by your prose commentary.`;
    }
    return base;
}

async function claudeAdminSendMessage() {
    if (_claudeAdminBusy) return;
    const input = document.getElementById('claudeAdminInput');
    let userText = (input?.value || '').trim();
    const hasPdfs = _claudeAdminPendingPdfs.length > 0;

    if (!userText && !hasPdfs) return;
    if (!userText && hasPdfs) {
        userText = `Process ${_claudeAdminPendingPdfs.length === 1 ? 'this commission statement' : 'these ' + _claudeAdminPendingPdfs.length + ' commission statements'}. Identify every transaction, match to BinderBook entries, and break down per agent.`;
    }

    let displayText = userText;
    if (hasPdfs) displayText = `📎 ${_claudeAdminPendingPdfs.map(p => p.name).join(', ')}\n${userText}`;
    claudeAdminAddMessage('user', displayText);
    input.value = '';

    const content = [];
    _claudeAdminPendingPdfs.forEach(pdf => {
        content.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 }
        });
    });
    content.push({ type: 'text', text: userText });

    const pdfsAttached = hasPdfs;
    const pdfNames = _claudeAdminPendingPdfs.map(p => p.name);
    _claudeAdminMessages.push({ role: 'user', content });
    _claudeAdminPendingPdfs = [];
    claudeAdminRefreshPreview();

    _claudeAdminBusy = true;
    const sendBtn = document.getElementById('claudeAdminSendBtn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }
    const loadingDiv = claudeAdminAddMessage('assistant', '✨ Reading statement(s) and reconciling against BinderBook…');

    try {
        const systemPrompt = claudeAdminBuildSystemPrompt(pdfsAttached);
        const reply = await claudeCallAPI(systemPrompt, _claudeAdminMessages);

        loadingDiv.remove();
        const replyText = reply.text || '(no response)';
        _claudeAdminMessages.push({ role: 'assistant', content: replyText });

        const statements = pdfsAttached ? claudeAdminParseAllStatements(replyText) : [];

        if (statements.length > 0) {
            const msg = claudeAdminAddMessage('assistant', '');
            msg.innerHTML = claudeRenderMarkdown(replyText) + claudeAdminRenderStatements(statements, pdfNames);
        } else {
            claudeAdminAddMessage('assistant', claudeRenderMarkdown(replyText), true);
        }
    } catch (err) {
        loadingDiv.remove();
        claudeAdminAddMessage('assistant', `❌ Error: ${err.message}\n\nMake sure the Google Apps Script has been updated with the Claude proxy.`);
    } finally {
        _claudeAdminBusy = false;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Process'; }
    }
}

function claudeAdminParseAllStatements(text) {
    const results = [];
    const re = /```json\s*([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        try {
            const obj = JSON.parse(m[1]);
            if (obj && Array.isArray(obj.transactions)) results.push(obj);
        } catch (e) { /* skip malformed block */ }
    }
    return results;
}

function claudeAdminRenderStatements(statements, pdfNames) {
    let html = `<div style="margin-top:14px;display:flex;flex-direction:column;gap:14px;">`;
    statements.forEach((stmt, idx) => {
        const totalAgentCommission = Object.values(stmt.agentTotals || {})
            .reduce((s, a) => s + (a.totalCommission || 0), 0);
        const matched = (stmt.transactions || []).filter(t => t.matchedAgent).length;
        const unmatched = (stmt.transactions || []).length - matched;

        html += `<div style="background:#fff;border:1.5px solid #ddd6fe;border-radius:10px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
                <div>
                    <div style="font-weight:700;color:#6d28d9;font-size:15px;">${stmt.carrier || 'Unknown carrier'} — ${stmt.statementMonth || stmt.statementDate || ''}</div>
                    <div style="font-size:12px;color:#6b7280;">${(stmt.transactions || []).length} transactions · ${matched} matched · ${unmatched} unmatched · Gross: $${(stmt.totalGrossCommission || 0).toFixed(2)}</div>
                </div>
                <button onclick='claudeAdminApplyStatement(${JSON.stringify(stmt).replace(/'/g, "&#39;")})'
                    style="background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;">
                    💾 Save as Commission Statement
                </button>
            </div>`;

        // Agent breakdown
        const agentTotals = stmt.agentTotals || {};
        const agentRows = Object.entries(agentTotals)
            .sort((a, b) => (b[1].totalCommission || 0) - (a[1].totalCommission || 0));
        if (agentRows.length > 0) {
            html += `<div style="background:#f9fafb;border-radius:8px;padding:10px;margin-bottom:10px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">Per-agent breakdown</div>
                <table style="width:100%;font-size:13px;border-collapse:collapse;">
                    ${agentRows.map(([agent, t]) => `<tr>
                        <td style="padding:4px 8px;color:#1f2937;font-weight:600;">${agent}</td>
                        <td style="padding:4px 8px;color:#6b7280;text-align:right;">${t.transactionCount || 0} txns</td>
                        <td style="padding:4px 8px;color:#15803d;font-weight:700;text-align:right;">$${(t.totalCommission || 0).toFixed(2)}</td>
                    </tr>`).join('')}
                </table>
            </div>`;
        }

        // Transaction table (collapsed)
        html += `<details style="cursor:pointer;">
            <summary style="font-size:12px;font-weight:700;color:#7c3aed;padding:4px 0;">▶ View all ${(stmt.transactions || []).length} transactions</summary>
            <div style="margin-top:8px;overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px;">
                <table style="width:100%;font-size:12px;border-collapse:collapse;min-width:600px;">
                    <thead style="background:#f9fafb;">
                        <tr>
                            <th style="padding:6px 8px;text-align:left;color:#6b7280;font-weight:700;text-transform:uppercase;font-size:10px;">Customer</th>
                            <th style="padding:6px 8px;text-align:left;color:#6b7280;font-weight:700;text-transform:uppercase;font-size:10px;">Policy #</th>
                            <th style="padding:6px 8px;text-align:right;color:#6b7280;font-weight:700;text-transform:uppercase;font-size:10px;">Premium</th>
                            <th style="padding:6px 8px;text-align:right;color:#6b7280;font-weight:700;text-transform:uppercase;font-size:10px;">Commission</th>
                            <th style="padding:6px 8px;text-align:left;color:#6b7280;font-weight:700;text-transform:uppercase;font-size:10px;">Agent</th>
                            <th style="padding:6px 8px;text-align:center;color:#6b7280;font-weight:700;text-transform:uppercase;font-size:10px;">Match</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(stmt.transactions || []).map(t => {
                            const colors = { high: '#16a34a', medium: '#ca8a04', low: '#ea580c', none: '#dc2626' };
                            const badge = `<span style="background:${colors[t.matchConfidence] || '#6b7280'};color:#fff;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;">${t.matchConfidence || '?'}</span>`;
                            return `<tr style="border-top:1px solid #f3f4f6;">
                                <td style="padding:6px 8px;color:#1f2937;">${t.customerName || '—'}</td>
                                <td style="padding:6px 8px;color:#374151;font-family:monospace;">${t.policyNumber || '—'}</td>
                                <td style="padding:6px 8px;text-align:right;color:#374151;">$${(t.premium || 0).toFixed(2)}</td>
                                <td style="padding:6px 8px;text-align:right;color:#15803d;font-weight:600;">$${(t.commissionAmount || 0).toFixed(2)}</td>
                                <td style="padding:6px 8px;color:${t.matchedAgent ? '#1d4ed8' : '#9ca3af'};font-weight:${t.matchedAgent ? '600' : '400'};">${t.matchedAgent || '— unmatched —'}</td>
                                <td style="padding:6px 8px;text-align:center;">${badge}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </details>`;
        html += `</div>`;
    });
    html += `</div>`;
    return html;
}

function claudeAdminApplyStatement(stmt) {
    if (!stmt || !Array.isArray(stmt.transactions)) {
        alert('Invalid statement data.');
        return;
    }

    const monthLabel = stmt.statementMonth || stmt.statementDate || `Statement ${new Date().toISOString().slice(0, 10)}`;
    const carrier = stmt.carrier || 'Unknown';
    const key = `${monthLabel} — ${carrier} (AI)`;

    // Convert AI transactions to commissionStatements format
    const entries = stmt.transactions.map((t, i) => ({
        idx: i + 1,
        carrier: carrier,
        customerName: t.customerName || '',
        policyNumber: t.policyNumber || '',
        premium: parseFloat(t.premium) || 0,
        commission: parseFloat(t.commissionAmount) || 0,
        agentMatch: t.matchedAgent || null,
        matchConfidence: t.matchConfidence || 'none',
        matchedEntryId: t.matchedEntryId || null,
        notes: t.notes || ''
    }));

    const carrierTotals = {};
    carrierTotals[carrier] = stmt.totalGrossCommission ||
        entries.reduce((s, e) => s + e.commission, 0);

    if (typeof commissionStatements === 'undefined' || commissionStatements === null) {
        window.commissionStatements = JSON.parse(localStorage.getItem('commissionStatements')) || {};
    }

    commissionStatements[key] = {
        month: monthLabel,
        sheetName: `AI: ${carrier}`,
        uploadedAt: new Date().toISOString(),
        source: 'claude-ai',
        carrier: carrier,
        entries,
        carrierTotals,
        grossTotal: carrierTotals[carrier],
        entryCount: entries.length,
        agentTotals: stmt.agentTotals || {}
    };

    localStorage.setItem('commissionStatements', JSON.stringify(commissionStatements));
    if (typeof driveSet === 'function') driveSet('commissionStatements', commissionStatements);

    alert(`✓ Saved commission statement: ${key}\n\nView it under "Commission Statements" in the admin dashboard.`);
    if (typeof loadCommissionStatementsList === 'function') loadCommissionStatementsList();
}

// ============================================================
// DRIVERS & VEHICLES — dynamic mini-sections in Daily Sales Entry
// ============================================================

let _driverRowCounter = 0;
let _vehicleRowCounter = 0;

function addDriverRow(prefill) {
    const container = document.getElementById('driversContainer');
    if (!container) return;
    _driverRowCounter++;
    const rid = `drv_${_driverRowCounter}`;
    const div = document.createElement('div');
    div.className = 'driver-row';
    div.dataset.rid = rid;
    div.style.cssText = 'background:#fff;border:1px solid #99f6e4;border-radius:8px;padding:10px 12px;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:8px;align-items:end;';
    div.innerHTML = `
        <div>
            <label style="font-size:11px;font-weight:700;color:#115e59;display:block;margin-bottom:3px;text-transform:uppercase;">First Name</label>
            <input type="text" class="drv-firstName" placeholder="John" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#115e59;display:block;margin-bottom:3px;text-transform:uppercase;">Last Name</label>
            <input type="text" class="drv-lastName" placeholder="Doe" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#115e59;display:block;margin-bottom:3px;text-transform:uppercase;">Date of Birth</label>
            <input type="date" class="drv-dob" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#115e59;display:block;margin-bottom:3px;text-transform:uppercase;">DL #</label>
            <input type="text" class="drv-dl" placeholder="License #" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <button type="button" onclick="this.closest('.driver-row').remove(); updateDriversEmptyState();" title="Remove driver"
            style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;padding:7px 10px;cursor:pointer;font-weight:700;font-size:14px;height:32px;">✕</button>
    `;
    container.appendChild(div);
    if (prefill) {
        if (prefill.firstName) div.querySelector('.drv-firstName').value = prefill.firstName;
        if (prefill.lastName)  div.querySelector('.drv-lastName').value  = prefill.lastName;
        if (prefill.dob)       div.querySelector('.drv-dob').value       = prefill.dob;
        if (prefill.dl)        div.querySelector('.drv-dl').value        = prefill.dl;
    }
    updateDriversEmptyState();
    div.querySelector('.drv-firstName')?.focus();
}

function addVehicleRow(prefill) {
    const container = document.getElementById('vehiclesContainer');
    if (!container) return;
    _vehicleRowCounter++;
    const rid = `veh_${_vehicleRowCounter}`;
    const div = document.createElement('div');
    div.className = 'vehicle-row';
    div.dataset.rid = rid;
    div.style.cssText = 'background:#fff;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;margin-bottom:8px;display:grid;grid-template-columns:80px 1fr 1fr 1.6fr auto;gap:8px;align-items:end;';
    div.innerHTML = `
        <div>
            <label style="font-size:11px;font-weight:700;color:#9a3412;display:block;margin-bottom:3px;text-transform:uppercase;">Year</label>
            <input type="number" class="veh-year" min="1900" max="2099" placeholder="2024" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#9a3412;display:block;margin-bottom:3px;text-transform:uppercase;">Make</label>
            <input type="text" class="veh-make" placeholder="Toyota" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#9a3412;display:block;margin-bottom:3px;text-transform:uppercase;">Model</label>
            <input type="text" class="veh-model" placeholder="Camry" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
            <label style="font-size:11px;font-weight:700;color:#9a3412;display:block;margin-bottom:3px;text-transform:uppercase;">VIN</label>
            <input type="text" class="veh-vin" placeholder="17-character VIN" maxlength="17" style="width:100%;padding:7px 9px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:monospace;text-transform:uppercase;box-sizing:border-box;">
        </div>
        <button type="button" onclick="this.closest('.vehicle-row').remove(); updateVehiclesEmptyState();" title="Remove vehicle"
            style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;padding:7px 10px;cursor:pointer;font-weight:700;font-size:14px;height:32px;">✕</button>
    `;
    container.appendChild(div);
    if (prefill) {
        if (prefill.year)  div.querySelector('.veh-year').value  = prefill.year;
        if (prefill.make)  div.querySelector('.veh-make').value  = prefill.make;
        if (prefill.model) div.querySelector('.veh-model').value = prefill.model;
        if (prefill.vin)   div.querySelector('.veh-vin').value   = prefill.vin;
    }
    updateVehiclesEmptyState();
    div.querySelector('.veh-year')?.focus();
}

function collectDriverRows() {
    const rows = document.querySelectorAll('#driversContainer .driver-row');
    const drivers = [];
    rows.forEach(r => {
        const driver = {
            firstName: r.querySelector('.drv-firstName')?.value.trim() || '',
            lastName:  r.querySelector('.drv-lastName')?.value.trim()  || '',
            dob:       r.querySelector('.drv-dob')?.value              || '',
            dl:        r.querySelector('.drv-dl')?.value.trim()        || ''
        };
        if (driver.firstName || driver.lastName || driver.dob || driver.dl) {
            drivers.push(driver);
        }
    });
    return drivers;
}

function collectVehicleRows() {
    const rows = document.querySelectorAll('#vehiclesContainer .vehicle-row');
    const vehicles = [];
    rows.forEach(r => {
        const vehicle = {
            year:  r.querySelector('.veh-year')?.value.trim()           || '',
            make:  r.querySelector('.veh-make')?.value.trim()           || '',
            model: r.querySelector('.veh-model')?.value.trim()          || '',
            vin:   r.querySelector('.veh-vin')?.value.trim().toUpperCase() || ''
        };
        if (vehicle.year || vehicle.make || vehicle.model || vehicle.vin) {
            vehicles.push(vehicle);
        }
    });
    return vehicles;
}

function resetDriversVehicles() {
    const dc = document.getElementById('driversContainer');
    const vc = document.getElementById('vehiclesContainer');
    if (dc) dc.innerHTML = '';
    if (vc) vc.innerHTML = '';
    _driverRowCounter = 0;
    _vehicleRowCounter = 0;
    // Both sections start empty — they're optional, agent adds rows only if needed
    updateDriversEmptyState();
    updateVehiclesEmptyState();
}

function updateDriversEmptyState() {
    const dc = document.getElementById('driversContainer');
    const ds = document.getElementById('driversEmptyState');
    if (!dc || !ds) return;
    ds.style.display = dc.children.length === 0 ? 'block' : 'none';
}

function updateVehiclesEmptyState() {
    const vc = document.getElementById('vehiclesContainer');
    const vs = document.getElementById('vehiclesEmptyState');
    if (!vc || !vs) return;
    vs.style.display = vc.children.length === 0 ? 'block' : 'none';
}

// ============================================================
// BINDERBOOK → AMS SYNC
// Whenever a Daily Sales Entry is saved, mirror the customer's
// contact info (drivers, vehicles, agent, location, source) into
// the AMS client record so AMS instantly sees them.
// ============================================================

function amsClientKeyFromName(name) {
    return (name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function splitCustomerName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/);
    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return {
        firstName: parts[0],
        lastName:  parts.slice(1).join(' ')
    };
}

function syncEntryToAMS(entry) {
    if (!entry || !entry.customerName) return;
    try {
        const key = amsClientKeyFromName(entry.customerName);
        if (!key) return;

        const contacts = JSON.parse(localStorage.getItem('amsClientData')) || {};
        const existing = contacts[key] || {};
        const now = new Date().toISOString();

        // Best-effort name split (only if AMS doesn't already have them)
        const split = splitCustomerName(entry.customerName);

        // Pull info from the first driver if provided (often the primary)
        const primaryDriver = (entry.drivers && entry.drivers.length > 0) ? entry.drivers[0] : null;

        const updated = {
            // Preserve any field already set in AMS — only fill blanks
            firstName:      existing.firstName      || (primaryDriver?.firstName) || split.firstName,
            lastName:       existing.lastName       || (primaryDriver?.lastName)  || split.lastName,
            dob:            existing.dob            || (primaryDriver?.dob)       || '',
            dlNum:          existing.dlNum          || (primaryDriver?.dl)        || '',
            phone1:         existing.phone1         || '',
            phone2:         existing.phone2         || '',
            email:          existing.email          || '',
            address:        existing.address        || '',
            city:           existing.city           || '',
            state:          existing.state          || '',
            zip:            existing.zip            || '',
            gender:         existing.gender         || '',
            marital:        existing.marital        || '',
            ssn4:           existing.ssn4           || '',
            dlState:        existing.dlState        || '',
            dlExp:          existing.dlExp          || '',
            language:       existing.language       || '',
            prefContact:    existing.prefContact    || '',
            csrName:        existing.csrName        || '',
            clientStatus:   existing.clientStatus   || 'Active',

            // These get updated from the latest entry
            assignedAgent:   entry.agent       || existing.assignedAgent   || '',
            dealerLocation:  entry.location    || existing.dealerLocation  || '',
            referral:        entry.referredBy  || existing.referral        || '',
            referralSource:  entry.source      || existing.referralSource  || '',
            clientSince:     existing.clientSince || (entry.entryDate || '').slice(0, 10) || '',

            // Drivers and vehicles arrays — merge/dedupe by name + vin
            drivers:  mergeDrivers(existing.drivers  || [], entry.drivers  || []),
            vehicles: mergeVehicles(existing.vehicles || [], entry.vehicles || []),

            // Preserve notes/uploads/etc if present
            notes:    existing.notes    || [],

            updatedAt: now,
            createdAt: existing.createdAt || now,
            createdBy: existing.createdBy || (entry.agent || '')
        };

        contacts[key] = updated;
        localStorage.setItem('amsClientData', JSON.stringify(contacts));

        // Sync to Drive in the background
        if (typeof driveSet === 'function') {
            driveSet('amsClientData', contacts);
        }
    } catch (e) {
        console.warn('AMS sync failed for entry', entry?.customerName, e);
    }
}

function mergeDrivers(existing, incoming) {
    const dedup = new Map();
    [...existing, ...incoming].forEach(d => {
        if (!d || (!d.firstName && !d.lastName && !d.dl)) return;
        const k = `${(d.firstName || '').toLowerCase().trim()}|${(d.lastName || '').toLowerCase().trim()}|${(d.dl || '').trim()}`;
        if (!k.replace(/\|/g, '')) return; // all-empty
        dedup.set(k, d);
    });
    return Array.from(dedup.values());
}

function mergeVehicles(existing, incoming) {
    const dedup = new Map();
    [...existing, ...incoming].forEach(v => {
        if (!v || (!v.year && !v.make && !v.model && !v.vin)) return;
        const k = (v.vin || '').toUpperCase().trim() ||
                  `${v.year}|${(v.make || '').toLowerCase().trim()}|${(v.model || '').toLowerCase().trim()}`;
        if (!k) return;
        dedup.set(k, v);
    });
    return Array.from(dedup.values());
}

// Make amsClientData a synced key (Drive pull + push)
(function ensureAmsClientDataSynced() {
    if (typeof SYNC_KEYS !== 'undefined' && !SYNC_KEYS.includes('amsClientData')) {
        SYNC_KEYS.push('amsClientData');
    }
})();
