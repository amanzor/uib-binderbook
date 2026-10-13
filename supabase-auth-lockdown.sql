-- ============================================================
--  UIB Binder Book — lock the cloud store to signed-in users
--  ------------------------------------------------------------
--  Run this in Supabase ▸ SQL Editor AFTER:
--    1. Auth accounts exist for every agent and admin
--       (see scripts/create_auth_users.mjs), and
--    2. the app version that signs in through Supabase Auth is live.
--  Until both are true, running this will lock agents out.
--
--  What it does: replaces the TEMPORARY "anyone" policies with rules
--  that require an authenticated Supabase user, on every table and on
--  the client-files storage bucket. The anon key alone then reads
--  nothing and writes nothing.
-- ============================================================

-- ── app_store (the key/value store the app syncs to) ─────────
drop policy if exists "temp_all_app_store" on app_store;
create policy "app_store_authenticated_select" on app_store for select to authenticated using (true);
create policy "app_store_authenticated_insert" on app_store for insert to authenticated with check (true);
create policy "app_store_authenticated_update" on app_store for update to authenticated using (true) with check (true);
create policy "app_store_authenticated_delete" on app_store for delete to authenticated using (true);

-- ── relational tables (defined for later use; same rule) ─────
drop policy if exists "temp_all_clients"   on clients;
drop policy if exists "temp_all_policies"  on policies;
drop policy if exists "temp_all_notes"     on notes;
drop policy if exists "temp_all_agents"    on agents;
drop policy if exists "temp_all_documents" on documents;

create policy "clients_authenticated"   on clients   for all to authenticated using (true) with check (true);
create policy "policies_authenticated"  on policies  for all to authenticated using (true) with check (true);
create policy "notes_authenticated"     on notes     for all to authenticated using (true) with check (true);
create policy "agents_authenticated"    on agents    for all to authenticated using (true) with check (true);
create policy "documents_authenticated" on documents for all to authenticated using (true) with check (true);

-- ── max_leads (consumer leads inserted by the inquiry function) ──
drop policy if exists "max_leads_read"   on max_leads;
drop policy if exists "max_leads_update" on max_leads;
create policy "max_leads_authenticated_select" on max_leads for select to authenticated using (true);
create policy "max_leads_authenticated_update" on max_leads for update to authenticated using (true) with check (true);

-- ── client-files storage bucket ──────────────────────────────
drop policy if exists "client_files_read"   on storage.objects;
drop policy if exists "client_files_insert" on storage.objects;
drop policy if exists "client_files_update" on storage.objects;
drop policy if exists "client_files_delete" on storage.objects;

create policy "client_files_auth_read"   on storage.objects for select to authenticated using (bucket_id = 'client-files');
create policy "client_files_auth_insert" on storage.objects for insert to authenticated with check (bucket_id = 'client-files');
create policy "client_files_auth_update" on storage.objects for update to authenticated using (bucket_id = 'client-files') with check (bucket_id = 'client-files');
create policy "client_files_auth_delete" on storage.objects for delete to authenticated using (bucket_id = 'client-files');

-- ── remove the rows that held the old exposure ───────────────
-- Plaintext agent logins (now handled by Supabase Auth) and the
-- rolling snapshots that carried copies of the book. Daily backups
-- should come from Supabase's own backup feature instead.
delete from app_store where key in ('agentCredentials', 'uibCloudStamp_agentCredentials');
delete from app_store where key like 'backupSnapshot_%';

-- ── verify ───────────────────────────────────────────────────
-- select schemaname, tablename, policyname, roles from pg_policies
--  where tablename in ('app_store','clients','policies','notes','agents','documents','max_leads','objects');
