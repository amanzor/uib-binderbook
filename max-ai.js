// ============================================================
//  MAX AI — local document reader for the AMS (Ollama)
//  ------------------------------------------------------------
//  A chat box that talks to an Ollama server (default the user's own
//  computer, http://localhost:11434) running a vision model (default
//  qwen3.5:4b). Drop a screenshot or PDF while a client is open: Max
//  reads it, and shows the changes it would make to that client's
//  contact info and policies. Nothing is saved until you tick what you
//  want and press Apply.
//
//  Ollama must allow the AMS sites to call it. On the computer running
//  Ollama, set the environment variable
//      OLLAMA_ORIGINS=https://uib-ams.vercel.app,https://uib-binderbook.vercel.app
//  and restart Ollama.
// ============================================================
(function () {
    'use strict';
    if (window.MaxAI) return;

    const CFG_KEY = 'maxAiConfig';
    const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function cfg() {
        let c = {};
        try { c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) {}
        return { url: (c.url || 'http://localhost:11434').replace(/\/+$/, ''), model: c.model || 'qwen3.5:4b' };
    }
    function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }

    // Contact fields Max may fill, with labels for the review table.
    const FIELDS = [
        ['companyName', 'Company name'], ['dba', 'DBA'], ['fein', 'FEIN'], ['entityType', 'Entity type'], ['bizDesc', 'Nature of business'],
        ['firstName', 'First name'], ['lastName', 'Last name'],
        ['contactFirst', 'Contact first name'], ['contactLast', 'Contact last name'], ['contactTitle', 'Contact title'],
        ['dob', 'Date of birth'], ['phone1', 'Phone'], ['phone2', 'Phone 2'], ['email', 'Email'],
        ['address', 'Street address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'],
        ['dlNum', "Driver's license #"], ['dlState', 'DL state'], ['dlExp', 'DL expiration']
    ];
    const POL_FIELDS = [['company', 'Carrier'], ['lineOfBusiness', 'Line of business'], ['effectiveDate', 'Effective'], ['expirationDate', 'Expiration'], ['totalPremium', 'Premium']];

    const SYSTEM = `You read insurance documents and screenshots (dec pages, ID cards, applications, carrier portal screens, renewal notices) for an insurance agency.
Return ONLY a JSON object, no other text, in this shape (omit anything you cannot read; never guess):
{"contact":{"companyName":"","dba":"","fein":"","entityType":"","bizDesc":"","firstName":"","lastName":"","contactFirst":"","contactLast":"","contactTitle":"","dob":"YYYY-MM-DD","phone1":"","phone2":"","email":"","address":"","city":"","state":"2-letter","zip":"","dlNum":"","dlState":"","dlExp":"YYYY-MM-DD"},
 "policies":[{"policyNumber":"","company":"","lineOfBusiness":"","effectiveDate":"YYYY-MM-DD","expirationDate":"YYYY-MM-DD","totalPremium":0}],
 "summary":"one short sentence describing the document"}
For a business: put the business in companyName and the owner/contact person in contactFirst/contactLast/contactTitle. For a person: use firstName/lastName.`;

    let pending = [];   // { name, images:[b64], text }
    let busy = false;
    let lastResult = null;

    // ── UI ───────────────────────────────────────────────────
    function build() {
        if (document.getElementById('maxAiPanel')) return;
        const btn = document.createElement('button');
        btn.id = 'maxAiFab'; btn.type = 'button'; btn.title = 'Max AI — read a screenshot or PDF into this client';
        btn.innerHTML = '🤖 Max AI';
        btn.style.cssText = 'position:fixed;right:22px;bottom:96px;z-index:9000;background:linear-gradient(135deg,#0f172a,#334155);color:#fff;border:none;border-radius:999px;padding:10px 16px;font-weight:800;font-size:13px;box-shadow:0 8px 24px rgba(15,23,42,.35);cursor:pointer;';
        btn.onclick = toggle;
        document.body.appendChild(btn);

        const p = document.createElement('div');
        p.id = 'maxAiPanel';
        p.style.cssText = 'display:none;position:fixed;right:22px;bottom:150px;z-index:9001;width:440px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 180px);background:#fff;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,.3);flex-direction:column;overflow:hidden;font-family:inherit;';
        p.innerHTML = `
          <div style="background:linear-gradient(135deg,#0f172a,#334155);color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px;">
            <div style="flex:1;"><div style="font-weight:800;font-size:15px;">🤖 Max AI</div>
              <div id="maxAiSub" style="font-size:11px;opacity:.8;"></div></div>
            <button type="button" onclick="MaxAI.settings()" title="Settings" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;padding:5px 8px;cursor:pointer;">⚙</button>
            <button type="button" onclick="MaxAI.toggle()" title="Close" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">×</button>
          </div>
          <div id="maxAiMsgs" style="flex:1;overflow-y:auto;padding:12px;background:#f8fafc;display:flex;flex-direction:column;gap:10px;font-size:13px;"></div>
          <div id="maxAiFiles" style="display:none;padding:6px 12px;background:#eef2ff;font-size:12px;color:#3730a3;"></div>
          <div id="maxAiDrop" style="padding:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;align-items:flex-end;">
            <button type="button" onclick="document.getElementById('maxAiFile').click()" title="Attach screenshot or PDF" style="flex-shrink:0;width:40px;height:40px;border-radius:10px;border:1.5px solid #cbd5e1;background:#fff;cursor:pointer;font-size:18px;">📎</button>
            <input type="file" id="maxAiFile" accept="image/*,application/pdf" multiple style="display:none;">
            <textarea id="maxAiInput" rows="2" placeholder="Drop a screenshot or PDF, or ask Max…" style="flex:1;border:1.5px solid #cbd5e1;border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit;resize:none;"></textarea>
            <button type="button" id="maxAiSend" onclick="MaxAI.send()" style="flex-shrink:0;height:40px;padding:0 14px;border:none;border-radius:10px;background:#0f172a;color:#fff;font-weight:700;cursor:pointer;">Send</button>
          </div>`;
        document.body.appendChild(p);
        document.getElementById('maxAiFile').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
        document.getElementById('maxAiInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
        document.getElementById('maxAiInput').addEventListener('paste', e => {
            const files = [...(e.clipboardData && e.clipboardData.files || [])];
            if (files.length) { e.preventDefault(); addFiles(files); }
        });
        p.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
        p.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); });
        say('assistant', 'Hi! Open a client, then drop a **screenshot or PDF** here (or paste a screenshot with Ctrl+V). I\'ll read it and show you what I\'d update — nothing is saved until you press **Apply**.');
        refreshSub();
    }
    function refreshSub() {
        const s = document.getElementById('maxAiSub'); if (!s) return;
        const c = cfg();
        const client = activeClientName();
        s.textContent = `${c.model} · ${client ? 'Client: ' + client : 'No client open'}`;
    }
    function toggle() {
        build();
        const p = document.getElementById('maxAiPanel');
        p.style.display = p.style.display === 'none' ? 'flex' : 'none';
        refreshSub();
    }
    function say(who, html, raw) {
        const box = document.getElementById('maxAiMsgs'); if (!box) return null;
        const d = document.createElement('div');
        d.style.cssText = who === 'user'
            ? 'align-self:flex-end;background:#0f172a;color:#fff;border-radius:12px 12px 2px 12px;padding:8px 11px;max-width:85%;white-space:pre-wrap;'
            : 'align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-radius:12px 12px 12px 2px;padding:9px 11px;max-width:95%;';
        d.innerHTML = raw ? html : esc(html).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
        box.appendChild(d); box.scrollTop = box.scrollHeight;
        return d;
    }

    // ── Files ────────────────────────────────────────────────
    function readAsDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); }
    function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
    async function pdfToImages(file) {
        if (!window.pdfjsLib) { await loadScript(PDFJS); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }
        const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const images = []; let text = '';
        for (let i = 1; i <= Math.min(doc.numPages, 4); i++) {
            const page = await doc.getPage(i);
            try { const tc = await page.getTextContent(); text += tc.items.map(t => t.str).join(' ') + '\n'; } catch (e) {}
            const vp = page.getViewport({ scale: 1.6 });
            const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            images.push(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
        }
        return { images, text: text.trim().slice(0, 12000) };
    }
    async function addFiles(list) {
        build();
        for (const f of [...(list || [])]) {
            try {
                if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
                    const r = await pdfToImages(f); pending.push({ name: f.name, images: r.images, text: r.text });
                } else if (/^image\//.test(f.type)) {
                    pending.push({ name: f.name || 'screenshot.png', images: [(await readAsDataURL(f)).split(',')[1]], text: '' });
                } else { say('assistant', `I can read screenshots and PDFs — "${f.name}" isn't one.`); }
            } catch (e) { say('assistant', 'Could not read ' + f.name + ': ' + (e.message || e)); }
        }
        const fl = document.getElementById('maxAiFiles');
        fl.style.display = pending.length ? '' : 'none';
        fl.innerHTML = pending.map(p => '📎 ' + esc(p.name)).join(' · ') + (pending.length ? ' <a href="#" onclick="MaxAI.clearFiles();return false;" style="margin-left:6px;">clear</a>' : '');
    }
    function clearFiles() { pending = []; const fl = document.getElementById('maxAiFiles'); if (fl) fl.style.display = 'none'; }

    // ── Ollama ───────────────────────────────────────────────
    async function ollama(messages, json) {
        const c = cfg();
        let res;
        try {
            res = await fetch(c.url + '/api/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: c.model, messages, stream: false, think: false, format: json ? 'json' : undefined, options: { temperature: 0 } })
            });
        } catch (e) {
            throw new Error(`Can't reach Ollama at ${c.url}. Make sure Ollama is running on this computer and allows this site: set OLLAMA_ORIGINS=${location.origin} (then restart Ollama).`);
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('Ollama HTTP ' + res.status) + (res.status === 404 ? ` — is the model "${c.model}" pulled? Run: ollama pull ${c.model}` : ''));
        return String((data.message && data.message.content) || '');
    }

    // ── Client context ───────────────────────────────────────
    function activeKey() { return (typeof amsActiveKey !== 'undefined' && amsActiveKey) ? amsActiveKey : ''; }
    function activeClientName() { const k = activeKey(); const c = k && typeof amsClientIndex !== 'undefined' ? amsClientIndex[k] : null; return c ? c.displayName : ''; }

    async function send() {
        if (busy) return;
        build();
        const input = document.getElementById('maxAiInput');
        const text = (input.value || '').trim();
        if (!text && !pending.length) return;
        const files = pending; clearFiles(); input.value = '';
        say('user', (files.length ? files.map(f => '📎 ' + f.name).join('\n') + (text ? '\n' : '') : '') + text);
        busy = true; const sendBtn = document.getElementById('maxAiSend'); sendBtn.disabled = true;
        const wait = say('assistant', files.length ? '🔎 Reading the document… (a local model can take 20–60 seconds)' : '…');
        try {
            if (files.length) {
                const images = files.flatMap(f => f.images);
                const pdfText = files.map(f => f.text).filter(Boolean).join('\n');
                const userMsg = (text ? text + '\n\n' : '') + 'Extract the client and policy information from the attached document.' + (pdfText ? '\n\nText found in the PDF:\n' + pdfText : '');
                const out = await ollama([{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg, images }], true);
                wait.remove();
                let obj = null;
                try { obj = JSON.parse(out); } catch (e) { const m = out.match(/\{[\s\S]*\}/); if (m) try { obj = JSON.parse(m[0]); } catch (e2) {} }
                if (!obj) { say('assistant', "I couldn't read structured information from that document. Try a clearer screenshot."); return; }
                review(obj);
            } else {
                const ctx = activeClientName() ? `The user is looking at the AMS client "${activeClientName()}".` : '';
                const out = await ollama([{ role: 'system', content: 'You are Max, a helpful assistant inside an insurance agency management system. Be brief. ' + ctx }, { role: 'user', content: text }], false);
                wait.remove(); say('assistant', out || '(no answer)');
            }
        } catch (e) { wait.remove(); say('assistant', '❌ ' + (e.message || e)); }
        finally { busy = false; sendBtn.disabled = false; refreshSub(); }
    }

    // ── Review & apply ───────────────────────────────────────
    function norm(v) { return String(v == null ? '' : v).trim(); }
    function review(obj) {
        lastResult = obj;
        const key = activeKey();
        const contact = obj.contact || {};
        const pols = Array.isArray(obj.policies) ? obj.policies.filter(p => p && (p.policyNumber || p.company)) : [];
        if (!key) {
            say('assistant', (obj.summary ? obj.summary + '\n\n' : '') + 'I read the document, but no client is open. Open the client in the AMS, then send it again so I can update them.');
            return;
        }
        const cur = (amsGetClientData()[key]) || {};
        const rows = FIELDS.map(([k, label]) => {
            const nv = norm(contact[k]); if (!nv) return '';
            const ov = norm(cur[k]); if (nv.toLowerCase() === ov.toLowerCase()) return '';
            return `<tr><td><input type="checkbox" class="maxai-c" data-k="${k}" checked></td><td style="font-weight:600;">${esc(label)}</td>
                <td style="color:#94a3b8;text-decoration:${ov ? 'line-through' : 'none'};">${esc(ov || '—')}</td><td style="color:#047857;font-weight:600;">${esc(nv)}</td></tr>`;
        }).join('');
        const client = amsClientIndex[key];
        const polRows = pols.map((p, i) => {
            const num = norm(p.policyNumber).toUpperCase().replace(/\s+/g, '');
            const match = (client.policies || []).find(x => num && norm(x.policyNumber).toUpperCase().replace(/\s+/g, '') === num);
            const changes = POL_FIELDS.map(([k, label]) => {
                const nv = norm(p[k]); if (!nv || nv === '0') return '';
                const ov = match ? norm(match[k] || (k === 'effectiveDate' ? match.effDate : '')) : '';
                if (match && nv.toLowerCase() === ov.toLowerCase()) return '';
                return `${esc(label)}: ${ov ? `<s style="color:#94a3b8;">${esc(ov)}</s> → ` : ''}<b style="color:#047857;">${esc(nv)}</b>`;
            }).filter(Boolean);
            if (!changes.length) return '';
            return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:7px 9px;margin-top:6px;">
                <label style="display:flex;gap:6px;align-items:flex-start;"><input type="checkbox" class="maxai-p" data-i="${i}" ${match ? 'checked' : ''}>
                <span><b>${esc(p.policyNumber || 'No policy #')}</b> ${match ? '<span style="color:#1d4ed8;font-size:11px;">update existing</span>' : '<span style="color:#b45309;font-size:11px;">not on this client — tick to add as a new policy</span>'}<br>${changes.join('<br>')}</span></label></div>`;
        }).join('');
        if (!rows && !polRows) { say('assistant', (obj.summary ? obj.summary + '\n\n' : '') + 'Everything in this document already matches ' + client.displayName + '. Nothing to update.'); return; }
        say('assistant', `${obj.summary ? esc(obj.summary) + '<br><br>' : ''}Proposed updates for <b>${esc(client.displayName)}</b> — untick anything you don't want:
            ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px;"><tbody>${rows}</tbody></table>` : ''}
            ${polRows ? `<div style="margin-top:8px;font-weight:700;">Policies</div>${polRows}` : ''}
            <button type="button" onclick="MaxAI.apply(this)" style="margin-top:10px;background:#047857;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;">✓ Apply to ${esc(client.displayName)}</button>`, true);
    }

    function apply(btn) {
        const key = activeKey(); const obj = lastResult;
        if (!key || !obj) return;
        const box = btn.closest('div');
        const contacts = amsGetClientData();
        const rec = contacts[key] || (contacts[key] = {});
        let n = 0;
        box.querySelectorAll('.maxai-c:checked').forEach(c => { const k = c.dataset.k; const v = norm((obj.contact || {})[k]); if (v) { rec[k] = v; n++; } });
        if (n) { rec.updatedAt = new Date().toISOString(); amsSave('amsClientData', contacts); }
        let pn = 0;
        const picks = [...box.querySelectorAll('.maxai-p:checked')].map(c => obj.policies[+c.dataset.i]).filter(Boolean);
        if (picks.length) {
            const binder = amsGetBinderData();
            const client = amsClientIndex[key];
            picks.forEach((p, i) => {
                const num = norm(p.policyNumber).toUpperCase().replace(/\s+/g, '');
                let e = num && binder.find(x => amsClientKey(x.customerName) === key && norm(x.policyNumber).toUpperCase().replace(/\s+/g, '') === num);
                if (!e) {
                    e = { id: Date.now() + i, entryDate: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), customerName: client.displayName,
                          agent: (client.policies[0] && client.policies[0].agent) || '', policyType: 'New', policyNumber: p.policyNumber || '', policyStatus: 'Active' };
                    binder.push(e);
                }
                POL_FIELDS.forEach(([k]) => { const v = norm(p[k]); if (v && v !== '0') e[k] = k === 'totalPremium' ? (parseFloat(v.replace(/[$,]/g, '')) || e[k]) : v; });
                if (p.effectiveDate) e.effDate = p.effectiveDate;
                e.updatedAt = Date.now();
                pn++;
            });
            amsSave('binderData', binder);
        }
        if (window.UIBAudit) try { UIBAudit.log('max_ai_update', amsClientIndex[key] && amsClientIndex[key].displayName, { fields: n, policies: pn }); } catch (e) {}
        btn.disabled = true; btn.textContent = `✓ Applied (${n} field${n !== 1 ? 's' : ''}${pn ? `, ${pn} polic${pn !== 1 ? 'ies' : 'y'}` : ''})`;
        try { amsBuildClientIndex(); amsLoadClientDetail(key); } catch (e) {}
    }

    function settings() {
        const c = cfg();
        const url = prompt('Ollama address (on this computer it is usually http://localhost:11434):', c.url); if (url === null) return;
        const model = prompt('Model name (must be pulled in Ollama, e.g. qwen3.5:4b):', c.model); if (model === null) return;
        saveCfg({ url: url.trim() || c.url, model: model.trim() || c.model });
        refreshSub();
        fetch(cfg().url + '/api/tags').then(r => r.json()).then(d => {
            const names = (d.models || []).map(m => m.name);
            say('assistant', names.length ? `Connected ✓ Models on this Ollama: ${names.join(', ')}` + (names.includes(cfg().model) ? '' : `\n\n⚠ "${cfg().model}" is not pulled yet. Run: ollama pull ${cfg().model}`) : 'Connected, but no models are pulled yet.');
        }).catch(() => say('assistant', `Can't reach Ollama at ${cfg().url}. Check it's running and OLLAMA_ORIGINS includes ${location.origin}.`));
    }

    window.MaxAI = { toggle, send, apply, settings, clearFiles, addFiles };
    function boot() {
        // Only for signed-in AMS users.
        const tryShow = () => { if (typeof amsCurrentUser !== 'undefined' && amsCurrentUser) build(); else setTimeout(tryShow, 2000); };
        tryShow();
        setInterval(refreshSub, 3000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
