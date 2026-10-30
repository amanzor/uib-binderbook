// ============================================================
//  ADDITIONAL INTERESTS — the companies tied to a client's policies
//  ------------------------------------------------------------
//  Certificate holders, additional insureds, loss payees, mortgagees
//  and lienholders, kept per client (the "Additional Interests" tab).
//  A certificate picks one as its holder, so the holder's name,
//  address and email are typed once and reused on every certificate.
//
//  Records live in `additionalInterestData` ({id: record}), merged
//  record by record like certificateData, so two agents adding
//  interests to the same client never overwrite each other. Removing
//  one marks it removed rather than deleting it: a plain delete would
//  come back from any device that still holds the record.
// ============================================================

(function () {
    'use strict';

    var STORE_KEY = 'additionalInterestData';
    var TYPES = ['Certificate Holder', 'Additional Insured', 'Loss Payee', 'Mortgagee',
                 'Lienholder', 'Lender', 'Additional Interest'];

    var FIELDS = [
        { k: 'name',      label: 'Company / name',  wide: true, required: true },
        { k: 'type',      label: 'Interest type',   type: 'select', options: TYPES },
        { k: 'reference', label: 'Loan / reference #' },
        { k: 'addr1',     label: 'Address line 1',  wide: true },
        { k: 'addr2',     label: 'Address line 2',  wide: true },
        { k: 'city',      label: 'City' },
        { k: 'state',     label: 'State', max: 2 },
        { k: 'zip',       label: 'ZIP' },
        { k: 'email',     label: 'E-mail (certificates are sent here)', type: 'email', wide: true },
        { k: 'phone',     label: 'Phone', type: 'tel' },
        { k: 'fax',       label: 'Fax', type: 'tel' },
        { k: 'contact',   label: 'Contact person', wide: true },
        { k: 'description', label: 'Certificate description — prints in "Description of Operations / Locations / Vehicles" when this holder is picked', type: 'textarea', wide: true, rows: 4 },
        { k: 'notes',     label: 'Notes', type: 'textarea', wide: true }
    ];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // ams.js declares these with `let`, so they are not on window.
    function activeKey()   { return (typeof amsActiveKey   !== 'undefined') ? amsActiveKey   : null; }
    function currentUser() { return (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : ''; }
    function clientName(key) {
        var idx = (typeof amsClientIndex !== 'undefined') ? amsClientIndex : {};
        return (idx[key] && idx[key].displayName) || key;
    }

    // ── Storage ──────────────────────────────────────────────
    function all() {
        try {
            var v = JSON.parse(localStorage.getItem(STORE_KEY));
            return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        } catch (e) { return {}; }
    }
    function get(id) { return all()[id] || null; }
    function save(rec) {
        var map = all();
        rec.updatedAt = new Date().toISOString();
        map[rec.id] = rec;
        if (window.UIBBinderSync) window.UIBBinderSync.save(STORE_KEY, map);
        else localStorage.setItem(STORE_KEY, JSON.stringify(map));
        return rec;
    }
    function forClient(clientKey) {
        var map = all();
        return Object.keys(map).map(function (id) { return map[id]; })
            .filter(function (r) { return r && r.clientKey === clientKey && !r.removed; })
            .sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    }
    function remove(id) {
        var r = get(id);
        if (!r) return null;
        r.removed = true;
        r.removedAt = new Date().toISOString();
        r.removedBy = currentUser();
        return save(r);
    }
    // One line, the way it reads on a certificate or in a list.
    function addressLine(r) {
        return [r.addr1, r.addr2, r.city, [r.state, r.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    }

    // Companies already on file for OTHER clients — a general contractor
    // or a lender shows up on many clients' certificates, so typing its
    // name offers the address and email someone already entered.
    function directory(exceptClient) {
        var seen = {};
        var map = all();
        Object.keys(map).forEach(function (id) {
            var r = map[id];
            if (!r || r.removed || !r.name || r.clientKey === exceptClient) return;
            var k = String(r.name).trim().toUpperCase() + '|' + String(r.addr1 || '').trim().toUpperCase();
            if (!seen[k] || String(r.updatedAt || '') > String(seen[k].updatedAt || '')) seen[k] = r;
        });
        return Object.keys(seen).map(function (k) { return seen[k]; })
            .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    }

    function usedOn(id) {
        if (!window.UIBCert) return 0;
        var map = window.UIBCert.all();
        return Object.keys(map).filter(function (k) {
            var c = map[k];
            return c && !c.voided && c.holderInterestId === id;
        }).length;
    }

    // ── The tab ──────────────────────────────────────────────
    function render() {
        if (window.cmInjectCss) window.cmInjectCss();
        var el = document.getElementById('aiListBody');
        var key = activeKey();
        updateBadge(key);
        if (!el) return;
        if (!key) { el.innerHTML = '<p style="color:var(--gray-400);font-size:12px;">Select a client first.</p>'; return; }
        var list = forClient(key);
        if (!list.length) {
            el.innerHTML =
                '<div style="text-align:center;padding:34px 16px;color:var(--gray-400);">' +
                  '<div style="font-size:30px;margin-bottom:8px;">🏢</div>' +
                  '<p style="font-size:13px;margin-bottom:4px;">No additional interests for this client yet.</p>' +
                  '<p style="font-size:11px;">Add the landlords, general contractors, lenders and other companies that ask ' +
                  'for proof of coverage — then pick one as the holder when you make a certificate.</p>' +
                '</div>';
            return;
        }
        el.innerHTML =
            '<div class="cm-grid-wrap"><table class="cm-grid">' +
              '<thead><tr><th style="width:120px;"></th><th>Name</th><th>Type</th><th>Address</th><th>E-mail</th><th>Phone</th><th>Certificates</th></tr></thead>' +
              '<tbody>' + list.map(function (r) {
                  var n = usedOn(r.id);
                  return '<tr>' +
                      '<td style="white-space:nowrap;">' +
                        '<button class="cm-btn" onclick="aiOpenEditor(\'' + esc(r.id) + '\')">✎ Edit</button> ' +
                        '<button class="cm-btn cm-btn-danger" onclick="aiRemove(\'' + esc(r.id) + '\')" title="Remove">✕</button>' +
                      '</td>' +
                      '<td><strong>' + esc(r.name) + '</strong>' + (r.contact ? '<div class="cm-sub">Attn: ' + esc(r.contact) + '</div>' : '') +
                         (r.reference ? '<div class="cm-sub">Ref: ' + esc(r.reference) + '</div>' : '') +
                         (r.description ? '<div class="cm-sub" title="' + esc(r.description) + '">📝 ' + esc(String(r.description).slice(0, 70)) + (String(r.description).length > 70 ? '…' : '') + '</div>' : '') +
                         (r.updatedBy === 'Client portal' || r.createdBy === 'Client portal' ? '<div class="cm-sub" style="color:#0891b2;">Added/edited by the client in the portal</div>' : '') + '</td>' +
                      '<td>' + esc(r.type || 'Certificate Holder') + '</td>' +
                      '<td>' + esc(addressLine(r)) + '</td>' +
                      '<td>' + (r.email ? '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '<span class="cm-sub">—</span>') + '</td>' +
                      '<td>' + esc(r.phone || '') + '</td>' +
                      '<td>' + (n ? n + ' certificate' + (n > 1 ? 's' : '') : '<span class="cm-sub">—</span>') + '</td>' +
                  '</tr>';
              }).join('') + '</tbody></table></div>' +
            '<div class="cm-pager"><span></span><span>' + list.length + ' item' + (list.length > 1 ? 's' : '') + '</span></div>';
    }

    function updateBadge(key) {
        var b = document.getElementById('aiTabBadge');
        if (!b) return;
        var n = key ? forClient(key).length : 0;
        b.textContent = n;
        b.style.display = n ? 'inline' : 'none';
    }

    // ── Editor ───────────────────────────────────────────────
    var _onSaved = null;

    // opts.onSaved(record) — used by the certificate editor to select
    // the interest it just added as the holder.
    function openEditor(id, opts) {
        opts = opts || {};
        var key = opts.clientKey || activeKey();
        if (!key) { alert('Open a client first.'); return; }
        var rec = id ? get(id) : null;
        if (id && !rec) { alert('That additional interest could no longer be found.'); return; }
        rec = rec || { type: opts.type || 'Certificate Holder' };
        _onSaved = opts.onSaved || null;
        if (window.cmInjectCss) window.cmInjectCss();

        var dir = directory(key);
        var input = function (f) {
            var v = rec[f.k] == null ? '' : rec[f.k];
            var el;
            if (f.type === 'select') {
                el = '<select id="ai_' + f.k + '">' + f.options.map(function (o) {
                    return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>';
                }).join('') + '</select>';
            } else if (f.type === 'textarea') {
                el = '<textarea id="ai_' + f.k + '" rows="' + (f.rows || 2) + '">' + esc(v) + '</textarea>';
            } else {
                el = '<input id="ai_' + f.k + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' +
                     (f.max ? ' maxlength="' + f.max + '"' : '') +
                     (f.k === 'name' ? ' list="aiDirectory" oninput="aiPickFromDirectory(this.value)" autocomplete="off"' : '') + '>';
            }
            return '<label class="cm-field' + (f.wide ? ' cm-wide' : '') + '"><span>' + esc(f.label) + (f.required ? ' *' : '') + '</span>' + el + '</label>';
        };

        var modal = document.createElement('div');
        modal.id = 'aiEditorModal';
        modal.className = 'cm-overlay';
        modal.style.zIndex = '10006';
        modal.onclick = function (e) { if (e.target === modal) closeEditor(); };
        modal.innerHTML =
            '<div class="cm-dialog" style="max-width:640px;" onclick="event.stopPropagation()">' +
              '<div class="cm-dialog-head"><div><h2>' + (id ? 'Edit' : 'Add new') + ' <span>Additional Interest</span></h2>' +
                '<p>' + esc(clientName(key)) + '</p></div>' +
                '<button class="cm-x" onclick="aiCloseEditor()">✕</button></div>' +
              '<div class="cm-dialog-body"><div class="cm-form-grid">' + FIELDS.map(input).join('') + '</div>' +
                (dir.length ? '<p class="cm-sub" style="margin-top:8px;">Start typing a company already used on another client to copy its address and e-mail.</p>' : '') +
                '<datalist id="aiDirectory">' + dir.map(function (r) {
                    return '<option value="' + esc(r.name) + '">' + esc(addressLine(r)) + '</option>';
                }).join('') + '</datalist>' +
              '</div>' +
              '<div class="cm-dialog-foot"><span></span><div>' +
                '<button class="cm-btn" onclick="aiCloseEditor()">Cancel</button> ' +
                '<button class="cm-btn cm-btn-primary" onclick="aiSave(\'' + esc(id || '') + '\', \'' + esc(key) + '\')">💾 Save</button>' +
              '</div></div>' +
            '</div>';
        document.body.appendChild(modal);
        var first = document.getElementById('ai_name');
        if (first) first.focus();
    }

    function closeEditor() {
        var m = document.getElementById('aiEditorModal');
        if (m) m.remove();
        _onSaved = null;
    }

    function pickFromDirectory(name) {
        var key = activeKey();
        var hit = directory(key).filter(function (r) { return String(r.name).trim().toUpperCase() === String(name).trim().toUpperCase(); })[0];
        if (!hit) return;
        FIELDS.forEach(function (f) {
            if (f.k === 'name' || f.k === 'notes' || f.k === 'reference' || f.k === 'description') return;
            var el = document.getElementById('ai_' + f.k);
            if (el && !el.value && hit[f.k]) el.value = hit[f.k];
        });
    }

    function saveEditor(id, clientKey) {
        var rec = id ? (get(id) || {}) : {
            id: 'ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            clientKey: clientKey,
            createdAt: new Date().toISOString(),
            createdBy: currentUser()
        };
        FIELDS.forEach(function (f) {
            var el = document.getElementById('ai_' + f.k);
            if (el) rec[f.k] = String(el.value || '').trim();
        });
        if (!rec.name) { alert('Enter the company or person\'s name.'); return; }
        if (rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) { alert('That e-mail address does not look right.'); return; }
        if (rec.state) rec.state = rec.state.toUpperCase();
        rec.updatedBy = currentUser();
        save(rec);
        var cb = _onSaved;
        closeEditor();
        render();
        if (cb) cb(rec);
        if (window.amsFlashBanner) window.amsFlashBanner('Additional interest saved ✓');
    }

    function removeInterest(id) {
        var r = get(id);
        if (!r) return;
        var n = usedOn(id);
        if (!confirm('Remove ' + r.name + ' from this client\'s additional interests?' +
                     (n ? '\n\nIt is the holder on ' + n + ' certificate' + (n > 1 ? 's' : '') + ' — those keep the holder they print.' : ''))) return;
        remove(id);
        render();
    }

    window.UIBInterests = {
        STORE_KEY: STORE_KEY, TYPES: TYPES,
        all: all, get: get, save: save, forClient: forClient, remove: remove,
        directory: directory, addressLine: addressLine, usedOn: usedOn,
        render: render, updateBadge: updateBadge, openEditor: openEditor
    };
    window.aiRender             = render;
    window.aiOpenEditor         = openEditor;
    window.aiCloseEditor        = closeEditor;
    window.aiSave               = saveEditor;
    window.aiRemove             = removeInterest;
    window.aiPickFromDirectory  = pickFromDirectory;
})();
