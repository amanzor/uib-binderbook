// ============================================================
// GOOGLE DRIVE SYNC
// ============================================================
const DRIVE_API_URL = "https://script.google.com/macros/s/AKfycbypm1A3G5Wgf4onwSU-yk6FbmTOA-9in7HcFrg0YWL6UBdhNj4di7yVDNlflLYwaehI/exec";
const SYNC_KEYS = ['binderData', 'agentMasterData', 'commissionData', 'carrierMasterData', 'agentCredentials', 'prospectData', 'verificationLogs'];

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

async function syncFromDrive() {
    const banner = document.getElementById('syncBanner');
    if (banner) banner.style.display = 'flex';
    for (const key of SYNC_KEYS) {
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
        if (freshCarriers) carrierMasterData = freshCarriers;

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

function toggleLobDropdown(id) {
    const container = document.getElementById(id);
    const btn = container.querySelector('.lob-multiselect-btn');
    const dropdown = container.querySelector('.lob-dropdown');
    const isOpen = dropdown.classList.contains('open');

    // Close all open dropdowns first
    document.querySelectorAll('.lob-dropdown.open').forEach(d => d.classList.remove('open'));

    if (!isOpen) {
        // Position the fixed dropdown under the button
        const rect = btn.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropH = 240;

        dropdown.style.left  = rect.left + 'px';
        dropdown.style.width = Math.max(rect.width, 220) + 'px';

        if (spaceBelow >= dropH || spaceBelow >= 120) {
            // Open downward
            dropdown.style.top    = (rect.bottom + 2) + 'px';
            dropdown.style.bottom = 'auto';
        } else {
            // Open upward
            dropdown.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
            dropdown.style.top    = 'auto';
        }

        dropdown.classList.add('open');
    }
}

function toggleLobSelectAll(id) {
    const container = document.getElementById(id);
    const selectAllCb = document.getElementById(id + '_all');
    container.querySelectorAll('.lob-dropdown input[type=checkbox]:not(#' + id + '_all)').forEach(cb => {
        cb.checked = selectAllCb.checked;
    });
    updateLobBtn(id);
}

function updateLobBtn(id) {
    const container = document.getElementById(id);
    const allCbs = Array.from(container.querySelectorAll('.lob-dropdown input[type=checkbox]:not(#' + id + '_all)'));
    const checked = allCbs.filter(cb => cb.checked).map(cb => cb.value);
    // Sync the Select All checkbox state
    const selectAllCb = document.getElementById(id + '_all');
    if (selectAllCb) selectAllCb.checked = checked.length === ALL_LOBS.length;
    const btn = container.querySelector('.lob-multiselect-btn');
    btn.textContent = checked.length === 0           ? 'Select LOB(s) ▾' :
                      checked.length === ALL_LOBS.length ? 'All LOBs ▾' :
                      checked.length === 1            ? checked[0] + ' ▾' :
                      checked.length + ' selected ▾';
}

function getLobSelections(rowEl) {
    return Array.from(rowEl.querySelectorAll('.lob-multiselect input[type=checkbox]:checked'))
        .filter(cb => !cb.id.endsWith('_all'))
        .map(cb => cb.value);
}

// Close LOB dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.lob-multiselect')) {
        document.querySelectorAll('.lob-dropdown.open').forEach(d => d.classList.remove('open'));
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

// Initialize credentials with default passwords
function initializeCredentials() {
    let credentials = JSON.parse(localStorage.getItem('agentCredentials'));
    if (!credentials) {
        credentials = {};
        AGENTS.forEach(agent => {
            credentials[agent] = agent.split(' ')[0].toLowerCase(); // Default: first name lowercase
        });
        localStorage.setItem('agentCredentials', JSON.stringify(credentials));
    }
    return credentials;
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
    initializeAgentData();
    initializeAgentButtons();
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
        initializeAgentButtons(); // Refresh agent buttons after sync
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
        const commission = parseFloat((basePremium * (rate / 100)).toFixed(2));

        // Populate the Agency Commission field
        const commField = document.getElementById('agencyCommission');
        if (commField) commField.value = commission;

        // Show the rate label and breakdown
        if (rateLabel) {
            rateLabel.textContent = `— Auto: ${rate}% (${typeLabel}) carrier rate`;
            rateLabel.style.display = 'inline';
        }
        if (breakdown) {
            breakdown.innerHTML = `💡 $${basePremium.toLocaleString()} × ${rate}% (${typeLabel}) = <strong>$${commission.toLocaleString()}</strong>`;
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
    const modal = document.getElementById('agentLoginModal');
    document.getElementById('loginAgentName').textContent = agent;
    document.getElementById('agentPassword').value = '';
    document.getElementById('selectedAgent').value = agent;
    modal.classList.add('active');
    if (window.UIBMotion) UIBMotion.animateModalOpen(modal);
    document.getElementById('agentPassword').focus();
}

function closeAgentLoginModal() {
    document.getElementById('agentLoginModal').classList.remove('active');
}

document.getElementById('agentLoginForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const agent = document.getElementById('selectedAgent').value;
    const password = document.getElementById('agentPassword').value;
    const credentials = JSON.parse(localStorage.getItem('agentCredentials'));

    if (credentials[agent] === password) {
        currentUser = agent;
        currentRole = 'agent';
        closeAgentLoginModal();
        showSection('agentSection');
        document.getElementById('userDisplay').textContent = `👤 Agent: ${agent}`;
        document.getElementById('agentForm').reset();
        setTodayDate();
        generateBinderNumber();
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

function setTodayDate() {
    const today = getEasternDateString();
    const entryDate = document.getElementById('entryDate');
    if (entryDate) entryDate.value = today;
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
        const commission = calculateCommission(premium, rate);
        const month = new Date(entry.entryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
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

        // Store commission with breakdown
        commData[agent][carrierType][carrier][month] = {
            amount: commission,
            lob: lob,
            rate: rate,
            premium: premium
        };

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

// ── Daily Sales Entry Modal ────────────────────────────────────
let _selectedSalesLocation = '';

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
}

function renderAgentTable(entries) {
    const tbody = document.getElementById('agentTable');
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="no-data">No entries yet</td></tr>';
        return;
    }

    tbody.innerHTML = entries.map(entry => `
        <tr>
            <td>${formatDate(entry.entryDate)}</td>
            <td>${entry.customerName}</td>
            <td>${entry.policyType}</td>
            <td>${entry.lineOfBusiness}</td>
            <td>${entry.company}</td>
            <td>$${entry.totalPremium.toFixed(2)}</td>
            <td>
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
    const tbody = document.getElementById('adminTable');
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="no-data">No data available</td></tr>';
        return;
    }

    tbody.innerHTML = entries.map(entry => `
        <tr>
            <td><strong>${entry.agent}</strong></td>
            <td>${formatDate(entry.entryDate)}</td>
            <td>${entry.customerName}</td>
            <td>${entry.policyType}</td>
            <td>${entry.lineOfBusiness}</td>
            <td>${entry.company}</td>
            <td>${entry.mga || '-'}</td>
            <td>${entry.binderNumber}</td>
            <td>$${entry.totalPremium.toFixed(2)}</td>
            <td>
                <button class="btn-danger btn-sm" onclick="deleteEntry(${entry.id})"><i data-lucide="trash-2"></i> Delete</button>
            </td>
        </tr>
    `).join('');
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
    document.getElementById('agentFilter').value = '';
    document.getElementById('monthFilter').value = '';
    loadAdminDashboard();
}

function getFilteredData() {
    const agent = document.getElementById('agentFilter')?.value;
    const month = document.getElementById('monthFilter')?.value;

    let filtered = allData;

    if (agent) {
        filtered = filtered.filter(d => d.agent === agent);
    }

    if (month) {
        filtered = filtered.filter(d => d.entryDate.startsWith(month));
    }

    return filtered;
}

// Edit & Delete
let editingId = null;

function openEditModal(id) {
    editingId = id;
    const entry = allData.find(d => d.id === id);
    if (!entry) return;
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
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    defaultCarriers.forEach(name => {
        if (!carrierData[name]) {
            carrierData[name] = {
                carrierName: name,
                phoneNumbers: ["", "", ""],
                emails: { underwriting: "", general: "", miscellaneous: "" },
                commissionRules: []
            };
            updated = true;
        }
    });

    if (!stored || updated) {
        carrierMasterData = carrierData;
        _origSetItem('carrierMasterData', JSON.stringify(carrierData));
        driveSet('carrierMasterData', carrierData);
    } else {
        carrierMasterData = carrierData;
    }
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
    const credentials = JSON.parse(localStorage.getItem('agentCredentials'));
    const tbody = document.getElementById('passwordTable');

    tbody.innerHTML = AGENTS.map(agent => `
        <tr>
            <td>${agent}</td>
            <td>
                <input type="password" value="${credentials[agent]}" id="pwd_${agent}" class="password-input">
            </td>
            <td>
                <button class="btn-success btn-sm" onclick="updateAgentPassword('${agent}')">Update</button>
            </td>
        </tr>
    `).join('');
}

function updateAgentPassword(agent) {
    const newPassword = document.getElementById(`pwd_${agent}`).value;
    if (!newPassword || newPassword.trim() === '') {
        alert('Password cannot be empty');
        return;
    }

    const credentials = JSON.parse(localStorage.getItem('agentCredentials'));
    credentials[agent] = newPassword;
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

function openAddCarrierModal() {
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
                <td style="padding:6px 4px;">${createLobMultiSelectHTML(lobs)}</td>
                <td style="padding:6px 4px;">
                    <select style="width: 100%; padding: 5px; font-size:13px;">
                        <option value="Monthly Paid" ${rule.paymentType === 'Monthly Paid' ? 'selected' : ''}>Monthly Paid</option>
                        <option value="Gross Paid" ${rule.paymentType === 'Gross Paid' ? 'selected' : ''}>Gross Paid</option>
                    </select>
                </td>
                <td style="padding:6px 4px; text-align:center;"><input type="number" step="0.1" value="${rule.newRate ?? rule.commissionRate ?? ''}" placeholder="0.0" style="width: 100%; padding: 5px; font-size:13px; text-align:center;" /></td>
                <td style="padding:6px 4px; text-align:center;"><input type="number" step="0.1" value="${rule.renewRate ?? ''}" placeholder="0.0" style="width: 100%; padding: 5px; font-size:13px; text-align:center;" /></td>
                <td style="padding:6px 4px; text-align:center;"><button type="button" class="btn-danger" onclick="removeCommissionRuleRow(this)" style="padding: 4px 8px; font-size: 12px;">❌</button></td>
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
        localStorage.setItem('carrierMasterData', JSON.stringify(carriers));
        loadCarrierList();
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
        <td style="padding:6px 4px;">${createLobMultiSelectHTML([])}</td>
        <td style="padding:6px 4px;">
            <select style="width: 100%; padding: 5px; font-size:13px;">
                <option value="">Select Type</option>
                <option value="Monthly Paid">Monthly Paid</option>
                <option value="Gross Paid">Gross Paid</option>
            </select>
        </td>
        <td style="padding:6px 4px; text-align:center;"><input type="number" step="0.1" placeholder="0.0" style="width: 100%; padding: 5px; font-size:13px; text-align:center;" /></td>
        <td style="padding:6px 4px; text-align:center;"><input type="number" step="0.1" placeholder="0.0" style="width: 100%; padding: 5px; font-size:13px; text-align:center;" /></td>
        <td style="padding:6px 4px; text-align:center;"><button type="button" class="btn-danger" onclick="removeCommissionRuleRow(this)" style="padding: 4px 8px; font-size: 12px;">❌</button></td>
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

    alert(`Carrier "${carrierName}" saved successfully!`);
    closeAddEditCarrierModal();
    loadCarrierList();

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

function calculateCommission(premium, rate) {
    return parseFloat((premium * (rate / 100)).toFixed(2));
}

function getMonthYear() {
    return getEasternMonthYear();
}

function recalculateAllCommissions() {
    const allPolicies = JSON.parse(localStorage.getItem('binderData')) || [];
    const carriers = JSON.parse(localStorage.getItem('carrierMasterData')) || {};

    // Initialize empty commission data
    let newCommissionData = {};

    // Iterate through all policies
    allPolicies.forEach(policy => {
        const agent = policy.agent;
        const carrier = policy.company;
        const lob = policy.lineOfBusiness;
        const premium = parseFloat(policy.totalPremium) || 0;
        const paymentType = policy.paymentType || 'Monthly Paid';
        const policyType  = policy.policyType  || 'New';
        const month = policy.entryDate ? new Date(policy.entryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : getMonthYear();

        // Get commission rate
        const rate = getCommissionRate(carrier, lob, paymentType, policyType);

        if (rate > 0) {
            // Calculate commission
            const commission = calculateCommission(premium, rate);

            // Determine carrier type
            const carrierType = paymentType === 'Monthly Paid' ? 'monthlyPaidCommissionCarriers' : 'grossPaidCarriers';

            // Initialize agent structure if needed
            if (!newCommissionData[agent]) {
                newCommissionData[agent] = {
                    monthlyPaidCommissionCarriers: {},
                    grossPaidCarriers: {}
                };
            }

            // Initialize carrier in type if needed
            if (!newCommissionData[agent][carrierType]) {
                newCommissionData[agent][carrierType] = {};
            }

            if (!newCommissionData[agent][carrierType][carrier]) {
                newCommissionData[agent][carrierType][carrier] = {};
            }

            // Store commission with breakdown
            newCommissionData[agent][carrierType][carrier][month] = {
                amount: commission,
                lob: lob,
                rate: rate,
                premium: premium
            };
        }
    });

    // Update global and localStorage
    commissionData = newCommissionData;
    localStorage.setItem('commissionData', JSON.stringify(newCommissionData));
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
            ? `$${c.premium.toFixed(2)}×${c.rate}%=$${c.amount.toFixed(2)}`
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
        const entryMonth = new Date(e.entryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
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
        const month = new Date(e.entryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
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
                const display = premium > 0 && rate > 0 ? `$${premium.toFixed(2)}×${rate}%=$${amount.toFixed(2)}` : `$${amount.toFixed(2)}`;
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
