# Running the Binder Book's data on your own server

Today the Binder Book's data (entries, clients, logins, uploaded documents)
lives in Supabase's cloud. This guide moves it to a computer you own, with
a Cloudflare Tunnel so agents still reach it from anywhere at
`https://data.universalinsurancebroker.com`. The website itself stays on
Vercel; only the data moves.

The app needs no code changes: it talks to self-hosted Supabase exactly as
it talks to the cloud. Switching is two values in `uib-config.js`.

## Read this first

- **The server must stay on.** If it is off, asleep, updating, or loses
  power or internet, nobody can use the Binder Book or AMS. Use a
  computer that does nothing else, set it never to sleep, and put it on a
  battery backup (UPS).
- **You own the backups.** Step 7 is not optional.
- **You need:** a computer with 16 GB of memory and an SSD (a mini PC is
  ideal), Docker, a free Cloudflare account, and the
  universalinsurancebroker.com domain moved to Cloudflare's DNS (free plan).
- **Expect a 30–60 minute window** with no entries saved while the data is
  copied (step 5). Do it after hours.
- Nothing changes for anyone until step 6. Until then the cloud keeps
  working as today.

## 1. Install Docker

- Windows: install Docker Desktop (it sets up WSL 2). Settings ▸ General ▸
  "Start Docker Desktop when you sign in".
- Ubuntu (recommended for a dedicated mini PC):
  `curl -fsSL https://get.docker.com | sh`

Turn on full-disk encryption (Windows: BitLocker; Ubuntu: choose
"encrypt the disk" at install). Client data at rest must be encrypted.

## 2. Start self-hosted Supabase

```
git clone --depth 1 https://github.com/supabase/supabase
mkdir uib-supabase && cp -r supabase/docker/* uib-supabase/ && cp supabase/docker/.env.example uib-supabase/.env
cd uib-supabase
```

Edit `.env`:

| Setting | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | a long random password |
| `JWT_SECRET` | a random string of at least 40 characters |
| `ANON_KEY`, `SERVICE_ROLE_KEY` | generate from `JWT_SECRET` with the key generator in Supabase's self-hosting docs ("Generate API keys") |
| `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` | your own; protects the admin dashboard |
| `SITE_URL` | `https://uib-binderbook.vercel.app` |
| `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL` | `https://data.universalinsurancebroker.com` |

Then:

```
docker compose pull
docker compose up -d
```

Open `http://localhost:8000` on the server and sign in with the dashboard
username and password to confirm it is running.

## 3. Install the app's server functions

Copy the four folders from this repository's `supabase/functions/`
(`claude`, `admin-users`, `inquiry`, and any others there) into
`uib-supabase/volumes/functions/`. In `.env`, add
`ANTHROPIC_API_KEY=` with your key if you keep Claude as the AI engine.
Then `docker compose restart functions`.

## 4. Open the tunnel

1. In Cloudflare: Zero Trust ▸ Networks ▸ Tunnels ▸ **Create a tunnel**
   (type Cloudflared). Name it `uib-data`.
2. Run the install command Cloudflare shows on the server. It installs
   `cloudflared` as a service that starts with the computer.
3. Add a public hostname: `data.universalinsurancebroker.com` ▸ service
   `http://localhost:8000`.
4. From your phone, open `https://data.universalinsurancebroker.com/rest/v1/`.
   A JSON error about a missing API key means the tunnel works.

No ports are opened on your router; the tunnel connects outward.

## 5. Copy the data (after hours)

Ask agents to stop entering for the window. On the server, with Node 18+
(`npx` downloads the Supabase command-line tool):

Get the cloud connection string: cloud dashboard ▸ **Connect** ▸ Session
pooler. Get the local one:
`postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres`.

```
npx supabase db dump --db-url "<CLOUD>" -f roles.sql --role-only
npx supabase db dump --db-url "<CLOUD>" -f schema.sql
npx supabase db dump --db-url "<CLOUD>" -f data.sql --use-copy --data-only
psql "<LOCAL>" --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' --file data.sql
```

This copies every table, the security rules, and the agents' logins with
their current passwords, so nobody has to reset.

Then copy the uploaded documents, which a database dump does not include:

```
SRC_URL=https://jgjmobktucyimupelfxd.supabase.co SRC_SERVICE_KEY=<cloud service_role> \
DST_URL=https://data.universalinsurancebroker.com DST_SERVICE_KEY=<local SERVICE_ROLE_KEY> \
node scripts/copy_storage.mjs
```

Run it again with `--check` at the end; it must say "All files match."
Delete `roles.sql`, `schema.sql` and `data.sql` afterwards; they contain
client data.

## 6. Switch the app over

Edit two lines in `uib-config.js`:

```
SUPABASE_URL:  'https://data.universalinsurancebroker.com',
SUPABASE_ANON: '<the ANON_KEY from your .env>'
```

In `vercel.json`, add `https://data.universalinsurancebroker.com` to
`connect-src`, `frame-src` and `media-src` in the Content-Security-Policy.
Deploy. Or send both values to Claude and it will make and ship the change.

Everyone signs in once more (sessions don't carry over); passwords are
unchanged. Check: an agent's entries show, a document opens, a new entry
saves and appears on a second device.

## 7. Backups (set up the same day)

Nightly database copy, kept 30 days, plus an off-site copy:

```
docker exec supabase-db pg_dump -U postgres -Fc postgres > /backups/uib-$(date +%F).dump
find /backups -name 'uib-*.dump' -mtime +30 -delete
```

Run it daily (Ubuntu: `crontab -e`; Windows: Task Scheduler running the
same command through WSL). Copy `/backups` and
`uib-supabase/volumes/storage` to an encrypted external drive weekly and
to an off-site location (for example an encrypted OneDrive folder). Test a
restore once a quarter.

## Going back to the cloud

Keep the cloud project for at least 30 days after switching (pause it,
don't delete it). To go back, put the old values back in `uib-config.js`
and deploy; copy any entries made in the meantime with step 5 in reverse.

## Compliance notes

Update `SECURITY-PROGRAM.md`: the vendor table (Supabase becomes
"self-hosted on agency hardware"; add Cloudflare as the tunnel provider),
the data inventory location, and the backup procedure above. The server
holds nonpublic personal information: keep it in a locked room, apply
operating-system updates monthly, and keep `.env` and the service-role key
off email and chat.
