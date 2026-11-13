// ============================================================
//  USER ACCESS PERMISSIONS — Executive Admin screen
//  ------------------------------------------------------------
//  Shows every user with a switch per permission. Executive Admins
//  (Alberto, Randy) always have everything and cannot be changed.
//  A switch left on "Default" follows the person's level; turning it
//  on or off stores an override in app_store 'userPermissions'.
//  Buttons with class "uib-perms-btn" are shown to Executive Admins.
// ============================================================
(function () {
    'use strict';
    if (window.UIBPerms) return;
    const A = () => window.UIBAuth;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let draft = null;

    function showButtons() {
        const exec = !!(A() && A().isExecutive && A().isExecutive());
        document.querySelectorAll('.uib-perms-btn').forEach(b => { b.style.display = exec ? '' : 'none'; });
    }

    // Everyone who can sign in: the built-in list plus Agent Management emails.
    function people() {
        const map = new Map();
        const add = (email, name) => {
            const em = String(email || '').trim().toLowerCase();
            if (!em || !/@/.test(em)) return;
            if (!map.has(em)) map.set(em, name || em);
        };
        Object.entries((A() && A().KNOWN_AGENTS) || {}).forEach(([em, n]) => add(em, n));
        try {
            const m = JSON.parse(localStorage.getItem('agentMasterData') || '{}') || {};
            Object.entries(m).forEach(([n, v]) => add(v && v.email, n));
        } catch (e) {}
        try {
            const c = JSON.parse(localStorage.getItem('agentCredentials') || '{}') || {};
            Object.entries(c).forEach(([n, v]) => add(v && v.email, n));
        } catch (e) {}
        const rank = { executive: 0, admin: 1, user: 2 };
        return [...map.entries()].map(([email, name]) => ({ email, name, level: A().baseLevelOf(email) }))
            .sort((a, b) => (rank[a.level] - rank[b.level]) || a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
    }

    function render() {
        const body = document.getElementById('uibPermsBody');
        if (!body) return;
        const P = A().PERMISSIONS;
        const rows = people().map(p => {
            const exec = p.level === 'executive';
            const cells = P.map(perm => {
                const ov = (draft[p.email] || {})[perm.key];
                const eff = exec ? true : (typeof ov === 'boolean' ? ov : A().permFor(p.email, perm.key, undefined, true));
                const state = exec ? 'locked' : (typeof ov === 'boolean' ? (ov ? 'on' : 'off') : 'default');
                const bg = eff ? '#059669' : '#cbd5e1';
                return `<td style="text-align:center;padding:8px;">
                    <button type="button" ${exec ? 'disabled' : ''} onclick="UIBPerms.toggle('${esc(p.email)}','${perm.key}')"
                        title="${exec ? 'Executive Admins always have this' : state === 'default' ? 'Following the default for this level — click to change' : 'Set by an Executive Admin — click to change'}"
                        style="width:44px;height:24px;border-radius:999px;border:none;background:${bg};position:relative;cursor:${exec ? 'not-allowed' : 'pointer'};opacity:${exec ? .6 : 1};">
                        <span style="position:absolute;top:3px;${eff ? 'right:3px' : 'left:3px'};width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);"></span>
                    </button>
                    <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${exec ? 'always' : state === 'default' ? 'default' : 'custom'}</div>
                </td>`;
            }).join('');
            const custom = !exec && draft[p.email] && Object.keys(draft[p.email]).length;
            return `<tr style="border-top:1px solid #e2e8f0;">
                <td style="padding:8px 10px;"><div style="font-weight:700;color:#0f172a;">${esc(p.name)}</div><div style="font-size:11px;color:#64748b;">${esc(p.email)}</div></td>
                <td style="padding:8px;"><span style="font-size:11px;font-weight:700;border-radius:999px;padding:3px 9px;background:${p.level === 'executive' ? '#ede9fe;color:#5b21b6' : p.level === 'admin' ? '#dbeafe;color:#1e40af' : '#f1f5f9;color:#475569'};">${A().levelLabel(p.level)}</span></td>
                ${cells}
                <td style="padding:8px;text-align:center;">${custom ? `<button type="button" onclick="UIBPerms.reset('${esc(p.email)}')" style="font-size:11px;background:none;border:none;color:#2563eb;cursor:pointer;text-decoration:underline;">Reset</button>` : ''}</td>
            </tr>`;
        }).join('');
        body.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f8fafc;color:#334155;font-size:12px;">
                <th style="text-align:left;padding:8px 10px;">User</th><th style="text-align:left;padding:8px;">Level</th>
                ${P.map(p => `<th style="padding:8px;max-width:140px;" title="${esc(p.desc)}">${esc(p.label)}<div style="font-weight:400;font-size:10.5px;color:#64748b;">${esc(p.desc)}</div></th>`).join('')}
                <th></th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function open() {
        if (!A() || !A().isExecutive()) { alert('Only Executive Admins can manage user access permissions.'); return; }
        let m = document.getElementById('uibPermsModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'uibPermsModal';
            m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
            m.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:1000px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit;">
                <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;">
                    <div style="flex:1;"><div style="font-size:18px;font-weight:800;color:#0f172a;">🔑 User Access Permissions</div>
                    <div style="font-size:12px;color:#64748b;">Give or remove access per user. "Default" follows the user's level. Changes apply the next time that user signs in.</div></div>
                    <button type="button" onclick="UIBPerms.close()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#64748b;">×</button>
                </div>
                <div id="uibPermsBody" style="overflow:auto;padding:8px 12px;flex:1;"></div>
                <div style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;align-items:center;">
                    <span id="uibPermsMsg" style="flex:1;font-size:12px;color:#64748b;"></span>
                    <button type="button" onclick="UIBPerms.close()" style="padding:8px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;">Cancel</button>
                    <button type="button" id="uibPermsSave" onclick="UIBPerms.save()" style="padding:8px 18px;border-radius:8px;border:none;background:#1d4ed8;color:#fff;font-weight:700;cursor:pointer;">Save</button>
                </div></div>`;
            m.addEventListener('click', e => { if (e.target === m) close(); });
            document.body.appendChild(m);
        }
        m.style.display = 'flex';
        draft = JSON.parse(JSON.stringify(A().readPerms()));
        document.getElementById('uibPermsMsg').textContent = 'Loading the latest from the cloud…';
        render();
        A().loadPermissions().then(v => {
            draft = JSON.parse(JSON.stringify(v || {}));
            document.getElementById('uibPermsMsg').textContent = '';
            render();
        });
    }
    function close() { const m = document.getElementById('uibPermsModal'); if (m) m.style.display = 'none'; }

    // Default → opposite of the default → back to default.
    function toggle(email, perm) {
        const cur = (draft[email] || {})[perm];
        const def = A().permFor(email, perm, undefined, true);
        draft[email] = draft[email] || {};
        if (typeof cur !== 'boolean') draft[email][perm] = !def;
        else delete draft[email][perm];
        if (!Object.keys(draft[email]).length) delete draft[email];
        render();
    }
    function reset(email) { delete draft[email]; render(); }

    function save() {
        const btn = document.getElementById('uibPermsSave');
        const msg = document.getElementById('uibPermsMsg');
        btn.disabled = true; btn.textContent = 'Saving…';
        A().savePermissions(draft).then(() => {
            msg.style.color = '#059669'; msg.textContent = 'Saved ✓ — applies the next time each user signs in.';
            if (window.UIBAudit && UIBAudit.log) try { UIBAudit.log('user_permissions_changed', { users: Object.keys(draft).length }); } catch (e) {}
        }).catch(err => {
            msg.style.color = '#dc2626'; msg.textContent = 'Could not save: ' + (err.message || err);
        }).finally(() => { btn.disabled = false; btn.textContent = 'Save'; });
    }

    window.UIBPerms = { open, close, toggle, reset, save, refreshButtons: showButtons };

    function boot() {
        showButtons();
        if (A() && A().user && A().user()) {
            A().loadPermissions().then(showButtons);
            if (A().syncLevel) A().syncLevel().then(showButtons);   // a role changed in Manage Users
        }
        setInterval(showButtons, 3000);   // sign-in / sign-out happens without a reload
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
