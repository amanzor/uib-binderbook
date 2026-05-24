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

// Keys that should never be overwritten by a Drive pull —
// credentials are pushed to Drive as backup but managed locally only.
const DRIVE_PULL_SKIP = new Set(['agentCredentials']);

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
    const saved = localStorage.getItem('rememberedAgentEmail') || '';
    document.getElementById('agentLoginEmail').value = saved;
    document.getElementById('agentLoginPassword').value = '';
    document.getElementById('agentLoginError').style.display = 'none';
    const rememberBox = document.getElementById('rememberAgentEmail');
    if (rememberBox) rememberBox.checked = !!saved;
    const m = document.getElementById('agentEmailLoginModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    refreshIcons();
    setTimeout(() => {
        const userField = document.getElementById('agentLoginEmail');
        if (saved) {
            document.getElementById('agentLoginPassword').focus();
        } else {
            userField.focus();
        }
    }, 80);
}

function closeAgentEmailLogin() {
    document.getElementById('agentEmailLoginModal').classList.remove('active');
}

function submitAgentEmailLogin(e) {
    e.preventDefault();
    const input    = document.getElementById('agentLoginEmail').value.trim().toLowerCase();
    const password = document.getElementById('agentLoginPassword').value.trim();
    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    const errEl = document.getElementById('agentLoginError');

    // Helper: get the stored password regardless of format (old flat string or new object)
    function getStoredPassword(cred) {
        if (typeof cred === 'string') return cred;           // old format
        if (typeof cred === 'object') return cred.password || ''; // new format
        return '';
    }
    function getStoredEmail(cred) {
        if (typeof cred === 'object') return (cred.email || '').toLowerCase();
        return '';
    }

    // Match by: exact agent name (from picker), OR email, OR full name, OR first name
    const match = Object.entries(credentials).find(([name, cred]) => {
        const storedPass  = getStoredPassword(cred);
        const storedEmail = getStoredEmail(cred);
        const firstName   = name.split(' ')[0].toLowerCase();

        const byName      = name === input || name.toLowerCase() === input;
        const byEmail     = storedEmail && storedEmail === input;
        const byFirstName = firstName === input;

        return (byName || byEmail || byFirstName) && storedPass === password;
    });

    if (!match) {
        errEl.textContent = 'Incorrect password. Please try again.';
        errEl.style.display = 'block';
        return;
    }

    const agentName = match[0];
    errEl.style.display = 'none';

    const remember = document.getElementById('rememberAgentEmail')?.checked;
    if (remember) {
        localStorage.setItem('rememberedAgentEmail', input);
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
                        onchange="autoSaveCredential('${agent}')"
                        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:13px;">
                </div>
                <div>
                    <label style="font-size:12px;color:var(--gray-500);font-weight:600;display:block;margin-bottom:4px;">Password</label>
                    <input type="text" id="page_cred_pass_${key}"
                        value="${cred.password || ''}" placeholder="Enter password"
                        onchange="autoSaveCredential('${agent}')"
                        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:13px;">
                </div>
            </div>
        </div>`;
    }).join('');
    refreshIcons();
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
    // Show agents immediately — don't wait for Drive sync
    initializeCredentials();
    initializeCommissionData();
    initializeCarrierData();
    refreshAllCarrierDropdowns();
    initializeAgentData();
    initializeCommissionStatements();
    setTodayDate();

    ['agencyFee', 'agencyCommission'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateAgentCommission);
    });

    // Auto-calculate carrier commission when key fields change
    ['basePremium', 'company', 'lineOfBusiness', 'paymentType', 'policyType'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', autoCalculateCommission);
        document.getElementById(id)?.addEventListener('input', autoCalculateCommission);
    });

    // Render Lucide icons in static HTML
    refreshIcons();

    // Animate header + login screen on first paint
    if (window.UIBMotion) {
        UIBMotion.animateHeader();
        UIBMotion.animateAgentCards();
        UIBMotion.addRippleToButtons();
    }

    // Sync from Drive in background — won't block the UI
    syncFromDrive().then(() => {
        refreshIcons();
    });

    // Start polling Drive every 30 seconds for live updates
    startAutoSync();
});

function calculateAgentCommission() {
    const fee = parseFloat(document.getElementById('agencyFee').value) || 0;
    const commission = parseFloat(document.getElementById('agencyCommission').value) || 0;
    const agentShare = parseFloat(((fee + commission) * 0.5).toFixed(2));
    const field = document.getElementById('agentCommission');
    if (field) field.value = agentShare > 0 ? agentShare : '';
}

function autoCalculateCommission() {
    const basePremium  = parseFloat(document.getElementById('basePremium')?.value) || 0;
    const carrier      = document.getElementById('company')?.value;
    const lob          = document.getElementById('lineOfBusiness')?.value;
    const paymentType  = document.getElementById('paymentType')?.value;
    const policyType   = document.getElementById('policyType')?.value;

    const rateLabel    = document.getElementById('commissionRateLabel');
    const breakdown    = document.getElementById('commissionBreakdown');

    if (!carrier || !lob || !paymentType || basePremium <= 0) {
        if (rateLabel)  { rateLabel.style.display  = 'none'; rateLabel.textContent = ''; }
        if (breakdown)  { breakdown.style.display  = 'none'; breakdown.textContent = ''; }
        return;
    }

    const rate = getCommissionRate(carrier, lob, paymentType, policyType);
    const typeLabel = (policyType === 'Renewal' || policyType === 'Renew A-B') ? 'Renew' : 'New';

    if (rate > 0) {
        const agencyFee  = parseFloat(document.getElementById('agencyFee')?.value) || 0;
        const carrierComm = parseFloat((basePremium * (rate / 100)).toFixed(2));
        const commission  = parseFloat(((carrierComm + agencyFee) * 0.5).toFixed(2));

        // Populate the Agency Commission field
        const commField = document.getElementById('agencyCommission');
        if (commField) commField.value = commission;

        // Show the rate label and breakdown
        if (rateLabel) {
            rateLabel.textContent = `— Auto: ${rate}% (${typeLabel}) carrier rate`;
            rateLabel.style.display = 'inline';
        }
        if (breakdown) {
            const feeStr = agencyFee > 0 ? ` + $${agencyFee.toLocaleString()}` : '';
            breakdown.innerHTML = `💡 ($${basePremium.toLocaleString()} × ${rate}%${feeStr}) × 50% = <strong>$${commission.toLocaleString()}</strong>`;
            breakdown.style.display = 'block';
        }

        // Recalculate agent share
        calculateAgentCommission();
    } else {
        if (rateLabel) {
            rateLabel.textContent = '— No rule set for this carrier/LOB';
            rateLabel.style.display = 'inline';
            rateLabel.style.color = '#e65100';
        }
        if (breakdown) {
            breakdown.style.display = 'none';
        }
    }
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

    AGENTS.forEach(agent => {

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
    const credentials = JSON.parse(localStorage.getItem('agentCredentials')) || {};
    const cred = credentials[agent] || {};

    // Pre-fill username: use saved email if configured, else agent full name
    const username = cred.email || agent.toLowerCase();
    document.getElementById('agentLoginEmail').value = username;
    document.getElementById('agentLoginPassword').value = '';
    document.getElementById('agentLoginError').style.display = 'none';

    // Update modal title to show which agent is signing in
    const titleEl = document.querySelector('#agentEmailLoginModal h3');
    if (titleEl) titleEl.innerHTML = `<i data-lucide="log-in"></i> Sign in as ${agent.split(' ')[0]}`;

    const m = document.getElementById('agentEmailLoginModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    refreshIcons();
    setTimeout(() => document.getElementById('agentLoginPassword').focus(), 120);
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
        location: _selectedSalesLocation || '',
        timestamp: getEasternTimestamp()
    };
    entry.agentCommissionShare = parseFloat(((entry.agencyFee + entry.agencyCommission) * 0.5).toFixed(2));

    allData.push(entry);
    localStorage.setItem('binderData', JSON.stringify(allData));

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

    // Populate agent dropdown — combine all three sources, dedup, sort
    const sel = document.getElementById('vl_agent');
    const fromMaster      = Object.keys(JSON.parse(localStorage.getItem('agentMasterData'))  || {});
    const fromCredentials = Object.keys(JSON.parse(localStorage.getItem('agentCredentials')) || {});
    const allAgents = [...new Set([...AGENTS, ...fromMaster, ...fromCredentials])].sort();
    sel.innerHTML = '<option value="">Select Agent</option>' +
        allAgents.map(a => `<option value="${a}">${a}</option>`).join('');

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
function openNewProspectModal() {
    const m = document.getElementById('newProspectModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
    // Set today's date + time (ET)
    document.getElementById('prospectDateAdded').value = getEasternDateTimeDisplay();

    // Populate agent dropdown from agentMasterData
    const agentSelect = document.getElementById('prospectAgent');
    const agents = Object.keys(JSON.parse(localStorage.getItem('agentMasterData')) || {}).sort();
    agentSelect.innerHTML = '<option value="">Select Agent</option>' +
        agents.map(a => `<option value="${a}">${a}</option>`).join('');

    document.getElementById('prospectSuccessMsg').style.display = 'none';
}

function closeNewProspectModal() {
    document.getElementById('newProspectModal').classList.remove('active');
    document.getElementById('prospectForm').reset();
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
        agent:       document.getElementById('prospectAgent').value,
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
    // Show location picker first
    document.getElementById('salesLocationModal').classList.add('active');
}

function selectLocationAndOpenSales(location) {
    _selectedSalesLocation = location;
    document.getElementById('salesLocationModal').classList.remove('active');
    document.getElementById('salesLocationDisplay').textContent = location;
    setTodayDate();
    generateBinderNumber();
    refreshAllCarrierDropdowns(); // ensure newly added carriers are present
    const m = document.getElementById('dailySalesModal');
    m.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(m);
}

function closeDailySalesModal() {
    document.getElementById('dailySalesModal').classList.remove('active');
    _selectedSalesLocation = '';
    document.getElementById('salesLocationDisplay').textContent = '—';
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
    const agentEntries = allData.filter(d => d.agent === currentUser);
    renderAgentTable(agentEntries);
    apdInit(); // refresh inline production dashboard
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
                <button class="btn-primary btn-sm" onclick="openEditModal(${entry.id})"><i data-lucide="pencil"></i> Edit</button>
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
    loadAgentData();
}

// Admin Dashboard
function loadAdminDashboard() {
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
                <button class="btn-primary btn-sm" onclick="openEditModal(${entry.id})" style="margin-right:4px;"><i data-lucide="pencil"></i> Edit</button>
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
        "Hiscox", "Hudson", "Imperial Flood", "Infinity", "Johnson&Johnson", "Mercury",
        "Monarch", "Mount Vernon Fire", "NICO", "National General", "Next Insurance",
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

    tbody.innerHTML = AGENTS.map(agent => {
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
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:32px;">No commission data found.</td></tr>';
        document.getElementById('uicRowCount').textContent = '';
        return;
    }

    // Sort: agent → month → carrier
    rows.sort((a, b) => a.agent.localeCompare(b.agent) || a.month.localeCompare(b.month) || a.carrier.localeCompare(b.carrier));

    tbody.innerHTML = rows.map((r, i) => {
        const breakdown = r.rate > 0
            ? `<span style="font-size:11px;color:var(--gray-400);display:block;">$${r.premium.toLocaleString('en-US',{minimumFractionDigits:2})} × ${r.rate}%</span>`
            : '';
        const bg = i % 2 === 0 ? '' : 'background:#f9fafb;';
        return `<tr style="${bg}border-bottom:1px solid var(--gray-100);">
            <td style="padding:10px 12px;font-weight:600;">${r.agent}</td>
            <td style="padding:10px 12px;font-size:13px;">${r.type}</td>
            <td style="padding:10px 12px;">${r.carrier}</td>
            <td style="padding:10px 12px;font-size:13px;color:var(--gray-500);">${r.lob}</td>
            <td style="padding:10px 12px;font-size:13px;color:var(--gray-500);">${r.month}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:700;color:#059669;">
                $${r.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
                ${breakdown}
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

function loadAgentCommissionData() {
    const commissions = loadCommissionData();
    const agent = currentUser;

    const agentData = commissions[agent] || { monthlyPaidCommissionCarriers: {}, grossPaidCarriers: {} };
    const monthlyPaidCarriers = agentData.monthlyPaidCommissionCarriers || {};
    const grossPaidCarriers = agentData.grossPaidCarriers || {};
    const agentShares = getAgentCommissionShares(agent);

    let totalCommissions = 0;
    let allMonths = new Set();

    Object.values(monthlyPaidCarriers).forEach(carrier => {
        Object.values(carrier).forEach(entry => { totalCommissions += typeof entry === 'object' ? entry.amount : entry; });
        Object.keys(carrier).forEach(month => allMonths.add(month));
    });
    Object.values(grossPaidCarriers).forEach(carrier => {
        Object.values(carrier).forEach(entry => { totalCommissions += typeof entry === 'object' ? entry.amount : entry; });
        Object.keys(carrier).forEach(month => allMonths.add(month));
    });
    Object.values(agentShares).forEach(m => { totalCommissions += m.total; Object.keys(agentShares).forEach(mo => allMonths.add(mo)); });

    const monthCount = allMonths.size;
    document.getElementById('agentTotalCommissions').textContent = `$${totalCommissions.toFixed(2)}`;
    document.getElementById('agentAvgCommission').textContent = `$${(monthCount > 0 ? totalCommissions / monthCount : 0).toFixed(2)}`;
    document.getElementById('agentCommissionCount').textContent = monthCount;

    const tbody = document.getElementById('agentCommissionTable');
    const hasCarrierData = Object.keys(monthlyPaidCarriers).length > 0 || Object.keys(grossPaidCarriers).length > 0;
    const hasShareData = Object.keys(agentShares).length > 0;

    if (!hasCarrierData && !hasShareData) {
        tbody.innerHTML = '<tr><td colspan="4" class="no-data">No commission data available</td></tr>';
        return;
    }

    let tableHTML = '';

    const renderCarrierRows = (carriers, header, color) => {
        if (Object.keys(carriers).length === 0) return;
        tableHTML += `<tr style="background-color: ${color}; font-weight: bold;"><td colspan="4">${header}</td></tr>`;
        Object.entries(carriers).forEach(([carrier, months]) => {
            Object.entries(months).forEach(([month, entry], idx) => {
                const amount = typeof entry === 'object' ? entry.amount : entry;
                const lob = typeof entry === 'object' ? entry.lob : '-';
                const rate = typeof entry === 'object' ? entry.rate : 0;
                const premium = typeof entry === 'object' ? entry.premium : 0;
                const display = premium > 0 && rate > 0 ? `($${premium.toFixed(2)}×${rate}%)×50%=$${amount.toFixed(2)}` : `$${amount.toFixed(2)}`;
                tableHTML += `<tr><td>${idx === 0 ? carrier : ''}</td><td>${lob}</td><td>${month}</td><td style="font-family: monospace; font-size: 0.95em;">${display}</td></tr>`;
            });
        });
    };

    renderCarrierRows(monthlyPaidCarriers, '📅 Monthly Paid Commission Carriers', '#e3f2fd');
    renderCarrierRows(grossPaidCarriers, '💰 Gross Paid Carriers', '#f3e5f5');

    if (hasShareData) {
        tableHTML += `<tr style="background-color: #e8f5e9; font-weight: bold;"><td colspan="4">🤝 Agent Commission (50% of Agency Fee + Agency Commission)</td></tr>`;
        Object.entries(agentShares).forEach(([month, data]) => {
            tableHTML += `<tr>
                <td>Agent Commission</td>
                <td>${data.count} polic${data.count === 1 ? 'y' : 'ies'}</td>
                <td>${month}</td>
                <td style="font-family: monospace; font-size: 0.95em;">($${data.agencyFeeTotal.toFixed(2)}+$${data.agencyCommissionTotal.toFixed(2)})×50%=<strong>$${data.total.toFixed(2)}</strong></td>
            </tr>`;
        });
    }

    tbody.innerHTML = tableHTML;
}

function exportAgentCommissions() {
    const commissions = loadCommissionData();
    const agent = currentUser;
    const agentData = commissions[agent] || { monthlyPaidCommissionCarriers: {}, grossPaidCarriers: {} };

    const monthlyPaidCarriers = agentData.monthlyPaidCommissionCarriers || {};
    const grossPaidCarriers = agentData.grossPaidCarriers || {};

    let csvLines = [
        `Commission Statement - ${agent}`,
        `Generated: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })} ET`,
        ''
    ];

    let totalAll = 0;

    // Monthly Paid Commission Carriers
    if (Object.keys(monthlyPaidCarriers).length > 0) {
        csvLines.push('MONTHLY PAID COMMISSION CARRIERS');
        csvLines.push('Carrier,Line of Business,Month,Commission');
        Object.entries(monthlyPaidCarriers).forEach(([carrier, months]) => {
            Object.entries(months).forEach(([month, entry]) => {
                const amount = typeof entry === 'object' ? entry.amount : entry;
                const lob = typeof entry === 'object' ? entry.lob : '-';
                csvLines.push(`${carrier},${lob},${month},$${amount.toFixed(2)}`);
                totalAll += amount;
            });
        });
        csvLines.push('');
    }

    // Gross Paid Carriers
    if (Object.keys(grossPaidCarriers).length > 0) {
        csvLines.push('GROSS PAID CARRIERS');
        csvLines.push('Carrier,Line of Business,Month,Commission');
        Object.entries(grossPaidCarriers).forEach(([carrier, months]) => {
            Object.entries(months).forEach(([month, entry]) => {
                const amount = typeof entry === 'object' ? entry.amount : entry;
                const lob = typeof entry === 'object' ? entry.lob : '-';
                csvLines.push(`${carrier},${lob},${month},$${amount.toFixed(2)}`);
                totalAll += amount;
            });
        });
        csvLines.push('');
    }

    const agentShares = getAgentCommissionShares(agent);
    if (Object.keys(agentShares).length > 0) {
        csvLines.push('AGENT COMMISSION (50% OF AGENCY COMMISSION)');
        csvLines.push('Month,Policies,Agency Commission,Agent Share (50%)');
        Object.entries(agentShares).forEach(([month, data]) => {
            csvLines.push(`${month},${data.count},$${data.agencyTotal.toFixed(2)},$${data.total.toFixed(2)}`);
            totalAll += data.total;
        });
        csvLines.push('');
    }

    csvLines.push(`TOTAL,$${totalAll.toFixed(2)}`);

    const csv = csvLines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent}_commissions_${getEasternDateString()}.csv`;
    a.click();
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

    // Populate Agent filter
    const agents = [...new Set(allData.map(d => d.agent).filter(Boolean))].sort();
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
