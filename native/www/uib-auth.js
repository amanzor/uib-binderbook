// ============================================================
//  UIB AUTH  —  Supabase Auth sessions for every page
//  ------------------------------------------------------------
//  Load this BEFORE app.js / ams.js / supabase.js.
//
//  • Agents sign in with the email + password of their Supabase Auth
//    account. Passwords are hashed by Supabase and never stored here.
//  • The session (access token, refresh token, profile) lives in
//    sessionStorage, so it ends when the tab is closed and is copied
//    into tabs the app opens itself (window.open / links).
//  • Every fetch() to the Supabase project is rewritten to carry the
//    signed-in user's token instead of the public anon key, so the
//    database, storage bucket and edge functions all see a real user.
//  • Idle timeout: 30 minutes without input signs the user out.
//
//  Profile: name = user_metadata.agent_name (the Binder Book agent
//  name), role = app_metadata.role ('admin' or 'agent').
// ============================================================
(function () {
    'use strict';

    const SUPABASE_URL = 'https://jgjmobktucyimupelfxd.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1vYmt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ';
    const SESSION_KEY = 'uibAuthSession';
    // Human verification (Cloudflare Turnstile). Paste the widget's SITE key
    // here and enable Turnstile with the SECRET key in Supabase ▸ Authentication
    // ▸ Attack Protection ▸ Captcha. Leave empty to run without it.
    const TURNSTILE_SITE_KEY = '';
    // 2-step verification is an agency-wide switch administrators flip on the
    // Manage Login Credentials page (stored in app_store under
    // "securitySettings"). This constant is only the default used when the
    // setting has never been saved or cannot be read.
    const MFA_REQUIRED = false;
    // The only accounts allowed into the admin console: Alberto, Randy and
    // Amanda. An account can also be made admin from Manage Login Credentials
    // (sets the server-side admin flag); nothing an agent can edit themselves
    // grants it.
    // Built-in email -> agent name, so sign-in works on any device even when
    // the Agent Management list has not reached the cloud yet.
    const KNOWN_AGENTS = {
        'admin@universalinsurancebroker.com': 'Alberto Manzor',
        'amanzor89@gmail.com': 'Alberto Manzor',
        'amanda@universalinsurancebroker.com': 'Amanda Montano',
        'doral@universalinsurancebroker.com': 'Jorge Castro',
        'lazaro@universalinsurancebroker.com': 'Lazaro Reigoza',
        'randy@universalinsurancebroker.com': 'Randy Diaz',
        'uri@universalinsurancebroker.com': 'Uriel Rendon'
    };
    const ADMIN_EMAILS = ['admin@universalinsurancebroker.com', 'amanzor89@gmail.com', 'randy@universalinsurancebroker.com', 'amanda@universalinsurancebroker.com'];
    const IDLE_MS = 30 * 60 * 1000;
    const REFRESH_AHEAD_S = 120;

    function readSession() {
        try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
    }
    function writeSession(s) {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
    }
    function clearSession() {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
        try { sessionStorage.removeItem('uibCurrentUser'); } catch (e) {}
        try { localStorage.removeItem('uibCurrentUser'); } catch (e) {}
    }

    // The Binder Book agent name comes from the account's agent_name metadata.
    // If that was not set when the account was created, fall back to the Agent
    // Management roster on this device, matched by email, so the agent still
    // lands on their own dashboard and their entries are found.
    function nameFromRoster(email) {
        try {
            const master = JSON.parse(localStorage.getItem('agentMasterData') || '{}');
            const e = String(email || '').trim().toLowerCase();
            if (!e) return '';
            for (const name of Object.keys(master)) {
                const rec = master[name] || {};
                if (String(rec.email || '').trim().toLowerCase() === e) return name;
            }
        } catch (err) {}
        return '';
    }
    function profileFrom(user) {
        const meta = (user && user.user_metadata) || {};
        const app = (user && user.app_metadata) || {};
        const email = (user && user.email) || '';
        const onAccount = meta.agent_name || meta.full_name || meta.name || '';
        const name = onAccount || nameFromRoster(email) || '';
        const role = (app.role === 'admin' || ADMIN_EMAILS.includes(String(email).toLowerCase())) ? 'admin' : 'agent';
        return { id: user && user.id, email: email, name: name, role: role, onAccount: !!onAccount };
    }

    function storeTokens(tok) {
        const now = Math.floor(Date.now() / 1000);
        const s = {
            access_token: tok.access_token,
            refresh_token: tok.refresh_token,
            expires_at: tok.expires_at || (now + (tok.expires_in || 3600)),
            user: profileFrom(tok.user),
            lastActive: Date.now()
        };
        const prev = readSession();
        if (prev && prev.pendingMfa) s.pendingMfa = prev.pendingMfa;
        if (prev && prev.rawUser && !tok.user) s.rawUser = prev.rawUser;
        if (tok.user) s.rawUser = tok.user;
        writeSession(s);
        return s.user;
    }

    async function authPost(path, body) {
        const res = await fetch(SUPABASE_URL + '/auth/v1/' + path, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        let data = null;
        try { data = await res.json(); } catch (e) {}
        if (!res.ok) {
            const msg = (data && (data.error_description || data.msg || data.message || data.error)) || ('HTTP ' + res.status);
            const err = new Error(msg); err.status = res.status; throw err;
        }
        return data;
    }

    // ── Public API ─────────────────────────────────────────────
    // Agent Management roster from the cloud (needs the signed-in token), for
    // a device that has not synced yet.
    async function rosterFromCloud(accessToken) {
        try {
            const res = await _fetch(SUPABASE_URL + '/rest/v1/app_store?select=value&key=eq.agentMasterData', { headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + accessToken } });
            if (!res.ok) return {};
            const rows = await res.json();
            const v = rows[0] && rows[0].value;
            return (v && typeof v === 'object') ? (Array.isArray(v) ? {} : v) : {};
        } catch (e) { return {}; }
    }
    function matchEmail(master, email) {
        const e = String(email || '').trim().toLowerCase();
        for (const name of Object.keys(master || {})) {
            const rec = master[name] || {};
            if (String(rec.email || '').trim().toLowerCase() === e) return name;
        }
        return '';
    }
    // Write the matched name onto the account so every later sign-in, on any
    // device, already knows who this is.
    async function saveAgentName(accessToken, name) {
        try {
            await _fetch(SUPABASE_URL + '/auth/v1/user', { method: 'PUT', headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { agent_name: name } }) });
        } catch (e) {}
    }

    async function authCall(method, path, body, accessToken) {
        const res = await _fetch(SUPABASE_URL + '/auth/v1/' + path, {
            method, headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + (accessToken || token() || SUPABASE_ANON), 'Content-Type': 'application/json' },
            body: body == null ? undefined : JSON.stringify(body)
        });
        let data = null; try { data = await res.json(); } catch (e) {}
        if (!res.ok) { const err = new Error((data && (data.error_description || data.msg || data.message || data.error)) || ('HTTP ' + res.status)); err.status = res.status; throw err; }
        return data;
    }

    // ── 2-step verification (TOTP through Supabase Auth MFA) ───
    async function mfaFactors(accessToken) {
        const u = await authCall('GET', 'user', null, accessToken);
        const all = (u && u.factors) || [];
        return all.filter((f) => f.factor_type === 'totp');
    }
    async function mfaEnroll(accessToken) {
        // Returns { id, totp: { qr_code (SVG data URL), secret, uri } }
        return authCall('POST', 'factors', { factor_type: 'totp', friendly_name: 'UIB Binder Book ' + new Date().toISOString().slice(0, 10) }, accessToken);
    }
    async function mfaVerify(factorId, code, accessToken) {
        const ch = await authCall('POST', 'factors/' + factorId + '/challenge', {}, accessToken);
        const tok = await authCall('POST', 'factors/' + factorId + '/verify', { challenge_id: ch.id, code: String(code || '').replace(/\D/g, '') }, accessToken);
        // A successful verify returns a new session at assurance level 2.
        if (tok && tok.access_token) return storeTokens(Object.assign({}, tok, { user: tok.user || (readSession() || {}).rawUser }));
        return user();
    }
    async function mfaUnenroll(factorId) {
        return authCall('DELETE', 'factors/' + factorId, null);
    }
    function assuranceLevel() {
        const t = token(); if (!t) return '';
        try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch (e) { return ''; }
    }

    async function signIn(email, password, opts) {
        opts = opts || {};
        const body = { email: String(email || '').trim().toLowerCase(), password: password };
        if (opts.captchaToken) body.gotrue_meta_security = { captcha_token: opts.captchaToken };
        const tok = await authPost('token?grant_type=password', body);
        const user = storeTokens(tok);
        try { const s0 = readSession(); if (s0) { s0.rawUser = tok.user; writeSession(s0); } } catch (e) {}
        // Agent Management is the source of truth for who this email is. Match
        // the email against the roster (this device first, then the cloud); if
        // the roster says something different from the name on the account,
        // the roster wins and the account is corrected.
        {
            const rosterName = nameFromRoster(user.email) || matchEmail(await rosterFromCloud(tok.access_token), user.email) || KNOWN_AGENTS[String(user.email || '').trim().toLowerCase()] || '';
            const nameOnAccount = user.onAccount ? user.name : '';
            if (rosterName && rosterName !== nameOnAccount) {
                user.name = rosterName; user.onAccount = true;
                const s = readSession(); if (s) { s.user = user; writeSession(s); }
                saveAgentName(tok.access_token, rosterName);
            }
        }
        if (!user.name && user.role !== 'admin') { clearSession(); throw new Error('This email is not linked to an agent yet. Add it to that agent in Agent Management (admin), then sign in again.'); }
        if (!user.name) user.name = 'Admin';

        // 2-step verification, when the agency switch is on: a verified
        // authenticator means a code is needed before this session counts; no
        // authenticator means enroll first. Switch off: email + password only.
        const s = readSession();
        if (await getMfaRequired(tok.access_token)) {
            const factors = await mfaFactors(tok.access_token).catch(() => []);
            const verified = factors.find((f) => f.status === 'verified');
            if (verified) { if (s) { s.pendingMfa = verified.id; writeSession(s); } return Object.assign({}, user, { mfaRequired: true, factorId: verified.id }); }
            if (s) { s.pendingMfa = 'enroll'; writeSession(s); } return Object.assign({}, user, { enrollRequired: true });
        }
        try { sessionStorage.setItem('uibCurrentUser', (user.role === 'admin' && (!user.name || user.name === 'Admin')) ? 'Admin' : user.name); } catch (e) {}
        audit('sign_in', user.email, { mfa: false });
        return user;
    }
    // Agency-wide 2-step switch (app_store key "securitySettings").
    async function getMfaRequired(accessToken) {
        try {
            const res = await _fetch(SUPABASE_URL + '/rest/v1/app_store?select=value&key=eq.securitySettings', { headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + (accessToken || token() || SUPABASE_ANON) } });
            if (!res.ok) return MFA_REQUIRED;
            const rows = await res.json(); const v = rows[0] && rows[0].value;
            return (v && typeof v.mfaRequired === 'boolean') ? v.mfaRequired : MFA_REQUIRED;
        } catch (e) { return MFA_REQUIRED; }
    }
    async function setMfaRequired(on) {
        const res = await _fetch(SUPABASE_URL + '/rest/v1/app_store', { method: 'POST', headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + (token() || SUPABASE_ANON), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key: 'securitySettings', value: { mfaRequired: !!on, changedBy: (user() || {}).email || '', changedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }]) });
        if (!res.ok) throw new Error('Could not save the setting (HTTP ' + res.status + ').');
        return !!on;
    }
    function audit(action, target, details) { try { if (window.UIBAudit) UIBAudit.log(action, target, details); } catch (e) {} }
    // Called by the page once the code (or enrollment) succeeded.
    function completeSignIn() {
        const s = readSession(); if (!s) return null;
        delete s.pendingMfa; writeSession(s);
        try { sessionStorage.setItem('uibCurrentUser', (s.user.role === 'admin' && (!s.user.name || s.user.name === 'Admin')) ? 'Admin' : s.user.name); } catch (e) {}
        audit('sign_in', s.user.email, { mfa: true });
        return s.user;
    }

    async function refresh() {
        const s = readSession();
        if (!s || !s.refresh_token) return null;
        try {
            const tok = await authPost('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
            return storeTokens(tok);
        } catch (e) {
            if (e.status === 400 || e.status === 401) { forcedSignOut('Your session ended. Please sign in again; anything you were typing has been kept and will be offered back.'); }
            return null;
        }
    }
    // A page that matched the email to an agent itself: fix the session and the account.
    function adoptName(name) {
        const s = readSession(); if (!s || !name) return;
        s.user.name = name; s.user.onAccount = true; writeSession(s);
        try { sessionStorage.setItem('uibCurrentUser', name); } catch (e) {}
        saveAgentName(s.access_token, name);
    }
    // Pages listen for this to stash an unsaved form before the reload.
    function forcedSignOut(message) {
        try { document.dispatchEvent(new CustomEvent('uib:forced-signout')); } catch (e) {}
        signOut();
        try { alert(message); } catch (e) {}
        window.location.reload();
    }

    async function ensureFresh() {
        const s = readSession();
        if (!s) return null;
        const now = Math.floor(Date.now() / 1000);
        if (s.expires_at - now < REFRESH_AHEAD_S) return refresh();
        return s.user;
    }

    function signOut() {
        const s = readSession();
        if (s && s.user && !s.pendingMfa) audit('sign_out', s.user.email);
        clearSession();
        if (s && s.access_token) {
            try {
                fetch(SUPABASE_URL + '/auth/v1/logout', { method: 'POST', headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + s.access_token } }).catch(() => {});
            } catch (e) {}
        }
    }

    async function changePassword(newPassword) {
        const s = readSession();
        if (!s) throw new Error('Not signed in.');
        const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
            method: 'PUT',
            headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: newPassword })
        });
        if (!res.ok) { let d = null; try { d = await res.json(); } catch (e) {} throw new Error((d && (d.msg || d.message)) || 'Could not change password'); }
        return true;
    }

    async function resetPasswordEmail(email) {
        await authPost('recover', { email: String(email || '').trim().toLowerCase() });
        return true;
    }

    function token() { const s = readSession(); return s ? s.access_token : null; }
    function user() { const s = readSession(); return (s && !s.pendingMfa) ? s.user : null; }
    function pendingMfa() { const s = readSession(); return s ? (s.pendingMfa || null) : null; }
    function isSignedIn() { return !!token() && !pendingMfa(); }
    function isAdmin() { const u = user(); return !!(u && u.role === 'admin'); }

    // ── Every call to the project carries the user's token ─────
    const _fetch = window.fetch;
    window.fetch = function (input, init) {
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url.indexOf(SUPABASE_URL) === 0 && url.indexOf('/auth/v1/') === -1) {
                const t = token();
                if (t) {
                    init = Object.assign({}, init || {});
                    const h = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
                    h.set('Authorization', 'Bearer ' + t);
                    if (!h.has('apikey')) h.set('apikey', SUPABASE_ANON);
                    init.headers = h;
                }
            }
        } catch (e) { /* fall through with the original request */ }
        return _fetch.call(this, input, init);
    };

    // ── Idle timeout + token refresh ───────────────────────────
    function touch() {
        const s = readSession(); if (!s) return;
        const now = Date.now();
        if (now - (s.lastActive || 0) > 15000) { s.lastActive = now; writeSession(s); }
    }
    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((ev) => document.addEventListener(ev, touch, { passive: true, capture: true }));
    setInterval(() => {
        const s = readSession(); if (!s) return;
        if (Date.now() - (s.lastActive || 0) > IDLE_MS) {
            forcedSignOut('You were signed out after 30 minutes of inactivity. Anything you were typing has been kept and will be offered back after you sign in.');
            return;
        }
        ensureFresh();
    }, 60 * 1000);
    ensureFresh();

    // Pages that need a signed-in user redirect to the Binder Book login
    // when there is no session (set data-uib-require-auth on <body>).
    document.addEventListener('DOMContentLoaded', () => {
        if (document.body && document.body.hasAttribute('data-uib-require-auth') && !isSignedIn()) {
            window.location.replace('./');
        }
    });

    window.UIBAuth = { signIn, completeSignIn, signOut, refresh, ensureFresh, changePassword, resetPasswordEmail, token, user, pendingMfa, isSignedIn, isAdmin, assuranceLevel, mfaFactors, mfaEnroll, mfaVerify, mfaUnenroll, getMfaRequired, setMfaRequired, adoptName, KNOWN_AGENTS, SUPABASE_URL, SUPABASE_ANON, TURNSTILE_SITE_KEY, MFA_REQUIRED };
})();
