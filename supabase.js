// ============================================================
//  UIB CLOUD SYNC  —  Supabase backup / restore layer
//  ------------------------------------------------------------
//  Safe, non-breaking. Runs alongside localStorage.
//  Adds a floating "☁️ Cloud" button to whatever page loads it.
//    • Back up  → pushes all local data to Supabase (app_store)
//    • Restore  → pulls it back onto this browser/computer
//  Nothing here touches or replaces your existing save logic.
// ============================================================

(function () {
    'use strict';

    const SUPABASE_URL  = 'https://jgjmobktucyimupelfxd.supabase.co';
    const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1vYmt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ';
    const REST = SUPABASE_URL + '/rest/v1/app_store';

    // Keys we skip backing up (session-only / device-only junk).
    const SKIP = new Set(['uibCloudLastBackup']);

    const HEADERS = {
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + SUPABASE_ANON,
        'Content-Type': 'application/json'
    };

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

    // ── Pull every row down ────────────────────────────────────
    async function cloudGetAll() {
        const res = await fetch(REST + '?select=key,value', { headers: HEADERS });
        if (!res.ok) throw new Error('Fetch failed (HTTP ' + res.status + ')');
        return res.json();
    }

    // ── Back up ALL localStorage data ──────────────────────────
    async function backupAll(onProgress) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && !SKIP.has(k)) keys.push(k);
        }
        let done = 0;
        for (const k of keys) {
            await cloudSet(k, localStorage.getItem(k));
            done++;
            if (onProgress) onProgress(done, keys.length, k);
        }
        localStorage.setItem('uibCloudLastBackup', new Date().toISOString());
        return done;
    }

    // ── Restore ALL data from cloud into this browser ──────────
    async function restoreAll(onProgress) {
        const rows = await cloudGetAll();
        let done = 0;
        for (const row of rows) {
            const val = (typeof row.value === 'string') ? row.value : JSON.stringify(row.value);
            localStorage.setItem(row.key, val);
            done++;
            if (onProgress) onProgress(done, rows.length, row.key);
        }
        return done;
    }

    // ── Connection check ───────────────────────────────────────
    async function ping() {
        try {
            const res = await fetch(REST + '?select=key&limit=1', { headers: HEADERS });
            return res.ok;
        } catch { return false; }
    }

    // ── Expose for other scripts / console ─────────────────────
    window.uibCloud = { set: cloudSet, getAll: cloudGetAll, backupAll, restoreAll, ping };

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
            'box-shadow:0 4px 14px rgba(0,0,0,.35);z-index:100000;display:flex;align-items:center;justify-content:center;';

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
              '<div style="font-size:12px;color:#475569;margin-bottom:6px;">Last backup:</div>' +
              '<div id="uibCloudLast" style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:14px;">—</div>' +
              '<button id="uibCloudBackup" style="width:100%;padding:11px;background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;border:none;border-radius:9px;font-weight:700;font-size:14px;cursor:pointer;margin-bottom:8px;">⬆️ Back up to Cloud</button>' +
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

        lastEl.textContent = fmtTime(localStorage.getItem('uibCloudLastBackup'));

        btn.onclick = () => {
            const open = panel.style.display === 'block';
            panel.style.display = open ? 'none' : 'block';
            if (!open) {
                lastEl.textContent = fmtTime(localStorage.getItem('uibCloudLastBackup'));
                ping().then(ok => {
                    statusEl.textContent = ok ? '● Connected' : '● Not connected';
                    statusEl.style.color = ok ? '#4ade80' : '#f87171';
                });
            }
        };

        backupBtn.onclick = async () => {
            backupBtn.disabled = restoreBtn.disabled = true;
            msgEl.style.color = '#475569';
            try {
                const n = await backupAll((d, total, k) => {
                    msgEl.textContent = 'Backing up ' + d + '/' + total + '…';
                });
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
            if (!confirm('Restore data from the cloud?\n\nThis overwrites the data in THIS browser with the last cloud backup. Your other devices are not affected.')) return;
            backupBtn.disabled = restoreBtn.disabled = true;
            msgEl.style.color = '#475569';
            try {
                const n = await restoreAll((d, total) => {
                    msgEl.textContent = 'Restoring ' + d + '/' + total + '…';
                });
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildUI);
    } else {
        buildUI();
    }
})();
