// ============================================================
//  MONDAY.COM IMPORT
//  ------------------------------------------------------------
//  Brings the agency's monday.com account into the Binder Book in
//  one reviewed pass, from the import file built off the monday
//  export:
//    • new-business sales → Binder Book entries. Renewals are not
//      entered: the Renewals pages generate them from each entry's
//      expiration date, which the file already carries forward.
//    • prospects          → New Prospects, and the AMS as Prospect
//      clients so the prospect report can list them
//    • health clients     → Health Book records (AMS Health section)
//
//  Nothing is written until the admin has seen the preview. Every
//  record keeps the batch id it came in with, so a batch can be
//  undone from the same screen. Each shared key is merged with the
//  cloud copy immediately before it is written, so work other agents
//  saved meanwhile is never replaced.
// ============================================================
(function () {
    'use strict';

    // Lists of clients whose policies lapsed: everyone on them is a
    // win-back prospect even when an older sale is on the book.
    const WINBACK_BOARDS = ['Expired Prospects', 'Prospects Dec 2021'];
    const SNAPSHOT_SLOT = 'backupSnapshot_PreImport';
    const PREVIEW_ROWS = 150;

    let _file = null;      // the parsed import file
    let _plan = null;      // that file checked against the live book
    let _agentMap = {};    // monday name → Binder Book agent
    let _imported = { entries: [], prospects: [] };

    const $ = id => document.getElementById(id);

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function normPol(s) {
        const k = String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
        return k.length >= 5 ? k : '';
    }
    // Word order and punctuation vary between boards ("Lopez, Ramon" vs
    // "Ramon Lopez"), so names compare as a sorted set of words.
    function nameKey(s) {
        return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
            .filter(t => t && ['LLC', 'INC', 'CORP', 'CO', 'THE'].indexOf(t) === -1).sort().join(' ');
    }
    function monthsBetween(a, b) {
        const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00');
        return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth()) + (db.getDate() - da.getDate()) / 30;
    }
    function daysBefore(iso, days) {
        const d = new Date(iso + 'T12:00:00');
        if (isNaN(d)) return '';
        d.setDate(d.getDate() - days);
        return d.toISOString().slice(0, 10);
    }
    function lineFamily(lob) {
        lob = lob || '';
        return /auto/i.test(lob) ? 'auto' : /home/i.test(lob) ? 'home' : lob.toLowerCase();
    }
    function num(n) { return (Number(n) || 0).toLocaleString('en-US'); }

    function etFmt(iso, withSeconds) {
        const d = iso ? new Date(iso) : new Date();
        if (isNaN(d)) return '';
        const opts = { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
        if (withSeconds) opts.second = '2-digit';
        const p = new Intl.DateTimeFormat('en-US', opts).formatToParts(d);
        const g = t => (p.find(x => x.type === t) || {}).value || '';
        return withSeconds
            ? `${g('month')}/${g('day')}/${g('year')}, ${g('hour')}:${g('minute')}:${g('second')} ${g('dayPeriod')} ET`
            : `${g('month')}/${g('day')}/${g('year')}  ${g('hour')}:${g('minute')} ${g('dayPeriod')} ET`;
    }

    // Why two sales of the same client and line may be one: the gap
    // measured against the policy term says whether the policy renewed
    // and was then rewritten.
    function explainGap(older, newer) {
        const d1 = older.effDate || older.entryDate, d2 = newer.effDate || newer.entryDate;
        if (!d1 || !d2) return 'Same client and line — a date is missing on one entry';
        const gap = Math.abs(monthsBetween(d1, d2));
        if (gap < 0.25) return 'Same client and line within a week — possibly entered twice';
        const t = parseInt(older.term, 10) || 12;
        const k = Math.round(gap / t);
        let tail;
        if (k >= 1 && Math.abs(gap - k * t) <= 1) {
            tail = k === 1 ? 'rewritten at its first renewal'
                : `renewed ${k - 1} time${k - 1 === 1 ? '' : 's'}, then rewritten at the next renewal`;
        } else {
            const n = Math.floor(gap / t);
            tail = n === 0 ? 'rewritten mid-term, before its first renewal'
                : `renewed ${n} time${n === 1 ? '' : 's'}, then rewritten mid-term`;
        }
        return `Same client and line ${Math.round(gap)} months apart on a ${t}-month term — ${tail}`;
    }

    function readLocal(key, fallback) {
        try {
            const v = JSON.parse(localStorage.getItem(key));
            if (v == null) return fallback;
            if (Array.isArray(fallback) && !Array.isArray(v)) return Array.isArray(v.value) ? v.value : fallback;
            return v;
        } catch (e) { return fallback; }
    }
    function book() { return Array.isArray(allData) ? allData : []; }

    function roster() {
        const set = new Set(typeof AGENTS !== 'undefined' ? AGENTS : []);
        Object.keys(readLocal('agentMasterData', {})).forEach(n => set.add(n));
        book().forEach(e => { if (e && e.agent) set.add(e.agent); });
        return [...set].filter(Boolean).sort();
    }
    function mapAgent(name) {
        if (!name) return '';
        return Object.prototype.hasOwnProperty.call(_agentMap, name) ? _agentMap[name] : name;
    }
    // A monday name the roster lacks maps to the one roster agent sharing
    // its first name (monday "Lazaro Reigosa Cruz" → "Lazaro Reigoza").
    function suggestAgent(name, list) {
        if (list.indexOf(name) !== -1) return name;
        const first = name.split(' ')[0].toLowerCase();
        const hits = list.filter(n => n.split(' ')[0].toLowerCase() === first);
        return hits.length === 1 ? hits[0] : name;
    }

    // The payment type that drives an agent's commission rule: whatever
    // that agent's existing entries mostly use.
    let _payTypeCache = null;
    function paymentTypeFor(agent) {
        if (!_payTypeCache) {
            _payTypeCache = {};
            const counts = {};
            book().forEach(e => {
                if (!e || !e.agent || !e.paymentType) return;
                const c = counts[e.agent] || (counts[e.agent] = {});
                c[e.paymentType] = (c[e.paymentType] || 0) + 1;
            });
            Object.keys(counts).forEach(a => {
                _payTypeCache[a] = Object.keys(counts[a]).sort((x, y) => counts[a][y] - counts[a][x])[0];
            });
        }
        return _payTypeCache[agent] || 'Monthly Paid';
    }

    // ── Batches already imported (for Undo) ──────────────────────
    function batches() {
        const out = {};
        const add = (b, k) => { if (!b) return; (out[b] = out[b] || { entries: 0, prospects: 0, health: 0, clients: 0 })[k]++; };
        book().forEach(e => e && add(e.importBatch, 'entries'));
        readLocal('prospectData', []).forEach(p => p && add(p.importBatch, 'prospects'));
        readLocal('healthData', []).forEach(h => h && add(h.importBatch, 'health'));
        const c = readLocal('amsClientData', {});
        Object.keys(c).forEach(k => { const r = c[k]; if (r && !r.importUndone) add(r.createdByImport, 'clients'); });
        return out;
    }
    function batchLabel(b) {
        const m = /^monday-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/.exec(b);
        return m ? `monday import of ${m[1]} at ${m[2]}:${m[3]} UTC` : b;
    }

    // ── Modal ────────────────────────────────────────────────────
    function showMondayImport() {
        if (typeof currentRole !== 'undefined' && currentRole !== 'admin') {
            alert('Only the admin can import from monday.com.');
            return;
        }
        let m = $('mondayImportModal');
        if (m) m.remove();
        m = document.createElement('div');
        m.id = 'mondayImportModal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
        m.innerHTML =
            '<div style="background:#fff;border-radius:16px;max-width:1040px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;font-family:inherit;">' +
              '<div style="background:linear-gradient(135deg,#0d1f3c,#6d28d9);color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div><div style="font-weight:700;font-size:16px;">📥 Import from monday.com</div>' +
                '<div style="font-size:11.5px;opacity:.85;margin-top:2px;">New-business sales → Binder Book · prospects → New Prospects and the AMS · health clients → AMS Health</div></div>' +
                '<button onclick="document.getElementById(\'mondayImportModal\').remove()" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">&times;</button>' +
              '</div>' +
              '<div id="miBody" style="padding:18px 20px;overflow-y:auto;font-size:13.5px;color:#0f172a;line-height:1.55;"></div>' +
            '</div>';
        document.body.appendChild(m);
        renderStart();
    }

    function renderStart() {
        const body = $('miBody');
        if (!body) return;
        const prior = batches();
        const priorKeys = Object.keys(prior).filter(b => /^monday-/.test(b)).sort().reverse();
        body.innerHTML =
            (priorKeys.length ? '<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:12px 14px;margin-bottom:16px;">' +
                '<strong>Already imported</strong>' +
                priorKeys.map(b => {
                    const c = prior[b];
                    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap;">' +
                        '<span>' + esc(batchLabel(b)) + ' — ' + num(c.entries) + ' entries, ' + num(c.prospects) + ' prospects, ' +
                        num(c.health) + ' health records, ' + num(c.clients) + ' new AMS clients</span>' +
                        '<button class="btn-danger btn-sm" onclick="mondayImportUndo(\'' + esc(b) + '\')">↩ Undo this import</button></div>';
                }).join('') + '</div>' : '') +
            '<p style="margin:0 0 10px;">Choose the import file built from the monday.com export (<code>monday_binderbook_import_….json</code>). ' +
            'You will see exactly what would be added, what is already in the book, and every possible duplicate before anything is written.</p>' +
            '<ul style="margin:0 0 14px 18px;padding:0;">' +
              '<li>Only <strong>new business</strong> goes into the Binder Book. Renewals are not entered — each entry carries its current expiration, so the Renewals pages generate the renewal.</li>' +
              '<li>A policy already in the Binder Book (same policy #, or same client, date and carrier) is skipped.</li>' +
              '<li>The same client sold again on a different date is imported and listed as a <strong>possible duplicate</strong> with the likely reason — for example a 6-month policy renewed, then rewritten.</li>' +
              '<li>Prospects go to New Prospects and to the AMS as Prospect clients — never into the Binder Book entries.</li>' +
              '<li>Health clients go to the Health Book, shown in the AMS Health section — never into the Binder Book.</li>' +
            '</ul>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
              (typeof downloadLocalSnapshot === 'function'
                  ? '<button class="btn-secondary" onclick="downloadLocalSnapshot()">⬇ Download a snapshot first (recommended)</button>' : '') +
              '<input type="file" id="miFile" accept="application/json,.json" style="display:none;" onchange="mondayImportPick(this)">' +
              '<button class="btn-primary" style="background:linear-gradient(135deg,#0d1f3c,#6d28d9);" onclick="document.getElementById(\'miFile\').click()">📂 Choose import file…</button>' +
            '</div>' +
            '<div id="miStatus" style="margin-top:10px;color:#475569;"></div>';
    }

    async function pickFile(input) {
        const f = input.files && input.files[0];
        input.value = '';
        if (!f) return;
        const status = $('miStatus');
        let data;
        try { data = JSON.parse(await f.text()); } catch (e) { status.textContent = '❌ That file is not valid JSON.'; return; }
        if (!data || data.format !== 'uib-monday-import') {
            status.textContent = '❌ That is not a monday.com import file.';
            return;
        }
        _file = data;
        _payTypeCache = null;
        status.textContent = '⏳ Loading the latest book from the cloud so the check is against current data…';
        try {
            if (typeof syncFromDrive === 'function') await syncFromDrive();
            const fresh = readLocal('binderData', null);
            if (Array.isArray(fresh) && fresh.length >= book().length) allData = fresh;
        } catch (e) { /* offline: check against what this device has */ }
        const list = roster();
        _agentMap = {};
        Object.keys(_file.agents || {}).forEach(n => { _agentMap[n] = suggestAgent(n, list); });
        analyze();
        renderPlan();
    }

    // ── Check the file against the live book ─────────────────────
    function analyze() {
        const byImport = new Set(), byPol = new Map(), byName = new Map();
        book().forEach(e => {
            if (!e) return;
            if (e.importId) byImport.add(e.importId);
            const pk = normPol(e.policyNumber);
            if (pk) (byPol.get(pk) || byPol.set(pk, []).get(pk)).push(e);
            const nk = nameKey(e.customerName);
            if (nk) (byName.get(nk) || byName.set(nk, []).get(nk)).push(e);
        });
        const plan = { entries: [], skippedEntries: [], possible: [], prospects: [], skippedProspects: [], health: [], skippedHealth: [] };

        (_file.binderEntries || []).forEach(ie => {
            if (byImport.has(ie.importId)) return plan.skippedEntries.push({ ie, why: 'Already imported' });
            const pk = normPol(ie.policyNumber);
            const samePol = pk ? (byPol.get(pk) || []) : [];
            // The book holding this policy only as a renewal still lacks the original sale.
            const onlyRenewals = samePol.length && samePol.every(e => /^renewal$/i.test(e.policyType || ''));
            if (samePol.length && !onlyRenewals) {
                return plan.skippedEntries.push({ ie, ex: samePol[0], why: 'Already in the Binder Book (same policy #)' });
            }
            const sameName = byName.get(nameKey(ie.customerName)) || [];
            const d = ie.effDate || ie.entryDate;
            const twin = sameName.find(e => {
                const ed = e.effDate || e.entryDate;
                if (!d || !ed || Math.abs(monthsBetween(d, ed)) >= 0.25) return false;
                if (lineFamily(e.lineOfBusiness) !== lineFamily(ie.lineOfBusiness)) return false;
                return !e.company || !ie.company || e.company.slice(0, 5).toLowerCase() === ie.company.slice(0, 5).toLowerCase();
            });
            if (twin) return plan.skippedEntries.push({ ie, ex: twin, why: 'Already in the Binder Book (same client, date and carrier)' });
            sameName.filter(e => lineFamily(e.lineOfBusiness) === lineFamily(ie.lineOfBusiness)).forEach(e => {
                const pair = [ie, e].sort((a, b) => String(a.effDate || a.entryDate || '').localeCompare(String(b.effDate || b.entryDate || '')));
                plan.possible.push({ client: ie.customerName, why: explainGap(pair[0], pair[1]), incoming: ie, existing: e, where: 'monday vs Binder Book' });
            });
            if (onlyRenewals) {
                plan.possible.push({ client: ie.customerName, why: 'The Binder Book has this policy # only as a renewal — the monday entry is the original sale',
                                     incoming: ie, existing: samePol[0], where: 'monday vs Binder Book' });
            }
            plan.entries.push(ie);
        });
        // Pairs found inside the monday data, where both halves are being added.
        const adding = new Map(plan.entries.map(e => [e.importId, e]));
        (_file.possibleDuplicates || []).forEach(p => {
            const a = adding.get(p.a), b = adding.get(p.b);
            if (a && b) plan.possible.push({ client: p.client, why: p.why, incoming: b, existing: a, where: 'both from monday' });
        });
        // Pairs against what is already in the book come first: those are the
        // ones to look at before importing.
        plan.possible.sort((x, y) => (x.where === y.where ? 0 : x.where === 'monday vs Binder Book' ? -1 : 1) ||
            String(x.client).localeCompare(String(y.client)));

        const prospects = readLocal('prospectData', []);
        const pImport = new Set(prospects.map(p => p && p.importId).filter(Boolean));
        const pByName = new Map();
        prospects.forEach(p => { if (p) pByName.set(nameKey((p.firstName || '') + ' ' + (p.lastName || '')), p); });
        const digits = s => String(s || '').replace(/\D/g, '').slice(-10);
        (_file.prospects || []).forEach(ip => {
            if (pImport.has(ip.importId)) return plan.skippedProspects.push({ ip, why: 'Already imported' });
            const k = nameKey(ip.firstName + ' ' + ip.lastName);
            const ex = pByName.get(k);
            if (ex && (!digits(ex.phone) || !digits(ip.phone) || digits(ex.phone) === digits(ip.phone))) {
                return plan.skippedProspects.push({ ip, why: 'Already a prospect in the Binder Book' });
            }
            const winback = WINBACK_BOARDS.indexOf(ip.mondayBoard) !== -1 || ip.source === 'Renewal list';
            if (!winback && ip.createdAt) {
                const since = daysBefore(ip.createdAt.slice(0, 10), 30);
                const sold = (byName.get(k) || []).find(e => (e.effDate || e.entryDate || '') >= since);
                if (sold) {
                    return plan.skippedProspects.push({ ip, why: `Sold — ${sold.agent || 'an agent'} entered ${sold.customerName} on ${sold.effDate || sold.entryDate}` });
                }
            }
            plan.prospects.push(ip);
        });

        const health = readLocal('healthData', []);
        const hImport = new Set(health.map(h => h && h.importId).filter(Boolean));
        const sig = h => [nameKey(h.clientName), String(h.carrier || '').toLowerCase(), h.effDate || h.date || ''].join('|');
        const hSig = new Set(health.filter(Boolean).map(sig));
        (_file.health || []).forEach(ih => {
            if (hImport.has(ih.importId)) return plan.skippedHealth.push({ ih, why: 'Already imported' });
            if (hSig.has(sig(ih))) return plan.skippedHealth.push({ ih, why: 'Already in the Health Book' });
            plan.health.push(ih);
        });
        _plan = plan;
    }

    // ── Preview ──────────────────────────────────────────────────
    function card(label, value, sub, color) {
        return '<div style="flex:1;min-width:150px;background:' + color + '0d;border:1px solid ' + color + '33;border-radius:10px;padding:10px 12px;">' +
            '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:' + color + ';">' + label + '</div>' +
            '<div style="font-size:22px;font-weight:800;color:#0f172a;">' + value + '</div>' +
            (sub ? '<div style="font-size:11.5px;color:#64748b;">' + sub + '</div>' : '') + '</div>';
    }
    function table(header, rows) {
        return '<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
            '<thead><tr>' + header.map(h => '<th style="text-align:left;padding:6px 8px;background:#f1f5f9;color:#0f172a;font-weight:700;border-bottom:1px solid #e2e8f0;white-space:nowrap;">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
            rows.slice(0, PREVIEW_ROWS).map(r => '<tr>' + r.map(c => '<td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top;">' + c + '</td>').join('') + '</tr>').join('') +
            (rows.length > PREVIEW_ROWS ? '<tr><td colspan="' + header.length + '" style="padding:6px 8px;color:#64748b;">… and ' + num(rows.length - PREVIEW_ROWS) + ' more — download the list for all of them.</td></tr>' : '') +
            '</tbody></table></div>';
    }
    function details(title, inner, open) {
        return '<details' + (open ? ' open' : '') + ' style="margin-top:12px;"><summary style="cursor:pointer;font-weight:700;color:#0d1f3c;">' + title + '</summary>' + inner + '</details>';
    }
    function link(url) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">monday ↗</a>' : ''; }

    function renderPlan() {
        const body = $('miBody');
        if (!body || !_plan) return;
        const p = _plan;
        const list = roster();
        const agentNames = Object.keys(_file.agents || {}).sort();

        const perAgent = {};
        const bump = (a, k) => { a = a || '(no agent on monday)'; (perAgent[a] = perAgent[a] || { e: 0, p: 0, h: 0, prem: 0 })[k]++; };
        p.entries.forEach(e => { bump(mapAgent((e.agents || [])[0]), 'e'); const a = mapAgent((e.agents || [])[0]) || '(no agent on monday)'; perAgent[a].prem += Number(e.basePremium) || 0; });
        p.prospects.forEach(x => bump((x.agents || []).map(mapAgent).filter(Boolean).join(', '), 'p'));
        p.health.forEach(h => bump(mapAgent(h.agent), 'h'));

        const open = p.prospects.filter(x => x.status !== 'Lost').length;
        body.innerHTML =
            '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
              card('Binder Book entries', num(p.entries.length), num(p.skippedEntries.length) + ' already in the book — skipped', '#1d4ed8') +
              card('Possible duplicates', num(p.possible.length), 'imported, listed for review', '#b45309') +
              card('Prospects', num(p.prospects.length), num(open) + ' open · ' + num(p.prospects.length - open) + ' lost · ' + num(p.skippedProspects.length) + ' skipped', '#6d28d9') +
              card('Health records', num(p.health.length), num(p.skippedHealth.length) + ' already in the Health Book', '#e11d48') +
            '</div>' +

            details('Agents — check who each monday name becomes', '<p style="margin:8px 0 0;color:#475569;">Every record keeps the agent shown on monday. Pick the Binder Book agent each monday name should become.</p>' +
                table(['monday name', 'Records', 'Binder Book agent'], agentNames.map(n => [esc(n), num((_file.agentCounts || {})[n]),
                    '<select data-mi-agent="' + esc(n) + '" onchange="mondayImportSetAgent(this)" style="padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;">' +
                    [...new Set(list.concat([n]))].sort().map(r => '<option value="' + esc(r) + '"' + (mapAgent(n) === r ? ' selected' : '') + '>' + esc(r) + (r === n && list.indexOf(n) === -1 ? ' (keep monday name)' : '') + '</option>').join('') +
                    '</select>'])), true) +

            details('By agent', table(['Agent', 'Binder entries', 'Base premium', 'Prospects', 'Health'],
                Object.keys(perAgent).sort().map(a => [esc(a), num(perAgent[a].e), '$' + num(Math.round(perAgent[a].prem)), num(perAgent[a].p), num(perAgent[a].h)])), true) +

            details('Possible duplicates (' + num(p.possible.length) + ') — imported, listed so you can review them',
                table(['Client', 'Why', 'Where', 'New entry', 'Other entry'], p.possible.map(x => [
                    esc(x.client), esc(x.why), esc(x.where),
                    esc([x.incoming.effDate || x.incoming.entryDate, x.incoming.company, x.incoming.policyNumber, mapAgent((x.incoming.agents || [])[0])].filter(Boolean).join(' · ')) + ' ' + link(x.incoming.mondayUrl),
                    esc([x.existing.effDate || x.existing.entryDate, x.existing.company, x.existing.policyNumber, x.existing.agent || mapAgent((x.existing.agents || [])[0])].filter(Boolean).join(' · ')) +
                        (x.existing.mondayUrl ? ' ' + link(x.existing.mondayUrl) : '')]))) +

            details('Already in the Binder Book — skipped (' + num(p.skippedEntries.length) + ')',
                table(['Client', 'Policy #', 'Effective', 'Carrier', 'Reason', 'In the book as'], p.skippedEntries.map(x => [
                    esc(x.ie.customerName), esc(x.ie.policyNumber), esc(x.ie.effDate), esc(x.ie.company), esc(x.why),
                    x.ex ? esc([x.ex.agent, x.ex.effDate || x.ex.entryDate, x.ex.policyType].filter(Boolean).join(' · ')) : '']))) +

            details('Binder Book entries to add (' + num(p.entries.length) + ')',
                table(['Agent', 'Client', 'Type', 'Line', 'Carrier', 'Policy #', 'Effective', 'Expires', 'Premium', 'Notes'], p.entries.map(e => [
                    esc(mapAgent((e.agents || [])[0])), esc(e.customerName), esc(e.policyType), esc(e.lineOfBusiness), esc(e.company),
                    esc(e.policyNumber), esc(e.effDate), esc(e.expirationDate) + (e.policyStatus === 'Cancelled' ? ' <span style="color:#b91c1c;">(cancelled)</span>' : ''),
                    '$' + num(e.basePremium), esc((e.importNotes || []).join('; '))]))) +

            details('Prospects to add (' + num(p.prospects.length) + ')',
                table(['Status', 'Agent', 'Name', 'Phone', 'Email', 'Address', 'Line', 'Current carrier', 'monday'], p.prospects.map(x => [
                    esc(x.status), esc((x.agents || []).map(mapAgent).join(', ')), esc((x.firstName + ' ' + x.lastName).trim()), esc(x.phone), esc(x.email),
                    esc([x.address, x.city, x.state, x.zip].filter(Boolean).join(', ')), esc(x.lob), esc(x.currentCarrier), esc(x.mondayBoard) + ' ' + link(x.mondayUrl)]))) +

            (p.skippedProspects.length ? details('Prospects skipped (' + num(p.skippedProspects.length) + ')',
                table(['Name', 'Reason', 'monday'], p.skippedProspects.map(x => [esc((x.ip.firstName + ' ' + x.ip.lastName).trim()), esc(x.why), esc(x.ip.mondayBoard) + ' ' + link(x.ip.mondayUrl)]))) : '') +

            details('Health records to add (' + num(p.health.length) + ')',
                table(['Agent', 'Client', 'Carrier', 'Effective', 'Members', 'Per month', 'Status'], p.health.map(h => [
                    esc(mapAgent(h.agent)), esc(h.clientName), esc(h.carrier), esc(h.effDate), esc(h.numMembers), h.monthlyPremium ? '$' + num(h.monthlyPremium) : '', esc(h.status)]))) +

            ((_file.soldWithoutDetails || []).length ? details('Sold on monday with no policy details (' + num(_file.soldWithoutDetails.length) + ') — not entered; add these by hand',
                table(['Client', 'Agent', 'Stage', 'Board'], _file.soldWithoutDetails.map(s => [esc(s.name), esc((s.agents || []).map(mapAgent).join(', ')), esc(s.stage), esc(s.board) + ' ' + link(s.url)]))) : '') +

            '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;">' +
              '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;">' +
                '<label><input type="checkbox" id="miDoEntries" checked> Binder Book entries (' + num(p.entries.length) + ')</label>' +
                '<label><input type="checkbox" id="miDoProspects" checked> Prospects + AMS prospect clients (' + num(p.prospects.length) + ')</label>' +
                '<label><input type="checkbox" id="miDoHealth" checked> Health records (' + num(p.health.length) + ')</label>' +
              '</div>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                '<button class="btn-secondary" onclick="mondayImportDownloadReview()">⬇ Download possible duplicates & skipped (Excel)</button>' +
                '<button class="btn-primary" id="miGo" style="background:linear-gradient(135deg,#0d1f3c,#6d28d9);" onclick="mondayImportRun()">📥 Import now</button>' +
                '<button class="btn-secondary" onclick="mondayImportBack()">← Back</button>' +
              '</div>' +
              '<div id="miLog" style="margin-top:12px;font-size:12.5px;color:#334155;"></div>' +
            '</div>';
    }

    function setAgent(sel) {
        _agentMap[sel.getAttribute('data-mi-agent')] = sel.value;
        const y = $('miBody') ? $('miBody').scrollTop : 0;
        renderPlan();
        if ($('miBody')) $('miBody').scrollTop = y;
    }

    // ── Review download ──────────────────────────────────────────
    function downloadReview() {
        if (!_plan) return;
        const p = _plan;
        const side = (e, isBook) => [
            isBook ? (e.agent || '') : mapAgent((e.agents || [])[0]), e.customerName || '', e.effDate || '', e.entryDate || '',
            e.company || '', e.policyNumber || '', e.lineOfBusiness || '', e.policyType || '', e.term || '', e.mondayUrl || ''];
        const sideHead = pre => ['Agent', 'Client', 'Effective', 'Entered', 'Carrier', 'Policy #', 'Line', 'Type', 'Term', 'monday link'].map(h => pre + ' ' + h);
        const sheets = {
            'Possible Duplicates': [['Client', 'Why', 'Where'].concat(sideHead('New:'), sideHead('Other:'))]
                .concat(p.possible.map(x => [x.client, x.why, x.where].concat(side(x.incoming, false), side(x.existing, x.where !== 'both from monday')))),
            'Skipped - Already In Book': [['Reason'].concat(sideHead('monday:'), sideHead('Binder Book:'))]
                .concat(p.skippedEntries.map(x => [x.why].concat(side(x.ie, false), x.ex ? side(x.ex, true) : []))),
            'Prospects Skipped': [['Name', 'Reason', 'monday board', 'monday link']]
                .concat(p.skippedProspects.map(x => [(x.ip.firstName + ' ' + x.ip.lastName).trim(), x.why, x.ip.mondayBoard, x.ip.mondayUrl])),
            'Sold - No Details': [['Client', 'Agent', 'Stage', 'Board', 'monday link']]
                .concat((_file.soldWithoutDetails || []).map(s => [s.name, (s.agents || []).map(mapAgent).join(', '), s.stage, s.board, s.url]))
        };
        const stamp = (typeof getEasternDateString === 'function') ? getEasternDateString() : new Date().toISOString().slice(0, 10);
        if (window.XLSX) {
            const wb = XLSX.utils.book_new();
            Object.keys(sheets).forEach(n => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[n]), n.slice(0, 31)));
            XLSX.writeFile(wb, 'monday-import-review-' + stamp + '.xlsx');
            return;
        }
        const csv = sheets['Possible Duplicates'].map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'monday-possible-duplicates-' + stamp + '.csv';
        a.click();
    }

    // ── Write ────────────────────────────────────────────────────
    function logLine(msg) {
        const el = $('miLog');
        if (el) el.insertAdjacentHTML('beforeend', '<div>' + msg + '</div>');
    }

    // A point-in-time copy of everything this import touches, kept in the
    // cloud next to the daily backups (Admin → Cloud Backups lists it).
    async function preImportSnapshot(batch) {
        const keys = (typeof BACKUP_SNAPSHOT_KEYS !== 'undefined' ? BACKUP_SNAPSHOT_KEYS : ['binderData', 'binderDeletedIds', 'prospectData'])
            .concat(['amsClientData', 'healthData', 'healthCarrierData']);
        const snap = { date: (typeof getEasternDateString === 'function') ? getEasternDateString() : new Date().toISOString().slice(0, 10),
                       savedAt: new Date().toISOString(), entryCount: book().length, reason: 'before ' + batch, data: {} };
        keys.forEach(k => { const v = readLocal(k, null); if (v !== null) snap.data[k] = v; });
        snap.data.binderData = book();
        if (typeof _backupPost !== 'function') throw new Error('the cloud backup function is not available on this page');
        await _backupPost(SNAPSHOT_SLOT, snap);
    }

    function entryNotes(ie) {
        const notes = (ie.importNotes || []).slice();
        notes.unshift('Imported from monday.com (' + (ie.mondayBoard || 'board') + ')');
        return notes.join(' · ');
    }

    function toEntry(ie, batch, nowIso, nowMs) {
        const agent = mapAgent((ie.agents || [])[0] || '');
        const e = {
            id: ie.id, importId: ie.importId, importBatch: batch, importedFrom: 'monday', importedAt: nowIso,
            agent, customerName: ie.customerName, contactName: '', documentationStatus: [],
            source: ie.source || '', referredBy: ie.referredBy || '',
            customerPhone: ie.customerPhone || '', customerEmail: ie.customerEmail || '',
            policyType: ie.policyType || 'New', lineOfBusiness: ie.lineOfBusiness || '',
            company: ie.company || '', mga: ie.mga || '', premiumFinance: '',
            down: Number(ie.down) || 0, agencyFee: Number(ie.agencyFee) || 0, basePremium: Number(ie.basePremium) || 0,
            agencyCommission: 0, totalPremium: Number(ie.totalPremium) || Number(ie.basePremium) || 0,
            paymentType: paymentTypeFor(agent), paymentMethod2: ie.paymentMethod2 || '',
            policyNumber: ie.policyNumber || '', binderNumber: '',
            entryDate: ie.entryDate || ie.effDate || '', entryDateDisplay: ie.entryDate || ie.effDate || '',
            effDate: ie.effDate || '', term: ie.term || '',
            location: typeof getAgentDefaultLocation === 'function' ? getAgentDefaultLocation(agent) : '',
            lineType: ie.lineType || 'personal', drivers: [], vehicles: [], secondAgent: '',
            agentCommissionShare: 0, secondAgentCommission: 0,
            timestamp: etFmt(ie.createdAt, true), updatedAt: nowMs, notes: entryNotes(ie)
        };
        ['effectiveDate', 'expirationDate', 'policyStatus', 'cancellationDate', 'renewalHistory', 'mondayUrl'].forEach(k => {
            if (ie[k] != null && ie[k] !== '') e[k] = ie[k];
        });
        const premium = e.basePremium || e.totalPremium;
        if (premium > 0 && e.company && e.lineOfBusiness && typeof getCommissionRate === 'function') {
            const rate = getCommissionRate(e.company, e.lineOfBusiness, e.paymentType, e.policyType);
            if (rate > 0) {
                e.agencyCommission = parseFloat((premium * rate / 100).toFixed(2));
                e.agentCommissionShare = parseFloat(((e.agencyFee + e.agencyCommission) * 0.5).toFixed(2));
            }
        }
        return e;
    }

    function toProspect(ip, batch) {
        const agents = (ip.agents || []).map(mapAgent).filter(Boolean);
        const p = {
            id: ip.id, importId: ip.importId, importBatch: batch, importedFrom: 'monday',
            firstName: ip.firstName || '', lastName: ip.lastName || '', businessName: ip.businessName || '',
            phone: ip.phone || '', phone2: '', email: ip.email || '',
            address: ip.address || '', city: ip.city || '', state: ip.state || '', zip: ip.zip || '', dob: ip.dob || '',
            lob: ip.lob || '', source: ip.source || '', referredBy: ip.referredBy || '',
            agent: [...new Set(agents)].join(', '), followUpDate: ip.followUpDate || '',
            dateAdded: etFmt(ip.createdAt, false), notes: ip.notes || '', status: ip.status || 'Open',
            currentCarrier: ip.currentCarrier || '', currentPolicyNumber: ip.currentPolicyNumber || '',
            currentPremium: Number(ip.currentPremium) || 0, quotedPremium: Number(ip.quotedPremium) || 0,
            policyExpiration: ip.policyExpiration || '',
            leadGenerator: (ip.leadGenerator || '').split(/,\s*/).filter(Boolean).map(mapAgent).join(', '),
            mondayStage: ip.mondayStage || '', mondayBoard: ip.mondayBoard || '', mondayUrl: ip.mondayUrl || '',
            mondayCreatedAt: ip.createdAt || ''
        };
        if (p.status === 'Lost') { p.lostAt = ip.createdAt || ''; p.lostReason = ip.mondayStage || 'Lost on monday.com'; }
        return p;
    }

    function toHealth(ih, batch, nowIso) {
        const h = Object.assign({}, ih);
        h.importBatch = batch;
        h.importedAt = nowIso;
        h.agent = mapAgent(ih.agent || '');
        h.agents = (ih.agents || []).map(mapAgent).filter(Boolean);
        h.timestamp = etFmt(ih.createdAt, true);
        h.updatedAt = Date.now();
        return h;
    }

    // Merge an id-keyed array with its cloud copy (cloud first, this
    // device on top), apply `change`, and write the result back.
    async function mergeAndWriteArray(key, change) {
        const cloud = await driveGetResult(key);
        if (!cloud.ok) throw new Error('the cloud could not be reached to merge ' + key + ' — nothing was written for it');
        const byId = new Map();
        (Array.isArray(cloud.value) ? cloud.value : []).forEach(r => { if (r && r.id != null) byId.set(r.id, r); });
        readLocal(key, []).forEach(r => { if (r && r.id != null) byId.set(r.id, r); });
        const list = change([...byId.values()]);
        _origSetItem(key, JSON.stringify(list));
        if (!(await driveSet(key, list))) throw new Error('the cloud did not accept ' + key);
        return list;
    }

    async function mergeAndWriteMap(key, change) {
        const cloud = await driveGetResult(key);
        if (!cloud.ok) throw new Error('the cloud could not be reached to merge ' + key + ' — nothing was written for it');
        const local = readLocal(key, {});
        const S = window.UIBBinderSync;
        const merged = (S && typeof S.mergeClientData === 'function')
            ? S.mergeClientData(local, cloud.value || {})
            : Object.assign({}, cloud.value || {}, local);
        const out = change(merged);
        _origSetItem(key, JSON.stringify(out));
        if (!(await driveSet(key, out))) throw new Error('the cloud did not accept ' + key);
        return out;
    }

    async function importEntries(batch) {
        const nowIso = new Date().toISOString(), nowMs = Date.now();
        const have = new Set(book().map(e => e && e.id));
        const entries = _plan.entries.map(ie => toEntry(ie, batch, nowIso, nowMs));
        entries.forEach(e => { while (have.has(e.id)) e.id++; have.add(e.id); });
        allData = book().concat(entries);
        _lsMirror('binderData', JSON.stringify(allData));
        if (!(await driveSet('binderData', allData))) {
            throw new Error('the cloud did not accept the Binder Book entries. They are kept on this device and upload on the next sync — nothing else was written');
        }
        _imported.entries = entries;
        try { if (typeof recalculateAllCommissions === 'function') recalculateAllCommissions(); } catch (e) {}
        return entries.length;
    }

    async function importProspects(batch) {
        const add = _plan.prospects.map(ip => toProspect(ip, batch));
        await mergeAndWriteArray('prospectData', list => list.concat(add.filter(p => !list.some(x => x.id === p.id))));
        _imported.prospects = add;
        return add.length;
    }

    // Sold clients get (or fill in) an Active client record; prospects get a
    // Prospect / Inactive Prospect record so the AMS prospect report finds them.
    // An existing record is only ever filled in — never overwritten.
    async function importClients(batch, doEntries, doProspects) {
        const now = new Date().toISOString();
        let created = 0, filled = 0;
        await mergeAndWriteMap('amsClientData', contacts => {
            const fill = (rec, f, v) => { if (v && !rec[f]) { rec[f] = v; return true; } return false; };
            const touch = (key, base) => {
                let rec = contacts[key];
                if (!rec) {
                    rec = contacts[key] = Object.assign({ notes: [], createdAt: now, createdBy: 'monday.com import', createdByImport: batch }, base);
                    created++;
                } else filled++;
                rec.updatedAt = now;
                return rec;
            };
            if (doEntries) {
                const byKey = new Map();
                _imported.entries.forEach(e => {
                    const key = amsClientKeyFromName(e.customerName);
                    if (key) (byKey.get(key) || byKey.set(key, []).get(key)).push(e);
                });
                byKey.forEach((list, key) => {
                    list.sort((a, b) => String(a.entryDate).localeCompare(String(b.entryDate)));
                    const first = list[0], last = list[list.length - 1];
                    const rec = touch(key, { clientStatus: 'Active' });
                    const split = splitCustomerName(first.customerName);
                    fill(rec, 'firstName', split.firstName);
                    fill(rec, 'lastName', split.lastName);
                    fill(rec, 'phone1', list.map(e => e.customerPhone).find(Boolean));
                    fill(rec, 'email', list.map(e => e.customerEmail).find(Boolean));
                    fill(rec, 'assignedAgent', last.agent);
                    fill(rec, 'csrName', last.agent);
                    fill(rec, 'clientSince', first.entryDate);
                    fill(rec, 'dealerLocation', last.location);
                    fill(rec, 'referralSource', first.source);
                    fill(rec, 'clientStatus', 'Active');
                });
            }
            if (doProspects) {
                _imported.prospects.forEach(p => {
                    const name = (p.firstName + ' ' + p.lastName).trim();
                    const key = amsClientKeyFromName(name);
                    if (!key) return;
                    const rec = touch(key, { clientStatus: p.status === 'Lost' ? 'Inactive Prospect' : 'Prospect' });
                    fill(rec, 'firstName', p.firstName);
                    fill(rec, 'lastName', p.lastName);
                    fill(rec, 'phone1', p.phone);
                    fill(rec, 'email', p.email);
                    fill(rec, 'address', p.address);
                    fill(rec, 'city', p.city);
                    fill(rec, 'state', p.state);
                    fill(rec, 'zip', p.zip);
                    fill(rec, 'dob', p.dob);
                    fill(rec, 'assignedAgent', p.agent.split(', ')[0]);
                    fill(rec, 'referralSource', p.source);
                    fill(rec, 'clientStatus', p.status === 'Lost' ? 'Inactive Prospect' : 'Prospect');
                    fill(rec, 'prospectId', p.id);
                    // Kept apart from clientStatus: a lapsed client being won back
                    // stays Active there and is still a prospect for the report.
                    fill(rec, 'prospectStatus', p.status === 'Lost' ? 'Lost' : 'Open');
                    fill(rec, 'prospectSince', p.dateAdded);
                    fill(rec, 'prospectSinceDate', (p.mondayCreatedAt || '').slice(0, 10));
                    fill(rec, 'prospectLob', p.lob);
                    fill(rec, 'currentCarrier', p.currentCarrier);
                    if (!Array.isArray(rec.notes)) rec.notes = [];
                    if (!rec.notes.some(n => n && n.prospectImportId === p.importId)) {
                        rec.notes.push({ text: 'Prospect from monday.com (' + p.mondayBoard + ')' + (p.notes ? ' — ' + p.notes : ''),
                                         author: 'monday.com import', date: now, prospectImportId: p.importId });
                    }
                });
            }
            return contacts;
        });
        return { created, filled };
    }

    async function importHealth(batch) {
        const nowIso = new Date().toISOString();
        const add = _plan.health.map(ih => toHealth(ih, batch, nowIso));
        await mergeAndWriteArray('healthData', list => {
            const have = new Set(list.map(h => h.id));
            add.forEach(h => { while (have.has(h.id)) h.id++; have.add(h.id); });
            return list.concat(add);
        });
        // Carriers seen on the health boards, for the AMS carrier list. Rates
        // stay at 0 until the admin sets them there.
        const names = _file.healthCarriers || [];
        let added = 0;
        if (names.length) {
            await mergeAndWriteMap('healthCarrierData', carriers => {
                names.forEach(n => {
                    if (Object.keys(carriers).some(k => k.toLowerCase() === n.toLowerCase())) return;
                    carriers[n] = { carrierName: n, commissionType: 'percent', commissionRules: [
                        { paymentType: 'Monthly Paid', newRate: 0, renewRate: 0 },
                        { paymentType: 'Gross Paid', newRate: 0, renewRate: 0 }], addedBy: 'monday.com import', updatedAt: nowIso };
                    added++;
                });
                return carriers;
            });
        }
        return { records: add.length, carriers: added };
    }

    async function run() {
        if (!_plan) return;
        const doE = $('miDoEntries') && $('miDoEntries').checked;
        const doP = $('miDoProspects') && $('miDoProspects').checked;
        const doH = $('miDoHealth') && $('miDoHealth').checked;
        if (!doE && !doP && !doH) { alert('Nothing is selected to import.'); return; }
        const parts = [];
        if (doE) parts.push(num(_plan.entries.length) + ' Binder Book entries');
        if (doP) parts.push(num(_plan.prospects.length) + ' prospects (and their AMS client records)');
        if (doH) parts.push(num(_plan.health.length) + ' health records');
        if (!confirm('Import ' + parts.join(', ') + '?\n\nA snapshot of the current data is saved to the cloud first. ' +
                     'The whole import can be undone from this screen.')) return;
        const go = $('miGo');
        if (go) { go.disabled = true; go.textContent = 'Importing…'; }
        const batch = 'monday-' + new Date().toISOString().replace(/[:.]/g, '-');
        _imported = { entries: [], prospects: [] };
        try {
            logLine('⏳ Saving a snapshot of the current data to the cloud…');
            await preImportSnapshot(batch);
            logLine('✓ Snapshot saved (Admin → Cloud Backups → PreImport).');
            if (doE) { logLine('⏳ Adding Binder Book entries…'); logLine('✓ ' + num(await importEntries(batch)) + ' Binder Book entries added, commissions priced from the carrier rules.'); }
            if (doP) { logLine('⏳ Adding prospects…'); logLine('✓ ' + num(await importProspects(batch)) + ' prospects added to New Prospects.'); }
            if (doE || doP) {
                logLine('⏳ Updating AMS client records…');
                const c = await importClients(batch, doE, doP);
                logLine('✓ AMS: ' + num(c.created) + ' new client records, ' + num(c.filled) + ' existing ones filled in.');
            }
            if (doH) {
                logLine('⏳ Adding health records…');
                const h = await importHealth(batch);
                logLine('✓ ' + num(h.records) + ' health records added' + (h.carriers ? ', ' + h.carriers + ' health carriers added to the carrier list (set their commission in AMS → Health → Carriers)' : '') + '.');
            }
            logLine('<strong style="color:#047857;">✅ Import complete.</strong> Batch: <code>' + esc(batch) + '</code>');
            if (window.UIBAudit) try { UIBAudit.log('import', 'monday.com', { batch, entries: doE ? _plan.entries.length : 0, prospects: doP ? _plan.prospects.length : 0, health: doH ? _plan.health.length : 0 }); } catch (e) {}
        } catch (e) {
            logLine('<strong style="color:#b91c1c;">❌ Stopped: ' + esc(e.message || e) + '</strong>');
        } finally {
            if (go) { go.textContent = 'Imported'; }
            refreshViews();
        }
    }

    // ── Undo ─────────────────────────────────────────────────────
    async function undo(batch) {
        const c = batches()[batch] || {};
        if (!confirm('Undo ' + batchLabel(batch) + '?\n\nThis removes ' + num(c.entries) + ' Binder Book entries, ' + num(c.prospects) +
                     ' prospects and ' + num(c.health) + ' health records it added, and hides the ' + num(c.clients) +
                     ' AMS client records it created. Records it only filled in are left as they are.')) return;
        const status = $('miStatus') || $('miLog');
        const say = msg => { if (status) status.innerHTML = msg; };
        try {
            say('⏳ Removing Binder Book entries…');
            const ids = book().filter(e => e && e.importBatch === batch).map(e => e.id);
            if (ids.length) {
                binderMarkDeleted(ids);
                allData = book().filter(e => !(e && e.importBatch === batch));
                _lsMirror('binderData', JSON.stringify(allData));
                if (!(await driveSet('binderData', allData))) throw new Error('the cloud did not accept the removal of the entries');
                try { if (typeof recalculateAllCommissions === 'function') recalculateAllCommissions(); } catch (e) {}
            }
            say('⏳ Removing prospects and health records…');
            await mergeAndWriteArray('prospectData', list => list.filter(p => p.importBatch !== batch));
            await mergeAndWriteArray('healthData', list => list.filter(h => h.importBatch !== batch));
            say('⏳ Hiding the AMS client records it created…');
            // Deletions do not travel through the client-record merge, so the
            // records are flagged (with a newer stamp) and the AMS hides them.
            const now = new Date().toISOString();
            await mergeAndWriteMap('amsClientData', contacts => {
                Object.keys(contacts).forEach(k => {
                    const r = contacts[k];
                    if (r && r.createdByImport === batch && !r.importUndone) { r.importUndone = now; r.updatedAt = now; }
                });
                return contacts;
            });
            say('✅ ' + esc(batchLabel(batch)) + ' undone.');
        } catch (e) {
            say('❌ Undo stopped: ' + esc(e.message || e));
        }
        refreshViews();
        setTimeout(renderStart, 1200);
    }

    function refreshViews() {
        try { if (typeof loadAdminData === 'function') loadAdminData(); } catch (e) {}
        try { if (typeof renderNavMonthStats === 'function') renderNavMonthStats(); } catch (e) {}
        try {
            if (document.getElementById('prospectsSection')?.classList.contains('active')) {
                if (typeof renderProspectsDashboard === 'function') renderProspectsDashboard();
                if (typeof renderProspectsTable === 'function') renderProspectsTable();
            }
        } catch (e) {}
    }

    window.showMondayImport = showMondayImport;
    window.mondayImportPick = pickFile;
    window.mondayImportSetAgent = setAgent;
    window.mondayImportDownloadReview = downloadReview;
    window.mondayImportRun = run;
    window.mondayImportUndo = undo;
    window.mondayImportBack = function () { _plan = null; renderStart(); };
})();
