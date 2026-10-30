// ============================================================
//  AGENCY PROFILE
//  ------------------------------------------------------------
//  The agency's own record: who it is, where it is, where it
//  writes from, who writes for it, and how commission is split.
//
//  Everything here is agency-wide, so only an administrator can
//  change it — an agent sees the same page read-only. The Admin
//  entry in the Dashboard menu is the gate: it asks for the same
//  administrator credentials as the login screen.
// ============================================================

(function () {
    'use strict';

    var STORE_KEY = 'agencyProfile';

    // Agency documents live in the same bucket and `documents` table as
    // client files, under a reserved key no client name can collide with
    // (amsClientKey upper-cases and collapses spaces; it never produces
    // this). Folders are the row's existing `category` column, so this
    // needed no new table and no new upload path.
    var AGENCY_DOC_KEY = '__AGENCY__';
    var _agencyFiles   = [];
    var _openFolder    = null;
    var _agentOpen     = null;   // the agent whose profile is open, by name
    var _agentTab      = 'details';
    var _agentFiles    = [];

    // An agent's own record. Personal contact and HR sit beside the
    // licences because an agency is asked for all three, and keeping them
    // in one record is what makes them findable a year later.
    var AGENT_FIELDS = {
        contact: [
            { k: 'email',        label: 'Work e-mail',     type: 'email' },
            { k: 'phone',        label: 'Work phone',      type: 'tel' },
            { k: 'personalPhone',label: 'Personal phone',  type: 'tel' },
            { k: 'personalEmail',label: 'Personal e-mail', type: 'email' },
            { k: 'address',      label: 'Home address',    wide: true },
            { k: 'city',         label: 'City' },
            { k: 'state',        label: 'State', max: 2 },
            { k: 'zip',          label: 'ZIP' },
            { k: 'dob',          label: 'Date of birth',   type: 'date' },
            { k: 'emergencyName',  label: 'Emergency contact' },
            { k: 'emergencyPhone', label: 'Emergency phone', type: 'tel' }
        ],
        hr: [
            { k: 'title',        label: 'Title / role' },
            { k: 'hireDate',     label: 'Hire date', type: 'date' },
            { k: 'endDate',      label: 'End date', type: 'date' },
            { k: 'status',       label: 'Status', type: 'select',
              opts: ['', 'Active', 'On leave', 'Inactive', 'Terminated'] },
            { k: 'employment',   label: 'Employment type', type: 'select',
              opts: ['', 'W-2 employee', '1099 contractor', 'Owner', 'Other'] },
            { k: 'npn',          label: 'NPN' },
            { k: 'ssn4',         label: 'SSN (last 4)', max: 4 },
            { k: 'payNotes',     label: 'Compensation notes', wide: true, type: 'textarea' },
            { k: 'hrNotes',      label: 'HR notes', wide: true, type: 'textarea' }
        ]
    };

    // Tabs mirror the agency record an agency manager expects, minus the
    // three that were explicitly not wanted (workflow checklists, sales
    // goals, tasks). Commission Rules does not duplicate the commission
    // screens that already exist — it states the rule and links to them.
    var TABS = [
        { id: 'general',    label: 'General',          icon: 'building-2' },
        { id: 'locations',  label: 'Locations',        icon: 'map-pin' },
        { id: 'agents',     label: 'Agents',           icon: 'users' },
        { id: 'files',      label: 'Files',            icon: 'folder' },
        { id: 'commission', label: 'Commission Rules', icon: 'percent' },
        { id: 'notes',      label: 'Notes',            icon: 'sticky-note' }
    ];

    var GENERAL_FIELDS = [
        { k: 'name',     label: 'Agency name',   wide: true },
        { k: 'dba',      label: 'DBA / trade name', wide: true },
        { k: 'address1', label: 'Address',       wide: true },
        { k: 'address2', label: 'Address line 2', wide: true },
        { k: 'city',     label: 'City' },
        { k: 'state',    label: 'State', max: 2 },
        { k: 'zip',      label: 'ZIP' },
        { k: 'phone',    label: 'Phone', type: 'tel' },
        { k: 'fax',      label: 'Fax', type: 'tel' },
        { k: 'email',    label: 'E-mail', type: 'email' },
        { k: 'certContact', label: 'Certificate contact (prints as the producer contact)' },
        { k: 'website',  label: 'Website' },
        { k: 'npn',      label: 'NPN' },
        { k: 'fein',     label: 'FEIN' },
        { k: 'license',  label: 'License #' }
    ];

    var LOCATION_FIELDS = [
        { k: 'name',    label: 'Location name' },
        { k: 'address', label: 'Address' },
        { k: 'city',    label: 'City' },
        { k: 'state',   label: 'State', max: 2 },
        { k: 'zip',     label: 'ZIP' },
        { k: 'phone',   label: 'Phone' }
    ];

    var _tab = 'general';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ams.js declares AMS_SB_* with `const`, which makes them lexical
    // globals and NOT properties of window — reading them off window gives
    // undefined with no error, and the request quietly goes to "undefined/…".
    function sbUrl()     { return (typeof AMS_SB_URL     !== 'undefined') ? AMS_SB_URL     : ''; }
    function sbKey()     { return (typeof AMS_SB_KEY     !== 'undefined') ? AMS_SB_KEY     : ''; }
    function sbBucket()  { return (typeof AMS_SB_BUCKET  !== 'undefined') ? AMS_SB_BUCKET  : 'client-files'; }
    function sbHeaders() { return (typeof AMS_SB_HEADERS !== 'undefined') ? AMS_SB_HEADERS : {}; }

    function isAdmin() {
        return typeof amsIsAdminUser === 'function' ? amsIsAdminUser() : false;
    }

    // ── Storage ──────────────────────────────────────────────
    function load() {
        var v = {};
        try { v = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { v = {}; }
        if (!Array.isArray(v.locations)) v.locations = [];
        if (!v.commission || typeof v.commission !== 'object') v.commission = {};
        // The agency id is stable once issued, so a record keeps the same
        // identifier across edits and devices.
        if (!v.agencyId) v.agencyId = 'UIB-' + Math.random().toString(36).slice(2, 10).toUpperCase();
        return v;
    }

    function save(v) {
        v.updatedAt = new Date().toISOString();
        v.updatedBy = (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : '';
        if (typeof amsSave === 'function') amsSave(STORE_KEY, v);
        else localStorage.setItem(STORE_KEY, JSON.stringify(v));
        return v;
    }

    // ── Render ───────────────────────────────────────────────
    function render() {
        var el = document.getElementById('amsAgencyBody');
        if (!el) return;
        var a = load();

        var head =
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:6px;">' +
              '<div>' +
                '<h2 style="color:var(--navy);font-size:20px;margin:0;">' +
                  '<i data-lucide="building-2" style="width:20px;height:20px;vertical-align:-4px;"></i> ' +
                  (a.name ? esc(a.name) : 'Agency Profile') +
                '</h2>' +
                '<div style="font-size:12px;color:var(--gray-500);margin-top:4px;">' +
                  (a.phone ? '📞 ' + esc(a.phone) + ' &nbsp; ' : '') +
                  (a.address1 ? '📍 ' + esc([a.address1, a.city, a.state, a.zip].filter(Boolean).join(', ')) : '') +
                '</div>' +
              '</div>' +
              (isAdmin()
                 ? ''
                 : '<span style="background:#fef3c7;color:#92400e;border-radius:10px;padding:4px 10px;font-size:11px;font-weight:700;">' +
                   'Read-only — administrators can edit</span>') +
            '</div>' +
            '<p style="font-size:11px;color:var(--gray-400);margin-bottom:16px;">' +
               'Agency ID ' + esc(a.agencyId) +
               (a.updatedAt ? ' · last updated ' + esc(new Date(a.updatedAt).toLocaleString('en-US')) +
                              (a.updatedBy ? ' by ' + esc(a.updatedBy) : '') : '') +
            '</p>';

        var tabs = '<div style="display:flex;gap:4px;border-bottom:1px solid var(--gray-200);margin-bottom:18px;flex-wrap:wrap;">' +
            TABS.map(function (t) {
                var on = t.id === _tab;
                return '<button onclick="agencyTab(\'' + t.id + '\')" style="' +
                    'padding:9px 15px;border:none;background:none;cursor:pointer;font-family:inherit;' +
                    'font-size:13px;font-weight:600;border-bottom:2px solid ' + (on ? 'var(--blue)' : 'transparent') + ';' +
                    'color:' + (on ? 'var(--blue)' : 'var(--gray-500)') + ';">' + esc(t.label) + '</button>';
            }).join('') + '</div>';

        el.innerHTML = head + tabs + '<div id="amsAgencyTabBody">' + body(a) + '</div>';
        if (window.lucide) lucide.createIcons();
    }

    function body(a) {
        if (_tab === 'general')    return generalTab(a);
        if (_tab === 'locations')  return locationsTab(a);
        if (_tab === 'agents')     return _agentOpen ? agentProfile(_agentOpen) : agentsTab();
        if (_tab === 'files')      return filesTab(a);
        if (_tab === 'commission') return commissionTab(a);
        if (_tab === 'notes')      return notesTab(a);
        return '';
    }

    function fieldCss() {
        return 'width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:7px;' +
               'font-size:13px;box-sizing:border-box;font-family:inherit;';
    }
    function labelCss() {
        return 'font-size:10px;font-weight:700;color:var(--gray-500);display:block;margin-bottom:4px;' +
               'text-transform:uppercase;letter-spacing:.3px;';
    }

    function input(f, val) {
        var ro = isAdmin() ? '' : ' disabled';
        return '<div style="' + (f.wide ? 'grid-column:1/-1;' : '') + '">' +
            '<label style="' + labelCss() + '">' + esc(f.label) + '</label>' +
            '<input type="' + (f.type || 'text') + '" id="ag_' + f.k + '" value="' + esc(val || '') + '"' +
                (f.max ? ' maxlength="' + f.max + '"' : '') + ro +
                ' style="' + fieldCss() + (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '">' +
        '</div>';
    }

    function generalTab(a) {
        return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">' +
                 GENERAL_FIELDS.map(function (f) { return input(f, a[f.k]); }).join('') +
               '</div>' + saveBar();
    }

    function saveBar() {
        if (!isAdmin()) return '';
        return '<div style="display:flex;justify-content:flex-end;gap:8px;padding-top:6px;border-top:1px solid var(--gray-200);">' +
            '<button onclick="agencySave()" style="padding:9px 18px;background:var(--navy);color:#fff;border:none;' +
            'border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;">Save</button></div>';
    }

    function locationsTab(a) {
        var rows = a.locations.map(function (loc, i) {
            return '<div style="border:1px solid var(--gray-200);border-radius:9px;padding:13px 15px;margin-bottom:10px;">' +
                '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">' +
                   LOCATION_FIELDS.map(function (f) {
                       var ro = isAdmin() ? '' : ' disabled';
                       return '<div><label style="' + labelCss() + '">' + esc(f.label) + '</label>' +
                           '<input type="text" id="agloc_' + i + '_' + f.k + '" value="' + esc(loc[f.k] || '') + '"' +
                           (f.max ? ' maxlength="' + f.max + '"' : '') + ro + ' style="' + fieldCss() +
                           (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '"></div>';
                   }).join('') +
                '</div>' +
                (isAdmin()
                   ? '<div style="text-align:right;margin-top:9px;"><button onclick="agencyRemoveLocation(' + i + ')" ' +
                     'style="padding:5px 11px;background:#fff;color:#991b1b;border:1px solid var(--gray-200);' +
                     'border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">Remove</button></div>'
                   : '') +
            '</div>';
        }).join('');

        if (!a.locations.length) {
            rows = '<p style="color:var(--gray-400);font-size:12px;margin-bottom:12px;">No locations recorded yet.</p>';
        }
        return rows +
            (isAdmin()
               ? '<button onclick="agencyAddLocation()" style="padding:8px 15px;background:var(--blue-pale,#eff6ff);' +
                 'color:var(--navy);border:1px solid var(--gray-200);border-radius:7px;font-size:12px;font-weight:600;' +
                 'cursor:pointer;margin-bottom:14px;">+ Add location</button>'
               : '') +
            saveBar();
    }

    // The agent roster is the Binder Book's: agentMasterData, which both
    // apps sync from the same cloud row, so this is the Agent Management
    // list rather than a second copy that would drift from it.
    //
    // Anyone who has written business is shown too, even if they were never
    // added to the roster — an agent on policies but not on the list is
    // exactly the thing worth seeing here, not hiding.
    function agentsFromBinderBook() {
        var master = {};
        try { master = JSON.parse(localStorage.getItem('agentMasterData')) || {}; } catch (e) {}

        var book = [];
        try {
            var b = JSON.parse(localStorage.getItem('binderData'));
            if (Array.isArray(b)) book = b;
            else if (b && Array.isArray(b.value)) book = b.value;
        } catch (e) {}

        var rows = {};
        Object.keys(master).forEach(function (name) {
            var m = master[name] || {};
            rows[name] = {
                name: name, onRoster: true,
                email: m.email || '', phone: m.phone || '', address: m.address || '',
                licenses: Array.isArray(m.licenses) ? m.licenses : [],
                policies: 0, premium: 0, last: ''
            };
        });

        book.forEach(function (e) {
            var n = (e && e.agent) ? String(e.agent).trim() : '';
            if (!n) return;
            if (!rows[n]) {
                rows[n] = { name: n, onRoster: false, email: '', phone: '', address: '',
                            licenses: [], policies: 0, premium: 0, last: '' };
            }
            rows[n].policies += 1;
            rows[n].premium  += parseFloat(e.totalPremium) || 0;
            var d = e.entryDate || e.effectiveDate || '';
            if (d && d > rows[n].last) rows[n].last = d;
        });

        return Object.keys(rows).map(function (k) { return rows[k]; })
            .sort(function (a, b) {
                if (b.policies !== a.policies) return b.policies - a.policies;
                return a.name.localeCompare(b.name);
            });
    }

    // Agents arrive under more than one spelling — "Lazaro", "Lazaro
    // Reigosa" and "Lazaro Reigoza" are one person, and each variant takes
    // its own share of the book. These find the likely pairs so they can be
    // merged rather than quietly splitting someone's production.
    function normName(n) {
        return String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function editDistance(a, b) {
        if (a === b) return 0;
        var m = a.length, n = b.length;
        if (!m) return n;
        if (!n) return m;
        var prev = [], cur = [], i, j;
        for (j = 0; j <= n; j++) prev[j] = j;
        for (i = 1; i <= m; i++) {
            cur[0] = i;
            for (j = 1; j <= n; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                                  prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
            }
            for (j = 0; j <= n; j++) prev[j] = cur[j];
        }
        return prev[n];
    }

    // The busiest matching name is treated as the real one — it is the
    // spelling the book mostly uses. Only ever a suggestion: the merge
    // itself is the agent's own click.
    function duplicateOf(row, all) {
        var a = normName(row.name);
        if (!a) return '';
        var best = '';
        all.forEach(function (o) {
            if (o.name === row.name) return;
            if (o.policies < row.policies) return;          // merge into the bigger side
            var b = normName(o.name);
            if (!b) return;
            var same = (a === b) ||
                       (b.indexOf(a + ' ') === 0) || (a.indexOf(b + ' ') === 0) ||
                       (Math.min(a.length, b.length) > 5 && editDistance(a, b) <= 2);
            if (same && (!best || o.policies > (all.filter(function (x) { return x.name === best; })[0] || {}).policies)) {
                best = o.name;
            }
        });
        return best;
    }

    function money(n) {
        return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // ── One agent's profile ──────────────────────────────────
    function agentRecord(name) {
        var master = {};
        try { master = JSON.parse(localStorage.getItem('agentMasterData')) || {}; } catch (e) {}
        return master[name] || {};
    }

    // Writes ONE agent back, over the cloud's current roster rather than
    // over this device's copy of it. agentMasterData is a plain upsert, so
    // saving the whole local object would drop any agent added elsewhere
    // since this page loaded.
    function saveAgentRecord(name, patch) {
        var apply = function (master) {
            master = (master && typeof master === 'object') ? master : {};
            var rec = master[name] || {};
            Object.keys(patch).forEach(function (k) { rec[k] = patch[k]; });
            rec.updatedAt = new Date().toISOString();
            rec.updatedBy = (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : '';
            master[name] = rec;
            if (typeof amsSave === 'function') amsSave('agentMasterData', master);
            else localStorage.setItem('agentMasterData', JSON.stringify(master));
            return master;
        };
        var local = {};
        try { local = JSON.parse(localStorage.getItem('agentMasterData')) || {}; } catch (e) {}

        if (window.UIBBinderSync && typeof window.UIBBinderSync.readCloud === 'function') {
            return window.UIBBinderSync.readCloud('agentMasterData').then(function (res) {
                var base = (res.ok && res.value && typeof res.value === 'object') ? res.value : local;
                // Anything this device knows that the cloud does not, keep.
                Object.keys(local).forEach(function (k) { if (!base[k]) base[k] = local[k]; });
                return apply(base);
            }).catch(function () { return apply(local); });
        }
        return Promise.resolve(apply(local));
    }

    function agentDocKey(name) {
        return '__AGENT__' + String(name).toUpperCase().replace(/\s+/g, ' ').trim();
    }

    function reloadAgentFiles(name) {
        if (typeof amsCloudList !== 'function') return Promise.resolve();
        return amsCloudList(agentDocKey(name)).then(function (rows) {
            _agentFiles = Array.isArray(rows) ? rows : [];
        }).catch(function () { _agentFiles = []; });
    }

    function agentField(f, rec) {
        var ro = isAdmin() ? '' : ' disabled';
        var v  = rec[f.k] == null ? '' : rec[f.k];
        var el;
        if (f.type === 'textarea') {
            el = '<textarea id="agp_' + f.k + '" rows="3"' + ro + ' style="' + fieldCss() + 'resize:vertical;' +
                 (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '">' + esc(v) + '</textarea>';
        } else if (f.type === 'select') {
            el = '<select id="agp_' + f.k + '"' + ro + ' style="' + fieldCss() +
                 (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '">' +
                 f.opts.map(function (o) {
                     return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' +
                            esc(o || '—') + '</option>';
                 }).join('') + '</select>';
        } else {
            el = '<input type="' + (f.type || 'text') + '" id="agp_' + f.k + '" value="' + esc(v) + '"' +
                 (f.max ? ' maxlength="' + f.max + '"' : '') + ro + ' style="' + fieldCss() +
                 (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '">';
        }
        return '<div style="' + (f.wide ? 'grid-column:1/-1;' : '') + '">' +
            '<label style="' + labelCss() + '">' + esc(f.label) + '</label>' + el + '</div>';
    }

    function agentProfile(name) {
        var rec  = agentRecord(name);
        var all  = agentsFromBinderBook();
        var mine = all.filter(function (a) { return a.name === name; })[0] ||
                   { policies: 0, premium: 0, last: '', onRoster: !!Object.keys(rec).length };

        // HR holds SSN and pay; it is not a tab other agents get to open,
        // so it is left out of the list rather than rendered disabled.
        var tabs = [{ id: 'details', label: 'Details' }];
        if (isAdmin()) tabs.push({ id: 'hr', label: 'HR' });
        tabs.push({ id: 'licenses', label: 'Licenses' }, { id: 'files', label: 'Files' });
        if (_agentTab === 'hr' && !isAdmin()) _agentTab = 'details';

        var head =
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:10px;">' +
              '<div>' +
                '<button onclick="agencyCloseAgent()" style="background:none;border:none;cursor:pointer;' +
                  'color:var(--blue);font-size:12px;font-weight:600;padding:0;margin-bottom:6px;">← All agents</button>' +
                '<div style="font-size:18px;font-weight:800;color:var(--navy);">' + esc(name) + '</div>' +
                '<div style="font-size:11px;color:var(--gray-500);margin-top:3px;">' +
                   mine.policies + ' polic' + (mine.policies === 1 ? 'y' : 'ies') + ' · ' + money(mine.premium) +
                   (mine.last ? ' · last ' + esc(mine.last) : '') +
                   (rec.updatedAt ? ' · updated ' + esc(new Date(rec.updatedAt).toLocaleDateString('en-US')) +
                                    (rec.updatedBy ? ' by ' + esc(rec.updatedBy) : '') : '') +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:4px;border-bottom:1px solid var(--gray-200);margin-bottom:16px;flex-wrap:wrap;">' +
              tabs.map(function (t) {
                  var on = t.id === _agentTab;
                  return '<button onclick="agencyAgentTab(\'' + t.id + '\')" style="padding:8px 14px;border:none;' +
                      'background:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;' +
                      'border-bottom:2px solid ' + (on ? 'var(--blue)' : 'transparent') + ';' +
                      'color:' + (on ? 'var(--blue)' : 'var(--gray-500)') + ';">' + esc(t.label) + '</button>';
              }).join('') +
            '</div>';

        var body;
        if (_agentTab === 'details') {
            body = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;">' +
                     AGENT_FIELDS.contact.map(function (f) { return agentField(f, rec); }).join('') +
                   '</div>' + agentSaveBar();
        } else if (_agentTab === 'hr') {
            body = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;">' +
                     AGENT_FIELDS.hr.map(function (f) { return agentField(f, rec); }).join('') +
                   '</div>' +
                   '<p style="font-size:11px;color:var(--gray-400);margin-bottom:12px;">' +
                     'Personnel detail. This page is only shown to an administrator.' +
                   '</p>' + agentSaveBar();
        } else if (_agentTab === 'licenses') {
            body = licensesPane(rec);
        } else {
            body = agentFilesPane(name);
        }
        return head + body;
    }

    function agentSaveBar() {
        if (!isAdmin()) return '';
        return '<div style="display:flex;justify-content:flex-end;padding-top:6px;border-top:1px solid var(--gray-200);">' +
            '<button onclick="agencySaveAgent()" style="padding:9px 18px;background:var(--navy);color:#fff;border:none;' +
            'border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;">Save</button></div>';
    }

    // Licences are a list, because an agent carries several and each has its
    // own number, state and expiry — a single text box loses the expiry,
    // which is the only part with a deadline attached.
    function licensesPane(rec) {
        var lic = Array.isArray(rec.licenseList) ? rec.licenseList : [];
        // Older records kept plain strings in `licenses`; show them rather
        // than pretending the agent has none.
        if (!lic.length && Array.isArray(rec.licenses) && rec.licenses.length) {
            lic = rec.licenses.map(function (t) { return { type: t, number: '', state: '', expires: '' }; });
        }
        var ro = isAdmin() ? '' : ' disabled';
        var rows = lic.map(function (l, i) {
            var cell = function (k, label, type) {
                return '<div><label style="' + labelCss() + '">' + esc(label) + '</label>' +
                    '<input type="' + (type || 'text') + '" id="aglic_' + i + '_' + k + '" value="' + esc(l[k] || '') + '"' +
                    ro + ' style="' + fieldCss() + 'padding:7px 9px;font-size:12px;' +
                    (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '"></div>';
            };
            var expSoon = l.expires && (new Date(l.expires) - Date.now()) < 60 * 86400000;
            return '<div style="border:1px solid ' + (expSoon ? '#fde68a' : 'var(--gray-200)') + ';border-radius:9px;' +
                       'padding:12px 14px;margin-bottom:9px;' + (expSoon ? 'background:#fffbeb;' : '') + '">' +
                '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">' +
                   cell('type', 'Licence type') + cell('number', 'Number') +
                   cell('state', 'State') + cell('expires', 'Expires', 'date') +
                '</div>' +
                (expSoon ? '<div style="font-size:11px;color:#b45309;font-weight:600;margin-top:7px;">Expires within 60 days</div>' : '') +
                (isAdmin()
                   ? '<div style="text-align:right;margin-top:8px;"><button onclick="agencyRemoveLicense(' + i + ')" ' +
                     'style="padding:5px 11px;background:#fff;color:#991b1b;border:1px solid var(--gray-200);' +
                     'border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">Remove</button></div>'
                   : '') +
            '</div>';
        }).join('') || '<p style="font-size:12px;color:var(--gray-400);margin-bottom:12px;">No licences recorded.</p>';

        return rows +
            (isAdmin()
               ? '<button onclick="agencyAddLicense()" style="padding:8px 15px;background:var(--blue-pale,#eff6ff);' +
                 'color:var(--navy);border:1px solid var(--gray-200);border-radius:7px;font-size:12px;' +
                 'font-weight:600;cursor:pointer;margin-bottom:14px;">+ Add licence</button>'
               : '') + agentSaveBar();
    }

    function agentFilesPane(name) {
        var rows = _agentFiles.filter(visibleAgentFile).map(function (f) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;' +
                       'padding:11px 14px;border-top:1px solid var(--gray-200);flex-wrap:wrap;">' +
                '<div style="min-width:0;">' +
                  '<div style="font-size:12px;font-weight:600;color:var(--navy);">' + esc(f.name) + '</div>' +
                  '<div style="font-size:10px;color:var(--gray-500);margin-top:2px;">' +
                     esc(f.category || 'Document') + ' · ' + fileSize(f.size) +
                     (f.uploadedAt ? ' · ' + esc(new Date(f.uploadedAt).toLocaleDateString('en-US')) : '') +
                  '</div>' +
                '</div>' +
                '<div style="display:flex;gap:6px;flex-shrink:0;">' +
                  '<button onclick="agencyAgentDownload(\'' + esc(f.docId) + '\')" style="padding:5px 11px;background:#fff;' +
                    'color:var(--navy);border:1px solid var(--gray-200);border-radius:6px;font-size:11px;' +
                    'font-weight:600;cursor:pointer;">Download</button>' +
                  (isAdmin()
                    ? '<button onclick="agencyAgentDeleteFile(\'' + esc(f.docId) + '\')" style="padding:5px 10px;' +
                      'background:#fff;color:#991b1b;border:1px solid var(--gray-200);border-radius:6px;' +
                      'font-size:11px;font-weight:600;cursor:pointer;">Delete</button>'
                    : '') +
                '</div>' +
            '</div>';
        }).join('') || '<div style="padding:18px 14px;border-top:1px solid var(--gray-200);font-size:12px;' +
                        'color:var(--gray-400);">Nothing filed yet — licences, signed agreements, HR paperwork.</div>';

        return (isAdmin()
                  ? '<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;">' +
                      '<select id="agentFileKind" style="padding:7px 10px;border:1px solid var(--gray-200);' +
                        'border-radius:7px;font-size:12px;">' +
                        ['Licence', 'HR document', 'Agreement', 'Certification', 'Other']
                          .map(function (k) { return '<option>' + k + '</option>'; }).join('') +
                      '</select>' +
                      '<button onclick="agencyAgentPick()" style="padding:7px 14px;background:var(--navy);color:#fff;' +
                        'border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">Upload</button>' +
                      '<input type="file" id="agentFileInput" multiple style="display:none;" ' +
                        'onchange="agencyAgentUpload(this.files)">' +
                    '</div>'
                  : '') +
               '<div style="border:1px solid var(--gray-200);border-radius:10px;overflow:hidden;">' + rows + '</div>' +
               '<p style="font-size:11px;color:var(--gray-400);margin-top:10px;">' +
                 'Filed against this agent in the same secure store as client and agency documents.' +
                 (isAdmin() ? '' : ' HR paperwork is only shown to an administrator.') +
               '</p>';
    }

    // One rule, used by both the list and the download handler, so hiding a
    // row cannot drift apart from refusing to fetch it.
    function visibleAgentFile(f) {
        return isAdmin() || String((f && f.category) || '').toLowerCase() !== 'hr document';
    }

    function agentsTab() {
        var list = agentsFromBinderBook();
        if (!list.length) {
            return '<div style="border:1px dashed var(--gray-200);border-radius:10px;padding:24px 16px;text-align:center;color:var(--gray-400);">' +
                     '<p style="font-size:12px;margin:0 0 4px;">No agents yet.</p>' +
                     '<p style="font-size:11px;margin:0;">The roster comes from the Binder Book\'s Agent Management list, ' +
                     'and anyone who writes a policy appears here too.</p>' +
                   '</div>';
        }

        var offRoster = list.filter(function (a) { return !a.onRoster; }).length;

        return '<p style="font-size:11px;color:var(--gray-400);margin-bottom:12px;">' +
                 list.length + ' agent' + (list.length === 1 ? '' : 's') +
                 ' — from the Binder Book\'s Agent Management list, with what each has written.' +
                 (offRoster ? ' <strong style="color:#b45309;">' + offRoster + ' not on the roster.</strong>' : '') +
               '</p>' +
               '<div style="border:1px solid var(--gray-200);border-radius:10px;overflow:hidden;">' +
               list.map(function (a, i) {
                   var bits = [];
                   if (a.email)   bits.push('✉️ ' + esc(a.email));
                   if (a.phone)   bits.push('📞 ' + esc(a.phone));
                   if (a.licenses.length) bits.push('🪪 ' + esc(a.licenses.join(', ')));
                   if (a.address) bits.push('📍 ' + esc(a.address));
                   var dup = duplicateOf(a, list);
                   return '<div style="padding:12px 15px;' + (i ? 'border-top:1px solid var(--gray-200);' : '') +
                              'display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;' +
                              (dup ? 'background:#fffbeb;' : '') + '">' +
                       '<div style="min-width:0;">' +
                         '<div style="font-weight:700;font-size:13px;">' +
                           '<a href="#" onclick="event.preventDefault();agencyOpenAgent(' +
                              JSON.stringify(a.name).replace(/"/g, '&quot;') + ')" ' +
                              'style="color:#1d4ed8;text-decoration:none;border-bottom:1px solid rgba(29,78,216,.3);">' +
                              esc(a.name) + '</a>' +
                           (a.onRoster ? ''
                              : ' <span style="background:#fef3c7;color:#92400e;border-radius:9px;padding:2px 7px;' +
                                'font-size:10px;font-weight:700;">not on the roster</span>') +
                         '</div>' +
                         '<div style="font-size:11px;color:var(--gray-500);margin-top:3px;">' +
                           (bits.length ? bits.join(' &nbsp; ') : 'No contact details on the roster') +
                         '</div>' +
                         (dup
                            ? '<div style="font-size:11px;color:#b45309;margin-top:4px;font-weight:600;">' +
                                'Looks like the same person as ' + esc(dup) + '</div>'
                            : '') +
                       '</div>' +
                       '<div style="text-align:right;flex-shrink:0;">' +
                         '<div style="font-weight:700;color:var(--navy);font-size:13px;">' +
                            a.policies + ' polic' + (a.policies === 1 ? 'y' : 'ies') + '</div>' +
                         '<div style="font-size:11px;color:var(--gray-500);margin-top:3px;">' +
                            money(a.premium) + (a.last ? ' · last ' + esc(a.last) : '') + '</div>' +
                         (isAdmin()
                            ? '<button onclick="agencyMergeAgent(' + JSON.stringify(a.name).replace(/"/g, '&quot;') + ')" ' +
                              'style="margin-top:7px;padding:5px 11px;background:' + (dup ? 'var(--navy);color:#fff;border:none' : '#fff;color:var(--navy);border:1px solid var(--gray-200)') + ';' +
                              'border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">Merge into…</button>'
                            : '') +
                       '</div>' +
                   '</div>';
               }).join('') + '</div>' +
               '<p style="font-size:11px;color:var(--gray-400);margin-top:12px;">' +
                 'Add, edit or remove agents in the Binder Book under Agent Management — this list follows it.' +
               '</p>';
    }

    // ── Files ────────────────────────────────────────────────
    // Folders are kept on the agency record so an empty one survives, and
    // documents carry their folder in the row's `category`. Deleting a
    // folder never deletes documents — they fall back to Unfiled, because
    // losing a file to a mis-click on a folder is not a trade worth making.
    var UNFILED = 'Unfiled';

    function folders(a) {
        var named = Array.isArray(a.folders) ? a.folders.slice() : [];
        var used  = {};
        _agencyFiles.forEach(function (f) { used[f.category || UNFILED] = true; });
        Object.keys(used).forEach(function (n) {
            if (n !== UNFILED && named.indexOf(n) === -1) named.push(n);
        });
        named.sort(function (x, y) { return x.localeCompare(y); });
        if (used[UNFILED] || !named.length) named.push(UNFILED);
        return named;
    }

    function fileSize(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    function filesTab(a) {
        var list = folders(a);
        var counts = {};
        _agencyFiles.forEach(function (f) {
            var k = f.category || UNFILED;
            counts[k] = (counts[k] || 0) + 1;
        });

        var head =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
              '<div style="font-size:11px;color:var(--gray-400);">' +
                _agencyFiles.length + ' document' + (_agencyFiles.length === 1 ? '' : 's') +
                ' in ' + list.length + ' folder' + (list.length === 1 ? '' : 's') + '.' +
              '</div>' +
              (isAdmin()
                 ? '<div style="display:flex;gap:8px;">' +
                     '<button onclick="agencyNewFolder()" style="padding:7px 13px;background:var(--blue-pale,#eff6ff);' +
                       'color:var(--navy);border:1px solid var(--gray-200);border-radius:7px;font-size:12px;' +
                       'font-weight:600;cursor:pointer;">+ New folder</button>' +
                     '<button onclick="agencyPickFiles()" style="padding:7px 14px;background:var(--navy);color:#fff;' +
                       'border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;">Upload</button>' +
                     '<input type="file" id="agencyFileInput" multiple style="display:none;" ' +
                       'onchange="agencyUploadFiles(this.files)">' +
                   '</div>'
                 : '') +
            '</div>';

        var body = list.map(function (name) {
            var open = _openFolder === name;
            var mine = _agencyFiles.filter(function (f) { return (f.category || UNFILED) === name; });
            var rows = mine.map(function (f) {
                return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;' +
                           'padding:9px 14px 9px 34px;border-top:1px solid var(--gray-200);flex-wrap:wrap;">' +
                    '<div style="min-width:0;">' +
                      '<div style="font-size:12px;font-weight:600;color:var(--navy);">' + esc(f.name) + '</div>' +
                      '<div style="font-size:10px;color:var(--gray-500);margin-top:2px;">' +
                        fileSize(f.size) +
                        (f.uploadedAt ? ' · ' + esc(new Date(f.uploadedAt).toLocaleDateString('en-US')) : '') +
                        (f.uploadedBy ? ' · ' + esc(f.uploadedBy) : '') +
                      '</div>' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;flex-shrink:0;">' +
                      '<button onclick="agencyDownload(\'' + esc(f.docId) + '\')" style="padding:5px 11px;background:#fff;' +
                        'color:var(--navy);border:1px solid var(--gray-200);border-radius:6px;font-size:11px;' +
                        'font-weight:600;cursor:pointer;">Download</button>' +
                      (isAdmin()
                        ? '<select onchange="agencyMoveFile(\'' + esc(f.docId) + '\',this.value)" ' +
                            'style="padding:5px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:11px;">' +
                            '<option value="">Move to…</option>' +
                            list.filter(function (t) { return t !== name; })
                                .map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('') +
                          '</select>' +
                          '<button onclick="agencyDeleteFile(\'' + esc(f.docId) + '\')" style="padding:5px 10px;' +
                            'background:#fff;color:#991b1b;border:1px solid var(--gray-200);border-radius:6px;' +
                            'font-size:11px;font-weight:600;cursor:pointer;">Delete</button>'
                        : '') +
                    '</div>' +
                '</div>';
            }).join('') || '<div style="padding:11px 14px 11px 34px;border-top:1px solid var(--gray-200);' +
                            'font-size:11px;color:var(--gray-400);">Empty.</div>';

            return '<div style="border:1px solid var(--gray-200);border-radius:9px;margin-bottom:9px;overflow:hidden;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;' +
                     'background:#f8fafc;cursor:pointer;" onclick="agencyToggleFolder(\'' + esc(name) + '\')">' +
                  '<div style="font-weight:700;color:var(--navy);font-size:12px;">' +
                    (open ? '📂 ' : '📁 ') + esc(name) +
                    ' <span style="font-weight:600;color:var(--gray-500);">(' + (counts[name] || 0) + ')</span>' +
                  '</div>' +
                  (isAdmin() && name !== UNFILED
                     ? '<button onclick="event.stopPropagation();agencyDeleteFolder(\'' + esc(name) + '\')" ' +
                       'style="padding:4px 10px;background:#fff;color:#991b1b;border:1px solid var(--gray-200);' +
                       'border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">Remove folder</button>'
                     : '') +
                '</div>' +
                (open ? rows : '') +
            '</div>';
        }).join('');

        return head + body +
            '<p style="font-size:11px;color:var(--gray-400);margin-top:10px;">' +
              'Agency documents, kept in the same secure store as client files. ' +
              'Removing a folder never deletes what is in it — those documents move to Unfiled.' +
            '</p>';
    }

    // Commission lives in the Accounting and Commission screens already.
    // This states the agency's default split and sends you there rather
    // than becoming a second place where the numbers live.
    function commissionTab(a) {
        var c  = a.commission || {};
        var ro = isAdmin() ? '' : ' disabled';
        var pct = function (id, label, val) {
            return '<div><label style="' + labelCss() + '">' + esc(label) + '</label>' +
                '<input type="number" min="0" step="0.1" id="' + id + '" value="' + esc(val == null ? '' : val) + '"' +
                ro + ' style="' + fieldCss() + (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '"></div>';
        };

        var head =
            '<div style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;' +
                 'letter-spacing:.3px;margin-bottom:8px;">Agency default</div>' +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px;">' +
              pct('agcom_agencyPct', 'Agency commission %',    c.agencyPct) +
              pct('agcom_agentPct',  'Agent share %',          c.agentPct) +
              pct('agcom_agencyFee', 'Default agency fee ($)', c.agencyFee) +
            '</div>' +
            '<p style="font-size:11px;color:var(--gray-400);margin-bottom:20px;">' +
              'Applied to an agent with no rule of their own.' +
            '</p>';

        // Per-agent rules, over the same roster the Agents tab shows, so a
        // rule can never be written against a name that is not an agent.
        var people = agentsFromBinderBook();
        var byAgent = (c.agents && typeof c.agents === 'object') ? c.agents : {};

        var rows = people.map(function (p) {
            var r = byAgent[p.name] || {};
            var has = (r.agencyPct != null && r.agencyPct !== '') ||
                      (r.agentPct  != null && r.agentPct  !== '') ||
                      (r.agencyFee != null && r.agencyFee !== '');
            var id = p.name.replace(/[^\w]/g, '_');
            var cell = function (k, ph) {
                return '<input type="number" min="0" step="0.1" id="agrule_' + id + '_' + k + '" ' +
                    'value="' + esc(r[k] == null ? '' : r[k]) + '" placeholder="' + esc(ph) + '"' + ro +
                    ' style="' + fieldCss() + 'padding:6px 8px;font-size:12px;' +
                    (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '">';
            };
            return '<div style="display:grid;grid-template-columns:minmax(150px,1.6fr) repeat(3,1fr);gap:9px;' +
                       'align-items:center;padding:10px 12px;border-top:1px solid var(--gray-200);">' +
                '<div style="min-width:0;">' +
                  '<div style="font-size:12px;font-weight:600;color:var(--navy);">' + esc(p.name) + '</div>' +
                  '<div style="font-size:10px;color:' + (has ? '#1d4ed8' : 'var(--gray-400)') + ';margin-top:2px;">' +
                     (has ? 'own rule' : 'uses the agency default') +
                  '</div>' +
                '</div>' +
                cell('agencyPct', String(c.agencyPct == null ? '—' : c.agencyPct)) +
                cell('agentPct',  String(c.agentPct  == null ? '—' : c.agentPct)) +
                cell('agencyFee', String(c.agencyFee == null ? '—' : c.agencyFee)) +
            '</div>';
        }).join('');

        var table = people.length
            ? '<div style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;' +
                   'letter-spacing:.3px;margin-bottom:8px;">Agent rules</div>' +
              '<div style="border:1px solid var(--gray-200);border-radius:10px;overflow:hidden;margin-bottom:8px;">' +
                '<div style="display:grid;grid-template-columns:minmax(150px,1.6fr) repeat(3,1fr);gap:9px;' +
                     'padding:9px 12px;background:#f8fafc;font-size:10px;font-weight:700;color:var(--gray-500);' +
                     'text-transform:uppercase;letter-spacing:.3px;">' +
                  '<div>Agent</div><div>Agency %</div><div>Agent %</div><div>Fee ($)</div>' +
                '</div>' + rows +
              '</div>' +
              '<p style="font-size:11px;color:var(--gray-400);margin-bottom:18px;">' +
                'Leave a box empty to follow the agency default. The roster is the Binder Book\'s, ' +
                'so a rule cannot be written against someone who is not an agent.' +
              '</p>'
            : '<p style="font-size:12px;color:var(--gray-400);margin-bottom:18px;">' +
                'No agents yet — add them in the Binder Book under Agent Management.</p>';

        var links =
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">' +
              '<button onclick="amsSidebarNav(\'commissions\')" style="padding:8px 15px;background:var(--navy);' +
                'color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;">' +
                'Open Commission Statements</button>' +
              '<button onclick="amsSidebarNav(\'accounting\')" style="padding:8px 15px;background:#fff;' +
                'color:var(--navy);border:1px solid var(--gray-200);border-radius:7px;font-size:12px;' +
                'font-weight:600;cursor:pointer;">Open Accounting &amp; Ledger</button>' +
            '</div>' +
            '<p style="font-size:11px;color:var(--gray-400);margin-bottom:16px;">' +
              'These are the rules. What was actually earned lives in the commission screens — ' +
              'a second copy of those numbers would only disagree with the first.' +
            '</p>';

        return head + table + links + saveBar();
    }

    function notesTab(a) {
        var ro = isAdmin() ? '' : ' disabled';
        return '<label style="' + labelCss() + '">Agency notes</label>' +
            '<textarea id="ag_notes" rows="10"' + ro + ' style="' + fieldCss() + 'resize:vertical;' +
            (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '">' + esc(a.notes || '') + '</textarea>' +
            '<div style="height:12px;"></div>' + saveBar();
    }

    // ── Actions ──────────────────────────────────────────────
    function collect() {
        var a = load();
        GENERAL_FIELDS.forEach(function (f) {
            var el = document.getElementById('ag_' + f.k);
            if (el) a[f.k] = el.value;
        });
        a.locations.forEach(function (loc, i) {
            LOCATION_FIELDS.forEach(function (f) {
                var el = document.getElementById('agloc_' + i + '_' + f.k);
                if (el) loc[f.k] = el.value;
            });
        });
        ['agencyPct', 'agentPct', 'agencyFee'].forEach(function (k) {
            var el = document.getElementById('agcom_' + k);
            if (el) a.commission[k] = el.value === '' ? '' : Number(el.value);
        });
        // Per-agent rules. An empty box means "follow the agency default",
        // so it is removed rather than stored as 0 — which would be a real
        // rule paying nothing.
        if (document.getElementById('agrule_marker') || _tab === 'commission') {
            var rules = {};
            agentsFromBinderBook().forEach(function (p) {
                var id = p.name.replace(/[^\w]/g, '_');
                var one = {};
                ['agencyPct', 'agentPct', 'agencyFee'].forEach(function (k) {
                    var el = document.getElementById('agrule_' + id + '_' + k);
                    if (el && el.value !== '') one[k] = Number(el.value);
                });
                if (Object.keys(one).length) rules[p.name] = one;
            });
            a.commission.agents = rules;
        }
        var n = document.getElementById('ag_notes');
        if (n) a.notes = n.value;
        return a;
    }

    // ── File actions ─────────────────────────────────────────
    function reloadFiles() {
        if (typeof amsCloudList !== 'function') return Promise.resolve();
        return amsCloudList(AGENCY_DOC_KEY).then(function (rows) {
            _agencyFiles = Array.isArray(rows) ? rows : [];
        }).catch(function () { _agencyFiles = []; });
    }

    window.agencyToggleFolder = function (name) {
        _openFolder = (_openFolder === name) ? null : name;
        render();
    };

    window.agencyNewFolder = function () {
        if (!isAdmin()) return;
        var name = (prompt('Name the new folder:') || '').trim();
        if (!name) return;
        if (name === UNFILED) { alert('"' + UNFILED + '" is where documents with no folder go — pick another name.'); return; }
        var a = collect();
        a.folders = Array.isArray(a.folders) ? a.folders : [];
        if (a.folders.indexOf(name) !== -1) { alert('There is already a folder called "' + name + '".'); return; }
        a.folders.push(name);
        save(a);
        _openFolder = name;
        render();
    };

    // Removing a folder removes the folder, not the documents: anything in
    // it moves to Unfiled. A folder is a label here, and a label should
    // never be able to destroy what it labels.
    window.agencyDeleteFolder = function (name) {
        if (!isAdmin()) return;
        var inside = _agencyFiles.filter(function (f) { return (f.category || UNFILED) === name; });
        var msg = inside.length
            ? 'Remove the folder "' + name + '"?\n\nIts ' + inside.length + ' document' +
              (inside.length === 1 ? '' : 's') + ' will move to ' + UNFILED + ', not be deleted.'
            : 'Remove the empty folder "' + name + '"?';
        if (!confirm(msg)) return;

        var a = collect();
        a.folders = (a.folders || []).filter(function (f) { return f !== name; });
        save(a);
        Promise.all(inside.map(function (f) { return setCategory(f.docId, UNFILED); }))
            .then(reloadFiles)
            .then(function () {
                if (_openFolder === name) _openFolder = null;
                render();
                if (typeof amsFlashBanner === 'function') amsFlashBanner('Folder removed');
            });
    };

    window.agencyPickFiles = function () {
        if (!isAdmin()) return;
        document.getElementById('agencyFileInput')?.click();
    };

    window.agencyUploadFiles = function (fileList) {
        if (!isAdmin() || !fileList || !fileList.length) return;
        if (typeof amsCloudUpload !== 'function') { alert('File upload is unavailable on this page.'); return; }
        var target = _openFolder || UNFILED;
        var files  = Array.prototype.slice.call(fileList);
        if (typeof amsFlashBanner === 'function') amsFlashBanner('Uploading ' + files.length + ' file…');
        Promise.all(files.map(function (f) { return amsCloudUpload(f, AGENCY_DOC_KEY, target); }))
            .then(reloadFiles)
            .then(function () {
                _openFolder = target;
                render();
                if (typeof amsFlashBanner === 'function') amsFlashBanner(files.length + ' file(s) uploaded to ' + target + ' ✓');
            })
            .catch(function (e) { alert('Upload failed: ' + e.message); });
    };

    function setCategory(docId, category) {
        var url = sbUrl() + '/rest/v1/documents?id=eq.' + encodeURIComponent(docId);
        return fetch(url, {
            method: 'PATCH',
            headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }),
            body: JSON.stringify({ category: category })
        });
    }

    window.agencyMoveFile = function (docId, target) {
        if (!isAdmin() || !target) return;
        setCategory(docId, target).then(reloadFiles).then(function () {
            render();
            if (typeof amsFlashBanner === 'function') amsFlashBanner('Moved to ' + target);
        }).catch(function (e) { alert('Could not move the file: ' + e.message); });
    };

    window.agencyDownload = function (docId) {
        var f = _agencyFiles.filter(function (x) { return String(x.docId) === String(docId); })[0];
        if (!f || typeof amsCloudDownloadFile !== 'function') return;
        amsCloudDownloadFile(f.docId, f.storagePath, f.name, f.type);
    };

    window.agencyDeleteFile = function (docId) {
        if (!isAdmin()) return;
        var f = _agencyFiles.filter(function (x) { return String(x.docId) === String(docId); })[0];
        if (!f) return;
        if (!confirm('Delete "' + f.name + '"?\n\nThis removes the document from the cloud and cannot be undone.')) return;
        var url = sbUrl() + '/storage/v1/object/' + sbBucket() + '/' +
                  String(f.storagePath).split('/').map(encodeURIComponent).join('/');
        var h = { 'apikey': sbKey(), 'Authorization': 'Bearer ' + sbKey() };
        fetch(url, { method: 'DELETE', headers: h })
            .then(function () {
                return fetch(sbUrl() + '/rest/v1/documents?id=eq.' + encodeURIComponent(f.docId),
                             { method: 'DELETE', headers: sbHeaders() });
            })
            .then(reloadFiles)
            .then(function () { render(); if (typeof amsFlashBanner === 'function') amsFlashBanner('Document deleted'); })
            .catch(function (e) { alert('Could not delete: ' + e.message); });
    };

    // ── Agent profile actions ────────────────────────────────
    window.agencyOpenAgent = function (name) {
        _agentOpen = name;
        _agentTab  = 'details';
        _agentFiles = [];
        render();
    };

    // The way in from anywhere else in the AMS -- a report row, the renewals
    // list, an accounting breakdown. Opens the Agency Profile on that one
    // agent, whether or not they are on the roster.
    window.amsOpenAgentProfile = function (name) {
        name = String(name == null ? '' : name).trim();
        if (!name) return;
        if (typeof amsSidebarNav === 'function') amsSidebarNav('agency');
        if (typeof window.agencyTab === 'function') window.agencyTab('agents');
        window.agencyOpenAgent(name);
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    };

    window.agencyCloseAgent = function () {
        collectAgent();              // keep what is on screen
        _agentOpen = null;
        render();
    };

    window.agencyAgentTab = function (id) {
        collectAgent();
        _agentTab = id;
        if (id === 'files' && _agentOpen) {
            reloadAgentFiles(_agentOpen).then(function () { if (_agentTab === 'files') render(); });
        }
        render();
    };

    // Reads whatever of the agent's form is on screen. Each tab shows a
    // different slice, so only the fields actually present are touched —
    // switching tabs must not blank the ones that were not rendered.
    function collectAgent() {
        if (!_agentOpen || !isAdmin()) return null;
        var patch = {};
        AGENT_FIELDS.contact.concat(AGENT_FIELDS.hr).forEach(function (f) {
            var el = document.getElementById('agp_' + f.k);
            if (el) patch[f.k] = el.value;
        });
        if (document.getElementById('aglic_0_type') || _agentTab === 'licenses') {
            var rec = agentRecord(_agentOpen);
            var cur = Array.isArray(rec.licenseList) ? rec.licenseList
                    : (Array.isArray(rec.licenses) ? rec.licenses.map(function (t) {
                          return { type: t, number: '', state: '', expires: '' }; }) : []);
            var out = [];
            cur.forEach(function (_, i) {
                var one = {};
                ['type', 'number', 'state', 'expires'].forEach(function (k) {
                    var el = document.getElementById('aglic_' + i + '_' + k);
                    if (el) one[k] = el.value;
                });
                if (Object.keys(one).length) out.push(one);
            });
            if (out.length || cur.length) patch.licenseList = out;
        }
        return patch;
    }

    window.agencySaveAgent = function () {
        if (!_agentOpen || !isAdmin()) return;
        var patch = collectAgent();
        if (!patch) return;
        saveAgentRecord(_agentOpen, patch).then(function () {
            render();
            if (typeof amsFlashBanner === 'function') amsFlashBanner('Agent saved ✓');
        });
    };

    window.agencyAddLicense = function () {
        if (!_agentOpen || !isAdmin()) return;
        var patch = collectAgent() || {};
        var list  = Array.isArray(patch.licenseList) ? patch.licenseList : [];
        list.push({ type: '', number: '', state: '', expires: '' });
        patch.licenseList = list;
        saveAgentRecord(_agentOpen, patch).then(render);
    };

    window.agencyRemoveLicense = function (i) {
        if (!_agentOpen || !isAdmin()) return;
        if (!confirm('Remove this licence?')) return;
        var patch = collectAgent() || {};
        var list  = Array.isArray(patch.licenseList) ? patch.licenseList : [];
        list.splice(i, 1);
        patch.licenseList = list;
        saveAgentRecord(_agentOpen, patch).then(render);
    };

    window.agencyAgentPick = function () {
        if (isAdmin()) document.getElementById('agentFileInput')?.click();
    };

    window.agencyAgentUpload = function (fileList) {
        if (!_agentOpen || !isAdmin() || !fileList || !fileList.length) return;
        if (typeof amsCloudUpload !== 'function') { alert('File upload is unavailable on this page.'); return; }
        var kind  = document.getElementById('agentFileKind')?.value || 'Other';
        var files = Array.prototype.slice.call(fileList);
        Promise.all(files.map(function (f) { return amsCloudUpload(f, agentDocKey(_agentOpen), kind); }))
            .then(function () { return reloadAgentFiles(_agentOpen); })
            .then(function () {
                render();
                if (typeof amsFlashBanner === 'function') amsFlashBanner(files.length + ' file(s) filed ✓');
            })
            .catch(function (e) { alert('Upload failed: ' + e.message); });
    };

    window.agencyAgentDownload = function (docId) {
        var f = _agentFiles.filter(function (x) { return String(x.docId) === String(docId); })[0];
        if (f && !visibleAgentFile(f)) return;
        if (f && typeof amsCloudDownloadFile === 'function') {
            amsCloudDownloadFile(f.docId, f.storagePath, f.name, f.type);
        }
    };

    window.agencyAgentDeleteFile = function (docId) {
        if (!isAdmin()) return;
        var f = _agentFiles.filter(function (x) { return String(x.docId) === String(docId); })[0];
        if (!f) return;
        if (!confirm('Delete "' + f.name + '"? This cannot be undone.')) return;
        var url = sbUrl() + '/storage/v1/object/' + sbBucket() + '/' +
                  String(f.storagePath).split('/').map(encodeURIComponent).join('/');
        fetch(url, { method: 'DELETE', headers: { 'apikey': sbKey(), 'Authorization': 'Bearer ' + sbKey() } })
            .then(function () {
                return fetch(sbUrl() + '/rest/v1/documents?id=eq.' + encodeURIComponent(f.docId),
                             { method: 'DELETE', headers: sbHeaders() });
            })
            .then(function () { return reloadAgentFiles(_agentOpen); })
            .then(function () { render(); if (typeof amsFlashBanner === 'function') amsFlashBanner('Document deleted'); })
            .catch(function (e) { alert('Could not delete: ' + e.message); });
    };

    // ── Merging agents ───────────────────────────────────────
    // Two spellings of one person split their book in half: each takes a
    // share of the policies, so production and commission both read wrong.
    // Merging rewrites the agent on every matching entry and folds the
    // roster record over, through the same merge-safe save every other
    // write here uses.
    function binderEntries() {
        try {
            var b = JSON.parse(localStorage.getItem('binderData'));
            if (Array.isArray(b)) return b;
            if (b && Array.isArray(b.value)) return b.value;
        } catch (e) {}
        return [];
    }

    window.agencyMergeAgent = function (fromName) {
        if (!isAdmin()) return;
        var all = agentsFromBinderBook();
        var me  = all.filter(function (a) { return a.name === fromName; })[0];
        if (!me) return;
        var others = all.filter(function (a) { return a.name !== fromName; });
        if (!others.length) { alert('There is no other agent to merge into.'); return; }
        var suggested = duplicateOf(me, all);

        var m = document.createElement('div');
        m.id = 'agencyMergeModal';
        m.className = 'ams-modal open';
        m.innerHTML =
          '<div class="ams-modal-box" style="max-width:480px;">' +
            '<h3>Merge "' + esc(fromName) + '" into another agent</h3>' +
            '<p style="font-size:12px;color:var(--gray-500);margin:-10px 0 14px;">' +
              'Every policy written under "' + esc(fromName) + '" is reassigned. ' +
              'The name itself disappears from the book.' +
            '</p>' +
            '<div class="form-group"><label>Merge into</label>' +
              '<select id="agencyMergeTarget">' +
                others.map(function (o) {
                    return '<option value="' + esc(o.name) + '"' + (o.name === suggested ? ' selected' : '') + '>' +
                        esc(o.name) + ' — ' + o.policies + ' polic' + (o.policies === 1 ? 'y' : 'ies') + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<p style="font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;' +
               'border-radius:8px;padding:10px 12px;">' +
              '<strong>' + me.policies + ' polic' + (me.policies === 1 ? 'y' : 'ies') + '</strong> ' +
              '(' + money(me.premium) + ') will be reassigned. This cannot be undone from here.' +
            '</p>' +
            '<div class="modal-actions">' +
              '<button class="btn-secondary" onclick="agencyCloseMerge()">Cancel</button>' +
              '<button id="agencyMergeGo" class="btn-primary" onclick="agencyDoMerge(' + JSON.stringify(fromName).replace(/"/g, '&quot;') + ')">Merge</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(m);
    };

    window.agencyCloseMerge = function () {
        document.getElementById('agencyMergeModal')?.remove();
    };

    window.agencyDoMerge = function (fromName) {
        if (!isAdmin()) return;
        var target = document.getElementById('agencyMergeTarget')?.value || '';
        if (!target || target === fromName) return;

        // Rename across the *cloud* book, not just what this tab happens to
        // hold. A tab that has not finished syncing would otherwise rename a
        // handful of entries, look finished, and let the old name reappear on
        // the next pull.
        var rename = function (book) {
            var now = Date.now();
            var n = 0;
            book.forEach(function (e) {
                if (e && String(e.agent || '').trim() === fromName) {
                    e.agent = target;
                    e.updatedAt = now;      // so the cloud merge keeps this edit
                    n++;
                }
            });
            return n;
        };

        // Fold the roster record over: keep the target's own details, fill
        // any gap from the one being merged away, then drop that name.
        var foldRoster = function (master) {
            master = (master && typeof master === 'object') ? master : {};
            if (master[fromName]) {
                var src = master[fromName];
                var dst = master[target] || {};
                Object.keys(src).forEach(function (k) {
                    if (dst[k] === undefined || dst[k] === '' ||
                        (Array.isArray(dst[k]) && !dst[k].length)) dst[k] = src[k];
                });
                dst.updatedAt = new Date().toISOString();
                master[target] = dst;
                delete master[fromName];
            }
            return master;
        };

        var localMaster = {};
        try { localMaster = JSON.parse(localStorage.getItem('agentMasterData')) || {}; } catch (e) {}

        var local = binderEntries();
        var finish = function (book, master, n) {
            if (typeof amsSave === 'function') {
                amsSave('binderData', book);
                amsSave('agentMasterData', master);
            } else {
                localStorage.setItem('binderData', JSON.stringify(book));
                localStorage.setItem('agentMasterData', JSON.stringify(master));
            }
            agencyCloseMerge();
            render();
            if (typeof amsFlashBanner === 'function') {
                amsFlashBanner(n + ' polic' + (n === 1 ? 'y' : 'ies') + ' moved to ' + target + ' ✓');
            }
        };

        var sync = window.UIBBinderSync;
        if (sync && typeof sync.readCloud === 'function' && typeof sync.mergeBinderData === 'function') {
            agencyMergeBusy(true);
            // The roster is written back whole, so it has to be read whole --
            // from the cloud, not from whatever this tab happens to hold.
            // Writing a stale local copy over it would drop agents added
            // on another device, the same way a stale book would.
            return Promise.all([
                sync.readCloud('binderData'),
                sync.readCloud('agentMasterData')
            ]).then(function (res) {
                var bRes = res[0], mRes = res[1];
                // Only widen either set when the cloud actually answered; a
                // failed read must not be mistaken for an empty one.
                var book = (bRes && bRes.ok && Array.isArray(bRes.value))
                         ? sync.mergeBinderData(local, bRes.value)
                         : local;
                var master = localMaster;
                if (mRes && mRes.ok && mRes.value && typeof mRes.value === 'object' && !Array.isArray(mRes.value)) {
                    master = mRes.value;
                    // Anything this device knows that the cloud does not, keep.
                    Object.keys(localMaster).forEach(function (k) {
                        if (!master[k]) master[k] = localMaster[k];
                    });
                }
                agencyMergeBusy(false);
                finish(book, foldRoster(master), rename(book));
            }).catch(function () {
                agencyMergeBusy(false);
                finish(local, foldRoster(localMaster), rename(local));
            });
        }
        finish(local, foldRoster(localMaster), rename(local));
    };

    // The read can take a moment on a big book; make it obvious the merge is
    // running so nobody clicks it twice.
    function agencyMergeBusy(on) {
        var b = document.getElementById('agencyMergeGo');
        if (!b) return;
        b.disabled = !!on;
        b.textContent = on ? 'Merging…' : 'Merge';
        b.style.opacity = on ? '0.6' : '';
    }

    window.agencyRender = render;
    window.agencyTab = function (id) {
        if (id !== 'agents') _agentOpen = null;
        if (id === 'files') { reloadFiles().then(function () { if (_tab === 'files') render(); }); }
        // Keep what is on screen before switching, so a half-filled tab is
        // not lost to a click.
        if (isAdmin()) { try { save(collect()); } catch (e) {} }
        _tab = id;
        render();
    };
    window.agencySave = function () {
        if (!isAdmin()) return;
        save(collect());
        render();
        if (typeof amsFlashBanner === 'function') amsFlashBanner('Agency profile saved ✓');
    };
    window.agencyAddLocation = function () {
        if (!isAdmin()) return;
        var a = collect();
        a.locations.push({ name: '', address: '', city: '', state: '', zip: '', phone: '' });
        save(a); render();
    };
    window.agencyRemoveLocation = function (i) {
        if (!isAdmin()) return;
        if (!confirm('Remove this location?')) return;
        var a = collect();
        a.locations.splice(i, 1);
        save(a); render();
    };

    // ── The logo card in the left pane ───────────────────────
    // Agency Management is for the agency's managers (the admin
    // accounts: Alberto, Randy, Amanda). Every other agent gets Agent
    // Management: their own profile, which they can keep up to date and
    // which is the record the Agents section shows.
    function me() { return (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : ''; }
    function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase(); }

    function renderLogoSection() {
        var el = document.getElementById('amsLogoSection');
        if (!el) return;
        if (!me()) { el.innerHTML = ''; return; }
        if (isAdmin()) {
            var a = load();
            el.innerHTML =
                '<button type="button" class="ams-logo-card" onclick="amsSidebarNav(\'agency\')" title="Agency Management">' +
                  '<img src="icons/uib-192.png" alt="Universal Insurance Brokers logo">' +
                  '<span><b>Agency Management</b><small>' + esc(a.name || 'Universal Insurance Brokers') + '</small></span>' +
                '</button>';
        } else {
            el.innerHTML =
                '<button type="button" class="ams-logo-card" onclick="amsOpenMyProfile()" title="Agent Management — your agent profile">' +
                  '<span class="ams-logo-initials">' + esc(initials(me())) + '</span>' +
                  '<span><b>Agent Management</b><small>' + esc(me()) + ' · my profile</small></span>' +
                '</button>';
        }
    }

    // ── My agent profile (every agent, for themselves) ───────
    var MY_FIELDS = [{ k: 'title', label: 'Title / role' }, { k: 'npn', label: 'NPN' }].concat(AGENT_FIELDS.contact);

    function openMyProfile() {
        var name = me();
        if (!name) return;
        var rec = agentRecord(name);
        var lic = Array.isArray(rec.licenseList) ? rec.licenseList
                : (Array.isArray(rec.licenses) ? rec.licenses.map(function (t) { return { type: t }; }) : []);
        var field = function (f) {
            var v = rec[f.k] == null ? '' : rec[f.k];
            return '<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:600;color:var(--gray-500);' + (f.wide ? 'grid-column:1/-1;' : '') + '">' +
                esc(f.label) + '<input id="myp_' + f.k + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' + (f.max ? ' maxlength="' + f.max + '"' : '') +
                ' style="padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;font-family:inherit;color:var(--navy);"></label>';
        };
        var m = document.createElement('div');
        m.id = 'amsMyProfile';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10004;display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow-y:auto;';
        m.onclick = function (e) { if (e.target === m) m.remove(); };
        m.innerHTML =
            '<div style="background:#fff;border-radius:16px;max-width:680px;width:100%;margin:auto;box-shadow:0 30px 70px rgba(15,23,42,.35);overflow:hidden;" onclick="event.stopPropagation()">' +
              '<div style="background:linear-gradient(135deg,#0d1f3c,#1d4ed8);color:#fff;padding:20px 22px;display:flex;gap:14px;align-items:center;">' +
                '<span style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;">' + esc(initials(name)) + '</span>' +
                '<div style="flex:1;"><div style="font-size:11px;opacity:.8;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">' + (isAdmin() ? 'My profile' : 'Agent Management') + '</div>' +
                  '<div style="font-size:19px;font-weight:800;">' + esc(name) + '</div>' +
                  '<div style="font-size:12px;opacity:.85;">Keep your details current — this is the record the agency sees in its Agents list.</div></div>' +
                '<button type="button" onclick="document.getElementById(\'amsMyProfile\').remove()" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">✕</button>' +
              '</div>' +
              '<div style="padding:18px 22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">' + MY_FIELDS.map(field).join('') + '</div>' +
              '<div style="padding:0 22px 6px;">' +
                '<div style="font-size:11px;font-weight:800;color:var(--navy);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Licenses</div>' +
                (lic.length ? lic.map(function (l) {
                    return '<div style="font-size:12.5px;color:var(--gray-600);padding:3px 0;">📜 ' + esc([l.type, l.number, l.state, l.expires ? 'exp ' + l.expires : ''].filter(Boolean).join(' · ')) + '</div>';
                }).join('') : '<div style="font-size:12px;color:var(--gray-400);">None on file.</div>') +
                '<div style="font-size:11px;color:var(--gray-400);margin-top:4px;">Licenses and HR details are kept by the agency managers — ask them to update those.</div>' +
              '</div>' +
              '<div style="padding:14px 22px;border-top:1px solid var(--gray-200);margin-top:12px;display:flex;justify-content:flex-end;gap:8px;">' +
                '<button type="button" class="btn-secondary btn-sm" onclick="document.getElementById(\'amsMyProfile\').remove()">Cancel</button>' +
                '<button type="button" class="btn-sm" id="mypSave" style="background:linear-gradient(135deg,#0d1f3c,#1d4ed8);color:#fff;border:none;" onclick="amsSaveMyProfile()">💾 Save my profile</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(m);
    }

    function saveMyProfile() {
        var name = me();
        if (!name) return;
        var patch = {};
        MY_FIELDS.forEach(function (f) {
            var el = document.getElementById('myp_' + f.k);
            if (el) patch[f.k] = String(el.value || '').trim();
        });
        var bad = ['email', 'personalEmail'].filter(function (k) { return patch[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch[k]); });
        if (bad.length) { alert('That e-mail address does not look right.'); return; }
        if (patch.state) patch.state = patch.state.toUpperCase();
        var btn = document.getElementById('mypSave');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        saveAgentRecord(name, patch).then(function () {
            var m = document.getElementById('amsMyProfile');
            if (m) m.remove();
            if (typeof amsFlashBanner === 'function') amsFlashBanner('Profile saved ✓');
            var panel = document.getElementById('amsAgencyPanel');
            if (panel && panel.style.display !== 'none') render();
        }).catch(function (e) {
            if (btn) { btn.disabled = false; btn.textContent = '💾 Save my profile'; }
            alert('Could not save your profile: ' + (e && e.message ? e.message : e));
        });
    }

    window.amsRenderLogoSection = renderLogoSection;
    window.amsCanManageAgency = isAdmin;
    window.amsOpenMyProfile = openMyProfile;
    window.amsSaveMyProfile = saveMyProfile;
})();
