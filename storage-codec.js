// ============================================================
//  STORAGE CODEC — transparent compression for the big localStorage keys
//  ------------------------------------------------------------
//  Chrome caps a site's localStorage at 5,000,000 characters and the
//  Binder Book keeps its whole book of business there (~4M chars for
//  5,400 policies), so saves started throwing QuotaExceededError in
//  September 2026. This wrapper stores the largest keys LZ-compressed
//  (UTF-16 safe, ~3-4x smaller) and decompresses on read, so every
//  existing `localStorage.getItem('binderData')` call site, the cloud
//  sync layers and the cloud data format stay exactly as they were.
//
//  MUST be loaded (after lz-string.min.js) BEFORE app.js / ams.js /
//  supabase.js on every page — those files capture localStorage.setItem
//  at load time and wrap it; this codec has to be the innermost layer.
//
//  Safety: a value is only stored compressed if it round-trips
//  (decompress(compress(v)) === v) AND is actually smaller; otherwise it
//  is stored plain. Plain (legacy) values are read as-is, so a page that
//  somehow loads without this codec still finds valid JSON for anything
//  written before it — and never corrupts what it reads.
// ============================================================
(function () {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (typeof LZString === 'undefined' || !LZString.compressToUTF16) {
        console.warn('storage-codec: lz-string not loaded — storing plain.');
        return;
    }
    const KEYS = new Set(['binderData', 'amsClientData', 'commissionStatements', 'verificationLogs', 'raterQuotes']);
    const MARK = 'LZ1:';           // never appears at the start of JSON
    const nativeGet = Storage.prototype.getItem;
    const nativeSet = Storage.prototype.setItem;
    const memo = new Map();               // key -> { raw, value } (last decoded)

    function decode(key, raw) {
        if (raw == null || raw.substring(0, MARK.length) !== MARK) return raw;
        const m = memo.get(key);
        if (m && m.raw === raw) return m.value;
        let value = null;
        try { value = LZString.decompressFromUTF16(raw.substring(MARK.length)); } catch (e) { value = null; }
        if (value == null || value === '') {
            // Unreadable — report "no local copy". The sync layer then merges
            // from the cloud (and its shrink guard refuses destructive writes).
            console.error('storage-codec: could not decompress ' + key);
            return null;
        }
        memo.set(key, { raw: raw, value: value });
        return value;
    }

    function encode(str) {
        try {
            const packed = MARK + LZString.compressToUTF16(str);
            if (packed.length < str.length &&
                LZString.decompressFromUTF16(packed.substring(MARK.length)) === str) {
                return packed;
            }
        } catch (e) { /* fall through: store plain */ }
        return str;
    }

    // Saving: write the value plain when it fits (instant). Only when the
    // browser refuses it for lack of room is it compressed, and that runs in
    // a background worker: compressing the whole book on the main thread
    // froze phones for 8+ seconds per save. Until the compressed copy is
    // stored, reads of the key return the new value from memory.
    const pending = new Map();            // key -> latest value awaiting a compressed write
    let worker = null, seq = 0;
    const jobs = new Map();               // job id -> key
    function isQuota(e) { return e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message))); }
    function getWorker() {
        if (worker !== null) return worker;
        try {
            worker = new Worker('lz-worker.js');
            worker.onmessage = function (ev) {
                const key = jobs.get(ev.data.id); jobs.delete(ev.data.id);
                if (!key || !pending.has(key) || pending.get(key).id !== ev.data.id) return;   // a newer save superseded it
                const str = pending.get(key).str;
                const raw = ev.data.packed || str;
                try { nativeSet.call(localStorage, key, raw); memo.set(key, { raw: raw, value: str }); pending.delete(key); }
                catch (e) {
                    // Still no room: keep serving the value from memory (the cloud has it).
                    pending.get(key).id = 0;
                    console.warn('storage-codec: no room for ' + key + ' even compressed — kept in memory and in the cloud');
                }
            };
            worker.onerror = function () { worker = false; };
        } catch (e) { worker = false; }
        return worker;
    }

    localStorage.getItem = function (key) {
        if (KEYS.has(key) && pending.has(key)) return pending.get(key).str;
        const raw = nativeGet.call(this, key);
        return KEYS.has(key) ? decode(key, raw) : raw;
    };

    localStorage.setItem = function (key, value) {
        if (!KEYS.has(key)) return nativeSet.call(this, key, value);
        const str = String(value);
        try {
            nativeSet.call(this, key, str);
            memo.set(key, { raw: str, value: str });
            pending.delete(key);
            return;
        } catch (e) { if (!isQuota(e)) throw e; }
        const w = getWorker();
        if (w) {
            const id = ++seq; jobs.set(id, key); pending.set(key, { id: id, str: str });
            w.postMessage({ id: id, str: str, mark: MARK });
            return;                                   // saved in memory now, on the device shortly
        }
        const raw = encode(str);                      // no worker support: old behaviour
        nativeSet.call(this, key, raw);               // QuotaExceededError propagates to the caller
        memo.set(key, { raw: raw, value: str });
    };

    window.uibStorageCodec = {
        keys: Array.from(KEYS),
        // Actual bytes-on-disk view (what counts against the browser cap).
        rawLength: function (key) { return (nativeGet.call(localStorage, key) || '').length; },
        usageChars: function () {
            let n = 0;
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                n += k.length + (nativeGet.call(localStorage, k) || '').length;
            }
            return n;
        }
    };
})();
