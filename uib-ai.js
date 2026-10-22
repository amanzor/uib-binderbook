// ============================================================
//  UIB AI ENGINE SWITCH — Claude (cloud) or Ollama (local)
//  ------------------------------------------------------------
//  Every AI feature calls the Supabase "claude" function with an
//  Anthropic Messages request. When the engine is Ollama, this file
//  answers those calls from an Ollama server instead, in the same
//  shape, so no feature needs to change:
//    • system + messages  → Ollama /api/chat messages
//    • images             → Ollama "images" (vision model)
//    • PDFs               → text via pdf.js; scanned pages → images
//    • stream:true        → replayed as Anthropic-style SSE events
//  Settings: agency default in app_store "aiSettings" (admins), with an
//  optional per-device override (localStorage "uibAiDevice"), because
//  Ollama lives on one machine. If Ollama can't be reached and fallback
//  is on, the call goes to Claude as before.
// ============================================================
(function () {
    'use strict';
    const A = window.UIBAuth || {};
    const SB = A.SUPABASE_URL || 'https://jgjmobktucyimupelfxd.supabase.co';
    const ANON = A.SUPABASE_ANON || '';
    const DEFAULTS = { engine: 'claude', url: 'http://localhost:11434', model: 'llama3.1:8b', visionModel: 'llama3.2-vision', fallback: true };
    const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    const _fetch = window.fetch.bind(window);
    let agency = null, agencyAt = 0;

    function deviceCfg() { try { return JSON.parse(localStorage.getItem('uibAiDevice') || 'null'); } catch (e) { return null; } }
    async function agencyCfg() {
        if (agency && Date.now() - agencyAt < 5 * 60 * 1000) return agency;
        try {
            const tok = (A.token && A.token()) || ANON;
            const r = await _fetch(SB + '/rest/v1/app_store?select=value&key=eq.aiSettings', { headers: { apikey: ANON, Authorization: 'Bearer ' + tok } });
            const rows = r.ok ? await r.json() : [];
            agency = Object.assign({}, DEFAULTS, (rows[0] && rows[0].value) || {});
        } catch (e) { agency = agency || Object.assign({}, DEFAULTS); }
        agencyAt = Date.now();
        return agency;
    }
    async function settings() { return Object.assign({}, await agencyCfg(), deviceCfg() || {}); }

    // ── PDF → text (and page images for scans) ─────────────────
    let pdfjsLoading = null;
    function loadPdfJs() {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        if (pdfjsLoading) return pdfjsLoading;
        pdfjsLoading = new Promise((res, rej) => {
            const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js';
            s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(window.pdfjsLib); };
            s.onerror = () => rej(new Error('Could not load the PDF reader.'));
            document.head.appendChild(s);
        });
        return pdfjsLoading;
    }
    function b64ToBytes(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    async function pdfToParts(b64) {
        const lib = await loadPdfJs();
        const doc = await lib.getDocument({ data: b64ToBytes(b64) }).promise;
        const pages = Math.min(doc.numPages, 40);
        let text = '';
        for (let i = 1; i <= pages; i++) {
            const pg = await doc.getPage(i); const tc = await pg.getTextContent();
            text += `\n--- Page ${i} ---\n` + tc.items.map(t => t.str).join(' ');
        }
        const images = [];
        if (text.replace(/--- Page \d+ ---|\s/g, '').length < 40 * pages) {   // scanned: little or no text layer
            for (let i = 1; i <= Math.min(pages, 6); i++) {
                const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1.6 });
                const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
                await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
                images.push(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
            }
        }
        return { text: text.trim(), images, pages: doc.numPages };
    }

    // ── Anthropic request → Ollama request ─────────────────────
    async function toOllama(p, cfg) {
        const msgs = [];
        if (p.system) msgs.push({ role: 'system', content: Array.isArray(p.system) ? p.system.map(b => b.text || '').join('\n') : String(p.system) });
        let usesImages = false;
        for (const m of (p.messages || [])) {
            if (typeof m.content === 'string') { msgs.push({ role: m.role, content: m.content }); continue; }
            const texts = [], images = [];
            for (const b of (m.content || [])) {
                if (b.type === 'text') texts.push(b.text || '');
                else if (b.type === 'image' && b.source && b.source.data) images.push(b.source.data);
                else if (b.type === 'document' && b.source && b.source.data) {
                    const d = await pdfToParts(b.source.data);
                    texts.push(`[Attached PDF, ${d.pages} page(s)]\n${d.text || '(no text layer — see the page images)'}`);
                    images.push(...d.images);
                }
            }
            const out = { role: m.role, content: texts.join('\n\n') };
            if (images.length) { out.images = images; usesImages = true; }
            msgs.push(out);
        }
        return {
            model: usesImages ? (cfg.visionModel || cfg.model) : cfg.model,
            messages: msgs, stream: false,
            options: { num_predict: Math.min(p.max_tokens || 4096, 16000), temperature: typeof p.temperature === 'number' ? p.temperature : 0.2 },
        };
    }

    // ── Ollama reply → Anthropic-shaped Response ───────────────
    function asAnthropic(text, model, stream) {
        if (!stream) {
            return new Response(JSON.stringify({ id: 'ollama', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
                { status: 200, headers: { 'content-type': 'application/json' } });
        }
        const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify(Object.assign({ type }, data))}\n\n`;
        const body = ev('message_start', { message: { id: 'ollama', type: 'message', role: 'assistant', model, content: [] } })
            + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
            + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
            + ev('content_block_stop', { index: 0 })
            + ev('message_delta', { delta: { stop_reason: 'end_turn' } })
            + ev('message_stop', {});
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    async function viaOllama(p, cfg) {
        const req = await toOllama(p, cfg);
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10 * 60 * 1000);
        try {
            const r = await _fetch(cfg.url.replace(/\/+$/, '') + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: ctl.signal });
            if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Ollama returned HTTP ${r.status}: ${t.slice(0, 200)}`); }
            const data = await r.json();
            return { text: (data.message && data.message.content) || '', model: req.model };
        } finally { clearTimeout(timer); }
    }

    // ── Intercept calls to the claude function ─────────────────
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (!/\/functions\/v1\/claude(\?|$)/.test(url) || !init || !init.body) return window.__uibAiNext(input, init);
        const cfg = await settings();
        if (cfg.engine !== 'ollama') return window.__uibAiNext(input, init);
        let p; try { const raw = JSON.parse(init.body); p = raw.body || raw; } catch (e) { return window.__uibAiNext(input, init); }
        try {
            const out = await viaOllama(p, cfg);
            if (window.UIBAudit) UIBAudit.log('ai_request', 'ollama', { model: out.model });
            return asAnthropic(out.text, out.model, p.stream === true);
        } catch (e) {
            console.warn('Ollama call failed:', e);
            if (cfg.fallback !== false) { if (window.UIBAudit) UIBAudit.log('ai_request', 'claude-fallback', { reason: String(e.message || e).slice(0, 120) }); return window.__uibAiNext(input, init); }
            return new Response(JSON.stringify({ error: { type: 'ollama_error', message: 'The local AI (Ollama) could not be reached at ' + cfg.url + '. ' + (e.message || e) } }), { status: 502, headers: { 'content-type': 'application/json' } });
        }
    };
    window.__uibAiNext = _fetch;

    // ── Settings helpers for the admin screen ──────────────────
    async function testOllama(url) {
        const r = await _fetch(String(url || DEFAULTS.url).replace(/\/+$/, '') + '/api/tags');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json(); return (d.models || []).map(m => m.name);
    }
    async function saveAgency(v) {
        const tok = (A.token && A.token()) || ANON;
        const res = await _fetch(SB + '/rest/v1/app_store', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + tok, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify([{ key: 'aiSettings', value: Object.assign({}, DEFAULTS, v), updated_at: new Date().toISOString() }]) });
        if (!res.ok) throw new Error('Could not save (HTTP ' + res.status + ').');
        agency = Object.assign({}, DEFAULTS, v); agencyAt = Date.now();
    }
    function saveDevice(v) { try { if (v) localStorage.setItem('uibAiDevice', JSON.stringify(v)); else localStorage.removeItem('uibAiDevice'); } catch (e) {} }
    window.UIBAI = { settings, agencyCfg, deviceCfg, saveAgency, saveDevice, testOllama, DEFAULTS };
})();
