-- ============================================================
--  UIB Binder Book — require 2-step verification at the database
--  ------------------------------------------------------------
--  Optional hardening, run AFTER supabase-auth-lockdown.sql and after
--  every agent has enrolled an authenticator in the app.
--
--  The app already demands the 6-digit code before it lets anyone in.
--  This makes the database itself refuse a session that has not passed
--  2-step verification (assurance level aal2), so a stolen password alone
--  reads nothing even with a modified copy of the app.
-- ============================================================

create or replace function public.uib_is_mfa_verified() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- app_store
drop policy if exists "app_store_authenticated_select" on app_store;
drop policy if exists "app_store_authenticated_insert" on app_store;
drop policy if exists "app_store_authenticated_update" on app_store;
drop policy if exists "app_store_authenticated_delete" on app_store;
create policy "app_store_mfa_select" on app_store for select to authenticated using (public.uib_is_mfa_verified());
create policy "app_store_mfa_insert" on app_store for insert to authenticated with check (public.uib_is_mfa_verified());
create policy "app_store_mfa_update" on app_store for update to authenticated using (public.uib_is_mfa_verified()) with check (public.uib_is_mfa_verified());
create policy "app_store_mfa_delete" on app_store for delete to authenticated using (public.uib_is_mfa_verified());

-- relational tables
drop policy if exists "clients_authenticated"   on clients;
drop policy if exists "policies_authenticated"  on policies;
drop policy if exists "notes_authenticated"     on notes;
drop policy if exists "agents_authenticated"    on agents;
drop policy if exists "documents_authenticated" on documents;
create policy "clients_mfa"   on clients   for all to authenticated using (public.uib_is_mfa_verified()) with check (public.uib_is_mfa_verified());
create policy "policies_mfa"  on policies  for all to authenticated using (public.uib_is_mfa_verified()) with check (public.uib_is_mfa_verified());
create policy "notes_mfa"     on notes     for all to authenticated using (public.uib_is_mfa_verified()) with check (public.uib_is_mfa_verified());
create policy "agents_mfa"    on agents    for all to authenticated using (public.uib_is_mfa_verified()) with check (public.uib_is_mfa_verified());
create policy "documents_mfa" on documents for all to authenticated using (public.uib_is_mfa_verified()) with check (public.uib_is_mfa_verified());

-- max_leads
drop policy if exists "max_leads_authenticated_select" on max_leads;
drop policy if exists "max_leads_authenticated_update" on max_leads;
create policy "max_leads_mfa_select" on max_leads for select to authenticated using (public.uib_is_mfa_verified());
create policy "max_leads_mfa_update" on max_leads for update to authenticated using (public.uib_is_mfa_verified()) with check (public.uib_is_mfa_verified());

-- client-files bucket
drop policy if exists "client_files_auth_read"   on storage.objects;
drop policy if exists "client_files_auth_insert" on storage.objects;
drop policy if exists "client_files_auth_update" on storage.objects;
drop policy if exists "client_files_auth_delete" on storage.objects;
create policy "client_files_mfa_read"   on storage.objects for select to authenticated using (bucket_id = 'client-files' and public.uib_is_mfa_verified());
create policy "client_files_mfa_insert" on storage.objects for insert to authenticated with check (bucket_id = 'client-files' and public.uib_is_mfa_verified());
create policy "client_files_mfa_update" on storage.objects for update to authenticated using (bucket_id = 'client-files' and public.uib_is_mfa_verified()) with check (bucket_id = 'client-files' and public.uib_is_mfa_verified());
create policy "client_files_mfa_delete" on storage.objects for delete to authenticated using (bucket_id = 'client-files' and public.uib_is_mfa_verified());

-- Note: the agent-roster lookup at first sign-in (uib-auth.js reads
-- agentMasterData before the code step) will no longer work once this is
-- applied, so make sure every account has agent_name set before running it
-- (sign in once on the app before this, or set it in Authentication ▸ Users).
