// ============================================================
//  MAX by UIB — consumer lead app
//  ------------------------------------------------------------
//  A guided, no-login flow for prospects: name → phone → email →
//  driver's license photo → VIN photo → current insurance →
//  consent → submit. MAX (Claude Haiku 4.5, through the Supabase
//  "claude" proxy) reads the photos; the lead is emailed to the
//  office through the "inquiry" function (Resend), which also logs
//  it to the max_leads table when that table exists.
//
//  The page is a PWA and is also what the App Store / Play Store
//  wrappers in native/ load, so one deploy updates every channel.
// ============================================================
(function () {
    'use strict';

    const SUPABASE_URL  = 'https://jgjmobktucyimupelfxd.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1vYmt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ';
    const CLAUDE_FN  = SUPABASE_URL + '/functions/v1/claude';
    const INQUIRY_FN = SUPABASE_URL + '/functions/v1/inquiry';
    const MODEL      = 'claude-haiku-4-5';
    const INQUIRY_TO = 'quotes@universalinsurancebroker.com';
    const HEADERS    = { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' };

    const STEPS = ['name', 'phone', 'email', 'dl', 'vin', 'insurance', 'submit'];
    let step = 0;
    let lead = blank();
    let busy = false;
    let pendingKind = 'dl';

    function blank() { return { name: '', phone: '', email: '', dl: null, dlPhoto: null, vin: '', vehicle: null, vinPhoto: null, currentInsurer: '', consent: false, startedAt: new Date().toISOString() }; }

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ── chat helpers ─────────────────────────────────────────────
    function msg(role, html, photoUrl) {
        const d = document.createElement('div'); d.className = 'msg ' + role;
        d.innerHTML = (photoUrl ? '<img class="ph" src="' + photoUrl + '" alt="">' : '') + html;
        $('log').appendChild(d); scrollDown(); return d;
    }
    function scrollDown() { requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })); }
    function typing(on) {
        let t = $('typing');
        if (on && !t) { t = document.createElement('div'); t.id = 'typing'; t.className = 'typing'; t.innerHTML = '<i></i><i></i><i></i> MAX is reading'; $('log').appendChild(t); scrollDown(); }
        if (!on && t) t.remove();
        $('bot').classList.toggle('thinking', !!on);
    }
    async function say(html, photoUrl) { typing(true); await sleep(350); typing(false); return msg('bot', html, photoUrl); }
    function progress() { $('steps').innerHTML = STEPS.map((_, i) => '<i class="' + (i <= step ? 'on' : '') + '"></i>').join(''); }
    function compose(html) { $('composer').innerHTML = html; const inp = $('composer').querySelector('input[type=text],input[type=tel],input[type=email]'); if (inp) setTimeout(() => inp.focus(), 50); scrollDown(); }
    function onEnter(e, fn) { if (e.key === 'Enter') { e.preventDefault(); fn(); } }

    // ── steps ────────────────────────────────────────────────────
    async function start() {
        $('log').innerHTML = ''; step = 0; progress();
        await say("Hi! I'm MAX from Universal Insurance Brokers. I'll grab a few details and a licensed agent will call you with your best car insurance rates. First, what's your name?");
        askName();
    }
    function askName() {
        compose('<div class="row"><input type="text" id="in" placeholder="First and last name" autocomplete="name" value="' + esc(lead.name) + '" onkeydown="MaxLead.enter(event, MaxLead.saveName)"><button class="b pri" onclick="MaxLead.saveName()">Next</button></div>');
    }
    async function saveName() {
        const v = ($('in').value || '').trim(); if (v.length < 2) { $('in').focus(); return; }
        lead.name = v; msg('user', esc(v)); step = 1; progress();
        await say('Nice to meet you, ' + esc(v.split(' ')[0]) + '! What\'s the best phone number to reach you?');
        compose('<div class="row"><input type="tel" id="in" inputmode="tel" placeholder="(305) 555-1234" autocomplete="tel" maxlength="14" oninput="this.value=MaxLead.fmtPhone(this.value)" onkeydown="MaxLead.enter(event, MaxLead.savePhone)"><button class="b pri" onclick="MaxLead.savePhone()">Next</button></div>');
    }
    function fmtPhone(v) { const d = String(v || '').replace(/\D/g, '').slice(0, 10); if (d.length < 4) return d; if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3); return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6); }
    async function savePhone() {
        const v = fmtPhone($('in').value); if (v.replace(/\D/g, '').length !== 10) { msg('bot err', 'Please enter a 10-digit phone number.'); $('in').focus(); return; }
        lead.phone = v; msg('user', esc(v)); step = 2; progress();
        await say('Thanks. And your email address? We\'ll send your quote there too.');
        compose('<div class="row"><input type="email" id="in" inputmode="email" placeholder="name@example.com" autocomplete="email" onkeydown="MaxLead.enter(event, MaxLead.saveEmail)"><button class="b pri" onclick="MaxLead.saveEmail()">Next</button></div>');
    }
    async function saveEmail() {
        const v = ($('in').value || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { msg('bot err', 'That email doesn\'t look right. Please check it.'); $('in').focus(); return; }
        lead.email = v; msg('user', esc(v)); step = 3; progress();
        await say('Now take a photo of your <b>driver\'s license</b> (front). Hold it flat, fill the frame, and avoid glare. I only use it to prepare your quote.');
        composeDL();
    }
    function composeDL() {
        compose('<button class="b pri big" onclick="MaxLead.pick(\'dl\')">📷 Take a photo of my license</button><div class="chips" style="margin-top:8px;"><button class="b sec" onclick="MaxLead.typeDL()">Type it instead</button></div>');
    }
    function typeDL() {
        compose('<div class="row" style="flex-wrap:wrap;"><input type="text" id="dob" placeholder="Date of birth (MM/DD/YYYY)" inputmode="numeric" style="flex:1 1 100%;"><input type="text" id="dln" placeholder="License number (optional)" style="flex:1 1 100%;"><button class="b pri" style="flex:1" onclick="MaxLead.saveTypedDL()">Next</button></div>');
    }
    async function saveTypedDL() {
        const dob = ($('dob').value || '').trim(); const dln = ($('dln').value || '').trim();
        const m = dob.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); if (!m) { msg('bot err', 'Please type the date of birth as MM/DD/YYYY.'); return; }
        const parts = lead.name.split(' ');
        lead.dl = { firstName: parts[0] || '', lastName: parts.slice(1).join(' '), dob: m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'), dlNumber: dln.toUpperCase(), dlState: 'FL' };
        msg('user', 'DOB ' + esc(dob) + (dln ? ', DL ' + esc(dln) : ''));
        await afterDL();
    }
    async function afterDL() {
        step = 4; progress();
        await say('Great. Now a photo of your car\'s <b>VIN</b> — it\'s on the driver\'s door sticker, the dashboard by the windshield, or your registration or insurance card.');
        composeVIN();
    }
    function composeVIN() {
        compose('<button class="b pur big" onclick="MaxLead.pick(\'vin\')">📷 Take a photo of my VIN</button><div class="chips" style="margin-top:8px;"><button class="b sec" onclick="MaxLead.typeVIN()">Type the VIN</button><button class="b sec" onclick="MaxLead.skipVIN()">Skip for now</button></div>');
    }
    function typeVIN() {
        compose('<div class="row"><input type="text" id="in" placeholder="17-character VIN" maxlength="17" style="text-transform:uppercase;letter-spacing:1px;" onkeydown="MaxLead.enter(event, MaxLead.saveTypedVIN)"><button class="b pri" onclick="MaxLead.saveTypedVIN()">Next</button></div>');
    }
    async function saveTypedVIN() {
        const v = ($('in').value || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
        if (v.length !== 17) { msg('bot err', 'A VIN has exactly 17 letters and numbers (no I, O or Q).'); return; }
        msg('user', esc(v)); await useVIN(v);
    }
    async function skipVIN() { msg('user', 'Skip for now'); lead.vin = ''; lead.vehicle = null; await afterVIN(); }
    async function useVIN(vin) {
        lead.vin = vin; typing(true);
        try {
            const r = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin) + '?format=json');
            const j = await r.json(); const d = j.Results && j.Results[0];
            if (d && d.Make) lead.vehicle = { year: d.ModelYear, make: titleCase(d.Make), model: d.Model, trim: [d.Trim, d.BodyClass].filter(Boolean).join(' / ') };
        } catch (e) { /* offline: keep just the VIN */ }
        typing(false);
        if (lead.vehicle) await say('Got it — a <b>' + esc([lead.vehicle.year, lead.vehicle.make, lead.vehicle.model].filter(Boolean).join(' ')) + '</b>.');
        else await say('Got the VIN ' + esc(vin) + '.');
        await afterVIN();
    }
    function titleCase(s) { return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
    async function afterVIN() {
        step = 5; progress();
        await say('Do you currently have car insurance?');
        compose('<div class="chips"><button class="b pri" onclick="MaxLead.insured(true)">Yes</button><button class="b sec" onclick="MaxLead.insured(false)">No</button></div>');
    }
    async function insured(yes) {
        msg('user', yes ? 'Yes' : 'No');
        if (!yes) { lead.currentInsurer = 'None'; return review(); }
        await say('Who is your current insurance company?');
        compose('<div class="row"><input type="text" id="in" placeholder="e.g. Progressive, GEICO…" onkeydown="MaxLead.enter(event, MaxLead.saveInsurer)"><button class="b pri" onclick="MaxLead.saveInsurer()">Next</button></div>');
    }
    async function saveInsurer() { const v = ($('in').value || '').trim(); lead.currentInsurer = v || 'Unknown'; msg('user', esc(lead.currentInsurer)); review(); }

    async function review() {
        step = 6; progress();
        const d = lead.dl || {}; const v = lead.vehicle || {};
        const card = '<div class="card">' +
            '<div><b>Name:</b> ' + esc(lead.name) + '</div><div><b>Phone:</b> ' + esc(lead.phone) + ' · <b>Email:</b> ' + esc(lead.email) + '</div>' +
            (lead.dl ? '<div><b>License:</b> ' + esc([d.firstName, d.lastName].filter(Boolean).join(' ')) + (d.dob ? ', DOB ' + esc(d.dob) : '') + (d.dlNumber ? ', ' + esc(d.dlNumber) : '') + '</div>' : '') +
            (lead.vin ? '<div><b>Vehicle:</b> ' + esc([v.year, v.make, v.model].filter(Boolean).join(' ') || 'VIN') + ' (' + esc(lead.vin) + ')</div>' : '') +
            '<div><b>Current insurance:</b> ' + esc(lead.currentInsurer || '—') + '</div></div>';
        await say('Here\'s what I have. Ready to send it to an agent?' + card);
        compose('<label class="consent"><input type="checkbox" id="consent"> I agree that Universal Insurance Brokers may contact me by phone, text or email about this quote, and I accept the <a href="privacy.html" target="_blank">privacy policy</a>.</label>' +
            '<button class="b ok big" id="sendBtn" onclick="MaxLead.submit()">Send my quote request</button>');
    }

    // ── photos → MAX reads them ──────────────────────────────────
    function pick(kind) { pendingKind = kind; const f = $('file'); f.value = ''; f.click(); }
    async function fileChosen(input) {
        const file = input.files && input.files[0]; if (!file || busy) return;
        busy = true;
        let im;
        try { im = await prepare(file); } catch (e) { busy = false; msg('bot err', 'I could not open that photo. Please try again with the camera.'); return; }
        const kind = pendingKind;
        msg('user', kind === 'dl' ? 'My license' : 'My VIN', im.url);
        typing(true);
        try {
            const data = await extract(im, kind);
            typing(false);
            if (kind === 'dl') {
                if (!data || !(data.firstName || data.lastName || data.dob || data.dlNumber)) { await say('I couldn\'t read that clearly. Try again with more light, no glare, and the card filling the frame.'); composeDL(); busy = false; return; }
                lead.dl = data; lead.dlPhoto = im;
                if (data.address) lead.address = data.address;
                await say('I read: <b>' + esc([data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ')) + '</b>' + (data.dob ? ', born ' + esc(data.dob) : '') + (data.dlNumber ? ', license ' + esc(data.dlNumber) : '') + '. Is that right?');
                compose('<div class="chips"><button class="b ok" onclick="MaxLead.confirmDL(true)">Yes, correct</button><button class="b sec" onclick="MaxLead.confirmDL(false)">Retake photo</button></div>');
            } else {
                const vin = String((data && data.vin) || '').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
                if (vin.length !== 17) { await say('I couldn\'t make out a full 17-character VIN. Try a closer, straight-on photo, or type it.'); composeVIN(); busy = false; return; }
                lead.vinPhoto = im; await useVIN(vin);
            }
        } catch (e) {
            typing(false);
            await say('Sorry, I had trouble reading that (' + esc(e.message) + '). You can try again or type the details.');
            if (kind === 'dl') composeDL(); else composeVIN();
        }
        busy = false;
    }
    async function confirmDL(ok) {
        msg('user', ok ? 'Yes, correct' : 'Retake');
        if (!ok) { lead.dl = null; lead.dlPhoto = null; composeDL(); return; }
        await afterDL();
    }

    async function loadBitmap(file) {
        if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back */ } }
        return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); }; img.src = url; });
    }
    async function prepare(file) {
        const bmp = await loadBitmap(file);
        const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
        const scale = Math.min(1, 2000 / Math.max(w, h));
        const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * scale)); cv.height = Math.max(1, Math.round(h * scale));
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
        if (bmp.close) bmp.close();
        const url = cv.toDataURL('image/jpeg', 0.9);
        return { url, b64: url.split(',')[1], media: 'image/jpeg' };
    }
    async function extract(im, kind) {
        const system = 'You are MAX, an assistant inside Universal Insurance Brokers\' quote app. The customer is sharing their own ' + (kind === 'dl' ? "driver's license" : 'vehicle VIN') + ' photo so an agent can prepare their car insurance quote; reading it is expected. Transcribe what you can read even if the photo is rotated, tilted or glary; leave out fields you cannot read. Answer with ONLY a JSON object, no prose. ' +
            (kind === 'dl' ? 'Keys: firstName, middleName, lastName, dob (YYYY-MM-DD), gender (Male/Female), dlNumber, dlState (2 letters), address (one line), expiration (YYYY-MM-DD).' : 'Keys: vin (17 characters, letters I, O and Q never occur), plate (if visible).') +
            ' If nothing is legible answer {}.';
        const res = await fetch(CLAUDE_FN, { method: 'POST', headers: HEADERS, body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: im.media, data: im.b64 } }, { type: 'text', text: 'Read this ' + (kind === 'dl' ? 'license' : 'VIN') + '.' }] }] }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error((j.error && (j.error.message || j.error.type)) || ('HTTP ' + res.status));
        const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
        try { return JSON.parse(m[0]); } catch (e) { return null; }
    }

    // ── submit ───────────────────────────────────────────────────
    function leadText() {
        const d = lead.dl || {}; const v = lead.vehicle || {};
        return ['NEW LEAD — MAX app', 'Received: ' + new Date().toLocaleString('en-US'), '',
            'Name: ' + lead.name, 'Phone: ' + lead.phone, 'Email: ' + lead.email, '',
            'DRIVER\'S LICENSE', '  Name on license: ' + ([d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ') || '—'), '  DOB: ' + (d.dob || '—') + '   Sex: ' + (d.gender || '—'), '  DL #: ' + (d.dlNumber || '—') + '   State: ' + (d.dlState || '—') + '   Exp: ' + (d.expiration || '—'), '  Address: ' + (d.address || lead.address || '—'), '',
            'VEHICLE', '  VIN: ' + (lead.vin || '— (skipped)'), '  ' + ([v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || ''), '',
            'Current insurance: ' + (lead.currentInsurer || '—'), 'Consent to contact: yes', '',
            (lead.dlPhoto ? 'License photo attached. ' : '') + (lead.vinPhoto ? 'VIN photo attached.' : '')].join('\n');
    }
    async function submit() {
        if (!$('consent').checked) { msg('bot err', 'Please tick the consent box so we can contact you.'); return; }
        const btn = $('sendBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Sending…';
        const text = leadText(); const subject = 'New Lead (MAX app) – ' + lead.name;
        const attachments = []; if (lead.dlPhoto) attachments.push({ filename: 'drivers-license.jpg', content: lead.dlPhoto.b64 }); if (lead.vinPhoto) attachments.push({ filename: 'vin.jpg', content: lead.vinPhoto.b64 });
        try {
            const res = await fetch(INQUIRY_FN, { method: 'POST', headers: HEADERS, body: JSON.stringify({ subject, text, html: '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;">' + esc(text) + '</pre>', replyTo: lead.email, attachments, source: 'max-app',
                lead: { name: lead.name, phone: lead.phone, email: lead.email, dl: lead.dl, vin: lead.vin, vehicle: lead.vehicle, current_insurer: lead.currentInsurer, address: (lead.dl && lead.dl.address) || lead.address || '' } }) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
            done();
        } catch (e) {
            // Fallback: the prospect's own mail app, prefilled (photos cannot be attached this way).
            const mailto = 'mailto:' + INQUIRY_TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text.slice(0, 1800));
            btn.disabled = false; btn.innerHTML = 'Send my quote request';
            msg('bot err', 'I couldn\'t send that automatically. <a href="' + mailto + '">Tap here to send it by email</a> and we\'ll take it from there.');
        }
    }
    function done() {
        compose('');
        $('log').innerHTML += '<div class="done"><div class="big-check">✓</div><h2>Thanks, ' + esc(lead.name.split(' ')[0]) + '!</h2><p>Your details are on their way to Universal Insurance Brokers. A licensed agent will call you at <b>' + esc(lead.phone) + '</b> shortly with your best rates.</p><p style="margin-top:14px;"><button class="b sec" onclick="MaxLead.restart()">Start another quote</button></p></div>';
        scrollDown();
        try { localStorage.removeItem('maxLeadDraft'); } catch (e) {}
    }
    function restart() { if (step > 0 && !confirm('Start over?')) return; lead = blank(); start(); }

    // ── Auto dealer sign-up ──────────────────────────────────────
    // A dealership salesperson registers so the office can set them up as a
    // referral partner. Sent to the office like a lead (source 'dealer-signup').
    function dealerSignup() {
        $('log').innerHTML = ''; $('steps').innerHTML = ''; compose('');
        $('log').innerHTML = '<div class="form" id="dealerForm">' +
            '<h2>🤝 Auto Dealer Sign Up</h2><p>Partner with Universal Insurance Brokers. Tell us who you are and an agent will reach out to set you up.</p>' +
            '<div><label>Full name</label><input type="text" id="d_name" autocomplete="name" placeholder="First and last name"></div>' +
            '<div><label>Dealership</label><input type="text" id="d_dealer" autocomplete="organization" placeholder="Dealership name"></div>' +
            '<div><label>Address</label><input type="text" id="d_address" autocomplete="street-address" placeholder="Street, city, state, zip"></div>' +
            '<div><label>Phone number</label><input type="tel" id="d_phone" inputmode="tel" autocomplete="tel" placeholder="(305) 555-1234" maxlength="14" oninput="this.value=MaxLead.fmtPhone(this.value)"></div>' +
            '<div><label>Email</label><input type="email" id="d_email" inputmode="email" autocomplete="email" placeholder="name@dealership.com"></div>' +
            '<div class="err" id="d_err" style="display:none;"></div>' +
            '<button class="b ok big" id="d_send" onclick="MaxLead.submitDealer()">Sign up</button>' +
            '<button class="b sec big" onclick="MaxLead.restart()">Back to quote</button></div>';
        step = 0; window.scrollTo({ top: 0 }); setTimeout(() => $('d_name').focus(), 50);
    }
    async function submitDealer() {
        const v = (id) => ($(id).value || '').trim();
        const d = { name: v('d_name'), dealership: v('d_dealer'), address: v('d_address'), phone: fmtPhone(v('d_phone')), email: v('d_email') };
        const err = $('d_err');
        const problem = d.name.length < 2 ? 'Please enter your full name.' : d.address.length < 5 ? 'Please enter your address.' : d.phone.replace(/\D/g, '').length !== 10 ? 'Please enter a 10-digit phone number.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? 'Please enter a valid email.' : '';
        if (problem) { err.textContent = problem; err.style.display = ''; return; }
        err.style.display = 'none';
        const btn = $('d_send'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Sending…';
        const subject = 'New Dealer Sign-up – ' + d.name + (d.dealership ? ' (' + d.dealership + ')' : '');
        const text = ['NEW AUTO DEALER SIGN-UP — MAX app', 'Received: ' + new Date().toLocaleString('en-US'), '', 'Name: ' + d.name, 'Dealership: ' + (d.dealership || '—'), 'Address: ' + d.address, 'Phone: ' + d.phone, 'Email: ' + d.email].join('\n');
        try {
            const res = await fetch(INQUIRY_FN, { method: 'POST', headers: HEADERS, body: JSON.stringify({ subject, text, html: '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;">' + esc(text) + '</pre>', replyTo: d.email, source: 'dealer-signup', lead: Object.assign({ type: 'dealer' }, d) }) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
            $('log').innerHTML = '<div class="done"><div class="big-check">✓</div><h2>Thanks, ' + esc(d.name.split(' ')[0]) + '!</h2><p>Your sign-up is on its way to Universal Insurance Brokers. An agent will contact you at <b>' + esc(d.phone) + '</b> to get you set up.</p><p style="margin-top:14px;"><button class="b sec" onclick="MaxLead.restart()">Back to quote</button></p></div>';
            window.scrollTo({ top: 0 });
        } catch (e) {
            const mailto = 'mailto:' + INQUIRY_TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);
            btn.disabled = false; btn.innerHTML = 'Sign up';
            err.innerHTML = 'We couldn\'t send that automatically. <a href="' + mailto + '">Tap here to send it by email</a>.'; err.style.display = '';
        }
    }

    // ── boot ─────────────────────────────────────────────────────
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    document.addEventListener('DOMContentLoaded', start);

    window.MaxLead = { enter: onEnter, saveName, savePhone, saveEmail, fmtPhone, pick, fileChosen, confirmDL, typeDL, saveTypedDL, typeVIN, saveTypedVIN, skipVIN, insured, saveInsurer, submit, restart, dealerSignup, submitDealer, get lead() { return lead; } };
})();
