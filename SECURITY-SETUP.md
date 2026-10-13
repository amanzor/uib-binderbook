# Binder Book — security lockdown rollout

This release moves logins to Supabase Auth and closes the cloud store to
anyone who is not signed in. Follow the steps **in this order**; doing the
SQL step before the accounts exist locks everyone out.

## 1. Create the accounts

### Easiest: from the app

Deploy the login-management function once: Dashboard ▸ Edge Functions ▸
Deploy a new function ▸ name it exactly `admin-users` ▸ paste
`supabase/functions/admin-users/index.ts` ▸ Deploy. No secrets to add.

Then sign in as an administrator, open **Manage Login Credentials** and use
**Add Login** for each agent: pick the agent, type their email and a
temporary password (10+ characters). The page also shows who has signed in,
resets passwords, links an account to an agent, clears 2-step and deletes.

### Alternative: script

On your own computer, with Node 18 or newer:

```
# users.csv — one row per person. name must match the Binder Book agent name.
name,email,password,role
Alberto Manzor,alberto@universalinsurancebroker.com,TempPass!2026,admin
Randy Diaz,randy@universalinsurancebroker.com,TempPass!2026,agent

SUPABASE_URL=https://jgjmobktucyimupelfxd.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<Dashboard ▸ Project Settings ▸ API ▸ service_role> \
node scripts/create_auth_users.mjs users.csv
```

Delete `users.csv` afterwards. Ask everyone to change their temporary
password on first sign-in (the **Password** button next to Logout).

Alternative without the script: Dashboard ▸ Authentication ▸ Users ▸ Add
user. Then open the user and set **User Metadata** `{"agent_name": "Randy
Diaz"}` and, for admins only, **App Metadata** `{"role": "admin"}`.

## 2. Merge this release

The new sign-in screens take email + password. Until step 3 runs, the old
open policies still allow reads, so nothing breaks during the switch.

## 3. Redeploy the three edge functions

Dashboard ▸ Edge Functions, open each of `claude`, `rate`, `inquiry`, paste
the new contents from `supabase/functions/<name>/index.ts`, Deploy. In
**Manage secrets** add:

| Secret | Value |
| --- | --- |
| `RATER_ALLOWED_HOSTS` | comma-separated carrier API hostnames (can be empty for now; the rater refuses to call anything until it is set) |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided automatically.

## 4. Run the lockdown SQL

Dashboard ▸ SQL Editor ▸ paste `supabase-auth-lockdown.sql` ▸ Run. This
replaces the temporary "anyone" policies with authenticated-only rules on
every table and on the `client-files` bucket, and deletes the old
plaintext credentials row and rolling snapshots.

Verify from a terminal (should return `[]` and a 401):

```
curl -s "https://jgjmobktucyimupelfxd.supabase.co/rest/v1/app_store?select=key&limit=1" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://jgjmobktucyimupelfxd.supabase.co/functions/v1/claude" \
  -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" -d '{}'
```

## 4b. Run the compliance SQL

Dashboard ▸ SQL Editor ▸ paste `supabase-compliance.sql` ▸ Run. Creates the
append-only `audit_log` table behind the admin **Access Log** page. Until it
runs, the Access Log page shows "table does not exist" and activity is not
recorded (the app keeps working).

## 5. Rotate the anon key

The current anon key has been in public page source since the project
began. Dashboard ▸ Project Settings ▸ API ▸ **Generate new anon key**, then
replace the old value in `uib-auth.js`, `app.js`, `ams.js`, `rater.js`,
`supabase.js` and `ams.html` and deploy. The old key stops working.

## 6. Turn on backups

Dashboard ▸ Database ▸ Backups ▸ enable daily backups (or Point-in-time
Recovery on Pro). The in-app rolling snapshots are retired.

## 7. Retire the Google Apps Script mirror

The app no longer calls the old Apps Script URL. Delete the deployment in
Google Apps Script (Deploy ▸ Manage deployments ▸ Archive) and clear its
Sheet so the unauthenticated copy of the data is gone.

## 8. Keep the written program current

`SECURITY-PROGRAM.md` is the agency's written information security and
privacy program (Safeguards Rule). Review it yearly, fill in the agency
address and phone in `privacy-notice.html`, and keep training attendance
with it.

## What changed in the app

- Sign-in is email + password through Supabase Auth on the Binder Book, AMS
  and Auto Rater. Admin is a role on the account, not a shared password.
- Sessions live in the tab, end on close, and sign out after 30 idle
  minutes. Every call to Supabase carries the user's token.
- The `admin123` / `admin2024` passwords are gone. Agent passwords are no
  longer stored or synced; the old credential screens now explain where
  accounts are managed.
- Carrier portal passwords on rater cards stay on the device and are not
  synced.
- The AI and rating functions refuse callers who are not signed in; the
  rating function only calls hosts in `RATER_ALLOWED_HOSTS`; the public
  inquiry function is rate-limited and size-capped.
- Security headers (Content-Security-Policy, frame denial, nosniff,
  referrer policy) are set in `vercel.json`.
- 2-step verification (authenticator app) is required for every account.
- Every user accepts a yearly confidentiality & security acknowledgment
  before working; administrators see who has in the Access Log page.
- Access Log: sign-ins, client views, saves, deletes, exports, file views
  and uploads, credential changes and retention deletions are recorded in
  the append-only `audit_log` table.
- Retention Review: entries past the retention period (default 7 years,
  minimum 5) can be deleted; records on legal hold are protected.
- AMS Contact tab records when and how the privacy notice was delivered;
  `privacy-notice.html` is the printable GLBA / Florida notice.
