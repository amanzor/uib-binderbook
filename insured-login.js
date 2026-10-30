// ============================================================
//  INSURED LOGIN — a commercial client's access to the Client Portal
//  ------------------------------------------------------------
//  The "Insured Login" tab on a commercial client. It sets the
//  client's portal user name (their e-mail, defaulting to the one on
//  file), their password, and what the portal shows them: policies,
//  shared documents, file uploads, the Certificate Master, sending
//  certificates and managing certificate holders.
//
//  Records live in `insuredPortalAccounts` ({clientKey: record}),
//  merged record by record like additionalInterestData. The password
//  never leaves this browser in the clear: it is hashed here
//  (PBKDF2-SHA256, random salt) and only the hash is stored. The
//  Client Portal function (api/insured-portal.js on the AMS site) checks a sign-in against that hash
//  and enforces the permissions on every request — the portal page
//  only draws what the server already decided to send.
//
//  Personal-lines clients keep the last-name + policy-number sign-in;
//  this tab only appears on commercial clients.
// ============================================================

(function () {
    'use strict';

    var STORE_KEY = 'insuredPortalAccounts';
    var ITERATIONS = 100000;
    var PORTAL_PATH = 'insured-portal';

    var PERMS = [
        { k: 'policies',         label: 'Active policies and their details',          hint: 'Carrier, dates, limits, vehicles and locations — never premiums, fees or payments.' },
        { k: 'documents',        label: 'Documents the agency shared',                hint: 'Only files marked "Client can see" on the Documents tab.' },
        { k: 'uploads',          label: 'Upload files',                               hint: 'Files the client uploads land in this client\'s Documents, in the Client Uploads folder.' },
        { k: 'certificates',     label: 'Certificate Master (view and download)',     hint: 'The client sees the certificates on file but cannot change their coverage.' },
        { k: 'sendCertificates', label: 'Send certificates',                          hint: 'E-mails a certificate to a holder the client picks. The agency mailbox is copied on every one.' },
        { k: 'holders',          label: 'Add and edit certificate holders',           hint: 'Additional interests: names, addresses, e-mails and their certificate description.' },
        { k: 'agent',            label: 'Agent contact card',                         hint: 'The assigned agent\'s name, phone and e-mail.' }
    ];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // ams.js declares these with `let`, so they are not on window.
    function activeKey()   { return (typeof amsActiveKey   !== 'undefined') ? amsActiveKey   : null; }
    function currentUser() { return (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) ? amsCurrentUser : ''; }
    function client(key)   { var idx = (typeof amsClientIndex !== 'undefined') ? amsClientIndex : {}; return idx[key] || null; }
    function flash(msg)    { if (window.amsFlashBanner) window.amsFlashBanner(msg); }

    // ── Who gets a login ─────────────────────────────────────
    // A client with any policy in the Commercial book (ams-books.js rules:
    // line type, line of business, then a business-looking name).
    function isCommercial(key) {
        var c = client(key);
        if (!c || c.isHealth) return false;
        var bookOf = window.amsBookOf;
        if (typeof bookOf !== 'function') return false;
        if ((c.policies || []).length) return c.policies.some(function (p) { return bookOf(p) === 'commercial'; });
        return bookOf({ customerName: c.displayName }) === 'commercial';
    }

    // ── Storage ──────────────────────────────────────────────
    function all() {
        try {
            var v = JSON.parse(localStorage.getItem(STORE_KEY));
            return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        } catch (e) { return {}; }
    }
    function get(key) { return all()[key] || null; }
    function save(rec) {
        var map = all();
        rec.updatedAt = new Date().toISOString();
        rec.updatedBy = currentUser();
        map[rec.clientKey] = rec;
        if (window.UIBBinderSync) window.UIBBinderSync.save(STORE_KEY, map);
        else localStorage.setItem(STORE_KEY, JSON.stringify(map));
        return rec;
    }
    function defaultPerms() {
        var p = {};
        PERMS.forEach(function (x) { p[x.k] = true; });
        return p;
    }

    // ── Password hashing (must match api/insured-portal.js on the AMS site) ──
    function b64(bytes) {
        var s = '';
        bytes = new Uint8Array(bytes);
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    }
    function hashPassword(password) {
        if (!window.crypto || !crypto.subtle) return Promise.reject(new Error('This browser cannot hash passwords (it needs a secure https page).'));
        var salt = crypto.getRandomValues(new Uint8Array(16));
        return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
            .then(function (k) {
                return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: ITERATIONS }, k, 256);
            })
            .then(function (bits) {
                return { alg: 'PBKDF2-SHA256', iter: ITERATIONS, salt: b64(salt), hash: b64(bits) };
            });
    }

    // Easy to read aloud over the phone: no 0/O or 1/l/I.
    function generatePassword() {
        var A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        var r = crypto.getRandomValues(new Uint32Array(12)), out = '';
        for (var i = 0; i < 12; i++) out += A[r[i] % A.length];
        return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8);
    }

    function portalUrl() {
        var here = location.origin + location.pathname.replace(/[^/]*$/, '');
        return here + PORTAL_PATH;
    }

    function stamp(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    // Other clients already using this e-mail. Allowed — one owner can run
    // several companies, and the portal asks which one to open — but the
    // agent should know.
    function sharedWith(email, exceptKey) {
        email = String(email || '').trim().toLowerCase();
        if (!email) return [];
        var map = all();
        return Object.keys(map).filter(function (k) {
            var r = map[k];
            return k !== exceptKey && r && r.enabled && String(r.email || '').toLowerCase() === email;
        }).map(function (k) { return (client(k) && client(k).displayName) || k; });
    }

    // ── The tab ──────────────────────────────────────────────
    function updateTab(key) {
        var btn = document.querySelector('.ams-tab[data-tab="insuredLogin"]');
        if (!btn) return;
        var on = !!key && isCommercial(key);
        btn.style.display = on ? '' : 'none';
        var b = document.getElementById('ilTabBadge');
        if (b) {
            var rec = on ? get(key) : null;
            b.style.display = rec && rec.enabled ? 'inline' : 'none';
        }
        // A personal client cannot be left on a hidden tab.
        if (!on && btn.classList.contains('active') && typeof amsShowTab === 'function') amsShowTab('contact');
    }

    function render() {
        if (window.cmInjectCss) window.cmInjectCss();
        var el = document.getElementById('ilBody');
        var key = activeKey();
        updateTab(key);
        if (!el) return;
        if (!key) { el.innerHTML = '<p style="color:var(--gray-400);font-size:12px;">Select a client first.</p>'; return; }
        if (!isCommercial(key)) {
            el.innerHTML = '<p class="cm-sub" style="padding:20px 0;">Portal logins with an e-mail and password are for commercial clients. ' +
                'Personal-lines clients sign in to the portal with their last name and a policy number.</p>';
            return;
        }
        var c = client(key) || {};
        var contact = c.contact || {};
        var rec = get(key) || { clientKey: key, enabled: false, email: '', perms: defaultPerms() };
        var perms = Object.assign(defaultPerms(), rec.perms || {});
        var email = rec.email || contact.email || '';
        var others = sharedWith(email, key);
        var hasPw = !!(rec.pw && rec.pw.hash);

        el.innerHTML =
          '<div class="cm-panel"><div class="cm-panel-head"><span class="cm-grow">Portal access</span>' +
            '<span style="font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;' +
              (rec.enabled && hasPw ? 'background:#dcfce7;color:#166534;">● Active' : 'background:#f1f5f9;color:#64748b;">○ ' + (rec.enabled ? 'No password yet' : 'Off')) + '</span></div>' +
            '<div class="cm-panel-body">' +
              '<label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;margin-bottom:12px;">' +
                '<input type="checkbox" id="il_enabled"' + (rec.enabled ? ' checked' : '') + '> Allow this client to sign in to the Client Portal</label>' +
              '<div class="cm-form-grid">' +
                '<label class="cm-field cm-wide"><span>User name (e-mail)</span>' +
                  '<input id="il_email" type="email" value="' + esc(email) + '" placeholder="owner@company.com" autocomplete="off">' +
                  (contact.email && email.toLowerCase() !== String(contact.email).toLowerCase()
                     ? '<span class="cm-sub">E-mail on file: ' + esc(contact.email) + ' <a href="#" onclick="document.getElementById(\'il_email\').value=\'' + esc(String(contact.email).replace(/'/g, '')) + '\';return false;">use it</a></span>'
                     : (!rec.email && contact.email ? '<span class="cm-sub">Defaults to the e-mail on file.</span>' : '')) +
                  (others.length ? '<span class="cm-sub" style="color:#b45309;">Also the login for: ' + esc(others.join(', ')) + ' — the portal will ask which company to open.</span>' : '') +
                '</label>' +
                '<label class="cm-field cm-wide"><span>' + (hasPw ? 'New password (leave blank to keep the current one)' : 'Password') + '</span>' +
                  '<div style="display:flex;gap:6px;">' +
                    '<input id="il_password" type="text" autocomplete="new-password" placeholder="' + (hasPw ? '••••••••' : 'at least 8 characters') + '" style="flex:1;font-family:monospace;">' +
                    '<button type="button" class="cm-btn" onclick="ilGenerate()">Generate</button>' +
                  '</div>' +
                  (hasPw ? '<span class="cm-sub">Password set ' + esc(stamp(rec.pw.setAt)) + (rec.pw.setBy ? ' by ' + esc(rec.pw.setBy) : '') +
                           '. Passwords are stored hashed — they cannot be looked up, only replaced.</span>' : '') +
                '</label>' +
              '</div>' +
            '</div></div>' +

          '<div class="cm-panel"><div class="cm-panel-head"><span class="cm-grow">What the client can see and do</span></div>' +
            '<div class="cm-panel-body">' +
              PERMS.map(function (p) {
                  return '<label style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f1f5f9;cursor:pointer;">' +
                      '<input type="checkbox" id="il_perm_' + p.k + '"' + (perms[p.k] ? ' checked' : '') + ' style="margin-top:3px;">' +
                      '<span><strong style="font-size:13px;">' + esc(p.label) + '</strong><div class="cm-sub">' + esc(p.hint) + '</div></span></label>';
              }).join('') +
              '<p class="cm-sub" style="margin-top:10px;">Premiums, fees, commissions and payments are never shown in the portal, whatever is ticked here.</p>' +
            '</div></div>' +

          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px;">' +
            '<div class="cm-sub">' + (rec.updatedAt ? 'Last changed ' + esc(stamp(rec.updatedAt)) + (rec.updatedBy ? ' by ' + esc(rec.updatedBy) : '') : 'Not set up yet.') + '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="cm-btn" onclick="ilCopyDetails()">📋 Copy login details</button>' +
              '<button class="cm-btn" onclick="window.open(\'' + esc(portalUrl()) + '\',\'_blank\',\'noopener\')">↗ Open portal</button>' +
              '<button class="cm-btn cm-btn-primary" onclick="ilSave()">💾 Save</button>' +
            '</div>' +
          '</div>';
    }

    function generate() {
        var el = document.getElementById('il_password');
        if (el) { el.value = generatePassword(); el.select(); }
    }

    var _lastPassword = '';
    function saveForm() {
        var key = activeKey();
        if (!key || !isCommercial(key)) return;
        var rec = get(key) || { clientKey: key, createdAt: new Date().toISOString(), createdBy: currentUser() };
        var email = String(document.getElementById('il_email').value || '').trim().toLowerCase();
        var pw = String(document.getElementById('il_password').value || '');
        var enabled = document.getElementById('il_enabled').checked;
        if (enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Enter the e-mail the client will sign in with.'); return; }
        if (pw && pw.length < 8) { alert('Use a password of at least 8 characters (or click Generate).'); return; }
        if (enabled && !pw && !(rec.pw && rec.pw.hash)) { alert('Set a password before turning the login on.'); return; }
        var perms = {};
        PERMS.forEach(function (p) { var b = document.getElementById('il_perm_' + p.k); perms[p.k] = !!(b && b.checked); });
        if (perms.sendCertificates) perms.certificates = true;

        var done = function (pwRec) {
            rec.clientKey = key;
            rec.displayName = (client(key) && client(key).displayName) || key;
            rec.email = email;
            rec.enabled = enabled;
            rec.perms = perms;
            if (pwRec) {
                pwRec.setAt = new Date().toISOString();
                pwRec.setBy = currentUser();
                rec.pw = pwRec;
                _lastPassword = pw;
            }
            save(rec);
            render();
            flash(pwRec ? 'Insured login saved ✓ — copy the login details for the client' : 'Insured login saved ✓');
        };
        if (pw) hashPassword(pw).then(done).catch(function (e) { alert(e.message); });
        else done(null);
    }

    function copyDetails() {
        var key = activeKey();
        var rec = key ? get(key) : null;
        if (!rec || !rec.email) { alert('Save a user name and password first.'); return; }
        var typed = (document.getElementById('il_password') || {}).value || _lastPassword;
        var text = 'Your Universal Insurance Brokers Client Portal\n\n' +
            'Sign in at: ' + portalUrl() + '\n' +
            'User name: ' + rec.email + '\n' +
            'Password: ' + (typed || '(the password your agent gave you)') + '\n\n' +
            'From the portal you can see your active policies, download and send certificates of insurance, ' +
            'and upload documents for our office.';
        var ok = function () { flash('Login details copied ✓'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { prompt('Copy the login details:', text); });
        else prompt('Copy the login details:', text);
    }

    window.UIBInsuredLogin = {
        STORE_KEY: STORE_KEY, PERMS: PERMS,
        all: all, get: get, isCommercial: isCommercial,
        render: render, updateTab: updateTab
    };
    window.ilRender      = render;
    window.ilGenerate    = generate;
    window.ilSave        = saveForm;
    window.ilCopyDetails = copyDetails;
})();
