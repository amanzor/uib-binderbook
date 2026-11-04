// ============================================================
//  UIB BINDER SYNC  —  the one safe way to write shared data
//  ------------------------------------------------------------
//  The whole book of business lives in a single Supabase row
//  (app_store.binderData). A page that saves that row by simply
//  replacing it destroys whatever other devices wrote meanwhile.
//  That is how entries kept vanishing, and it is why app.js has
//  always merged the cloud copy in before writing.
//
//  The AMS does not load app.js, so it had no merge at all: every
//  amsSave('binderData', …) pushed the whole array raw, and the
//  delete path pushed a SHORTENED array — overwriting the book for
//  everyone. This module gives the AMS the same merge-then-write
//  path app.js uses.
//
//  On a page that already loads app.js this module forwards to
//  driveSet/binderMarkDeleted instead, so exactly one merge
//  implementation is ever live on a page.
//
//  Load order: after uib-config.js. Works with or without
//  supabase.js (it prefers uibCloud.rawSet so a local mirror does
//  not queue a second, unmerged cloud push).
// ============================================================

(function () {
    'use strict';

    var SB_URL = ((window.UIB_CONFIG || {}).SUPABASE_URL || 'https://jgjmobktucyimupelfxd.supabase.co');
    var SB_ANON = (window.UIB_CONFIG || {}).SUPABASE_ANON || '';
    var REST = SB_URL + '/rest/v1/app_store';

    var HEADERS = {
        'apikey': SB_ANON,
        'Authorization': 'Bearer ' + SB_ANON,
        'Content-Type': 'application/json'
    };

    // Keys the merge layer owns. Must stay in step with SYNC_KEYS in
    // app.js — supabase.js uses this list to know which keys it must
    // NOT push raw, on every page including the ones without app.js.
    // 'amsClientData' is appended to SYNC_KEYS at runtime by app.js, so it
    // belongs here too — otherwise the client contact records would be the
    // one shared key the AMS still pushed raw.
    var MERGE_KEYS = [
        'binderData', 'agentMasterData', 'commissionData', 'carrierMasterData',
        'prospectData', 'verificationLogs', 'commissionStatements',
        'underwritingData', 'healthData', 'healthCarrierData', 'amsClientData',
        'certificateData', 'acordSavedForms', 'agencyProfile', 'healthCommissionStatements',
        'additionalInterestData', 'clientSharedDocs', 'insuredPortalAccounts'
    ];
    var TOMBSTONE_KEYS = ['binderDeletedIds', 'verificationLogsDeleted'];
    var TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

    function isMergeManaged(key) {
        return MERGE_KEYS.indexOf(key) !== -1 || TOMBSTONE_KEYS.indexOf(key) !== -1;
    }

    // app.js, when present, owns the merge for this page.
    function appJsPresent() {
        return typeof window.driveSet === 'function';
    }

    // Write localStorage WITHOUT queueing a cloud push. supabase.js
    // captures the setter after storage-codec wraps it, so this still
    // compresses; falling back to the plain setter would re-queue the
    // very push we just merged.
    function rawSet(key, str) {
        try {
            if (window.uibCloud && typeof window.uibCloud.rawSet === 'function') window.uibCloud.rawSet(key, str);
            else localStorage.setItem(key, str);
            return true;
        } catch (e) {
            // A full device must not stop the cloud write — that write is
            // the only place the data would otherwise survive.
            console.warn('localStorage write failed for ' + key + ' — kept in cloud only:', e);
            return false;
        }
    }

    function readLocal(key, fallback) {
        try {
            var v = JSON.parse(localStorage.getItem(key));
            if (v == null) return fallback;
            // Older writes wrapped the array as {value: [...]}.
            if (!Array.isArray(v) && Array.isArray(v.value)) return v.value;
            return v;
        } catch (e) { return fallback; }
    }

    // {ok,value} so callers can tell "cloud says empty" from "cloud did
    // not answer". Merging against a failed read and writing the result
    // back is exactly how a book gets replaced by a handful of records.
    function readCloud(key) {
        return fetch(REST + '?select=value&key=eq.' + encodeURIComponent(key), { headers: HEADERS })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (rows) {
                var v = (rows.length && rows[0].value !== null) ? rows[0].value : null;
                if (v && !Array.isArray(v) && Array.isArray(v.value)) v = v.value;
                return { ok: true, value: v };
            })
            .catch(function (e) {
                console.warn('Cloud read failed for ' + key + ':', e);
                return { ok: false, value: null };
            });
    }

    function writeCloud(key, value) {
        return fetch(REST, {
            method: 'POST',
            headers: Object.assign({}, HEADERS, { 'Prefer': 'resolution=merge-duplicates' }),
            body: JSON.stringify([{ key: key, value: value, updated_at: new Date().toISOString() }])
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return true;
        });
    }

    // ── Tombstones ───────────────────────────────────────────────
    function tombstones(key) {
        var list = readLocal(key || 'binderDeletedIds', []);
        return Array.isArray(list) ? list : [];
    }

    function mergeTombstones(a, b) {
        var now = Date.now();
        var byId = new Map();
        [].concat(a || [], b || []).forEach(function (t) {
            if (t && t.id != null && now - (t.ts || 0) < TOMBSTONE_RETENTION_MS) {
                var prev = byId.get(t.id);
                if (!prev || (t.ts || 0) > (prev.ts || 0)) byId.set(t.id, t);
            }
        });
        return Array.from(byId.values());
    }

    // Pull cloud tombstones, union with local, persist. Returns the
    // merged list so it can go straight into mergeBinderData.
    function syncTombstones(key) {
        key = key || 'binderDeletedIds';
        return readCloud(key).then(function (res) {
            var merged = mergeTombstones(tombstones(key), Array.isArray(res.value) ? res.value : []);
            rawSet(key, JSON.stringify(merged));
            return merged;
        }).catch(function () { return tombstones(key); });
    }

    // Record an intentional deletion so the merge does not bring the
    // entry back, and push the tombstone so other devices honour it.
    function markDeleted(ids, key) {
        key = key || 'binderDeletedIds';
        if (appJsPresent() && key === 'binderDeletedIds' && typeof window.binderMarkDeleted === 'function') {
            window.binderMarkDeleted(ids);
            return Promise.resolve(true);
        }
        var now = Date.now();
        var list = tombstones(key);
        var have = new Set(list.map(function (t) { return t.id; }));
        (Array.isArray(ids) ? ids : [ids]).forEach(function (id) {
            if (id != null && !have.has(id)) list.push({ id: id, ts: now });
        });
        var pruned = list.filter(function (t) { return now - (t.ts || 0) < TOMBSTONE_RETENTION_MS; });
        rawSet(key, JSON.stringify(pruned));
        return save(key, pruned);
    }

    // ── Entry merge ──────────────────────────────────────────────
    // Entries get id = Date.now() at save; very old imports may lack
    // one, so fall back to a stable content signature for those.
    function entryKey(e) {
        return e.id != null ? 'i' + e.id
            : 's' + [e.customerName, e.policyNumber, e.entryDate, e.timestamp].join('|');
    }

    // Infinity and Kemper write no Homeowners policies — the same
    // correction app.js applies on every merge, so it propagates from
    // the AMS too rather than only from the Binder Book.
    function normalizeLOBs(entries) {
        if (typeof window.normalizeRestrictedCarrierLOBs === 'function') {
            return window.normalizeRestrictedCarrierLOBs(entries);
        }
        if (!Array.isArray(entries)) return 0;
        var fixed = 0;
        entries.forEach(function (e) {
            if (e && /infinity|kemper/i.test(e.company || '') && /home/i.test(e.lineOfBusiness || '')) {
                e.lineOfBusiness = 'Personal Auto';
                e.updatedAt = Date.now();
                fixed++;
            }
        });
        return fixed;
    }

    // Union of both arrays keyed by entry id. For the same id the copy
    // with the newer updatedAt wins; on a tie local wins. Tombstoned
    // ids are dropped. A merge can only ever ADD entries.
    function mergeBinderData(localArr, cloudArr, tombs) {
        if (appJsPresent() && typeof window.mergeBinderData === 'function') {
            return window.mergeBinderData(localArr, cloudArr, tombs);
        }
        var dead = new Set((tombs || tombstones('binderDeletedIds')).map(function (t) { return t.id; }));
        var byKey = new Map();
        var put = function (e) {
            if (!e || typeof e !== 'object') return;
            if (e.id != null && dead.has(e.id)) return;
            var k = entryKey(e);
            var prev = byKey.get(k);
            if (!prev || (e.updatedAt || 0) >= (prev.updatedAt || 0)) byKey.set(k, e);
        };
        (Array.isArray(cloudArr) ? cloudArr : []).forEach(put);
        (Array.isArray(localArr) ? localArr : []).forEach(put);
        var merged = Array.from(byKey.values()).sort(function (x, y) { return (x.id || 0) - (y.id || 0); });
        normalizeLOBs(merged);
        return merged;
    }

    // Contact records and certificates are maps of key -> record, not id
    // arrays, so they get a union: the cloud's records first, then this
    // device's on top. Where BOTH hold the same record, the newer
    // updatedAt wins — two agents editing different clients must not
    // overwrite each other just because one saved second. Like the entry
    // merge it can only ever ADD, so a stale AMS tab cannot drop a record
    // another device added. Deleting is therefore not propagated by a
    // save: losing a client or a certificate silently is the worse
    // failure of the two (certificates are voided, not deleted).
    //
    // agencyProfile is deliberately NOT here. It is one settings record,
    // not a map of them, so a per-field union would let a device that has
    // a field blank beat one that has it filled. It takes the plain-upsert
    // path instead: the whole record is written as a unit.
    var RECORD_MAP_KEYS = ['amsClientData', 'certificateData', 'acordSavedForms', 'additionalInterestData', 'clientSharedDocs',
                           'insuredPortalAccounts'];

    function mergeClientData(localObj, cloudObj) {
        var out = {};
        var stamp = function (r) {
            var t = r && (r.updatedAt || r.createdAt);
            if (!t) return 0;
            var n = typeof t === 'number' ? t : Date.parse(t);
            return isFinite(n) ? n : 0;
        };
        if (cloudObj && typeof cloudObj === 'object') Object.keys(cloudObj).forEach(function (k) { out[k] = cloudObj[k]; });
        if (localObj && typeof localObj === 'object') Object.keys(localObj).forEach(function (k) {
            var mine = localObj[k], theirs = out[k];
            out[k] = (theirs && stamp(theirs) > stamp(mine)) ? theirs : mine;
        });
        return out;
    }

    // An edit made here must survive the merge against a cloud copy
    // that carries an updatedAt. The AMS edits entries in a dozen
    // places and stamps none of them, so stamp whatever actually
    // changed relative to the copy already on this device.
    function stampChanged(incoming) {
        if (!Array.isArray(incoming)) return incoming;
        var before = new Map();
        readLocal('binderData', []).forEach(function (e) {
            if (e && typeof e === 'object') before.set(entryKey(e), e);
        });
        var now = Date.now();
        incoming.forEach(function (e) {
            if (!e || typeof e !== 'object') return;
            var prev = before.get(entryKey(e));
            if (!prev) { if (!e.updatedAt) e.updatedAt = now; return; }
            try {
                // Compare without updatedAt so re-stamping is not itself a change.
                var a = Object.assign({}, e); delete a.updatedAt;
                var b = Object.assign({}, prev); delete b.updatedAt;
                if (JSON.stringify(a) !== JSON.stringify(b)) e.updatedAt = now;
            } catch (err) { e.updatedAt = now; }
        });
        return incoming;
    }

    // ── The safe write ───────────────────────────────────────────
    function save(key, value) {
        // app.js owns the merge on its pages — one implementation per page.
        if (appJsPresent() && isMergeManaged(key)) {
            return Promise.resolve(window.driveSet(key, value));
        }

        if (key === 'binderData') {
            value = stampChanged(Array.isArray(value) ? value : []);
            // Mirror locally BEFORE the cloud round trip. Callers save and
            // then immediately re-read and re-render (amsSavePolicyModal
            // does exactly that), so deferring this until the network
            // answers would redraw the screen from the pre-save copy. The
            // merged result overwrites this a moment later.
            rawSet('binderData', JSON.stringify(value));
            return syncTombstones('binderDeletedIds').then(function (tombs) {
                return readCloud('binderData').then(function (cloudRes) {
                    // Cloud unreachable: merging against an empty array and
                    // writing it back would wipe every entry that exists
                    // only in the cloud. Keep the local copy and retry later.
                    if (!cloudRes.ok) {
                        console.warn('Skipping binderData cloud write — cloud read failed; local copy kept.');
                        rawSet('binderData', JSON.stringify(value));
                        return false;
                    }
                    var cloudArr = Array.isArray(cloudRes.value) ? cloudRes.value : [];
                    var merged = mergeBinderData(value, cloudArr, tombs);

                    // SHRINK GUARD. A merge can only ever add entries, so a
                    // result smaller than the live cloud copy means something
                    // upstream is wrong. Refuse it — never publish the shrink.
                    // Tombstoned ids are excluded so real deletes still work.
                    var deadIds = new Set((tombs || []).map(function (t) { return t.id; }));
                    var cloudLive = cloudArr.filter(function (e) {
                        return !(e && e.id != null && deadIds.has(e.id));
                    }).length;
                    if (cloudLive > 0 && merged.length < cloudLive) {
                        var lost = cloudLive - merged.length;
                        console.error('BLOCKED binderData write: would drop ' + lost + ' of ' + cloudLive + ' cloud entries.');
                        try {
                            rawSet('uibBlockedShrink', JSON.stringify({
                                at: new Date().toISOString(), from: 'ams',
                                cloudLive: cloudLive, wouldWrite: merged.length, lost: lost
                            }));
                        } catch (e) {}
                        if (typeof alert === 'function') {
                            alert('⚠️ Cloud save BLOCKED to protect your data.\n\n' +
                                  'The save would have reduced the book from ' + cloudLive + ' to ' + merged.length +
                                  ' policies (' + lost + ' lost). Nothing was written — your cloud data is untouched.\n\n' +
                                  'Reload the page. If this repeats, tell your admin before entering more data.');
                        }
                        return false;
                    }

                    rawSet('binderData', JSON.stringify(merged));
                    return writeCloud('binderData', merged).then(function () { return true; });
                });
            }).catch(function (e) {
                console.warn('Cloud write failed for binderData:', e);
                return false;
            });
        }

        if (RECORD_MAP_KEYS.indexOf(key) !== -1) {
            rawSet(key, JSON.stringify(value));   // same reasoning as binderData above
            return readCloud(key).then(function (cloudRes) {
                if (!cloudRes.ok) {
                    console.warn('Skipping ' + key + ' cloud write — cloud read failed; local copy kept.');
                    rawSet(key, JSON.stringify(value));
                    return false;
                }
                var merged = mergeClientData(value, cloudRes.value);
                rawSet(key, JSON.stringify(merged));
                return writeCloud(key, merged).then(function () { return true; });
            }).catch(function (e) {
                console.warn('Cloud write failed for ' + key + ':', e);
                return false;
            });
        }

        if (TOMBSTONE_KEYS.indexOf(key) !== -1) {
            return readCloud(key).then(function (cloudRes) {
                if (!cloudRes.ok) return false;
                var merged = mergeTombstones(Array.isArray(value) ? value : [],
                                             Array.isArray(cloudRes.value) ? cloudRes.value : []);
                rawSet(key, JSON.stringify(merged));
                return writeCloud(key, merged).then(function () { return true; });
            }).catch(function (e) {
                console.warn('Cloud write failed for ' + key + ':', e);
                return false;
            });
        }

        // Everything else is a plain upsert — the same thing app.js's
        // driveSet does for these keys.
        rawSet(key, JSON.stringify(value));
        return writeCloud(key, value).then(function () { return true; }).catch(function (e) {
            console.warn('Cloud write failed for ' + key + ':', e);
            return false;
        });
    }

    // ── Pull ─────────────────────────────────────────────────────
    // Bring the cloud's entries down and union them with what this
    // device has. Returns {ok, count, changed} so a caller can skip
    // re-rendering when nothing moved.
    function pullBinderData() {
        return syncTombstones('binderDeletedIds').then(function (tombs) {
            return readCloud('binderData').then(function (res) {
                if (!res.ok) return { ok: false, count: 0, changed: false };
                var local = readLocal('binderData', []);
                var merged = mergeBinderData(local, Array.isArray(res.value) ? res.value : [], tombs);
                var str = JSON.stringify(merged);
                var changed = str !== JSON.stringify(local);
                if (changed) rawSet('binderData', str);
                return { ok: true, count: merged.length, changed: changed };
            });
        }).catch(function () { return { ok: false, count: 0, changed: false }; });
    }

    // A new client shows up as both a policy entry and a contact record, so
    // a refresh has to bring down both or the client list and the contact
    // card disagree.
    function pullRecordMap(key) {
        return readCloud(key).then(function (res) {
            if (!res.ok) return { ok: false, changed: false };
            var local = readLocal(key, {});
            var merged = mergeClientData(local, res.value);
            var str = JSON.stringify(merged);
            var changed = str !== JSON.stringify(local);
            if (changed) rawSet(key, str);
            return { ok: true, changed: changed };
        }).catch(function () { return { ok: false, changed: false }; });
    }

    function pullClientData() { return pullRecordMap('amsClientData'); }

    function pull() {
        var jobs = [pullBinderData()].concat(RECORD_MAP_KEYS.map(pullRecordMap));
        return Promise.all(jobs).then(function (r) {
            return {
                ok: r.some(function (x) { return x.ok; }),
                count: r[0].count,
                changed: r.some(function (x) { return x.changed; })
            };
        });
    }

    // MERGE_KEYS must stay in step with app.js's SYNC_KEYS: a key app.js
    // protects but this list does not is a key the AMS would push raw, which
    // is the whole bug this file exists to close. app.js appends to SYNC_KEYS
    // at runtime, so check after load rather than trusting the literals.
    function auditKeyParity() {
        if (typeof SYNC_KEYS === 'undefined') return;
        var missing = SYNC_KEYS.filter(function (k) { return MERGE_KEYS.indexOf(k) === -1; });
        if (missing.length) {
            console.error('uib-binder-sync: these SYNC_KEYS are unprotected on pages without app.js — ' +
                          'add them to MERGE_KEYS: ' + missing.join(', '));
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(auditKeyParity, 0); });
    } else {
        setTimeout(auditKeyParity, 0);
    }

    window.UIBBinderSync = {
        MERGE_KEYS: MERGE_KEYS,
        TOMBSTONE_KEYS: TOMBSTONE_KEYS,
        isMergeManaged: isMergeManaged,
        mergeBinderData: mergeBinderData,
        mergeClientData: mergeClientData,
        readCloud: readCloud,
        save: save,
        markDeleted: markDeleted,
        pull: pull,
        pullBinderData: pullBinderData,
        pullClientData: pullClientData
    };
})();
