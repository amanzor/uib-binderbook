// ============================================================
//  UIB AUDIT LOG + ANNUAL CONFIDENTIALITY ACKNOWLEDGMENT
//  ------------------------------------------------------------
//  Load after uib-auth.js on every page. Records who signed in, and who
//  viewed, changed, exported or deleted customer records, in the
//  append-only `audit_log` table (see supabase-compliance.sql). Agents can
//  only add rows; only administrators can read them (Access Log page).
//
//    UIBAudit.log(action, target, details)   fire-and-forget
//    UIBAudit.list({limit, action, email, since})   admins only
//    UIBAudit.requireAck()   yearly confidentiality & security acknowledgment
// ============================================================
(function () {
    'use strict';
    if (!window.UIBAuth) { console.warn('uib-audit.js: uib-auth.js must load first'); return; }
    const A = window.UIBAuth;
    const URL_ = A.SUPABASE_URL, ANON = A.SUPABASE_ANON;
    const ACK_VERSION = '2026';   // bump once a year (or when the policy changes) to re-ask everyone
    const hdr = () => ({ 'apikey': ANON, 'Authorization': 'Bearer ' + (A.token() || ANON), 'Content-Type': 'application/json' });
    const page = () => (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');

    function log(action, target, details) {
        try {
            const u = A.user(); if (!u || !A.token()) return;
            const row = { user_email: u.email || '', user_name: u.name || '', action: String(action), target: target == null ? null : String(target).slice(0, 300), details: details || null, page: page() };
            fetch(URL_ + '/rest/v1/audit_log', { method: 'POST', headers: Object.assign(hdr(), { 'Prefer': 'return=minimal' }), body: JSON.stringify(row), keepalive: true }).catch(() => {});
        } catch (e) {}
    }

    async function list(opts) {
        opts = opts || {};
        const q = ['select=id,at,user_email,user_name,action,target,details,page', 'order=at.desc', 'limit=' + (opts.limit || 500)];
        if (opts.action) q.push('action=eq.' + encodeURIComponent(opts.action));
        if (opts.email) q.push('user_email=eq.' + encodeURIComponent(opts.email));
        if (opts.since) q.push('at=gte.' + encodeURIComponent(opts.since));
        const res = await fetch(URL_ + '/rest/v1/audit_log?' + q.join('&'), { headers: hdr() });
        if (res.status === 404) throw new Error('The audit_log table does not exist yet. Run supabase-compliance.sql in the Supabase SQL Editor.');
        if (!res.ok) throw new Error('Could not load the access log (HTTP ' + res.status + ').');
        return res.json();
    }

    // ── Yearly confidentiality & security acknowledgment ───────
    async function getAcks() {
        try {
            const res = await fetch(URL_ + '/rest/v1/app_store?select=value&key=eq.complianceAcks', { headers: hdr() });
            if (!res.ok) return null;
            const rows = await res.json(); const v = rows[0] && rows[0].value;
            return (v && typeof v === 'object') ? v : {};
        } catch (e) { return null; }
    }
    async function setAck(acks, email) {
        acks[email] = { version: ACK_VERSION, date: new Date().toISOString(), name: (A.user() || {}).name || '' };
        await fetch(URL_ + '/rest/v1/app_store', { method: 'POST', headers: Object.assign(hdr(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify([{ key: 'complianceAcks', value: acks, updated_at: new Date().toISOString() }]) });
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function requireAck() {
        return new Promise(async (resolve) => {
            const u = A.user(); if (!u || !u.email) { resolve(false); return; }
            const email = String(u.email).toLowerCase();
            const acks = await getAcks();
            if (acks === null) { resolve(false); return; }            // cloud unavailable: do not block work
            const mine = acks[email];
            if (mine && mine.version === ACK_VERSION) { resolve(true); return; }
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(13,31,60,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;';
            wrap.innerHTML = '<div style="background:#fff;border-radius:18px;box-shadow:0 25px 60px rgba(0,0,0,.35);padding:28px 26px;width:100%;max-width:560px;color:#0d1f3c;max-height:92vh;overflow:auto;">' +
                '<div style="font-size:1.25rem;font-weight:800;margin-bottom:4px;">🔒 Confidentiality &amp; security acknowledgment ' + esc(ACK_VERSION) + '</div>' +
                '<p style="margin:0 0 12px;color:#4b5563;font-size:13px;">Required once a year for every Binder Book user. Hi ' + esc(u.name || u.email) + ', please read and accept before continuing.</p>' +
                '<ol style="font-size:13.5px;line-height:1.55;color:#1f2937;padding-left:20px;margin:0 0 14px;">' +
                '<li>Customer information in this system (names, addresses, dates of birth, driver license and Social Security numbers, policy and payment details, health information) is <b>nonpublic personal information</b> protected by the Gramm-Leach-Bliley Act and Florida insurance privacy rules. I will use it only to serve the customer and the agency\'s business.</li>' +
                '<li>I will not share, export, photograph, copy or send customer information to anyone outside the agency, or to any personal email, phone or cloud account, except as the customer or a carrier requires for their policy.</li>' +
                '<li>My login is personal. I will not share my password or 2-step codes, and I will sign out or lock my screen when I step away.</li>' +
                '<li>I will report a lost device, a suspicious email or message, an unknown sign-in, or any possible exposure of customer data to the agency administrator <b>the same day</b>.</li>' +
                '<li>I understand that my sign-ins and the records I view, change, export or delete are logged, and that misuse may lead to loss of access and disciplinary or legal action.</li>' +
                '</ol>' +
                '<label style="display:flex;gap:10px;align-items:flex-start;font-size:13.5px;margin-bottom:16px;cursor:pointer;"><input type="checkbox" id="uibAckBox" style="margin-top:3px;width:18px;height:18px;"> I have read and agree to the above, and I have completed the agency\'s privacy and security training for ' + esc(ACK_VERSION) + '.</label>' +
                '<div style="display:flex;gap:10px;"><button type="button" id="uibAckNo" style="padding:11px 16px;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;background:#e5e7eb;color:#374151;flex:1;">Sign out</button>' +
                '<button type="button" id="uibAckOk" disabled style="padding:11px 16px;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;background:linear-gradient(135deg,#1d4ed8,#1e40af);color:#fff;flex:2;opacity:.5;">I agree</button></div></div>';
            document.body.appendChild(wrap);
            const box = wrap.querySelector('#uibAckBox'), ok = wrap.querySelector('#uibAckOk');
            box.addEventListener('change', () => { ok.disabled = !box.checked; ok.style.opacity = box.checked ? '1' : '.5'; });
            ok.addEventListener('click', async () => {
                ok.disabled = true; ok.textContent = 'Saving…';
                try { await setAck(acks, email); log('training_ack', email, { version: ACK_VERSION }); } catch (e) {}
                wrap.remove(); resolve(true);
            });
            wrap.querySelector('#uibAckNo').addEventListener('click', () => { wrap.remove(); A.signOut(); location.reload(); });
        });
    }

    window.UIBAudit = { log, list, requireAck, getAcks, ACK_VERSION };
})();
