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
        if (_tab === 'agents')     return agentsTab();
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

    function money(n) {
        return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
                   return '<div style="padding:12px 15px;' + (i ? 'border-top:1px solid var(--gray-200);' : '') +
                              'display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
                       '<div style="min-width:0;">' +
                         '<div style="font-weight:700;color:var(--navy);font-size:13px;">' + esc(a.name) +
                           (a.onRoster ? ''
                              : ' <span style="background:#fef3c7;color:#92400e;border-radius:9px;padding:2px 7px;' +
                                'font-size:10px;font-weight:700;">not on the roster</span>') +
                         '</div>' +
                         '<div style="font-size:11px;color:var(--gray-500);margin-top:3px;">' +
                           (bits.length ? bits.join(' &nbsp; ') : 'No contact details on the roster') +
                         '</div>' +
                       '</div>' +
                       '<div style="text-align:right;flex-shrink:0;">' +
                         '<div style="font-weight:700;color:var(--navy);font-size:13px;">' +
                            a.policies + ' polic' + (a.policies === 1 ? 'y' : 'ies') + '</div>' +
                         '<div style="font-size:11px;color:var(--gray-500);margin-top:3px;">' +
                            money(a.premium) + (a.last ? ' · last ' + esc(a.last) : '') + '</div>' +
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

    window.agencyRender = render;
    window.agencyTab = function (id) {
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
})();
