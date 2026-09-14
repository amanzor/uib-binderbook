# UIB Binder Book

Static web app (plain HTML + JS, no build step) for the Universal Insurance
Brokers Binder Book, AMS, daily sales entry, transaction entry and client portal.

## Where it runs

| Piece | Lives in |
|---|---|
| Web app (this repo) | **Vercel**, production deploy of the `master` branch: https://uib-binderbook.vercel.app |
| App data (`binderData`, clients, agents, carriers, commissions, logs, backups) | **Supabase** Postgres, table `app_store` (see `supabase-schema.sql`) |
| Client documents / statement PDFs | **Supabase Storage**, bucket `client-files` (see `supabase-storage-setup.sql`) |
| AI assistant proxy | **Supabase Edge Function** `claude` (see `supabase/functions/claude/index.ts`) |

Vercel is the only host. Every page carries a tiny redirect so anyone who still
opens the old GitHub Pages address (`amanzor.github.io/uib-binderbook`) lands on
the same page on Vercel. GitHub is used for source control and pull requests
only. To finish retiring GitHub Pages, turn it off in the repository settings
(GitHub → Settings → Pages → Source: *None*).

The browser keeps a working copy of the data in `localStorage` so pages open
instantly and keep working during a connection blip, but Supabase is the
source of truth: every write is pushed to `app_store` and a fresh browser pulls
everything down on first open (`supabase.js`, plus the merge-based sync layer
at the top of `app.js`).

`.vercelignore` keeps the commission source folders, setup SQL, Python
reporting scripts and this file off the public site.

### The one thing still outside Vercel + Supabase

`app.js` calls the old Google Apps Script web app for exactly one thing: the
admin e-mail sent when an existing client is re-reported through the AI chat
(`sendEmail` action, `DRIVE_API_URL`). It stores no data. Replacing it means
picking an e-mail provider and adding a Supabase Edge Function for it.

## Deploying a change

1. Commit to a branch, open a PR, merge to `master`. Vercel deploys `master`
   automatically.
2. Whenever `app.js` changes, bump `APP_BUILD` at the top of `app.js` **and**
   the `?v=` on every `<script src="app.js?v=...">` tag (`index.html`,
   `dailysalesentry.html`, `transactionentry.html`). Do the same for
   `ams.js?v=` / `supabase.js?v=` when those files change. The build guard in
   `app.js` uses this to force stale tabs to reload instead of writing old data
   over the fleet.

## Supabase setup (one time, already done for the live project)

Run these in the Supabase SQL editor: `supabase-schema.sql`, then
`supabase-storage-setup.sql`. Deploy `supabase/functions/claude/index.ts` as
an Edge Function named `claude` with the `ANTHROPIC_API_KEY` secret set.
