#!/usr/bin/env node
// ============================================================
//  Create Supabase Auth accounts for the agency's agents + admin.
//  ------------------------------------------------------------
//  Run ONCE on your own computer (never in the browser):
//
//    SUPABASE_URL=https://jgjmobktucyimupelfxd.supabase.co \
//    SUPABASE_SERVICE_ROLE_KEY=<service role key from Dashboard ▸ Settings ▸ API> \
//    node scripts/create_auth_users.mjs users.csv
//
//  users.csv (header row required):
//    name,email,password,role
//    Alberto Manzor,alberto@example.com,TempPass!2026,admin
//    Randy Diaz,randy@example.com,TempPass!2026,agent
//
//  • `name` must match the agent's name in the Binder Book exactly
//    (it becomes user_metadata.agent_name and is what shows on screen).
//  • `role` is admin or agent (becomes app_metadata.role).
//  • Give everyone a temporary password and ask them to change it from
//    the app on first sign-in (Change password in the user menu).
//  • Re-running updates existing accounts (matched by email) instead of
//    failing.
// ============================================================
import { readFileSync } from 'node:fs';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const file = process.argv[2];
if (!URL || !KEY || !file) {
    console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/create_auth_users.mjs users.csv');
    process.exit(1);
}

const headers = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const cols = lines.shift().split(',').map((c) => c.trim().toLowerCase());
    return lines.map((line) => {
        const cells = line.split(',').map((c) => c.trim());
        const row = {}; cols.forEach((c, i) => { row[c] = cells[i] || ''; });
        return row;
    });
}

async function findByEmail(email) {
    const res = await fetch(`${URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
    if (!res.ok) throw new Error('List users failed: HTTP ' + res.status);
    const data = await res.json();
    return (data.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
}

async function upsert(row) {
    const email = row.email.toLowerCase();
    const role = row.role === 'admin' ? 'admin' : 'agent';
    const body = {
        email, password: row.password, email_confirm: true,
        user_metadata: { agent_name: row.name },
        app_metadata: { role }
    };
    const existing = await findByEmail(email);
    const res = existing
        ? await fetch(`${URL}/auth/v1/admin/users/${existing.id}`, { method: 'PUT', headers, body: JSON.stringify(body) })
        : await fetch(`${URL}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${email}: HTTP ${res.status} ${data.msg || data.message || data.error || ''}`);
    console.log(`${existing ? 'updated' : 'created'}  ${row.name} <${email}>  role=${role}`);
}

const rows = parseCsv(readFileSync(file, 'utf8'));
for (const row of rows) {
    if (!row.name || !row.email || !row.password) { console.warn('skipping incomplete row', row); continue; }
    try { await upsert(row); } catch (e) { console.error('FAILED', e.message); }
}
