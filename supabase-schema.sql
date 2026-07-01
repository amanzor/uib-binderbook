-- ============================================================
--  UIB BINDER BOOK — Supabase Database Schema
--  Phase 1: move Binder Book + AMS off localStorage.
--
--  HOW TO USE:
--    1. Open your Supabase project.
--    2. Left sidebar ▸ SQL Editor ▸ New query.
--    3. Paste this entire file and click RUN.
--    That creates every table below. Safe to re-run.
-- ============================================================


-- ────────────────────────────────────────────────────────────
--  STEP 1A — "Safe landing" key/value store
--  A near drop-in replacement for the current localStorage /
--  Google Apps Script storage. Lets us cut over with almost no
--  code changes and NO size limits (kills the crashes), then
--  normalize into the real tables below at our own pace.
-- ────────────────────────────────────────────────────────────
create table if not exists app_store (
    key         text primary key,
    value       jsonb,
    updated_at  timestamptz default now()
);


-- ────────────────────────────────────────────────────────────
--  STEP 1B — The real relational tables
--  (mapped directly from the data the app already uses)
-- ────────────────────────────────────────────────────────────

-- Clients / insureds  (from amsClientData)
create table if not exists clients (
    id            uuid primary key default gen_random_uuid(),
    client_key    text unique,              -- matches the app's existing client key
    first_name    text,
    last_name     text,
    display_name  text,
    dob           date,
    phone1        text,
    phone2        text,
    email         text,
    address       text,
    city          text,
    state         text,
    zip           text,
    assigned_agent text,
    source        text,
    client_status text default 'Active',
    extra         jsonb,                    -- any fields not broken out above
    created_at    timestamptz default now(),
    updated_at    timestamptz default now()
);

-- Policies / binder entries  (from binderData)
create table if not exists policies (
    id                 uuid primary key default gen_random_uuid(),
    legacy_id          bigint,              -- the app's original numeric id
    client_id          uuid references clients(id) on delete set null,
    customer_name      text,
    agent              text,
    source             text,
    policy_type        text,
    line_of_business   text,
    company            text,
    mga                text,
    policy_number      text,
    binder_number      text,
    base_premium       numeric(12,2),
    agency_fee         numeric(12,2),
    down_payment       numeric(12,2),
    agency_commission  numeric(12,2),
    agent_commission_share numeric(12,2),
    total_premium      numeric(12,2),
    payment_type       text,
    eff_date           date,
    expiration_date    date,
    term               text,
    entry_date         date,
    status             text default 'Active',
    al3_source_file    text,
    al3_txn_code       text,
    transaction_history jsonb,              -- carrier file events array
    extra              jsonb,               -- any remaining fields
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
);

-- Client notes  (from amsClientData[].notes)
create table if not exists notes (
    id          uuid primary key default gen_random_uuid(),
    client_id   uuid references clients(id) on delete cascade,
    author      text,
    body        text,
    note_date   text,
    created_at  timestamptz default now()
);

-- Agents  (from agentMasterData / agentCredentials)
create table if not exists agents (
    id          uuid primary key default gen_random_uuid(),
    name        text,
    email       text unique,
    role        text default 'agent',       -- 'admin' or 'agent'
    active      boolean default true,
    extra       jsonb,
    created_at  timestamptz default now()
);

-- Document metadata  (actual files go in Supabase Storage later)
create table if not exists documents (
    id          uuid primary key default gen_random_uuid(),
    client_id   uuid references clients(id) on delete cascade,
    file_name   text,
    category    text,
    storage_path text,
    size_bytes  bigint,
    uploaded_at timestamptz default now()
);


-- ────────────────────────────────────────────────────────────
--  Helpful indexes for fast search / reporting
-- ────────────────────────────────────────────────────────────
create index if not exists idx_policies_client   on policies(client_id);
create index if not exists idx_policies_polnum    on policies(policy_number);
create index if not exists idx_policies_status    on policies(status);
create index if not exists idx_policies_agent     on policies(agent);
create index if not exists idx_clients_name       on clients(last_name, first_name);
create index if not exists idx_notes_client       on notes(client_id);


-- ────────────────────────────────────────────────────────────
--  Auto-update the updated_at timestamp on any change
-- ────────────────────────────────────────────────────────────
create or replace function touch_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clients_touch on clients;
create trigger trg_clients_touch before update on clients
    for each row execute function touch_updated_at();

drop trigger if exists trg_policies_touch on policies;
create trigger trg_policies_touch before update on policies
    for each row execute function touch_updated_at();


-- ────────────────────────────────────────────────────────────
--  SECURITY — Row Level Security
--  Enabled now; we'll add precise access policies once logins
--  are wired. For initial testing we allow the anon key to
--  read/write (TIGHTEN THIS before going live with real data).
-- ────────────────────────────────────────────────────────────
alter table app_store enable row level security;
alter table clients   enable row level security;
alter table policies  enable row level security;
alter table notes     enable row level security;
alter table agents    enable row level security;
alter table documents enable row level security;

-- TEMPORARY open policies for setup/testing. Replace with
-- authenticated-only rules before storing live client data.
create policy "temp_all_app_store" on app_store for all using (true) with check (true);
create policy "temp_all_clients"   on clients   for all using (true) with check (true);
create policy "temp_all_policies"  on policies  for all using (true) with check (true);
create policy "temp_all_notes"     on notes     for all using (true) with check (true);
create policy "temp_all_agents"    on agents    for all using (true) with check (true);
create policy "temp_all_documents" on documents for all using (true) with check (true);
