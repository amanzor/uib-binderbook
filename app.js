// Data Management
let currentUser = null;
let currentRole = null;
let allData = JSON.parse(localStorage.getItem('binderData')) || [];
let carrierMasterData = JSON.parse(localStorage.getItem('carrierMasterData')) || {};

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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeCredentials();
    initializeCommissionData();
    initializeCarrierData();
    initializeAgentData();
    initializeAgentButtons();
    setTodayDate();
});

function initializeAgentButtons() {
    const agentList = document.getElementById('agentList');
    agentList.innerHTML = '';
    AGENTS.forEach(agent => {
        const btn = document.createElement('button');
        btn.className = 'agent-btn';
        btn.textContent = agent;
        btn.onclick = () => showAgentLoginModal(agent);
        agentList.appendChild(btn);
    });
}

function showAgentLoginModal(agent) {
    const modal = document.getElementById('agentLoginModal');
    document.getElementById('loginAgentName').textContent = agent;
    document.getElementById('agentPassword').value = '';
    document.getElementById('agentPassword').focus();
    document.getElementById('selectedAgent').value = agent;
    modal.classList.add('active');
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
        loadAgentData();
        populateAgentFilter();
    } else {
        alert('Incorrect password');
        document.getElementById('agentPassword').value = '';
        document.getElementById('agentPassword').focus();
    }
});

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    const entryDate = document.getElementById('entryDate');
    if (entryDate) entryDate.value = today;
}

function generateBinderNumber() {
    if (!currentUser) return;

    const year = new Date().getFullYear();
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
    document.getElementById('adminLoginModal').classList.add('active');
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
        loadAdminDashboard();
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
    document.getElementById(sectionId).classList.add('active');
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
        policyType: document.getElementById('policyType').value,
        lineOfBusiness: document.getElementById('lineOfBusiness').value,
        company: document.getElementById('company').value,
        mga: document.getElementById('mga').value,
        down: parseFloat(document.getElementById('down').value) || 0,
        basePremium: parseFloat(document.getElementById('basePremium').value),
        totalPremium: parseFloat(document.getElementById('totalPremium').value),
        paymentType: document.getElementById('paymentType').value,
        policyNumber: document.getElementById('policyNumber').value,
        binderNumber: document.getElementById('binderNumber').value,
        entryDate: document.getElementById('entryDate').value,
        effDate: document.getElementById('effDate').value,
        term: document.getElementById('term').value,
        timestamp: new Date().toISOString()
    };

    allData.push(entry);
    localStorage.setItem('binderData', JSON.stringify(allData));

    // Calculate and store commission
    const premium = entry.totalPremium;
    const carrier = entry.company;
    const lob = entry.lineOfBusiness;
    const paymentType = entry.paymentType || 'Monthly Paid';
    const agent = entry.agent;

    const rate = getCommissionRate(carrier, lob, paymentType);

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
    setTodayDate();
    loadAgentData();
}

function showSuccess() {
    const msg = document.getElementById('successMessage');
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 3000);
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
                <button class="btn-primary btn-sm" onclick="openEditModal(${entry.id})">Edit</button>
                <button class="btn-danger btn-sm" onclick="deleteEntry(${entry.id})">Delete</button>
            </td>
        </tr>
    `).join('');
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
}

function renderCharts() {
    const filteredData = getFilteredData();

    // Agent Chart
    const agentData = {};
    filteredData.forEach(d => {
        agentData[d.agent] = (agentData[d.agent] || 0) + d.totalPremium;
    });

    const agentChart = document.getElementById('agentChart');
    agentChart.innerHTML = Object.entries(agentData)
        .map(([agent, total]) => `
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <strong>${agent}</strong>
                    <span>$${total.toFixed(2)}</span>
                </div>
                <div style="background: #e0e0e0; border-radius: 4px; height: 25px; overflow: hidden;">
                    <div style="background: linear-gradient(90deg, #667eea, #764ba2); height: 100%; width: ${(total / Math.max(...Object.values(agentData))) * 100}%;">
                    </div>
                </div>
            </div>
        `).join('');

    // Business Chart
    const businessData = {};
    filteredData.forEach(d => {
        businessData[d.lineOfBusiness] = (businessData[d.lineOfBusiness] || 0) + d.totalPremium;
    });

    const businessChart = document.getElementById('businessChart');
    businessChart.innerHTML = Object.entries(businessData)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([business, total]) => `
            <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <strong>${business}</strong>
                    <span>$${total.toFixed(2)}</span>
                </div>
                <div style="background: #e0e0e0; border-radius: 4px; height: 25px; overflow: hidden;">
                    <div style="background: linear-gradient(90deg, #f093fb, #f5576c); height: 100%; width: ${(total / Math.max(...Object.values(businessData))) * 100}%;">
                    </div>
                </div>
            </div>
        `).join('');
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
                <button class="btn-danger btn-sm" onclick="deleteEntry(${entry.id})">Delete</button>
            </td>
        </tr>
    `).join('');
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
    if (entry) {
        document.getElementById('editCustomerName').value = entry.customerName;
        document.getElementById('editTotalPremium').value = entry.totalPremium;
        document.getElementById('editStatus').value = entry.status;
        document.getElementById('editModal').classList.add('active');
    }
}

function closeModal() {
    document.getElementById('editModal').classList.remove('active');
    editingId = null;
}

function updateEntry() {
    const entry = allData.find(d => d.id === editingId);
    if (entry) {
        entry.customerName = document.getElementById('editCustomerName').value;
        entry.totalPremium = parseFloat(document.getElementById('editTotalPremium').value);
        entry.status = document.getElementById('editStatus').value;
        localStorage.setItem('binderData', JSON.stringify(allData));
        closeModal();
        if (currentRole === 'agent') {
            loadAgentData();
        } else {
            loadAdminDashboard();
        }
    }
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

    const headers = ['Agent', 'Date', 'Customer', 'Policy Type', 'Line of Business', 'Company', 'Down', 'Base Premium', 'Total Premium', 'Payment Type', 'Policy #', 'Binder #', 'Term', 'Status'];

    const rows = entries.map(e => [
        e.agent,
        e.entryDate,
        e.customerName,
        e.policyType,
        e.lineOfBusiness,
        e.company,
        e.down,
        e.basePremium,
        e.totalPremium,
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
    alert('Excel export requires installation of a library. For now, please use CSV export and open in Excel.');
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
let commissionData = {
    "Alberto Manzor": {
        "monthlyPaidCommissionCarriers": {
            "AIG": { "May 2024": { "amount": 450.00, "lob": "Commercial" }, "Jun 2024": { "amount": 480.00, "lob": "Commercial" } },
            "Travelers": { "May 2024": { "amount": 380.00, "lob": "Personal" }, "Jun 2024": { "amount": 420.00, "lob": "Personal" } }
        },
        "grossPaidCarriers": {
            "State Farm": { "May 2024": { "amount": 320.00, "lob": "Personal" }, "Jun 2024": { "amount": 350.00, "lob": "Personal" } },
            "Allstate": { "May 2024": { "amount": 290.00, "lob": "Commercial" }, "Jun 2024": { "amount": 310.00, "lob": "Commercial" } }
        }
    },
    "Randy Diaz": {
        "monthlyPaidCommissionCarriers": {
            "AIG": { "May 2024": { "amount": 520.00, "lob": "Surety" }, "Jun 2024": { "amount": 550.00, "lob": "Surety" } },
            "Liberty Mutual": { "May 2024": { "amount": 410.00, "lob": "Commercial" }, "Jun 2024": { "amount": 440.00, "lob": "Commercial" } }
        },
        "grossPaidCarriers": {
            "State Farm": { "May 2024": { "amount": 380.00, "lob": "Personal" }, "Jun 2024": { "amount": 410.00, "lob": "Personal" } }
        }
    },
    "Amanda Montano": {
        "monthlyPaidCommissionCarriers": {},
        "grossPaidCarriers": {}
    },
    "Uriel Rendon": {
        "monthlyPaidCommissionCarriers": {
            "Travelers": { "May 2024": { "amount": 340.00, "lob": "Commercial" }, "Jun 2024": { "amount": 360.00, "lob": "Commercial" } }
        },
        "grossPaidCarriers": {
            "Allstate": { "May 2024": { "amount": 260.00, "lob": "Personal" }, "Jun 2024": { "amount": 280.00, "lob": "Personal" } }
        }
    },
    "Jorge Castro": {
        "monthlyPaidCommissionCarriers": {
            "AIG": { "May 2024": { "amount": 580.00, "lob": "Surety" }, "Jun 2024": { "amount": 620.00, "lob": "Surety" } },
            "Travelers": { "May 2024": { "amount": 490.00, "lob": "Commercial" }, "Jun 2024": { "amount": 530.00, "lob": "Commercial" } },
            "Liberty Mutual": { "May 2024": { "amount": 420.00, "lob": "Personal" }, "Jun 2024": { "amount": 460.00, "lob": "Personal" } }
        },
        "grossPaidCarriers": {
            "State Farm": { "May 2024": { "amount": 450.00, "lob": "Personal" }, "Jun 2024": { "amount": 480.00, "lob": "Personal" } },
            "Allstate": { "May 2024": { "amount": 380.00, "lob": "Commercial" }, "Jun 2024": { "amount": 410.00, "lob": "Commercial" } }
        }
    },
    "Lazaro Reigoza": {
        "monthlyPaidCommissionCarriers": {},
        "grossPaidCarriers": {}
    }
};

function initializeCommissionData() {
    localStorage.setItem('commissionData', JSON.stringify(commissionData));
}

function loadCommissionData() {
    const stored = localStorage.getItem('commissionData');
    if (stored) {
        return JSON.parse(stored);
    }
    return commissionData;
}

function initializeCarrierData() {
    const stored = localStorage.getItem('carrierMasterData');
    if (!stored) {
        localStorage.setItem('carrierMasterData', JSON.stringify({}));
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
    document.getElementById('carrierManagementModal').classList.add('active');
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
                <button class="btn-secondary" onclick="editCarrier('${name}')" style="padding: 5px 10px; font-size: 12px; margin-right: 5px;">✏️ Edit</button>
                <button class="btn-danger" onclick="deleteCarrier('${name}')" style="padding: 5px 10px; font-size: 12px;">🗑️ Delete</button>
            </td>
        </tr>`;
    }).join('');
}

function openAddCarrierModal() {
    document.getElementById('carrierFormTitle').textContent = 'Add New Carrier';
    document.getElementById('carrierForm').reset();
    document.getElementById('commissionRulesTable').innerHTML = '<tr><td colspan="4" class="no-data" style="text-align: center;">No commission rules yet. Click "Add Rule" to add one.</td></tr>';
    document.getElementById('addEditCarrierModal').classList.add('active');
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
        rulesTable.innerHTML = carrier.commissionRules.map((rule, index) => `
            <tr>
                <td>
                    <select style="width: 100%; padding: 5px;">
                        <option value="Commercial" ${rule.lineOfBusiness === 'Commercial' ? 'selected' : ''}>Commercial</option>
                        <option value="Personal" ${rule.lineOfBusiness === 'Personal' ? 'selected' : ''}>Personal</option>
                        <option value="Surety" ${rule.lineOfBusiness === 'Surety' ? 'selected' : ''}>Surety</option>
                    </select>
                </td>
                <td>
                    <select style="width: 100%; padding: 5px;">
                        <option value="Monthly Paid" ${rule.paymentType === 'Monthly Paid' ? 'selected' : ''}>Monthly Paid</option>
                        <option value="Gross Paid" ${rule.paymentType === 'Gross Paid' ? 'selected' : ''}>Gross Paid</option>
                    </select>
                </td>
                <td><input type="number" step="0.1" value="${rule.commissionRate}" style="width: 100%; padding: 5px;" /></td>
                <td><button type="button" class="btn-danger" onclick="removeCommissionRuleRow(this)" style="padding: 5px 10px; font-size: 12px;">❌</button></td>
            </tr>
        `).join('');
    } else {
        rulesTable.innerHTML = '<tr><td colspan="4" class="no-data" style="text-align: center;">No commission rules yet. Click "Add Rule" to add one.</td></tr>';
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
    const isEmpty = rulesTable.querySelector('tr[class="no-data"]');

    const newRow = document.createElement('tr');
    newRow.innerHTML = `
        <td>
            <select style="width: 100%; padding: 5px;">
                <option value="">Select LOB</option>
                <option value="Commercial">Commercial</option>
                <option value="Personal">Personal</option>
                <option value="Surety">Surety</option>
            </select>
        </td>
        <td>
            <select style="width: 100%; padding: 5px;">
                <option value="">Select Type</option>
                <option value="Monthly Paid">Monthly Paid</option>
                <option value="Gross Paid">Gross Paid</option>
            </select>
        </td>
        <td><input type="number" step="0.1" placeholder="e.g., 15.5" style="width: 100%; padding: 5px;" /></td>
        <td><button type="button" class="btn-danger" onclick="removeCommissionRuleRow(this)" style="padding: 5px 10px; font-size: 12px;">❌</button></td>
    `;

    if (isEmpty) {
        rulesTable.innerHTML = '';
    }

    rulesTable.appendChild(newRow);
}

function removeCommissionRuleRow(button) {
    const rulesTable = document.getElementById('commissionRulesTable');
    button.parentElement.parentElement.remove();

    if (rulesTable.children.length === 0) {
        rulesTable.innerHTML = '<tr><td colspan="4" class="no-data" style="text-align: center;">No commission rules yet. Click "Add Rule" to add one.</td></tr>';
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
        if (row.className !== 'no-data') {
            const cells = row.querySelectorAll('td');
            const lob = cells[0].querySelector('select')?.value;
            const paymentType = cells[1].querySelector('select')?.value;
            const rate = parseFloat(cells[2].querySelector('input')?.value);

            if (lob && paymentType && !isNaN(rate) && rate >= 0) {
                rules.push({
                    lineOfBusiness: lob,
                    paymentType: paymentType,
                    commissionRate: rate
                });
            }
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
    document.getElementById('agentManagementModal').classList.add('active');
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
                <button class="btn-primary btn-sm" onclick="editAgent('${agentName}')">Edit</button>
                <button class="btn-danger btn-sm" onclick="deleteAgent('${agentName}')">Delete</button>
            </td>
        </tr>`;
    });

    tbody.innerHTML = tableHTML;
}

// Open Add Agent Modal
function openAddAgentModal() {
    document.getElementById('agentFormTitle').textContent = 'Add New Agent';
    document.getElementById('agentForm').reset();
    document.getElementById('agentForm').dataset.editingAgent = '';
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

    document.getElementById('agentForm').dataset.editingAgent = agentName;
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
document.getElementById('agentForm')?.addEventListener('submit', (e) => {
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
        createdAt: isEditing ? (agents[isEditing]?.createdAt || new Date().toISOString()) : new Date().toISOString(),
        updatedAt: new Date().toISOString()
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
function getCommissionRate(carrierName, lob, paymentType) {
    const carriers = JSON.parse(localStorage.getItem('carrierMasterData')) || {};
    const carrier = carriers[carrierName];

    if (!carrier || !carrier.commissionRules) {
        return 0;
    }

    const rule = carrier.commissionRules.find(r =>
        r.lineOfBusiness === lob && r.paymentType === paymentType
    );

    return rule ? rule.commissionRate : 0;
}

function calculateCommission(premium, rate) {
    return parseFloat((premium * (rate / 100)).toFixed(2));
}

function getMonthYear() {
    const now = new Date();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
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
        const paymentType = policy.paymentType || 'Monthly Paid';  // Default to Monthly Paid if not set
        const month = policy.entryDate ? new Date(policy.entryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) : getMonthYear();

        // Get commission rate
        const rate = getCommissionRate(carrier, lob, paymentType);

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
    document.getElementById('commissionDashboardModal').classList.add('active');
    loadCommissionDashboard();
}

function closeCommissionDashboard() {
    document.getElementById('commissionDashboardModal').classList.remove('active');
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

    // Add agent totals to each row
    allCommissions = allCommissions.map(c => ({
        ...c,
        agentTotal: agentTotals[c.agent]
    }));

    // Calculate stats
    const totalCommissions = allCommissions.reduce((sum, c) => sum + c.amount, 0);
    const avgCommission = allCommissions.length > 0 ? totalCommissions / allCommissions.length : 0;
    const activeAgents = Object.keys(agentTotals).length;

    // Update stats
    document.getElementById('totalCommissions').textContent = `$${totalCommissions.toFixed(2)}`;
    document.getElementById('avgCommission').textContent = `$${avgCommission.toFixed(2)}`;
    document.getElementById('activeCommissionAgents').textContent = activeAgents;

    // Populate table
    const tbody = document.getElementById('commissionTable');
    if (allCommissions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="no-data">No commission data available</td></tr>';
        return;
    }

    tbody.innerHTML = allCommissions.map(c => {
        let commissionDisplay = `$${c.amount.toFixed(2)}`;
        if (c.premium > 0 && c.rate > 0) {
            commissionDisplay = `$${c.premium.toFixed(2)}×${c.rate}%=$${c.amount.toFixed(2)}`;
        }
        return `
        <tr>
            <td><strong>${c.agent}</strong></td>
            <td>${c.type}</td>
            <td>${c.carrier}</td>
            <td>${c.lob}</td>
            <td>${c.month}</td>
            <td style="font-family: monospace; font-size: 0.95em;">${commissionDisplay}</td>
            <td>$${c.agentTotal.toFixed(2)}</td>
        </tr>
    `;
    }).join('');
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

function loadAgentCommissionData() {
    const commissions = loadCommissionData();
    const agent = currentUser;

    const agentData = commissions[agent] || { monthlyPaidCommissionCarriers: {}, grossPaidCarriers: {} };
    const monthlyPaidCarriers = agentData.monthlyPaidCommissionCarriers || {};
    const grossPaidCarriers = agentData.grossPaidCarriers || {};

    // Calculate totals
    let totalCommissions = 0;
    let allMonths = new Set();

    Object.values(monthlyPaidCarriers).forEach(carrier => {
        Object.values(carrier).forEach(entry => {
            const amount = typeof entry === 'object' ? entry.amount : entry;
            totalCommissions += amount;
        });
        Object.keys(carrier).forEach(month => allMonths.add(month));
    });

    Object.values(grossPaidCarriers).forEach(carrier => {
        Object.values(carrier).forEach(entry => {
            const amount = typeof entry === 'object' ? entry.amount : entry;
            totalCommissions += amount;
        });
        Object.keys(carrier).forEach(month => allMonths.add(month));
    });

    const monthCount = allMonths.size;
    const avgCommission = monthCount > 0 ? totalCommissions / monthCount : 0;

    // Update stats
    document.getElementById('agentTotalCommissions').textContent = `$${totalCommissions.toFixed(2)}`;
    document.getElementById('agentAvgCommission').textContent = `$${avgCommission.toFixed(2)}`;
    document.getElementById('agentCommissionCount').textContent = monthCount;

    // Populate table with carrier breakdowns
    const tbody = document.getElementById('agentCommissionTable');

    if (Object.keys(monthlyPaidCarriers).length === 0 && Object.keys(grossPaidCarriers).length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="no-data">No commission data available</td></tr>';
        return;
    }

    let tableHTML = '';

    // Monthly Paid Commission Carriers
    if (Object.keys(monthlyPaidCarriers).length > 0) {
        tableHTML += '<tr style="background-color: #e3f2fd; font-weight: bold;"><td colspan="4">📅 Monthly Paid Commission Carriers</td></tr>';
        Object.entries(monthlyPaidCarriers).forEach(([carrier, months]) => {
            Object.entries(months).forEach(([month, entry], idx) => {
                const amount = typeof entry === 'object' ? entry.amount : entry;
                const lob = typeof entry === 'object' ? entry.lob : '-';
                const rate = typeof entry === 'object' ? entry.rate : 0;
                const premium = typeof entry === 'object' ? entry.premium : 0;
                let commissionDisplay = `$${amount.toFixed(2)}`;
                if (premium > 0 && rate > 0) {
                    commissionDisplay = `$${premium.toFixed(2)}×${rate}%=$${amount.toFixed(2)}`;
                }
                tableHTML += `<tr>
                    <td>${idx === 0 ? carrier : ''}</td>
                    <td>${lob}</td>
                    <td>${month}</td>
                    <td style="font-family: monospace; font-size: 0.95em;">${commissionDisplay}</td>
                </tr>`;
            });
        });
    }

    // Gross Paid Carriers
    if (Object.keys(grossPaidCarriers).length > 0) {
        tableHTML += '<tr style="background-color: #f3e5f5; font-weight: bold;"><td colspan="4">💰 Gross Paid Carriers</td></tr>';
        Object.entries(grossPaidCarriers).forEach(([carrier, months]) => {
            Object.entries(months).forEach(([month, entry], idx) => {
                const amount = typeof entry === 'object' ? entry.amount : entry;
                const lob = typeof entry === 'object' ? entry.lob : '-';
                const rate = typeof entry === 'object' ? entry.rate : 0;
                const premium = typeof entry === 'object' ? entry.premium : 0;
                let commissionDisplay = `$${amount.toFixed(2)}`;
                if (premium > 0 && rate > 0) {
                    commissionDisplay = `$${premium.toFixed(2)}×${rate}%=$${amount.toFixed(2)}`;
                }
                tableHTML += `<tr>
                    <td>${idx === 0 ? carrier : ''}</td>
                    <td>${lob}</td>
                    <td>${month}</td>
                    <td style="font-family: monospace; font-size: 0.95em;">${commissionDisplay}</td>
                </tr>`;
            });
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
        `Generated: ${new Date().toLocaleDateString()}`,
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

    csvLines.push(`TOTAL,$${totalAll.toFixed(2)}`);

    const csv = csvLines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent}_commissions_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
}
