// ============================================================
//  UIB MFA + HUMAN VERIFICATION  —  shared sign-in flow
//  ------------------------------------------------------------
//  Load after uib-auth.js on every page with a login form.
//
//  UIBMfa.signIn(email, password) does the whole thing:
//    1. human verification (Cloudflare Turnstile) when a site key is set
//    2. email + password through Supabase Auth
//    3. 2-step verification: 6-digit authenticator code, or first-time
//       enrollment (QR code) when the account has no authenticator yet
//  and resolves with the signed-in user. Pages only decide where to go.
//
//  UIBMfa.mountCaptcha(form)  renders the Turnstile widget inside a login
//  form (call once per form, safe to call again).
//  UIBMfa.manage()            lets a signed-in user reset their authenticator.
// ============================================================
(function () {
    'use strict';
    if (!window.UIBAuth) { console.warn('uib-mfa.js: uib-auth.js must load first'); return; }
    const A = window.UIBAuth;
    const SITE_KEY = A.TURNSTILE_SITE_KEY || '';
    const widgets = new Map();   // form element -> turnstile widget id

    // ── Human verification (Turnstile) ────────────────────────
    let turnstileLoading = null;
    function loadTurnstile() {
        if (!SITE_KEY) return Promise.resolve(null);
        if (window.turnstile) return Promise.resolve(window.turnstile);
        if (turnstileLoading) return turnstileLoading;
        turnstileLoading = new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            s.async = true; s.defer = true;
            s.onload = () => resolve(window.turnstile || null);
            s.onerror = () => resolve(null);
            document.head.appendChild(s);
        });
        return turnstileLoading;
    }
    async function mountCaptcha(form) {
        if (!SITE_KEY || !form) return;
        const ts = await loadTurnstile(); if (!ts) return;
        if (widgets.has(form)) { try { ts.reset(widgets.get(form)); } catch (e) {} return; }
        let box = form.querySelector('.uib-captcha');
        if (!box) {
            box = document.createElement('div'); box.className = 'uib-captcha'; box.style.cssText = 'margin:0 0 14px;display:flex;justify-content:center;';
            const submit = form.querySelector('button[type="submit"], .btn-primary');
            if (submit && submit.parentNode === form) form.insertBefore(box, submit); else form.appendChild(box);
        }
        const id = ts.render(box, { sitekey: SITE_KEY, theme: 'light' });
        widgets.set(form, id);
    }
    function captchaToken(form) {
        if (!SITE_KEY) return '';
        const ts = window.turnstile; const id = form && widgets.get(form);
        if (!ts || id == null) return '';
        try { return ts.getResponse(id) || ''; } catch (e) { return ''; }
    }
    function captchaReset(form) {
        const ts = window.turnstile; const id = form && widgets.get(form);
        if (ts && id != null) { try { ts.reset(id); } catch (e) {} }
    }

    // ── Small modal helper ─────────────────────────────────────
    function modal(html) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(13,31,60,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;';
        wrap.innerHTML = '<div style="background:#fff;border-radius:18px;box-shadow:0 25px 60px rgba(0,0,0,.35);padding:28px 26px;width:100%;max-width:440px;color:#0d1f3c;">' + html + '</div>';
        document.body.appendChild(wrap);
        return wrap;
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const btnCss = 'padding:11px 16px;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;';
    const inputCss = 'width:100%;padding:12px 14px;border:1.5px solid #d1d5db;border-radius:10px;font-size:22px;letter-spacing:.35em;text-align:center;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;';

    // ── Step 2: ask for the 6-digit code ───────────────────────
    function promptCode(factorId, opts) {
        opts = opts || {};
        return new Promise((resolve, reject) => {
            const w = modal(
                '<div style="font-size:1.25rem;font-weight:800;margin-bottom:6px;">🔐 2-step verification</div>' +
                '<p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.5;">' + esc(opts.message || 'Open your authenticator app and enter the 6-digit code for UIB Binder Book.') + '</p>' +
                '<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" id="uibMfaCode" style="' + inputCss + '">' +
                '<div id="uibMfaErr" style="display:none;margin-top:10px;background:#fef2f2;color:#991b1b;padding:9px 12px;border-radius:8px;font-size:13px;font-weight:600;"></div>' +
                '<div style="display:flex;gap:10px;margin-top:18px;">' +
                '<button type="button" id="uibMfaCancel" style="' + btnCss + 'background:#e5e7eb;color:#374151;flex:1;">Cancel</button>' +
                '<button type="button" id="uibMfaOk" style="' + btnCss + 'background:linear-gradient(135deg,#1d4ed8,#1e40af);color:#fff;flex:2;">Verify</button></div>'
            );
            const inp = w.querySelector('#uibMfaCode'); const err = w.querySelector('#uibMfaErr'); const ok = w.querySelector('#uibMfaOk');
            const fail = (m) => { err.textContent = m; err.style.display = 'block'; inp.value = ''; inp.focus(); ok.disabled = false; ok.textContent = 'Verify'; };
            const go = async () => {
                const code = inp.value.replace(/\D/g, '');
                if (code.length !== 6) { fail('Enter the 6 digits from your authenticator app.'); return; }
                ok.disabled = true; ok.textContent = 'Checking…';
                try { const u = await A.mfaVerify(factorId, code); w.remove(); resolve(u); }
                catch (e) { fail(/invalid|expired|code/i.test(String(e.message)) ? 'That code is not valid. Codes change every 30 seconds — try the current one.' : (e.message || 'Could not verify.')); }
            };
            ok.addEventListener('click', go);
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
            w.querySelector('#uibMfaCancel').addEventListener('click', () => { w.remove(); A.signOut(); reject(new Error('Sign-in cancelled.')); });
            setTimeout(() => inp.focus(), 50);
        });
    }

    // ── First time: enroll an authenticator (QR code) ──────────
    function enroll(opts) {
        opts = opts || {};
        return new Promise(async (resolve, reject) => {
            let f;
            try { f = await A.mfaEnroll(); }
            catch (e) { reject(new Error('Could not start 2-step setup: ' + (e.message || e))); return; }
            const qr = f && f.totp && f.totp.qr_code; const secret = f && f.totp && f.totp.secret;
            const w = modal(
                '<div style="font-size:1.25rem;font-weight:800;margin-bottom:6px;">🔐 Set up 2-step verification</div>' +
                '<p style="margin:0 0 14px;color:#4b5563;font-size:14px;line-height:1.5;">' + esc(opts.message || 'Every sign-in needs a code from an authenticator app. Install Google Authenticator, Microsoft Authenticator or Authy on your phone, scan this code, then enter the 6 digits it shows.') + '</p>' +
                (qr ? '<div style="text-align:center;margin:0 0 10px;"><img src="' + esc(qr) + '" alt="QR code" style="width:200px;height:200px;border:1px solid #e5e7eb;border-radius:12px;padding:6px;background:#fff;"></div>' : '') +
                (secret ? '<div style="font-size:12px;color:#6b7280;text-align:center;margin-bottom:14px;">Can\'t scan? Enter this key by hand:<br><code style="font-size:13px;user-select:all;">' + esc(secret) + '</code></div>' : '') +
                '<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" id="uibMfaCode" style="' + inputCss + '">' +
                '<div id="uibMfaErr" style="display:none;margin-top:10px;background:#fef2f2;color:#991b1b;padding:9px 12px;border-radius:8px;font-size:13px;font-weight:600;"></div>' +
                '<div style="display:flex;gap:10px;margin-top:18px;">' +
                '<button type="button" id="uibMfaCancel" style="' + btnCss + 'background:#e5e7eb;color:#374151;flex:1;">Cancel</button>' +
                '<button type="button" id="uibMfaOk" style="' + btnCss + 'background:linear-gradient(135deg,#047857,#10b981);color:#fff;flex:2;">Activate</button></div>'
            );
            const inp = w.querySelector('#uibMfaCode'); const err = w.querySelector('#uibMfaErr'); const ok = w.querySelector('#uibMfaOk');
            const fail = (m) => { err.textContent = m; err.style.display = 'block'; inp.value = ''; inp.focus(); ok.disabled = false; ok.textContent = 'Activate'; };
            const go = async () => {
                const code = inp.value.replace(/\D/g, '');
                if (code.length !== 6) { fail('Enter the 6 digits shown in the app.'); return; }
                ok.disabled = true; ok.textContent = 'Checking…';
                try { const u = await A.mfaVerify(f.id, code); w.remove(); resolve(u); }
                catch (e) { fail(/invalid|expired|code/i.test(String(e.message)) ? 'That code did not match. Wait for the next code and try again.' : (e.message || 'Could not activate.')); }
            };
            ok.addEventListener('click', go);
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
            w.querySelector('#uibMfaCancel').addEventListener('click', async () => { try { await A.mfaUnenroll(f.id); } catch (e) {} w.remove(); if (opts.optional) resolve(null); else { A.signOut(); reject(new Error('2-step verification is required to sign in.')); } });
            setTimeout(() => inp.focus(), 50);
        });
    }

    // ── The whole sign-in, start to finish ─────────────────────
    async function signIn(email, password, form) {
        if (SITE_KEY) {
            const tokn = captchaToken(form);
            if (!tokn) throw new Error('Please complete the "I am human" check first.');
            try { return await finish(await A.signIn(email, password, { captchaToken: tokn })); }
            finally { captchaReset(form); }
        }
        return finish(await A.signIn(email, password));
    }
    async function finish(result) {
        if (result && result.mfaRequired) { await promptCode(result.factorId); return A.completeSignIn(); }
        if (result && result.enrollRequired) { await enroll(); return A.completeSignIn(); }
        return result;
    }

    // ── Signed-in user manages their authenticator ─────────────
    async function manage() {
        if (!A.isSignedIn()) { alert('Sign in first.'); return; }
        let factors = [];
        try { factors = await A.mfaFactors(); } catch (e) {}
        const verified = factors.filter((f) => f.status === 'verified');
        if (!verified.length) {
            if (confirm('No authenticator is set up on this account yet. Set one up now?')) { try { await enroll({ optional: true }); alert('2-step verification is active.'); } catch (e) { alert(e.message || e); } }
            return;
        }
        if (!confirm('Replace the authenticator on this account? You will scan a new QR code, and the old one stops working.')) return;
        try {
            await enroll({ optional: true, message: 'Scan the new code with your authenticator app and enter the 6 digits to confirm.' });
            for (const f of verified) { try { await A.mfaUnenroll(f.id); } catch (e) {} }
            alert('Authenticator replaced.');
        } catch (e) { alert(e.message || e); }
    }

    // Render the captcha on any login form that opts in.
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-uib-login]').forEach((f) => mountCaptcha(f));
    });

    window.UIBMfa = { signIn, mountCaptcha, captchaToken, promptCode, enroll, manage };
})();
