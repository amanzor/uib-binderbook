// ============================================================
//  UIB CLOUD SYNC  —  Supabase auto backup / restore layer
//  ------------------------------------------------------------
//  Safe, non-breaking. Runs alongside localStorage.
//    • AUTO-SAVE : every data change pushes to the cloud (debounced)
//    • AUTO-LOAD : a fresh/empty browser pulls data down on open
//    • Manual ⬆️/⬇️ buttons still available via the ☁️ panel
//  Auto-load ONLY runs when this browser has no data, so it can
//  never overwrite work in progress.
// ============================================================

(function () {
    'use strict';

    const SUPABASE_URL  = 'https://jgjmobktucyimupelfxd.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1vYmt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ';
    const REST = SUPABASE_URL + '/rest/v1/app_store';

    // Ephemeral / device-only keys we never sync.
    const SKIP = new Set([
        'uibCloudLastBackup', 'uibCloudAuto', 'uibPendingTransaction',
        'uibPendingSalesEntry', 'uibCurrentUser', 'uibCloudRestoredThisSession'
    ]);

    // The keys that actually hold your business data (auto-load checks these).
    const DATA_KEYS = ['binderData', 'amsClientData'];

    const DEBOUNCE_MS = 2500;

    const HEADERS = {
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + SUPABASE_ANON,
        'Content-Type': 'application/json'
    };

    let suppressAuto = false;          // true while we're writing during a restore
    let dirty = new Set();             // keys waiting to be pushed
    let debounceTimer = null;
    let autoEnabled = localStorage.getItem('uibCloudAuto') !== 'off';

    // Keep a handle to the REAL setItem before we wrap it.
    const _setItem = localStorage.setItem.bind(localStorage);

    // ── Push one key/value up (upsert on primary key) ──────────
    async function cloudSet(key, rawValue) {
        let parsed;
        try { parsed = JSON.parse(rawValue); } catch { parsed = rawValue; }
        const body = [{ key: key, value: parsed, updated_at: new Date().toISOString() }];
        const res = await fetch(REST, {
            method: 'POST',
            headers: Object.assign({}, HEADERS, { 'Prefer': 'resolution=merge-duplicates' }),
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('Save failed for "' + key + '" (HTTP ' + res.status + ')');
    }

    async function cloudGetAll() {
        const res = await fetch(REST + '?select=key,value', { headers: HEADERS });
        if (!res.ok) throw new Error('Fetch failed (HTTP ' + res.status + ')');
        return res.json();
    }

    async function backupAll(onProgress) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && !SKIP.has(k) && k.indexOf('uibDirty_') !== 0) keys.push(k);
        }
        let done = 0;
        for (const k of keys) {
            const v = localStorage.getItem(k);
            // Merge-managed keys go through driveSet so a manual "Back up
            // now" can't overwrite other agents' recent entries either.
            if (typeof driveSet === 'function' && typeof SYNC_KEYS !== 'undefined' &&
                (SYNC_KEYS.includes(k) || k === 'binderDeletedIds')) {
                try { await driveSet(k, JSON.parse(v)); }
                catch (e) { await cloudSet(k, v); }
            } else {
                await cloudSet(k, v);
            }
            done++;
            if (onProgress) onProgress(done, keys.length, k);
        }
        _setItem('uibCloudLastBackup', new Date().toISOString());
        return done;
    }

    async function restoreAll(onProgress) {
        const rows = await cloudGetAll();
        suppressAuto = true;
        try {
            let done = 0;
            for (const row of rows) {
                const val = (typeof row.value === 'string') ? row.value : JSON.stringify(row.value);
                _setItem(row.key, val);
                done++;
                if (onProgress) onProgress(done, rows.length, row.key);
            }
            return done;
        } finally {
            suppressAuto = false;
        }
    }

    async function ping() {
        try {
            const res = await fetch(REST + '?select=key&limit=1', { headers: HEADERS });
            return res.ok;
        } catch { return false; }
    }

    // ════════════════════════════════════════════════════════════
    //  AUTO-SAVE  — capture every localStorage write
    // ════════════════════════════════════════════════════════════
    function flashSyncing(state) {
        const btn = document.getElementById('uibCloudBtn');
        if (!btn) return;
        if (state === 'saving')      { btn.style.opacity = '0.55'; btn.title = 'Cloud Sync — saving…'; }
        else if (state === 'saved')  { btn.style.opacity = '1';    btn.title = 'Cloud Sync — all changes saved'; }
        else if (state === 'error')  { btn.style.opacity = '1';    btn.title = 'Cloud Sync — save error (will retry)'; }
    }

    async function flushDirty() {
        if (!dirty.size) return;
        const keys = Array.from(dirty);
        dirty.clear();
        flashSyncing('saving');
        try {
            for (const k of keys) {
                const v = localStorage.getItem(k);
                if (v !== null) await cloudSet(k, v);
            }
            _setItem('uibCloudLastBackup', new Date().toISOString());
            const lastEl = document.getElementById('uibCloudLast');
            if (lastEl) lastEl.textContent = fmtTime(localStorage.getItem('uibCloudLastBackup'));
            flashSyncing('saved');
        } catch (e) {
            // Re-queue on failure so we retry on the next change.
            keys.forEach(k => dirty.add(k));
            flashSyncing('error');
        }
    }

    function queueDirty(key) {
        if (!autoEnabled || suppressAuto) return;
        if (SKIP.has(key) || key.indexOf('uibDirty_') === 0) return; // device-local sync bookkeeping
        // Keys owned by app.js's merge-sync layer must NOT be pushed raw
        // from here: this layer writes the same app_store table without
        // merging, so a device with a stale copy overwrote entries other
        // agents had just saved (this is how transactions kept vanishing).
        // On pages without app.js (ams.html) SYNC_KEYS is undefined and this
        // layer still backs everything up.
        if (typeof SYNC_KEYS !== 'undefined' &&
            (SYNC_KEYS.includes(key) || key === 'binderDeletedIds')) return;
        dirty.add(key);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flushDirty, DEBOUNCE_MS);
    }

    function installAutoSave() {
        localStorage.setItem = function (key, value) {
            _setItem(key, value);       // do the real write first
            try { queueDirty(key); } catch (e) { /* never break the app */ }
        };
    }

    // ════════════════════════════════════════════════════════════
    //  AUTO-LOAD  — only when this browser has no data yet
    // ════════════════════════════════════════════════════════════
    function localHasData() {
        return DATA_KEYS.some(k => {
            const v = localStorage.getItem(k);
            if (!v) return false;
            try { const p = JSON.parse(v); return Array.isArray(p) ? p.length > 0 : Object.keys(p).length > 0; }
            catch { return v.length > 2; }
        });
    }

    async function maybeAutoRestore() {
        if (sessionStorage.getItem('uibCloudRestoredThisSession')) return;
        if (localHasData()) return;                       // never clobber existing data
        try {
            const rows = await cloudGetAll();
            if (!rows || !rows.length) return;            // nothing in the cloud yet
            await restoreAll();
            sessionStorage.setItem('uibCloudRestoredThisSession', '1');
            location.reload();                            // load the freshly-restored data
        } catch (e) { /* offline / not ready — just continue with local */ }
    }

    window.uibCloud = {
        set: cloudSet, getAll: cloudGetAll, backupAll, restoreAll, ping,
        isAuto: () => autoEnabled,
        setAuto: (on) => { autoEnabled = !!on; _setItem('uibCloudAuto', on ? 'on' : 'off'); }
    };

    // ════════════════════════════════════════════════════════════
    //  Floating UI
    // ════════════════════════════════════════════════════════════
    function fmtTime(iso) {
        if (!iso) return 'never';
        try { return new Date(iso).toLocaleString('en-US'); } catch { return iso; }
    }

    function buildUI() {
        const btn = document.createElement('button');
        btn.id = 'uibCloudBtn';
        btn.title = 'Cloud Sync';
        btn.innerHTML = '☁️';
        btn.style.cssText = 'position:fixed;bottom:20px;left:20px;width:50px;height:50px;border-radius:50%;' +
            'background:linear-gradient(135deg,#0d1f3c,#1d4ed8);color:#fff;border:none;font-size:22px;cursor:pointer;' +
            'box-shadow:0 4px 14px rgba(0,0,0,.35);z-index:100000;display:flex;align-items:center;justify-content:center;transition:opacity .2s;';

        const panel = document.createElement('div');
        panel.id = 'uibCloudPanel';
        panel.style.cssText = 'position:fixed;bottom:80px;left:20px;width:300px;background:#fff;border-radius:14px;' +
            'box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:100000;display:none;overflow:hidden;font-family:system-ui,Arial,sans-serif;';
        panel.innerHTML =
            '<div style="background:linear-gradient(135deg,#0d1f3c,#1d4ed8);color:#fff;padding:14px 16px;">' +
              '<div style="font-weight:700;font-size:15px;">☁️ Cloud Sync</div>' +
              '<div id="uibCloudStatus" style="font-size:11px;opacity:.8;margin-top:2px;">Checking connection…</div>' +
            '</div>' +
            '<div style="padding:16px;">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#0f172a;font-weight:600;margin-bottom:14px;cursor:pointer;">' +
                '<input type="checkbox" id="uibCloudAutoToggle" style="width:16px;height:16px;cursor:pointer;"> Automatic sync (recommended)' +
              '</label>' +
              '<div style="font-size:12px;color:#475569;margin-bottom:6px;">Last saved to cloud:</div>' +
              '<div id="uibCloudLast" style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:14px;">—</div>' +
              '<button id="uibCloudBackup" style="width:100%;padding:11px;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;border:none;border-radius:9px;font-weight:700;font-size:14px;cursor:pointer;margin-bottom:8px;">⬆️ Back up now</button>' +
              '<button id="uibCloudRestore" style="width:100%;padding:11px;background:#fff;color:#1d4ed8;border:1.5px solid #1d4ed8;border-radius:9px;font-weight:700;font-size:14px;cursor:pointer;">⬇️ Restore from Cloud</button>' +
              '<div id="uibCloudMsg" style="font-size:12px;margin-top:12px;min-height:16px;color:#475569;"></div>' +
            '</div>';

        document.body.appendChild(btn);
        document.body.appendChild(panel);

        const statusEl  = panel.querySelector('#uibCloudStatus');
        const lastEl    = panel.querySelector('#uibCloudLast');
        const msgEl     = panel.querySelector('#uibCloudMsg');
        const backupBtn = panel.querySelector('#uibCloudBackup');
        const restoreBtn= panel.querySelector('#uibCloudRestore');
        const autoToggle= panel.querySelector('#uibCloudAutoToggle');

        autoToggle.checked = autoEnabled;
        lastEl.textContent = fmtTime(localStorage.getItem('uibCloudLastBackup'));

        autoToggle.onchange = () => {
            window.uibCloud.setAuto(autoToggle.checked);
            msgEl.style.color = '#475569';
            msgEl.textContent = autoToggle.checked ? 'Automatic sync ON — every change saves itself.' : 'Automatic sync OFF — use the buttons to sync.';
        };

        btn.onclick = () => {
            const open = panel.style.display === 'block';
            panel.style.display = open ? 'none' : 'block';
            if (!open) {
                lastEl.textContent = fmtTime(localStorage.getItem('uibCloudLastBackup'));
                autoToggle.checked = autoEnabled;
                ping().then(ok => {
                    statusEl.textContent = ok ? '● Connected · Auto-sync ' + (autoEnabled ? 'ON' : 'OFF') : '● Not connected';
                    statusEl.style.color = ok ? '#4ade80' : '#f87171';
                });
            }
        };

        backupBtn.onclick = async () => {
            backupBtn.disabled = restoreBtn.disabled = true;
            msgEl.style.color = '#475569';
            try {
                const n = await backupAll((d, total) => { msgEl.textContent = 'Backing up ' + d + '/' + total + '…'; });
                msgEl.style.color = '#16a34a';
                msgEl.textContent = '✅ Backed up ' + n + ' items to the cloud.';
                lastEl.textContent = fmtTime(localStorage.getItem('uibCloudLastBackup'));
            } catch (e) {
                msgEl.style.color = '#dc2626';
                msgEl.textContent = '❌ ' + e.message;
            }
            backupBtn.disabled = restoreBtn.disabled = false;
        };

        restoreBtn.onclick = async () => {
            if (!confirm('Restore data from the cloud?\n\nThis overwrites the data in THIS browser with the latest cloud copy. Your other devices are not affected.')) return;
            backupBtn.disabled = restoreBtn.disabled = true;
            msgEl.style.color = '#475569';
            try {
                const n = await restoreAll((d, total) => { msgEl.textContent = 'Restoring ' + d + '/' + total + '…'; });
                msgEl.style.color = '#16a34a';
                msgEl.textContent = '✅ Restored ' + n + ' items. Reloading…';
                setTimeout(() => location.reload(), 1200);
            } catch (e) {
                msgEl.style.color = '#dc2626';
                msgEl.textContent = '❌ ' + e.message;
                backupBtn.disabled = restoreBtn.disabled = false;
            }
        };
    }

    // ── Boot ───────────────────────────────────────────────────
    installAutoSave();                 // capture writes immediately
    function init() {
        buildUI();
        maybeAutoRestore();            // fresh device? pull data down
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
