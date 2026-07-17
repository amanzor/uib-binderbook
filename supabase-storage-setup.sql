-- ============================================================
--  UIB — Supabase Storage setup (run ONCE)
--
--  Creates the "client-files" bucket used by:
--    • AMS client document uploads (ams.html)
--    • AI Commission Processor original statement PDFs
--      (attached to each statement month's "Documents" button)
--
--  HOW TO RUN:
--    1. Open your Supabase project dashboard.
--    2. Left sidebar ▸ SQL Editor ▸ New query.
--    3. Paste this entire file and click RUN. Safe to re-run.
-- ============================================================

-- 1. Create the bucket (private — files are fetched with the app's key)
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;

-- 2. Allow the app (anon key) to read / write / delete files in this bucket.
--    TIGHTEN these once real logins are wired (like the app_store policies).
drop policy if exists "client_files_read"   on storage.objects;
drop policy if exists "client_files_insert" on storage.objects;
drop policy if exists "client_files_update" on storage.objects;
drop policy if exists "client_files_delete" on storage.objects;

create policy "client_files_read"   on storage.objects for select using (bucket_id = 'client-files');
create policy "client_files_insert" on storage.objects for insert with check (bucket_id = 'client-files');
create policy "client_files_update" on storage.objects for update using (bucket_id = 'client-files');
create policy "client_files_delete" on storage.objects for delete using (bucket_id = 'client-files');

-- 3. The documents table needs three columns the app writes but the original
--    schema didn't have (file listings key off client_key).
alter table documents add column if not exists client_key  text;
alter table documents add column if not exists mime_type   text;
alter table documents add column if not exists uploaded_by text;
create index if not exists idx_documents_client_key on documents(client_key);
