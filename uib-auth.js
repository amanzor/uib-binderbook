// ============================================================
//  UIB AUTH  —  Supabase Auth sessions for every page
//  ------------------------------------------------------------
//  Load this BEFORE app.js / ams.js / rater.js / supabase.js.
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
        const name = meta.agent_name || meta.full_name || meta.name || nameFromRoster(email) || '';
        const role = app.role === 'admin' || meta.role === 'admin' ? 'admin' : 'agent';
        return { id: user && user.id, email: email, name: name, role: role };
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
    async function signIn(email, password) {
        const tok = await authPost('token?grant_type=password', { email: String(email || '').trim().toLowerCase(), password: password });
        const user = storeTokens(tok);
        if (!user.name && user.role !== 'admin') { clearSession(); throw new Error('This account is not linked to an agent. An admin must set agent_name on it in Supabase (Authentication ▸ Users ▸ User Metadata) or add this email to the agent in Agent Management.'); }
        if (!user.name) user.name = 'Admin';
        try { sessionStorage.setItem('uibCurrentUser', user.role === 'admin' ? 'Admin' : user.name); } catch (e) {}
        return user;
    }

    async function refresh() {
        const s = readSession();
        if (!s || !s.refresh_token) return null;
        try {
            const tok = await authPost('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
            return storeTokens(tok);
        } catch (e) {
            if (e.status === 400 || e.status === 401) { signOut(); }
            return null;
        }
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
    function user() { const s = readSession(); return s ? s.user : null; }
    function isSignedIn() { return !!token(); }
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
            signOut();
            try { alert('You were signed out after 30 minutes of inactivity.'); } catch (e) {}
            window.location.reload();
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

    window.UIBAuth = { signIn, signOut, refresh, ensureFresh, changePassword, resetPasswordEmail, token, user, isSignedIn, isAdmin, SUPABASE_URL, SUPABASE_ANON };
})();
