-- ============================================================
--  MAX by UIB — leads table
--  Optional. When this table exists, the "inquiry" edge function
--  stores every lead it emails, so leads survive even if an email
--  is missed. Run once in Supabase ▸ SQL Editor.
-- ============================================================
create table if not exists max_leads (
    id          uuid primary key default gen_random_uuid(),
    created_at  timestamptz default now(),
    source      text,            -- 'max-app' (consumer app) or 'rater' (agent MAX tab)
    subject     text,
    lead        jsonb,           -- name, phone, email, dl {...}, vin, vehicle {...}, current_insurer, address
    text        text,            -- the email body as sent
    status      text default 'new',   -- new / contacted / quoted / closed
    assigned_to text,
    notes       text
);
alter table max_leads enable row level security;
-- The edge function writes with the service role (bypasses RLS). Agents read through the app's anon key:
create policy "max_leads_read" on max_leads for select using (true);
create policy "max_leads_update" on max_leads for update using (true);
