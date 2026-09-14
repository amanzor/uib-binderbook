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
    const KEYS = new Set(['binderData', 'amsClientData', 'commissionStatements', 'verificationLogs']);
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

    localStorage.getItem = function (key) {
        const raw = nativeGet.call(this, key);
        return KEYS.has(key) ? decode(key, raw) : raw;
    };

    localStorage.setItem = function (key, value) {
        if (!KEYS.has(key)) return nativeSet.call(this, key, value);
        const str = String(value);
        const raw = encode(str);
        nativeSet.call(this, key, raw);   // QuotaExceededError propagates to the caller
        memo.set(key, { raw: raw, value: str });
    };

    // Compress anything already stored plain, so the room is freed now.
    KEYS.forEach(function (key) {
        const raw = nativeGet.call(localStorage, key);
        if (raw != null && raw.substring(0, MARK.length) !== MARK) {
            try { localStorage.setItem(key, raw); } catch (e) { /* no room to rewrite — leave it plain */ }
        }
    });

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
