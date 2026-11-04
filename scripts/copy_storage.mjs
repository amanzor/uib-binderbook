#!/usr/bin/env node
// ============================================================
//  Copy uploaded client documents from one Supabase to another
//  (cloud -> self-hosted) and check both sides match.
//
//  The database (tables, logins, security rules) is copied with the
//  Supabase dump commands in SELF-HOST-SETUP.md; this script copies the
//  files in Storage, which a database dump does not include.
//
//  Usage (Node 18+):
//    SRC_URL=https://jgjmobktucyimupelfxd.supabase.co \
//    SRC_SERVICE_KEY=<cloud service_role key> \
//    DST_URL=https://data.universalinsurancebroker.com \
//    DST_SERVICE_KEY=<self-hosted service_role key> \
//    node scripts/copy_storage.mjs            # copies bucket "client-files"
//    node scripts/copy_storage.mjs --check    # only compares, copies nothing
//
//  Safe to run more than once: files already present with the same size
//  are skipped. Service-role keys are secrets; never commit them.
// ============================================================

const { SRC_URL, SRC_SERVICE_KEY, DST_URL, DST_SERVICE_KEY } = process.env;
const BUCKETS = (process.env.BUCKETS || 'client-files').split(',').map(s => s.trim()).filter(Boolean);
const CHECK_ONLY = process.argv.includes('--check');

if (!SRC_URL || !SRC_SERVICE_KEY || !DST_URL || !DST_SERVICE_KEY) {
  console.error('Set SRC_URL, SRC_SERVICE_KEY, DST_URL and DST_SERVICE_KEY first (see the header of this file).');
  process.exit(1);
}

const hdr = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra });
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function listAll(base, key, bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: hdr(key, { 'content-type': 'application/json' }),
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (r.status === 404 || r.status === 400) return out;   // bucket missing on this side
    if (!r.ok) throw new Error(`list ${bucket}/${prefix}: HTTP ${r.status} ${await r.text()}`);
    const items = await r.json();
    for (const it of items) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id == null) out.push(...await listAll(base, key, bucket, path));       // folder
      else out.push({ path, size: (it.metadata && it.metadata.size) || 0, type: (it.metadata && it.metadata.mimetype) || 'application/octet-stream' });
    }
    if (items.length < 1000) return out;
  }
}

async function ensureBucket(bucket) {
  const r = await fetch(`${DST_URL}/storage/v1/bucket/${bucket}`, { headers: hdr(DST_SERVICE_KEY) });
  if (r.ok) return;
  const c = await fetch(`${DST_URL}/storage/v1/bucket`, {
    method: 'POST', headers: hdr(DST_SERVICE_KEY, { 'content-type': 'application/json' }),
    body: JSON.stringify({ id: bucket, name: bucket, public: false }),
  });
  if (!c.ok) throw new Error(`create bucket ${bucket}: HTTP ${c.status} ${await c.text()}`);
  console.log(`Created private bucket "${bucket}" on the destination.`);
}

async function copyOne(bucket, f) {
  const d = await fetch(`${SRC_URL}/storage/v1/object/${bucket}/${enc(f.path)}`, { headers: hdr(SRC_SERVICE_KEY) });
  if (!d.ok) throw new Error(`download ${f.path}: HTTP ${d.status}`);
  const body = Buffer.from(await d.arrayBuffer());
  const u = await fetch(`${DST_URL}/storage/v1/object/${bucket}/${enc(f.path)}`, {
    method: 'POST', headers: hdr(DST_SERVICE_KEY, { 'content-type': f.type, 'x-upsert': 'true' }), body,
  });
  if (!u.ok) throw new Error(`upload ${f.path}: HTTP ${u.status} ${await u.text()}`);
}

let failed = 0, mismatched = 0;
for (const bucket of BUCKETS) {
  console.log(`\n== ${bucket}`);
  const src = await listAll(SRC_URL, SRC_SERVICE_KEY, bucket);
  if (!CHECK_ONLY) await ensureBucket(bucket);
  const dstMap = new Map((await listAll(DST_URL, DST_SERVICE_KEY, bucket)).map(f => [f.path, f.size]));
  const todo = src.filter(f => dstMap.get(f.path) !== f.size);
  console.log(`source files: ${src.length} | already on destination: ${src.length - todo.length} | to copy: ${todo.length}`);
  if (CHECK_ONLY) { mismatched += todo.length; todo.slice(0, 20).forEach(f => console.log('  missing or different:', f.path)); continue; }
  let done = 0;
  for (const f of todo) {
    try { await copyOne(bucket, f); done++; if (done % 25 === 0) console.log(`  copied ${done}/${todo.length}`); }
    catch (e) { failed++; console.error('  FAILED', e.message); }
  }
  const after = new Map((await listAll(DST_URL, DST_SERVICE_KEY, bucket)).map(f => [f.path, f.size]));
  const still = src.filter(f => after.get(f.path) !== f.size);
  console.log(`copied ${done} | destination now matches source for ${src.length - still.length} of ${src.length} files`);
  mismatched += still.length;
}
const bad = failed + mismatched;
console.log(bad ? `\nNot finished: ${mismatched} file(s) missing or different, ${failed} copy error(s). Run the script again.` : '\nAll files match.');
process.exit(bad ? 1 : 0);
