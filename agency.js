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

    // Tabs mirror the agency record an agency manager expects, minus the
    // three that were explicitly not wanted (workflow checklists, sales
    // goals, tasks). Commission Rules does not duplicate the commission
    // screens that already exist — it states the rule and links to them.
    var TABS = [
        { id: 'general',    label: 'General',          icon: 'building-2' },
        { id: 'locations',  label: 'Locations',        icon: 'map-pin' },
        { id: 'agents',     label: 'Agents',           icon: 'users' },
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

    // Commission lives in the Accounting and Commission screens already.
    // This states the agency's default split and sends you there rather
    // than becoming a second place where the numbers live.
    function commissionTab(a) {
        var c = a.commission || {};
        var ro = isAdmin() ? '' : ' disabled';
        var num = function (k, label, val) {
            return '<div><label style="' + labelCss() + '">' + esc(label) + '</label>' +
                '<input type="number" min="0" max="100" step="0.1" id="agcom_' + k + '" value="' + esc(val == null ? '' : val) + '"' +
                ro + ' style="' + fieldCss() + (isAdmin() ? '' : 'background:#f8fafc;color:var(--gray-500);') + '"></div>';
        };
        return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px;">' +
                 num('agencyPct', 'Agency commission %', c.agencyPct) +
                 num('agentPct',  'Agent share %',       c.agentPct) +
                 num('agencyFee', 'Default agency fee ($)', c.agencyFee) +
               '</div>' +
               '<p style="font-size:11px;color:var(--gray-400);margin-bottom:16px;">' +
                 'Defaults applied to new entries. What was actually earned lives in the commission screens, ' +
                 'not here — a second copy of those numbers would only disagree with the first.' +
               '</p>' +
               '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">' +
                 '<button onclick="amsSidebarNav(\'commissions\')" style="padding:8px 15px;background:var(--navy);' +
                   'color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;">' +
                   'Open Commission Statements</button>' +
                 '<button onclick="amsSidebarNav(\'accounting\')" style="padding:8px 15px;background:#fff;' +
                   'color:var(--navy);border:1px solid var(--gray-200);border-radius:7px;font-size:12px;' +
                   'font-weight:600;cursor:pointer;">Open Accounting &amp; Ledger</button>' +
               '</div>' + saveBar();
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
        var n = document.getElementById('ag_notes');
        if (n) a.notes = n.value;
        return a;
    }

    window.agencyRender = render;
    window.agencyTab = function (id) {
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
