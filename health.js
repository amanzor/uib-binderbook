// ============================================================
//  HEALTH INSURANCE — the AMS Health section
//  ------------------------------------------------------------
//  The Health Book (the New Health Entry form, and the monday.com
//  import) keeps one record per enrollment in `healthData`: the
//  client, carrier, effective date, members, monthly premium and
//  status. This module turns those records into the AMS's health
//  side:
//    • health clients in the client list and their own client card,
//      in the Health Book's rose colour, kept apart from a P&C client
//      who has the same name
//    • the Health Insurance report and the Health Commissions report,
//      each separate from the P&C reports
//    • the health carrier list with each carrier's commission, and the
//      health commission statements — both edited by the admin only
//
//  Writes merge with the cloud copy first, so a record another device
//  saved meanwhile is never dropped.
// ============================================================
(function () {
    'use strict';

    const DATA_KEY = 'healthData';
    const CARRIER_KEY = 'healthCarrierData';
    const STMT_KEY = 'healthCommissionStatements';
    const ROSE = '#e11d48', ROSE_DARK = '#be123c', ROSE_LIGHT = '#fb7185', ROSE_PALE = '#fff1f2', ROSE_LINE = '#fecdd3';
    const GRADIENT = 'linear-gradient(to right,#be123c 0%,#e11d48 60%,#fb7185 100%)';
    const ACTIVE = /^(effectuated|renewed|active|enrolled)$/i;
    const STATUSES = ['Effectuated', 'Renewed', 'Pending', 'Pending Docs', 'Not Enrolled', 'Canceled'];
    const PREFIX = 'HEALTH::';

    let _tab = 'clients';
    let _openKey = null;
    let _pulled = false;
    const _f = { q: '', agent: '', carrier: '', status: 'active', year: '' };
    const _r = { from: '', to: '', agent: '', carrier: '', status: 'active', year: '' };

    // ── Helpers ──────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function jsq(s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }
    function money(n, cents) {
        return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
    }
    function num(n) { return (Number(n) || 0).toLocaleString('en-US'); }
    function readLocal(key, fallback) {
        try {
            const v = JSON.parse(localStorage.getItem(key));
            if (v == null) return fallback;
            if (Array.isArray(fallback) && !Array.isArray(v)) return Array.isArray(v.value) ? v.value : fallback;
            return v;
        } catch (e) { return fallback; }
    }
    function rawSet(key, value) {
        const str = JSON.stringify(value);
        if (typeof _amsRawSet === 'function') _amsRawSet(key, str);
        else localStorage.setItem(key, str);
    }
    function isAdmin() { return typeof amsIsAdminUser === 'function' && amsIsAdminUser(); }
    function me() { return (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) || ''; }
    function clientKey(name) { return String(name || '').trim().toUpperCase().replace(/\s+/g, ' '); }
    function healthKey(name) { return PREFIX + clientKey(name); }
    function today() { return new Date().toISOString().slice(0, 10); }
    function planYear(r) { return String(r.planYear || (r.effDate || r.date || '').slice(0, 4) || ''); }
    function isActive(r) { return ACTIVE.test(String(r.status || '').trim()); }
    // Plans run by calendar year, so an effectuated 2023 plan is history: a
    // client is covered now only by an effectuated plan for this year or later.
    function isCurrent(r) { return isActive(r) && (parseInt(planYear(r), 10) || 0) >= new Date().getFullYear(); }
    function isRenewal(r) { return /renew/i.test(r.enrollmentType || ''); }

    function records() { return readLocal(DATA_KEY, []).filter(r => r && r.clientName); }
    function carriers() { return readLocal(CARRIER_KEY, {}); }
    function statements() { return readLocal(STMT_KEY, {}); }

    function roster() {
        const set = new Set();
        try { Object.keys(amsGetCredentials()).forEach(n => set.add(n)); } catch (e) {}
        records().forEach(r => { if (r.agent) set.add(r.agent); });
        return [...set].filter(Boolean).sort();
    }

    // Records grouped into clients by name; newest enrollment first.
    function clients() {
        const map = new Map();
        records().forEach(r => {
            const key = healthKey(r.clientName);
            if (!map.has(key)) map.set(key, { key, name: r.clientName, records: [] });
            map.get(key).records.push(r);
        });
        map.forEach(c => {
            c.records.sort((a, b) => String(b.effDate || b.date || '').localeCompare(String(a.effDate || a.date || '')));
            c.latest = c.records[0];
            const pick = f => (c.records.find(r => r[f]) || {})[f] || '';
            c.contact = {
                phone1: pick('cellPhone') || pick('homePhone'), phone2: pick('homePhone') && pick('cellPhone') ? pick('homePhone') : '',
                email: pick('email'), address: pick('address'), city: pick('city'), state: pick('state'), zip: pick('zip'),
                dob: pick('dob'), assignedAgent: c.latest.agent || '', clientStatus: 'Health'
            };
            c.active = c.records.some(isCurrent);
            c.since = c.records.map(r => r.effDate || r.date).filter(Boolean).sort()[0] || '';
        });
        return map;
    }

    // ── Commission ───────────────────────────────────────────
    // A carrier pays either a % of the monthly premium, a dollar amount per
    // member per month, or a flat amount per policy per month — new and
    // renewal enrollments each at their own rate.
    function carrierRecord(name) {
        const all = carriers();
        const k = Object.keys(all).find(n => n.toLowerCase() === String(name || '').toLowerCase());
        return k ? all[k] : null;
    }
    function ruleOf(c) {
        const r = (c && Array.isArray(c.commissionRules) && c.commissionRules[0]) || {};
        return { type: (c && c.commissionType) || 'percent', newRate: Number(r.newRate) || 0, renewRate: Number(r.renewRate) || 0 };
    }
    function describeRule(c) {
        if (!c) return 'not on the carrier list';
        const r = ruleOf(c);
        if (!r.newRate && !r.renewRate) return 'rate not set';
        if (r.type === 'pmpm') return `${money(r.newRate, true)} new / ${money(r.renewRate, true)} renewal per member per month`;
        if (r.type === 'flat') return `${money(r.newRate, true)} new / ${money(r.renewRate, true)} renewal per policy per month`;
        return `${r.newRate}% new / ${r.renewRate}% renewal of premium`;
    }
    function monthlyCommission(rec) {
        const c = carrierRecord(rec.carrier);
        if (!c) return 0;
        const r = ruleOf(c);
        const rate = isRenewal(rec) ? r.renewRate : r.newRate;
        if (r.type === 'pmpm') return rate * (parseInt(rec.numMembers, 10) || 1);
        if (r.type === 'flat') return rate;
        return (Number(rec.monthlyPremium) || 0) * rate / 100;
    }
    // Months an enrollment is in force: from its effective month to the end of
    // its plan year, unless it was cancelled.
    function coveredMonths(rec) {
        const eff = rec.effDate || rec.date;
        if (!eff || !isActive(rec)) return [];
        const y = parseInt(planYear(rec), 10) || parseInt(eff.slice(0, 4), 10);
        const start = eff.slice(0, 7) < `${y}-01` ? `${y}-01` : eff.slice(0, 7);
        const out = [];
        let [yy, mm] = start.split('-').map(Number);
        while (yy === y && mm <= 12) { out.push(`${yy}-${String(mm).padStart(2, '0')}`); mm++; }
        return out;
    }

    // ── Cloud ────────────────────────────────────────────────
    async function pull() {
        const S = window.UIBBinderSync;
        if (!S || typeof S.readCloud !== 'function') return false;
        const res = await Promise.all([DATA_KEY, CARRIER_KEY, STMT_KEY].map(k => S.readCloud(k)));
        let changed = false;
        [DATA_KEY, CARRIER_KEY, STMT_KEY].forEach((k, i) => {
            if (!res[i].ok || res[i].value == null) return;
            const str = JSON.stringify(res[i].value);
            if (str !== localStorage.getItem(k)) { rawSet(k, res[i].value); changed = true; }
        });
        return changed;
    }

    // Read the cloud copy, union it with this device's, apply the change,
    // write the result. Refuses to write when the cloud cannot be read —
    // writing blind is how other devices' records get dropped.
    async function saveArray(key, change) {
        const S = window.UIBBinderSync;
        const cloud = S ? await S.readCloud(key) : { ok: false };
        if (!cloud.ok) { alert('The cloud could not be reached, so nothing was saved. Check the connection and try again.'); return false; }
        const byId = new Map();
        (Array.isArray(cloud.value) ? cloud.value : []).forEach(r => { if (r && r.id != null) byId.set(r.id, r); });
        readLocal(key, []).forEach(r => {
            if (!r || r.id == null) return;
            const theirs = byId.get(r.id);
            if (!theirs || (r.updatedAt || 0) >= (theirs.updatedAt || 0)) byId.set(r.id, r);
        });
        const list = change([...byId.values()]);
        rawSet(key, list);
        if (!(await S.save(key, list))) alert('Saved on this device, but the cloud did not accept it yet. It will not reach other devices until it is saved again.');
        return true;
    }
    async function saveMap(key, change) {
        const S = window.UIBBinderSync;
        const cloud = S ? await S.readCloud(key) : { ok: false };
        if (!cloud.ok) { alert('The cloud could not be reached, so nothing was saved. Check the connection and try again.'); return false; }
        const merged = Object.assign({}, cloud.value || {}, readLocal(key, {}));
        const out = change(merged);
        rawSet(key, out);
        if (!(await S.save(key, out))) alert('Saved on this device, but the cloud did not accept it yet. It will not reach other devices until it is saved again.');
        return true;
    }
    function refreshClientList() {
        try {
            if (typeof amsBuildClientIndex === 'function') amsBuildClientIndex();
            if (typeof amsApplyFilters === 'function') amsApplyFilters();
        } catch (e) {}
    }

    // ── AMS client list integration ──────────────────────────
    function indexClients(index) {
        clients().forEach(c => {
            const pcKey = clientKey(c.name);
            index[c.key] = {
                key: c.key, displayName: c.name, policies: [], contact: c.contact,
                isHealth: true, health: c.records, active: c.active,
                pcKey: index[pcKey] && !index[pcKey].isHealth ? pcKey : ''
            };
        });
    }

    function clientCard(c, active, relReason) {
        const latest = (c.health || [])[0] || {};
        const carriersOf = [...new Set((c.health || []).map(r => r.carrier).filter(Boolean))].join(', ');
        const initials = String(c.displayName || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return '<div class="client-card ' + (active ? 'active ' : '') + (relReason ? 'is-related' : '') + '" onclick="healthOpenClient(\'' + jsq(c.key) + '\')"' +
            ' style="border-left:4px solid ' + ROSE + ';background:' + ROSE_PALE + ';">' +
            '<div style="display:flex;gap:10px;align-items:center;">' +
              '<div style="width:36px;height:36px;border-radius:50%;background:' + GRADIENT + ';color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + esc(initials) + '</div>' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="display:flex;align-items:center;gap:6px;min-width:0;margin-bottom:3px;">' +
                  '<div class="cc-name" style="margin-bottom:0;color:' + ROSE_DARK + ';">' + esc(c.displayName) + '</div>' +
                  '<span class="cc-badge" style="flex-shrink:0;background:' + ROSE + ';color:#fff;">❤ Health</span>' +
                '</div>' +
                '<div class="cc-meta">' +
                  (c.contact.phone1 ? '<span>' + esc(c.contact.phone1) + '</span>' : '') +
                  (latest.effDate ? '<span>' + esc(latest.effDate) + '</span>' : '') +
                '</div>' +
                '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">' +
                  '<span class="cc-badge" style="background:' + ROSE_PALE + ';color:' + ROSE_DARK + ';border:1px solid ' + ROSE_LINE + ';">' +
                    num((c.health || []).length) + ' enrollment' + ((c.health || []).length === 1 ? '' : 's') + (carriersOf ? ' · ' + esc(carriersOf) : '') + '</span>' +
                  (latest.agent ? '<span class="cc-badge agent">' + esc(latest.agent) + '</span>' : '') +
                  (c.pcKey ? '<span class="cc-badge" style="background:#eff6ff;color:#1d4ed8;">Also P&amp;C</span>' : '') +
                  (relReason ? '<span class="cc-badge related">Related</span>' : '') +
                '</div>' +
              '</div>' +
            '</div></div>';
    }

    function openClient(key) {
        _openKey = key;
        _tab = 'client';
        if (typeof amsSidebarNav === 'function') amsSidebarNav('health');
        else render();
    }

    // ── Render ───────────────────────────────────────────────
    const TABS = [
        { id: 'clients', label: 'Clients' },
        { id: 'renewals', label: 'Renewals' },
        { id: 'report', label: 'Health Insurance Report' },
        { id: 'commissions', label: 'Health Commissions' },
        { id: 'carriers', label: 'Carriers' },
        { id: 'statements', label: 'Commission Statements' }
    ];

    function render() {
        const el = document.getElementById('amsHealthBody');
        if (!el) return;
        if (!_pulled) {
            _pulled = true;
            pull().then(changed => { if (changed) { refreshClientList(); render(); } }).catch(() => {});
        }
        const all = records();
        const cl = clients();
        const activeCount = [...cl.values()].filter(c => c.active).length;
        const head =
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:10px;">' +
              '<div><h2 style="color:' + ROSE_DARK + ';font-size:20px;margin:0;display:flex;align-items:center;gap:8px;">' +
                '<i data-lucide="heart-pulse" style="width:22px;height:22px;"></i> Health Insurance</h2>' +
                '<div style="font-size:12px;color:var(--gray-500);margin-top:4px;">' + num(cl.size) + ' health clients · ' + num(activeCount) +
                  ' covered this year · ' + num(all.length) + ' enrollments on the Health Book</div></div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                '<button class="btn-sm" style="background:' + GRADIENT + ';color:#fff;border:none;" onclick="healthEditRecord()">＋ New health client</button>' +
                '<button class="btn-secondary btn-sm" onclick="healthRefresh()">⟳ Refresh</button>' +
              '</div>' +
            '</div>';
        const tabs = '<div style="display:flex;gap:4px;border-bottom:1px solid var(--gray-200);margin-bottom:16px;flex-wrap:wrap;">' +
            TABS.map(t => {
                const on = t.id === _tab || (t.id === 'clients' && _tab === 'client');
                return '<button onclick="healthTab(\'' + t.id + '\')" style="padding:9px 15px;border:none;background:none;cursor:pointer;font-family:inherit;' +
                    'font-size:13px;font-weight:600;border-bottom:2px solid ' + (on ? ROSE : 'transparent') + ';color:' + (on ? ROSE_DARK : 'var(--gray-500)') + ';">' +
                    esc(t.label) + '</button>';
            }).join('') + '</div>';
        let body = '';
        if (_tab === 'client') body = clientView(cl.get(_openKey));
        else if (_tab === 'report') body = reportView();
        else if (_tab === 'renewals') body = renewalsView();
        else if (_tab === 'commissions') body = commissionView();
        else if (_tab === 'carriers') body = carriersView();
        else if (_tab === 'statements') body = statementsView();
        else body = clientsView(cl);
        el.innerHTML = head + tabs + body;
        if (window.lucide) lucide.createIcons();
    }

    // ── Renewals ─────────────────────────────────────────────
    // Health plans run by calendar year, so every plan active this year
    // renews on January 1 (open enrollment). A client has re-enrolled
    // once a record for next year exists.
    const _n = { agent: '', carrier: '', state: 'due', q: '' };
    function renewalsView() {
        const yr = new Date().getFullYear();
        const next = String(yr + 1);
        const all = records();
        const nextYear = new Set(all.filter(r => planYear(r) === next).map(r => clientKey(r.clientName)));
        const seen = new Set();
        const rows = all.filter(r => isActive(r) && planYear(r) === String(yr)).filter(r => {
            const k = clientKey(r.clientName);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        }).map(r => ({ r, done: nextYear.has(clientKey(r.clientName)) }));
        const mine = isAdmin() ? rows : rows.filter(x => x.r.agent === me());
        const q = _n.q.trim().toLowerCase();
        const shown = mine.filter(x => {
            if (_n.agent && x.r.agent !== _n.agent) return false;
            if (_n.carrier && x.r.carrier !== _n.carrier) return false;
            if (_n.state === 'due' && x.done) return false;
            if (_n.state === 'done' && !x.done) return false;
            if (q && (x.r.clientName + ' ' + (x.r.cellPhone || '') + ' ' + (x.r.email || '')).toLowerCase().indexOf(q) === -1) return false;
            return true;
        }).sort((a, b) => String(a.r.clientName).localeCompare(String(b.r.clientName)));
        const done = mine.filter(x => x.done).length;
        const pct = mine.length ? Math.round(done / mine.length * 100) : 0;
        const kpi = (label, v, sub, color) => '<div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--gray-200);border-top:4px solid ' + color +
            ';border-radius:10px;padding:12px 14px;"><div style="font-size:10.5px;font-weight:700;color:var(--gray-500);text-transform:uppercase;">' + label +
            '</div><div style="font-size:24px;font-weight:800;color:var(--navy);">' + v + '</div><div style="font-size:11px;color:var(--gray-500);">' + sub + '</div></div>';
        const agents = [...new Set(mine.map(x => x.r.agent).filter(Boolean))].sort();
        const carriersList = [...new Set(mine.map(x => x.r.carrier).filter(Boolean))].sort();
        return '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">' +
              kpi('Plans renewing for ' + next, num(mine.length), 'active ' + yr + ' plans', ROSE) +
              kpi('Re-enrolled', num(done), pct + '% done', '#16a34a') +
              kpi('Still to renew', num(mine.length - done), 'open enrollment Nov 1 – Jan 15', '#d97706') +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
              '<select onchange="healthRenewalFilter(\'state\',this.value)" style="padding:7px 9px;border:1px solid var(--gray-200);border-radius:7px;font-size:12.5px;">' +
                [['due', 'Still to renew'], ['done', 'Re-enrolled'], ['', 'All']].map(o => '<option value="' + o[0] + '"' + (o[0] === _n.state ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
              (isAdmin() ? selectHtml('hrnAgent', agents, _n.agent, 'All agents', "healthRenewalFilter('agent',this.value)") : '') +
              selectHtml('hrnCarrier', carriersList, _n.carrier, 'All carriers', "healthRenewalFilter('carrier',this.value)") +
              '<input placeholder="Search name, phone, e-mail…" value="' + esc(_n.q) + '" onchange="healthRenewalFilter(\'q\',this.value)" ' +
                'style="padding:7px 9px;border:1px solid var(--gray-200);border-radius:7px;font-size:12.5px;min-width:220px;">' +
            '</div>' +
            (shown.length ? '<div style="overflow-x:auto;"><table class="rpt-tbl" style="width:100%;"><thead><tr><th>Client</th><th>Agent</th><th>Carrier</th>' +
              '<th>Members</th><th>Premium / mo</th><th>Phone</th><th>Renews</th><th>Status</th></tr></thead><tbody>' +
              shown.slice(0, 500).map(x => '<tr style="cursor:pointer;" onclick="healthOpenClient(\'' + esc(healthKey(x.r.clientName)).replace(/'/g, "\\'") + '\')">' +
                '<td><strong>' + esc(x.r.clientName) + '</strong></td><td>' + esc(x.r.agent) + '</td><td>' + esc(x.r.carrier) + '</td>' +
                '<td>' + esc(x.r.numMembers || '') + '</td><td>' + (x.r.monthlyPremium ? money(x.r.monthlyPremium, true) : '') + '</td>' +
                '<td>' + esc(x.r.cellPhone || '') + '</td><td>01/01/' + next + '</td>' +
                '<td>' + (x.done ? '<span style="background:#dcfce7;color:#166534;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;">Re-enrolled</span>'
                                 : '<span style="background:#fef3c7;color:#92400e;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;">Due</span>') + '</td></tr>').join('') +
              '</tbody></table></div>'
            : '<p style="color:var(--gray-400);font-size:13px;padding:20px;text-align:center;">No health plans match.</p>');
    }

    function selectHtml(id, list, value, label, onchange) {
        return '<select id="' + id + '" onchange="' + onchange + '" style="padding:7px 9px;border:1px solid var(--gray-200);border-radius:7px;font-size:12.5px;font-family:inherit;">' +
            '<option value="">' + esc(label) + '</option>' +
            list.map(v => '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select>';
    }
    function statusChip(s) {
        const on = ACTIVE.test(s || '');
        const bad = /cancel|not enrolled|lost/i.test(s || '');
        const st = on ? 'background:#dcfce7;color:#166534;' : bad ? 'background:#fee2e2;color:#991b1b;' : 'background:#fef3c7;color:#92400e;';
        return s ? '<span style="padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;' + st + '">' + esc(s) + '</span>' : '—';
    }
    function tbl(header, rows, foot) {
        return '<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr>' + header.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
            (rows.length ? rows.join('') : '<tr><td colspan="' + header.length + '" style="color:var(--gray-500);text-align:center;padding:18px;">Nothing to show.</td></tr>') +
            '</tbody>' + (foot ? '<tfoot>' + foot + '</tfoot>' : '') + '</table></div>';
    }
    function kpi(label, value, sub, color) {
        return '<div class="rpt-kpi" style="border-top:4px solid ' + (color || ROSE) + ';"><div class="rk-label">' + esc(label) + '</div><div class="rk-val">' + value + '</div><div class="rk-sub">' + esc(sub || '') + '</div></div>';
    }

    // ── Clients tab ──────────────────────────────────────────
    function clientsView(cl) {
        const list = [...cl.values()];
        const years = [...new Set(records().map(planYear).filter(Boolean))].sort().reverse();
        const carrierNames = [...new Set(records().map(r => r.carrier).filter(Boolean))].sort();
        const q = _f.q.trim().toLowerCase();
        const rows = list.filter(c => {
            if (_f.agent && !c.records.some(r => r.agent === _f.agent)) return false;
            if (_f.carrier && !c.records.some(r => r.carrier === _f.carrier)) return false;
            if (_f.year && !c.records.some(r => planYear(r) === _f.year)) return false;
            if (_f.status === 'active' && !c.active) return false;
            if (_f.status === 'inactive' && c.active) return false;
            if (q) {
                const hay = [c.name, c.contact.phone1, c.contact.email, c.contact.address, c.contact.city, ...c.records.map(r => r.carrier + ' ' + (r.policyNumber || ''))].join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        }).sort((a, b) => a.name.localeCompare(b.name));
        const pcIndex = typeof amsClientIndex !== 'undefined' ? amsClientIndex : {};
        return '<div class="rpt-filters" style="margin-bottom:12px;">' +
              '<div class="rpt-filter-group"><label>Search</label><input type="text" id="hfQ" value="' + esc(_f.q) + '" placeholder="name, phone, carrier…" oninput="healthFilter(\'q\', this.value)"></div>' +
              '<div class="rpt-filter-group"><label>Status</label><select id="hfStatus" onchange="healthFilter(\'status\', this.value)">' +
                [['active', 'Covered this year'], ['inactive', 'Not covered this year'], ['', 'All clients']].map(([v, l]) => '<option value="' + v + '"' + (_f.status === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
              '<div class="rpt-filter-group"><label>Agent</label>' + selectHtml('hfAgent', roster(), _f.agent, 'All agents', "healthFilter('agent', this.value)") + '</div>' +
              '<div class="rpt-filter-group"><label>Carrier</label>' + selectHtml('hfCarrier', carrierNames, _f.carrier, 'All carriers', "healthFilter('carrier', this.value)") + '</div>' +
              '<div class="rpt-filter-group"><label>Plan year</label>' + selectHtml('hfYear', years, _f.year, 'All years', "healthFilter('year', this.value)") + '</div>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--gray-500);margin-bottom:6px;">' + num(rows.length) + ' of ' + num(list.length) + ' health clients</div>' +
            tbl(['Client', 'Carrier', 'Plan year', 'Effective', 'Members', 'Per month', 'Status', 'Agent', ''], rows.slice(0, 600).map(c => {
                const r = c.latest;
                const pc = pcIndex[clientKey(c.name)] && !pcIndex[clientKey(c.name)].isHealth;
                return '<tr style="cursor:pointer;" onclick="healthOpenClient(\'' + jsq(c.key) + '\')">' +
                    '<td><strong style="color:' + ROSE_DARK + ';">' + esc(c.name) + '</strong>' + (c.records.length > 1 ? '<div style="font-size:11px;color:var(--gray-500);">' + c.records.length + ' enrollments</div>' : '') + '</td>' +
                    '<td>' + esc(r.carrier) + '</td><td>' + esc(planYear(r)) + '</td><td>' + esc(r.effDate || r.date) + '</td>' +
                    '<td>' + esc(r.numMembers) + '</td><td>' + (r.monthlyPremium ? money(r.monthlyPremium, true) : '—') + '</td>' +
                    '<td>' + statusChip(r.status) + '</td><td>' + esc(r.agent) + '</td>' +
                    '<td>' + (pc ? '<span style="font-size:11px;font-weight:700;color:#1d4ed8;">Also P&amp;C</span>' : '') + '</td></tr>';
            }).concat(rows.length > 600 ? ['<tr><td colspan="9" style="color:var(--gray-500);">Showing 600 — narrow the filters to see the rest.</td></tr>'] : []));
    }

    // ── Client card ──────────────────────────────────────────
    function clientView(c) {
        if (!c) {
            return '<div class="rpt-no-data" style="margin-top:40px;">That health client is no longer on the Health Book.' +
                '<div style="margin-top:12px;"><button class="btn-secondary btn-sm" onclick="healthTab(\'clients\')">← Back to health clients</button></div></div>';
        }
        const pcIndex = typeof amsClientIndex !== 'undefined' ? amsClientIndex : {};
        const pcKey = clientKey(c.name);
        const pc = pcIndex[pcKey] && !pcIndex[pcKey].isHealth ? pcIndex[pcKey] : null;
        const ct = c.contact;
        const field = (label, id, val, type) => '<div><label style="font-size:10px;font-weight:700;color:var(--gray-500);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px;">' + esc(label) + '</label>' +
            '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val) + '" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:7px;font-size:13px;box-sizing:border-box;font-family:inherit;"></div>';
        const totalMonthly = c.records.filter(isActive).reduce((s, r) => s + (Number(r.monthlyPremium) || 0), 0);
        const totalComm = c.records.filter(isActive).reduce((s, r) => s + monthlyCommission(r), 0);
        return '<button class="btn-secondary btn-sm" style="margin-bottom:12px;" onclick="healthTab(\'clients\')">← Health clients</button>' +
            '<div style="background:' + GRADIENT + ';color:#fff;border-radius:14px;padding:18px 20px;margin-bottom:16px;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
              '<div><div style="font-size:11px;font-weight:700;letter-spacing:.5px;opacity:.85;">❤ HEALTH CLIENT</div>' +
                '<div style="font-size:22px;font-weight:800;margin-top:2px;">' + esc(c.name) + '</div>' +
                '<div style="font-size:12.5px;opacity:.9;margin-top:4px;">' +
                  [c.latest.agent ? 'Agent: ' + esc(c.latest.agent) : '', c.since ? 'Client since ' + esc(c.since) : '',
                   c.active ? 'Covered this year' : 'Not covered this year'].filter(Boolean).join(' · ') + '</div></div>' +
              '<div style="text-align:right;">' +
                '<div style="font-size:11px;opacity:.85;">Active premium / month</div><div style="font-size:20px;font-weight:800;">' + money(totalMonthly, true) + '</div>' +
                '<div style="font-size:11px;opacity:.85;margin-top:4px;">Expected commission / month: <strong>' + money(totalComm, true) + '</strong></div>' +
              '</div>' +
            '</div>' +
            (pc ? '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
                '<span>👤 <strong>' + esc(pc.displayName) + '</strong> is also a P&amp;C client (' + num(pc.policies.length) + ' polic' + (pc.policies.length === 1 ? 'y' : 'ies') + '). The two records are kept apart.</span>' +
                '<button class="btn-sm" style="background:#1d4ed8;color:#fff;border:none;" onclick="amsSidebarNav(\'search\'); amsLoadClientDetail(\'' + jsq(pcKey) + '\')">Open the P&amp;C record →</button></div>' : '') +
            '<div class="rpt-section"><div class="rpt-section-title">Contact</div>' +
              '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;">' +
                field('Cell phone', 'hcPhone', ct.phone1, 'tel') + field('Home phone', 'hcPhone2', ct.phone2, 'tel') + field('Email', 'hcEmail', ct.email, 'email') +
                field('Date of birth', 'hcDob', ct.dob, 'date') + field('Address', 'hcAddress', ct.address) + field('City', 'hcCity', ct.city) +
                field('State', 'hcState', ct.state) + field('ZIP', 'hcZip', ct.zip) +
              '</div>' +
              '<div style="margin-top:10px;"><button class="btn-sm" style="background:' + GRADIENT + ';color:#fff;border:none;" onclick="healthSaveContact(\'' + jsq(c.key) + '\')">💾 Save contact</button></div>' +
            '</div>' +
            '<div class="rpt-section"><div class="rpt-section-title" style="display:flex;justify-content:space-between;align-items:center;">Enrollments' +
              '<button class="btn-sm" style="background:' + GRADIENT + ';color:#fff;border:none;" onclick="healthEditRecord(null, \'' + jsq(c.key) + '\')">＋ Add enrollment</button></div>' +
              tbl(['Plan year', 'Carrier', 'Effective', 'Members', 'Per month', 'Type', 'Status', 'Commission / mo', 'Pending items', 'Agent', 'Source', ''],
                c.records.map(r => '<tr><td>' + esc(planYear(r)) + '</td><td>' + esc(r.carrier) + '</td><td>' + esc(r.effDate || r.date) + '</td>' +
                    '<td>' + esc(r.numMembers) + '</td><td>' + (r.monthlyPremium ? money(r.monthlyPremium, true) : '—') + '</td>' +
                    '<td>' + esc(r.enrollmentType || '') + '</td><td>' + statusChip(r.status) + '</td>' +
                    '<td title="' + esc(describeRule(carrierRecord(r.carrier))) + '">' + (isActive(r) ? money(monthlyCommission(r), true) : '—') + '</td>' +
                    '<td>' + esc(r.pendingItems || '') + '</td><td>' + esc(r.agent) + '</td><td>' + esc(r.source || r.referredBy || '') + '</td>' +
                    '<td style="white-space:nowrap;"><button class="btn-secondary btn-sm" onclick="healthEditRecord(' + JSON.stringify(r.id) + ')">Edit</button>' +
                    (isAdmin() ? ' <button class="btn-danger btn-sm" onclick="healthDeleteRecord(' + JSON.stringify(r.id) + ')">✕</button>' : '') +
                    (r.mondayUrl ? ' <a href="' + esc(r.mondayUrl) + '" target="_blank" rel="noopener" title="Open in monday.com" style="font-size:13px;text-decoration:none;">↗</a>' : '') + '</td></tr>' +
                    (r.notes ? '<tr><td></td><td colspan="11" style="font-size:12px;color:var(--gray-500);">📝 ' + esc(r.notes) + '</td></tr>' : ''))) +
            '</div>';
    }

    async function saveContact(key) {
        const v = id => (document.getElementById(id)?.value || '').trim();
        const patch = { cellPhone: v('hcPhone'), homePhone: v('hcPhone2'), email: v('hcEmail'), dob: v('hcDob'),
                        address: v('hcAddress'), city: v('hcCity'), state: v('hcState').toUpperCase(), zip: v('hcZip') };
        const now = Date.now();
        const ok = await saveArray(DATA_KEY, list => list.map(r => (r && healthKey(r.clientName) === key)
            ? Object.assign({}, r, patch, { updatedAt: now }) : r));
        if (ok) { refreshClientList(); render(); if (typeof amsFlashBanner === 'function') amsFlashBanner('Health contact saved ✓'); }
    }

    // ── Enrollment editor ────────────────────────────────────
    function editRecord(id, clientKeyForNew) {
        const all = records();
        const rec = id != null ? all.find(r => r.id === id) : null;
        const base = rec || (clientKeyForNew ? Object.assign({}, (clients().get(clientKeyForNew) || {}).latest || {}) : {});
        if (!rec) { delete base.id; ['effDate', 'date', 'planYear', 'status', 'enrollmentType', 'monthlyPremium', 'numMembers', 'pendingItems', 'policyNumber', 'notes', 'importId', 'importBatch', 'mondayUrl', 'mondayBoard'].forEach(k => delete base[k]); }
        if (!rec && !base.agent) base.agent = me();
        let m = document.getElementById('healthRecordModal');
        if (m) m.remove();
        m = document.createElement('div');
        m.id = 'healthRecordModal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
        const inp = (label, k, type, extra) => '<div><label style="font-size:10px;font-weight:700;color:var(--gray-500);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px;">' + esc(label) + '</label>' +
            '<input data-hr="' + k + '" type="' + (type || 'text') + '" value="' + esc(base[k] == null ? '' : base[k]) + '" ' + (extra || '') +
            ' style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:7px;font-size:13px;box-sizing:border-box;font-family:inherit;"></div>';
        const sel = (label, k, list) => '<div><label style="font-size:10px;font-weight:700;color:var(--gray-500);display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px;">' + esc(label) + '</label>' +
            '<select data-hr="' + k + '" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:7px;font-size:13px;font-family:inherit;">' +
            '<option value=""></option>' + [...new Set(list.concat(base[k] ? [base[k]] : []))].map(v => '<option value="' + esc(v) + '"' + (v === base[k] ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select></div>';
        const carrierNames = [...new Set(Object.keys(carriers()).concat(records().map(r => r.carrier).filter(Boolean)))].sort();
        m.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:760px;width:100%;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;font-family:inherit;">' +
            '<div style="background:' + GRADIENT + ';color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">' +
              '<strong>' + (rec ? 'Edit enrollment' : (clientKeyForNew ? 'Add enrollment' : 'New health client')) + '</strong>' +
              '<button onclick="document.getElementById(\'healthRecordModal\').remove()" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">&times;</button></div>' +
            '<div style="padding:16px 18px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">' +
              inp('Client name *', 'clientName', 'text', clientKeyForNew || rec ? '' : 'autofocus') +
              sel('Agent', 'agent', roster()) + sel('Carrier', 'carrier', carrierNames) +
              inp('Effective date *', 'effDate', 'date') + inp('Plan year', 'planYear', 'text', 'placeholder="from the effective date"') +
              inp('Members', 'numMembers', 'number', 'min="1"') + inp('Premium per month ($)', 'monthlyPremium', 'number', 'step="0.01" min="0"') +
              sel('Enrollment', 'enrollmentType', ['New', 'Renew']) + sel('Status', 'status', STATUSES) +
              inp('Pending items', 'pendingItems') + inp('Member / policy ID', 'policyNumber') + inp('Source', 'source') +
              inp('Cell phone', 'cellPhone', 'tel') + inp('Email', 'email', 'email') + inp('Date of birth', 'dob', 'date') +
              inp('Address', 'address') + inp('City', 'city') + inp('State', 'state', 'text', 'maxlength="2"') + inp('ZIP', 'zip') +
              '<div style="grid-column:1/-1;"><label style="font-size:10px;font-weight:700;color:var(--gray-500);display:block;margin-bottom:4px;text-transform:uppercase;">Notes</label>' +
                '<textarea data-hr="notes" rows="2" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:7px;font-size:13px;box-sizing:border-box;font-family:inherit;">' + esc(base.notes || '') + '</textarea></div>' +
            '</div>' +
            '<div style="padding:12px 18px;border-top:1px solid var(--gray-100);display:flex;justify-content:flex-end;gap:8px;">' +
              '<button class="btn-secondary btn-sm" onclick="document.getElementById(\'healthRecordModal\').remove()">Cancel</button>' +
              '<button class="btn-sm" style="background:' + GRADIENT + ';color:#fff;border:none;" onclick="healthSaveRecord(' + (rec ? JSON.stringify(rec.id) : 'null') + ')">💾 Save</button>' +
            '</div></div>';
        document.body.appendChild(m);
        if (!isAdmin() && rec) {
            const a = m.querySelector('[data-hr="agent"]');
            if (a) { a.disabled = true; a.title = 'Only an administrator can change the agent'; }
        }
    }

    async function saveRecord(id) {
        const m = document.getElementById('healthRecordModal');
        if (!m) return;
        const vals = {};
        m.querySelectorAll('[data-hr]').forEach(el => { vals[el.getAttribute('data-hr')] = String(el.value || '').trim(); });
        if (!vals.clientName) { alert('Enter the client name.'); return; }
        if (!vals.effDate) { alert('Enter the effective date.'); return; }
        vals.state = (vals.state || '').toUpperCase();
        vals.monthlyPremium = parseFloat(vals.monthlyPremium) || 0;
        vals.planYear = vals.planYear || vals.effDate.slice(0, 4);
        vals.date = vals.effDate;
        const now = Date.now();
        const ok = await saveArray(DATA_KEY, list => {
            if (id != null) {
                return list.map(r => {
                    if (!r || r.id !== id) return r;
                    const out = Object.assign({}, r, vals, { updatedAt: now, updatedBy: me() });
                    if (!isAdmin()) out.agent = r.agent;
                    return out;
                });
            }
            let newId = now;
            while (list.some(r => r && r.id === newId)) newId++;
            return list.concat([Object.assign({ id: newId, type: 'health', homePhone: '', organization: '', members: [], acknowledged: false,
                                               commissionRule: describeRule(carrierRecord(vals.carrier)), createdBy: me(),
                                               timestamp: new Date().toISOString() }, vals, { updatedAt: now })]);
        });
        if (!ok) return;
        m.remove();
        _openKey = healthKey(vals.clientName);
        _tab = 'client';
        refreshClientList();
        render();
    }

    async function deleteRecord(id) {
        if (!isAdmin()) { alert('Only an administrator can delete a health enrollment.'); return; }
        const rec = records().find(r => r.id === id);
        if (!rec || !confirm('Delete the ' + (rec.carrier || '') + ' enrollment of ' + rec.clientName + ' (' + (rec.effDate || rec.date || '') + ')?')) return;
        const ok = await saveArray(DATA_KEY, list => list.filter(r => !r || r.id !== id));
        if (ok) { refreshClientList(); render(); }
    }

    // ── Health Insurance report ──────────────────────────────
    // The Health report limits enrollments by effective date; the
    // commissions report instead keeps every enrollment and limits the
    // months it pays for.
    function reportRows(byMonthsOnly) {
        return records().filter(r => {
            const d = r.effDate || r.date || '';
            if (!byMonthsOnly && _r.from && d < _r.from) return false;
            if (!byMonthsOnly && _r.to && d > _r.to) return false;
            if (_r.year && planYear(r) !== _r.year) return false;
            if (_r.agent && r.agent !== _r.agent) return false;
            if (_r.carrier && r.carrier !== _r.carrier) return false;
            if (_r.status === 'active' && !isActive(r)) return false;
            if (_r.status && _r.status !== 'active' && r.status !== _r.status) return false;
            return true;
        });
    }
    function reportFilters(prefix) {
        const years = [...new Set(records().map(planYear).filter(Boolean))].sort().reverse();
        const carrierNames = [...new Set(records().map(r => r.carrier).filter(Boolean))].sort();
        const statuses = [...new Set(records().map(r => r.status).filter(Boolean))].sort();
        return '<div class="rpt-filters">' +
            '<div class="rpt-filter-group"><label>Plan year</label>' + selectHtml(prefix + 'Year', years, _r.year, 'All years', "healthReportFilter('year', this.value)") + '</div>' +
            '<div class="rpt-filter-group"><label>Effective from</label><input type="date" value="' + esc(_r.from) + '" onchange="healthReportFilter(\'from\', this.value)"></div>' +
            '<div class="rpt-filter-group"><label>to</label><input type="date" value="' + esc(_r.to) + '" onchange="healthReportFilter(\'to\', this.value)"></div>' +
            '<div class="rpt-filter-group"><label>Agent</label>' + selectHtml(prefix + 'Agent', roster(), _r.agent, 'All agents', "healthReportFilter('agent', this.value)") + '</div>' +
            '<div class="rpt-filter-group"><label>Carrier</label>' + selectHtml(prefix + 'Carrier', carrierNames, _r.carrier, 'All carriers', "healthReportFilter('carrier', this.value)") + '</div>' +
            '<div class="rpt-filter-group"><label>Status</label><select onchange="healthReportFilter(\'status\', this.value)">' +
              '<option value="active"' + (_r.status === 'active' ? ' selected' : '') + '>Active (effectuated / renewed)</option>' +
              '<option value=""' + (_r.status === '' ? ' selected' : '') + '>All statuses</option>' +
              statuses.map(s => '<option value="' + esc(s) + '"' + (_r.status === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>' +
            '<div class="rpt-filter-actions"><button class="btn-secondary btn-sm" onclick="' + (prefix === 'hr' ? 'healthExportReport' : 'healthExportCommissions') + '()" style="font-size:11px;">⬇ Export CSV</button>' +
            ' <button class="btn-secondary btn-sm" onclick="window.print()" style="font-size:11px;">🖨 Print</button></div>' +
            '</div>';
    }
    function groupBy(rows, f) {
        const m = {};
        rows.forEach(r => {
            const k = f(r) || '—';
            const g = m[k] || (m[k] = { n: 0, members: 0, premium: 0, active: 0, clients: new Set() });
            g.n++; g.members += parseInt(r.numMembers, 10) || 0; g.premium += Number(r.monthlyPremium) || 0;
            if (isActive(r)) g.active++;
            g.clients.add(clientKey(r.clientName));
        });
        return Object.entries(m).sort((a, b) => b[1].n - a[1].n);
    }
    function reportView() {
        const rows = reportRows();
        const members = rows.reduce((s, r) => s + (parseInt(r.numMembers, 10) || 0), 0);
        const prem = rows.reduce((s, r) => s + (Number(r.monthlyPremium) || 0), 0);
        const cl = new Set(rows.map(r => clientKey(r.clientName))).size;
        const groupTable = (title, entries) => '<div class="rpt-section" style="flex:1;min-width:300px;"><div class="rpt-section-title">' + title + '</div>' +
            tbl(['', 'Clients', 'Enrollments', 'Active', 'Members', 'Premium / mo'], entries.map(([k, g]) =>
                '<tr><td><strong>' + esc(k) + '</strong></td><td>' + num(g.clients.size) + '</td><td>' + num(g.n) + '</td><td>' + num(g.active) + '</td><td>' + num(g.members) + '</td><td>' + money(g.premium, true) + '</td></tr>')) + '</div>';
        return reportFilters('hr') +
            '<div class="rpt-kpis">' + kpi('Health clients', num(cl), 'in this view') + kpi('Enrollments', num(rows.length), num(rows.filter(isActive).length) + ' active', ROSE_DARK) +
              kpi('Members covered', num(members), 'people on these plans', ROSE_LIGHT) + kpi('Premium / month', money(prem, true), money(prem * 12) + ' a year', '#9f1239') + '</div>' +
            '<div style="display:flex;gap:14px;flex-wrap:wrap;">' + groupTable('By carrier', groupBy(rows, r => r.carrier)) + groupTable('By agent', groupBy(rows, r => r.agent)) + '</div>' +
            '<div style="display:flex;gap:14px;flex-wrap:wrap;">' + groupTable('By status', groupBy(rows, r => r.status)) + groupTable('By plan year', groupBy(rows, planYear)) + '</div>' +
            '<div class="rpt-section"><div class="rpt-section-title">Enrollments (' + num(rows.length) + ')</div>' +
              tbl(['Client', 'Agent', 'Carrier', 'Plan year', 'Effective', 'Members', 'Per month', 'Type', 'Status', 'Source'],
                rows.slice().sort((a, b) => String(b.effDate || '').localeCompare(String(a.effDate || ''))).slice(0, 800).map(r =>
                    '<tr style="cursor:pointer;" onclick="healthOpenClient(\'' + jsq(healthKey(r.clientName)) + '\')"><td><strong>' + esc(r.clientName) + '</strong></td><td>' + esc(r.agent) + '</td><td>' + esc(r.carrier) + '</td>' +
                    '<td>' + esc(planYear(r)) + '</td><td>' + esc(r.effDate || r.date) + '</td><td>' + esc(r.numMembers) + '</td>' +
                    '<td>' + (r.monthlyPremium ? money(r.monthlyPremium, true) : '—') + '</td><td>' + esc(r.enrollmentType) + '</td><td>' + statusChip(r.status) + '</td><td>' + esc(r.source || '') + '</td></tr>')) +
            '</div>';
    }
    function exportCsv(name, header, rows) {
        const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const blob = new Blob([[header.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    function exportReport() {
        exportCsv('health_insurance_report.csv',
            ['Client', 'Agent', 'Carrier', 'Plan Year', 'Effective', 'Members', 'Premium / Month', 'Enrollment', 'Status', 'Pending Items', 'Phone', 'Email', 'DOB', 'Source'],
            reportRows().map(r => [r.clientName, r.agent, r.carrier, planYear(r), r.effDate || r.date, r.numMembers, r.monthlyPremium,
                                  r.enrollmentType, r.status, r.pendingItems, r.cellPhone || r.homePhone, r.email, r.dob, r.source]));
    }

    // ── Health Commissions report ────────────────────────────
    function commissionRows() {
        // Expected commission per active enrollment per month in force,
        // limited to the months the filters cover.
        const out = [];
        reportRows(true).filter(isActive).forEach(r => {
            const perMonth = monthlyCommission(r);
            coveredMonths(r).forEach(mo => {
                if (_r.from && mo < _r.from.slice(0, 7)) return;
                if (_r.to && mo > _r.to.slice(0, 7)) return;
                out.push({ r, month: mo, amount: perMonth });
            });
        });
        return out;
    }
    function receivedByCarrierMonth() {
        const m = {};
        Object.values(statements()).forEach(s => {
            if (!s || s.voided) return;
            const k = (s.carrier || '').toLowerCase() + '|' + (s.period || '');
            m[k] = (m[k] || 0) + (Number(s.total) || 0);
        });
        return m;
    }
    function commissionView() {
        const rows = commissionRows();
        const expected = rows.reduce((s, x) => s + x.amount, 0);
        const recv = receivedByCarrierMonth();
        const byCarrierMonth = {};
        rows.forEach(x => {
            const k = (x.r.carrier || '—') + '|' + x.month;
            byCarrierMonth[k] = (byCarrierMonth[k] || 0) + x.amount;
        });
        const cmKeys = Object.keys(byCarrierMonth).sort((a, b) => b.split('|')[1].localeCompare(a.split('|')[1]) || a.localeCompare(b));
        const receivedTotal = cmKeys.reduce((s, k) => s + (recv[k.split('|')[0].toLowerCase() + '|' + k.split('|')[1]] || 0), 0);
        const sum = f => { const m = {}; rows.forEach(x => { const k = f(x) || '—'; m[k] = (m[k] || 0) + x.amount; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
        const noRate = [...new Set(reportRows(true).filter(isActive).filter(r => !monthlyCommission(r)).map(r => r.carrier || '(no carrier)'))];
        return reportFilters('hc') +
            (noRate.length ? '<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;color:#92400e;">⚠ No commission rate set for: <strong>' +
                noRate.map(esc).join(', ') + '</strong>. Set it under Carriers so these enrollments are priced.</div>' : '') +
            '<div class="rpt-kpis">' + kpi('Expected commission', money(expected, true), 'enrollments × months in force') +
              kpi('Received (statements)', money(receivedTotal, true), 'for the same carriers and months', '#047857') +
              kpi('Difference', money(receivedTotal - expected, true), receivedTotal >= expected ? 'paid at or above expected' : 'still owed or not yet posted', receivedTotal >= expected ? '#047857' : '#b45309') +
              kpi('Active enrollments', num(new Set(rows.map(x => x.r.id)).size), 'priced in this view', ROSE_LIGHT) + '</div>' +
            '<div style="display:flex;gap:14px;flex-wrap:wrap;">' +
              '<div class="rpt-section" style="flex:1;min-width:280px;"><div class="rpt-section-title">By agent</div>' +
                tbl(['Agent', 'Expected'], sum(x => x.r.agent).map(([k, v]) => '<tr><td><strong>' + esc(k) + '</strong></td><td>' + money(v, true) + '</td></tr>')) + '</div>' +
              '<div class="rpt-section" style="flex:1;min-width:280px;"><div class="rpt-section-title">By carrier</div>' +
                tbl(['Carrier', 'Rule', 'Expected'], sum(x => x.r.carrier).map(([k, v]) => '<tr><td><strong>' + esc(k) + '</strong></td><td style="font-size:11.5px;color:var(--gray-500);">' + esc(describeRule(carrierRecord(k))) + '</td><td>' + money(v, true) + '</td></tr>')) + '</div>' +
            '</div>' +
            '<div class="rpt-section"><div class="rpt-section-title">Carrier by month — expected vs received</div>' +
              tbl(['Month', 'Carrier', 'Expected', 'Received', 'Difference'], cmKeys.slice(0, 400).map(k => {
                  const [c, mo] = k.split('|');
                  const got = recv[c.toLowerCase() + '|' + mo] || 0;
                  const diff = got - byCarrierMonth[k];
                  return '<tr><td>' + esc(mo) + '</td><td>' + esc(c) + '</td><td>' + money(byCarrierMonth[k], true) + '</td><td>' + (got ? money(got, true) : '—') + '</td>' +
                      '<td style="font-weight:700;color:' + (diff >= 0 ? '#047857' : '#b45309') + ';">' + money(diff, true) + '</td></tr>';
              })) + '</div>' +
            '<div class="rpt-section"><div class="rpt-section-title">By client (expected, months in force)</div>' +
              tbl(['Client', 'Agent', 'Carrier', 'Plan year', 'Members', 'Per month', 'Commission / mo', 'Months', 'Expected'],
                Object.values(rows.reduce((m, x) => {
                    const g = m[x.r.id] || (m[x.r.id] = { r: x.r, months: 0, total: 0 });
                    g.months++; g.total += x.amount; return m;
                }, {})).sort((a, b) => b.total - a.total).slice(0, 600).map(g =>
                    '<tr><td><strong>' + esc(g.r.clientName) + '</strong></td><td>' + esc(g.r.agent) + '</td><td>' + esc(g.r.carrier) + '</td><td>' + esc(planYear(g.r)) + '</td>' +
                    '<td>' + esc(g.r.numMembers) + '</td><td>' + (g.r.monthlyPremium ? money(g.r.monthlyPremium, true) : '—') + '</td>' +
                    '<td>' + money(monthlyCommission(g.r), true) + '</td><td>' + g.months + '</td><td><strong>' + money(g.total, true) + '</strong></td></tr>')) +
            '</div>';
    }
    function exportCommissions() {
        exportCsv('health_commissions_report.csv',
            ['Month', 'Client', 'Agent', 'Carrier', 'Plan Year', 'Members', 'Premium / Month', 'Enrollment', 'Rule', 'Expected Commission'],
            commissionRows().map(x => [x.month, x.r.clientName, x.r.agent, x.r.carrier, planYear(x.r), x.r.numMembers, x.r.monthlyPremium,
                                       x.r.enrollmentType, describeRule(carrierRecord(x.r.carrier)), x.amount.toFixed(2)]));
    }

    // ── Carriers ─────────────────────────────────────────────
    function carriersView() {
        const all = carriers();
        const counts = {};
        records().forEach(r => { const k = (r.carrier || '').toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
        const names = Object.keys(all).sort((a, b) => a.localeCompare(b));
        const missing = [...new Set(records().map(r => r.carrier).filter(Boolean))].filter(n => !names.some(k => k.toLowerCase() === n.toLowerCase()));
        return '<p style="font-size:12.5px;color:var(--gray-500);margin:0 0 10px;">Health carriers are kept apart from the P&amp;C carrier list. The rate here prices the Health Commissions report' +
              ' and fills the commission rule on the New Health Entry form.' + (isAdmin() ? '' : ' <strong>Only an administrator can change it.</strong>') + '</p>' +
            (isAdmin() ? '<div style="margin-bottom:10px;"><button class="btn-sm" style="background:' + GRADIENT + ';color:#fff;border:none;" onclick="healthEditCarrier()">＋ Add carrier</button></div>' : '') +
            (missing.length ? '<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;color:#92400e;">Used on the Health Book but not on this list: <strong>' + missing.map(esc).join(', ') + '</strong></div>' : '') +
            tbl(['Carrier', 'Pays', 'New', 'Renewal', 'Enrollments', ''], names.map(n => {
                const r = ruleOf(all[n]);
                const unit = r.type === 'percent' ? v => (v || 0) + '%' : v => money(v, true);
                const pays = { percent: '% of monthly premium', pmpm: '$ per member per month', flat: '$ per policy per month' }[r.type] || r.type;
                return '<tr><td><strong>' + esc(n) + '</strong></td><td>' + esc(pays) + '</td><td>' + unit(r.newRate) + '</td><td>' + unit(r.renewRate) + '</td>' +
                    '<td>' + num(counts[n.toLowerCase()] || 0) + '</td><td style="white-space:nowrap;">' +
                    (isAdmin() ? '<button class="btn-secondary btn-sm" onclick="healthEditCarrier(\'' + jsq(n) + '\')">Edit</button> <button class="btn-danger btn-sm" onclick="healthDeleteCarrier(\'' + jsq(n) + '\')">✕</button>' : '') +
                    '</td></tr>';
            }));
    }
    function editCarrier(name) {
        if (!isAdmin()) return;
        const c = name ? carriers()[name] : null;
        const r = ruleOf(c);
        let m = document.getElementById('healthCarrierAmsModal');
        if (m) m.remove();
        m = document.createElement('div');
        m.id = 'healthCarrierAmsModal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
        const lab = t => '<label style="font-size:10px;font-weight:700;color:var(--gray-500);display:block;margin:10px 0 4px;text-transform:uppercase;">' + t + '</label>';
        const css = 'width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:7px;font-size:13px;box-sizing:border-box;font-family:inherit;';
        m.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;overflow:hidden;font-family:inherit;">' +
            '<div style="background:' + GRADIENT + ';color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;"><strong>' + (c ? 'Edit carrier' : 'Add carrier') + '</strong>' +
              '<button onclick="document.getElementById(\'healthCarrierAmsModal\').remove()" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">&times;</button></div>' +
            '<div style="padding:6px 18px 16px;">' +
              lab('Carrier name') + '<input id="hcaName" value="' + esc(name || '') + '" style="' + css + '">' +
              lab('Pays') + '<select id="hcaType" style="' + css + '">' +
                [['percent', '% of monthly premium'], ['pmpm', '$ per member per month'], ['flat', '$ per policy per month']]
                    .map(([v, l]) => '<option value="' + v + '"' + (r.type === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
              '<div style="display:flex;gap:10px;"><div style="flex:1;">' + lab('New enrollment') + '<input id="hcaNew" type="number" step="0.01" min="0" value="' + (r.newRate || '') + '" style="' + css + '"></div>' +
              '<div style="flex:1;">' + lab('Renewal') + '<input id="hcaRenew" type="number" step="0.01" min="0" value="' + (r.renewRate || '') + '" style="' + css + '"></div></div>' +
            '</div>' +
            '<div style="padding:12px 18px;border-top:1px solid var(--gray-100);display:flex;justify-content:flex-end;gap:8px;">' +
              '<button class="btn-secondary btn-sm" onclick="document.getElementById(\'healthCarrierAmsModal\').remove()">Cancel</button>' +
              '<button class="btn-sm" style="background:' + GRADIENT + ';color:#fff;border:none;" onclick="healthSaveCarrier(\'' + jsq(name || '') + '\')">💾 Save</button></div></div>';
        document.body.appendChild(m);
    }
    async function saveCarrier(oldName) {
        if (!isAdmin()) return;
        const name = (document.getElementById('hcaName')?.value || '').trim();
        if (!name) { alert('Enter the carrier name.'); return; }
        const type = document.getElementById('hcaType').value;
        const nw = parseFloat(document.getElementById('hcaNew').value) || 0;
        const rn = parseFloat(document.getElementById('hcaRenew').value) || 0;
        const ok = await saveMap(CARRIER_KEY, all => {
            if (oldName && oldName !== name) delete all[oldName];
            all[name] = Object.assign({}, all[name] || {}, {
                carrierName: name, commissionType: type,
                commissionRules: [{ paymentType: 'Monthly Paid', newRate: nw, renewRate: rn }, { paymentType: 'Gross Paid', newRate: nw, renewRate: rn }],
                updatedAt: new Date().toISOString(), updatedBy: me()
            });
            return all;
        });
        if (!ok) return;
        document.getElementById('healthCarrierAmsModal')?.remove();
        render();
    }
    async function deleteCarrier(name) {
        if (!isAdmin() || !confirm('Remove ' + name + ' from the health carrier list? Enrollments with this carrier stay as they are.')) return;
        if (await saveMap(CARRIER_KEY, all => { delete all[name]; return all; })) render();
    }

    // ── Commission statements ────────────────────────────────
    function statementsView() {
        const all = Object.values(statements()).filter(s => s && !s.voided)
            .sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')) || String(a.carrier).localeCompare(String(b.carrier)));
        return '<p style="font-size:12.5px;color:var(--gray-500);margin:0 0 10px;">What each health carrier actually paid. Record a statement by hand, or upload the carrier\'s statement (Excel or CSV) and its lines are matched to the health clients by name.' +
              (isAdmin() ? '' : ' <strong>Only an administrator can add statements.</strong>') + '</p>' +
            (isAdmin() ? '<div style="margin-bottom:10px;"><button class="btn-sm" style="background:' + GRADIENT + ';color:#fff;border:none;" onclick="healthNewStatement()">＋ Add commission statement</button></div>' : '') +
            '<div id="healthStmtForm"></div>' +
            tbl(['Month', 'Carrier', 'Received', 'Lines', 'Matched', 'File', 'Added', ''], all.map(s =>
                '<tr><td><strong>' + esc(s.period) + '</strong></td><td>' + esc(s.carrier) + '</td><td>' + money(s.total, true) + '</td>' +
                '<td>' + num((s.lines || []).length) + '</td><td>' + num((s.lines || []).filter(l => l.matchedKey).length) + '</td>' +
                '<td style="font-size:11.5px;">' + esc(s.fileName || '') + '</td><td style="font-size:11.5px;">' + esc((s.uploadedAt || '').slice(0, 10)) + (s.uploadedBy ? ' · ' + esc(s.uploadedBy) : '') + '</td>' +
                '<td style="white-space:nowrap;"><button class="btn-secondary btn-sm" onclick="healthViewStatement(\'' + jsq(s.id) + '\')">View</button>' +
                (isAdmin() ? ' <button class="btn-danger btn-sm" onclick="healthDeleteStatement(\'' + jsq(s.id) + '\')">✕</button>' : '') + '</td></tr>'));
    }

    let _draftLines = [];
    function newStatement() {
        if (!isAdmin()) return;
        _draftLines = [];
        const host = document.getElementById('healthStmtForm');
        if (!host) return;
        const css = 'width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:7px;font-size:13px;box-sizing:border-box;font-family:inherit;';
        const names = [...new Set(Object.keys(carriers()).concat(records().map(r => r.carrier).filter(Boolean)))].sort();
        host.innerHTML = '<div style="background:' + ROSE_PALE + ';border:1px solid ' + ROSE_LINE + ';border-radius:12px;padding:14px 16px;margin-bottom:14px;">' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;">' +
              '<div><label style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;">Carrier</label><select id="hsCarrier" style="' + css + '"><option value=""></option>' +
                names.map(n => '<option>' + esc(n) + '</option>').join('') + '</select></div>' +
              '<div><label style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;">Statement month</label><input id="hsPeriod" type="month" value="' + today().slice(0, 7) + '" style="' + css + '"></div>' +
              '<div><label style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;">Total paid ($)</label><input id="hsTotal" type="number" step="0.01" placeholder="sum of the lines if left blank" style="' + css + '"></div>' +
              '<div><label style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;">Statement file (optional)</label><input id="hsFile" type="file" accept=".xlsx,.xls,.csv" onchange="healthReadStatementFile(this)" style="' + css + 'padding:6px;"></div>' +
            '</div>' +
            '<div style="margin-top:8px;"><label style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;">Notes</label><input id="hsNotes" style="' + css + '"></div>' +
            '<div id="hsPreview" style="margin-top:10px;font-size:12.5px;color:var(--gray-600);"></div>' +
            '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">' +
              '<button class="btn-secondary btn-sm" onclick="document.getElementById(\'healthStmtForm\').innerHTML=\'\'">Cancel</button>' +
              '<button class="btn-sm" style="background:' + GRADIENT + ';color:#fff;border:none;" onclick="healthSaveStatement()">💾 Save statement</button></div>' +
            '</div>';
    }

    // Statement lines: the first sheet's header row names a client column and
    // an amount column; every row with both becomes a line, matched to a
    // health client by name (word order and punctuation ignored).
    function readStatementFile(input) {
        const f = input.files && input.files[0];
        const out = document.getElementById('hsPreview');
        if (!f) return;
        if (!window.XLSX) { out.textContent = 'The spreadsheet reader is not loaded on this page.'; return; }
        const rd = new FileReader();
        rd.onload = () => {
            try {
                const wb = XLSX.read(rd.result, { type: 'array' });
                const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
                let h = -1, nameCol = -1, amtCol = -1, memCol = -1;
                for (let i = 0; i < Math.min(rows.length, 30) && h < 0; i++) {
                    const cells = rows[i].map(c => String(c).toLowerCase());
                    const n = cells.findIndex(c => /(member|subscriber|insured|client|policyholder|customer)\s*(name)?|^name$/.test(c));
                    const a = cells.findIndex(c => /(commission|amount|paid|payment|total)/.test(c));
                    if (n >= 0 && a >= 0) { h = i; nameCol = n; amtCol = a; memCol = cells.findIndex(c => /(members|lives|count)/.test(c)); }
                }
                if (h < 0) { out.textContent = 'Could not find a client-name column and an amount column in the first sheet.'; return; }
                const words = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
                const byWords = new Map();
                clients().forEach(c => byWords.set(words(c.name), c.key));
                _draftLines = rows.slice(h + 1).filter(r => String(r[nameCol]).trim() && r[amtCol] !== '').map(r => {
                    const amount = parseFloat(String(r[amtCol]).replace(/[$,\s]/g, '')) || 0;
                    const raw = String(r[nameCol]).trim();
                    const flipped = raw.includes(',') ? raw.split(',').reverse().join(' ') : raw;
                    return { name: raw, amount, members: memCol >= 0 ? r[memCol] : '', matchedKey: byWords.get(words(flipped)) || byWords.get(words(raw)) || '' };
                });
                const total = _draftLines.reduce((s, l) => s + l.amount, 0);
                const matched = _draftLines.filter(l => l.matchedKey).length;
                const totalEl = document.getElementById('hsTotal');
                if (totalEl && !totalEl.value) totalEl.value = total.toFixed(2);
                out.innerHTML = '✓ ' + num(_draftLines.length) + ' lines, ' + money(total, true) + ' — ' + num(matched) + ' matched to a health client' +
                    (_draftLines.length > matched ? ', ' + num(_draftLines.length - matched) + ' not on the Health Book' : '') + '.';
            } catch (e) { out.textContent = 'Could not read that file: ' + (e.message || e); }
        };
        rd.readAsArrayBuffer(f);
    }

    async function saveStatement() {
        if (!isAdmin()) return;
        const carrier = document.getElementById('hsCarrier')?.value || '';
        const period = document.getElementById('hsPeriod')?.value || '';
        if (!carrier || !period) { alert('Choose the carrier and the statement month.'); return; }
        const total = parseFloat(document.getElementById('hsTotal')?.value) || _draftLines.reduce((s, l) => s + l.amount, 0);
        const file = document.getElementById('hsFile')?.files?.[0];
        const id = 'HCS-' + Date.now();
        const stmt = { id, carrier, period, total, lines: _draftLines, fileName: file ? file.name : '',
                       notes: (document.getElementById('hsNotes')?.value || '').trim(),
                       uploadedAt: new Date().toISOString(), uploadedBy: me() };
        if (await saveMap(STMT_KEY, all => { all[id] = stmt; return all; })) { _draftLines = []; render(); }
    }
    function viewStatement(id) {
        const s = statements()[id];
        if (!s) return;
        const cl = clients();
        const expectedFor = key => {
            const c = cl.get(key);
            if (!c) return 0;
            return c.records.filter(r => r.carrier && r.carrier.toLowerCase() === String(s.carrier).toLowerCase() && coveredMonths(r).includes(s.period))
                .reduce((sum, r) => sum + monthlyCommission(r), 0);
        };
        const host = document.getElementById('healthStmtForm');
        if (!host) return;
        host.innerHTML = '<div class="rpt-section"><div class="rpt-section-title" style="display:flex;justify-content:space-between;">' + esc(s.carrier) + ' · ' + esc(s.period) + ' · ' + money(s.total, true) +
            '<button class="btn-secondary btn-sm" onclick="document.getElementById(\'healthStmtForm\').innerHTML=\'\'">Close</button></div>' +
            (s.notes ? '<p style="font-size:12.5px;color:var(--gray-500);">' + esc(s.notes) + '</p>' : '') +
            tbl(['Line', 'Paid', 'Health client', 'Expected this month', 'Difference'], (s.lines || []).map(l => {
                const exp = l.matchedKey ? expectedFor(l.matchedKey) : 0;
                return '<tr><td>' + esc(l.name) + '</td><td>' + money(l.amount, true) + '</td>' +
                    '<td>' + (l.matchedKey ? '<a href="#" onclick="healthOpenClient(\'' + jsq(l.matchedKey) + '\');return false;">' + esc((cl.get(l.matchedKey) || {}).name || l.matchedKey) + '</a>' : '<span style="color:#b45309;">not on the Health Book</span>') + '</td>' +
                    '<td>' + (l.matchedKey ? money(exp, true) : '—') + '</td><td>' + (l.matchedKey ? money(l.amount - exp, true) : '—') + '</td></tr>';
            })) + '</div>';
    }
    async function deleteStatement(id) {
        if (!isAdmin() || !confirm('Delete this commission statement?')) return;
        // Voided rather than removed, so another device's copy cannot bring it back.
        if (await saveMap(STMT_KEY, all => { if (all[id]) all[id] = Object.assign({}, all[id], { voided: new Date().toISOString(), voidedBy: me() }); return all; })) render();
    }

    // ── Exports ──────────────────────────────────────────────
    window.healthIndexClients = indexClients;
    window.healthClientCard = clientCard;
    window.healthOpenClient = openClient;
    window.healthRender = render;
    window.healthTab = function (t) { _tab = t; if (t !== 'client') _openKey = null; render(); };
    window.healthRefresh = function () { pull().then(() => { refreshClientList(); render(); }).catch(() => render()); };
    window.healthFilter = function (k, v) {
        _f[k] = v;
        const focus = document.activeElement && document.activeElement.id;
        render();
        if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (el.setSelectionRange && typeof el.value === 'string') el.setSelectionRange(el.value.length, el.value.length); } }
    };
    window.healthReportFilter = function (k, v) { _r[k] = v; render(); };
    window.healthRenewalFilter = function (k, v) { _n[k] = v; render(); };
    window.healthEditRecord = editRecord;
    window.healthSaveRecord = saveRecord;
    window.healthDeleteRecord = deleteRecord;
    window.healthSaveContact = saveContact;
    window.healthExportReport = exportReport;
    window.healthExportCommissions = exportCommissions;
    window.healthEditCarrier = editCarrier;
    window.healthSaveCarrier = saveCarrier;
    window.healthDeleteCarrier = deleteCarrier;
    window.healthNewStatement = newStatement;
    window.healthReadStatementFile = readStatementFile;
    window.healthSaveStatement = saveStatement;
    window.healthViewStatement = viewStatement;
    window.healthDeleteStatement = deleteStatement;
})();
