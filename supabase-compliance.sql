-- ============================================================
--  UIB Binder Book — compliance tables (run once, after the lockdown SQL)
--  ------------------------------------------------------------
--  audit_log: append-only record of sign-ins and of who viewed, changed,
--  exported or deleted customer records. Agents can only add rows about
--  themselves; only administrators can read; nobody can edit or delete
--  through the app (keep that for a 5-year retention job run by the admin).
-- ============================================================

create or replace function public.uib_is_admin() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
      or lower(coalesce(auth.jwt() ->> 'email', '')) in (
           'admin@universalinsurancebroker.com', 'amanzor89@gmail.com',
           'randy@universalinsurancebroker.com', 'amanda@universalinsurancebroker.com');
$$;

create table if not exists public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     uuid        not null default auth.uid(),
  user_email  text,
  user_name   text,
  action      text        not null,
  target      text,
  details     jsonb,
  page        text
);
create index if not exists audit_log_at_idx     on public.audit_log (at desc);
create index if not exists audit_log_email_idx  on public.audit_log (user_email, at desc);

alter table public.audit_log enable row level security;
drop policy if exists "audit_insert_own"    on public.audit_log;
drop policy if exists "audit_select_admin"  on public.audit_log;
create policy "audit_insert_own"   on public.audit_log for insert to authenticated with check (user_id = auth.uid());
create policy "audit_select_admin" on public.audit_log for select to authenticated using (public.uib_is_admin());
-- No update/delete policies on purpose: the log is append-only from the app.

-- Yearly confidentiality acknowledgments and retention settings live in
-- app_store (keys complianceAcks, complianceSettings) under the existing
-- authenticated-only policies.

-- Optional: keep 5 years of log and prune older rows (run manually, or as a
-- pg_cron job on Pro):
--   delete from public.audit_log where at < now() - interval '5 years';
