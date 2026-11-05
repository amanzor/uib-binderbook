-- ============================================================
--  UIB BINDER BOOK — SERVER-SIDE ANTI-WIPE GUARD
--  ------------------------------------------------------------
--  Root cause of the data loss: binderData is stored as one big
--  JSON array in app_store, and ANY client (even a browser tab
--  running old, cached code) can overwrite that whole row. Every
--  earlier safeguard lives in the app's JavaScript, so a stale
--  tab that predates those safeguards bypasses all of them.
--
--  This moves the "never let the book shrink" rule into the
--  DATABASE, where no client can get around it. A single write is
--  allowed to ADD any number of entries, but may only REMOVE up to
--  SHRINK_THRESHOLD entries at once. A mass wipe (dozens gone in
--  one write) is rejected outright and the client gets an error.
--
--  HOW TO INSTALL:
--    1. Supabase ▸ SQL Editor ▸ New query.
--    2. Paste this whole file ▸ RUN. (Safe to re-run.)
--
--  NORMAL DELETIONS still work: the app deletes one (or a few)
--  policies at a time, well under the threshold. For a LARGE
--  intentional cleanup (removing more than SHRINK_THRESHOLD at
--  once), either do it in smaller batches or temporarily raise the
--  threshold (see the bottom of this file), then set it back.
-- ============================================================

-- How many entries a single write may remove before it's blocked.
-- The wipe that triggered this dropped 73 at once; real deletions
-- are one-at-a-time. 25 stops mass wipes while allowing routine
-- cleanup. Adjust to taste.
create table if not exists app_guard_config (
    name  text primary key,
    value int not null
);
insert into app_guard_config (name, value)
values ('binderData_shrink_threshold', 25)
on conflict (name) do nothing;

-- A running history of every ACCEPTED binderData write, so the
-- book's size over time is always auditable (who/when isn't
-- available at the DB layer, but size + timestamp catches trends).
create table if not exists binderdata_write_log (
    id         bigserial primary key,
    at         timestamptz default now(),
    old_len    int,
    new_len    int,
    delta      int
);

create or replace function guard_binderdata_shrink()
returns trigger as $$
declare
    old_len   int;
    new_len   int;
    threshold int;
begin
    -- Only police the binder book blob; every other key is untouched.
    if NEW.key <> 'binderData' then
        return NEW;
    end if;

    -- Length of the incoming array (treat non-arrays as empty/invalid).
    new_len := coalesce(
        jsonb_array_length(case when jsonb_typeof(NEW.value) = 'array'
                                then NEW.value else '[]'::jsonb end), 0);

    -- Length currently stored (0 if this is the very first write).
    select coalesce(
             jsonb_array_length(case when jsonb_typeof(value) = 'array'
                                     then value else '[]'::jsonb end), 0)
      into old_len
      from app_store
     where key = 'binderData';
    old_len := coalesce(old_len, 0);

    select value into threshold from app_guard_config
     where name = 'binderData_shrink_threshold';
    threshold := coalesce(threshold, 25);

    -- Reject a write that removes more than the allowed number of
    -- entries. Growth (new_len >= old_len) is always fine.
    if old_len > 0 and new_len < old_len - threshold then
        raise exception
          'binderData shrink blocked: % -> % (removes % entries, over the % limit). '
          'If this is an intentional bulk deletion, do it in smaller batches '
          'or raise binderData_shrink_threshold in app_guard_config.',
          old_len, new_len, old_len - new_len, threshold;
    end if;

    -- Accepted — record the size change for the audit trail.
    insert into binderdata_write_log (old_len, new_len, delta)
    values (old_len, new_len, new_len - old_len);

    return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_guard_binderdata on app_store;
create trigger trg_guard_binderdata
    before insert or update on app_store
    for each row execute function guard_binderdata_shrink();

-- ============================================================
--  OPTIONAL — for a large intentional deletion:
--    update app_guard_config set value = 500
--      where name = 'binderData_shrink_threshold';
--    -- ... perform the cleanup in the app ...
--    update app_guard_config set value = 25
--      where name = 'binderData_shrink_threshold';
--
--  To see the book's size history (newest first):
--    select at, old_len, new_len, delta
--      from binderdata_write_log order by at desc limit 50;
-- ============================================================
