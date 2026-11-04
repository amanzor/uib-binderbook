# The AMS is its own project now

The Agency Management System lives in its own repository,
[amanzor/UIB-AMS](https://github.com/amanzor/UIB-AMS), and deploys as its
own Vercel project. This repository keeps the Binder Book.

## Create the Vercel project

In the Vercel dashboard:

1. **Add New ▸ Project**, and import the `UIB-AMS` repository.
2. Framework preset **Other**. Leave Root Directory, Build Command and
   Output Directory empty — it is a static site.
3. Deploy.

`index.html` in that repository is the AMS, so the site root is the app.
There is no host rewrite to configure and no naming constraint: the
project can be called anything.

Add a custom domain under **Settings ▸ Domains** if you want one, e.g.
`ams.universalinsurancebroker.com`.

## Check the two apps still share data

Both apps point at the same Supabase project (`uib-config.js`), and that
shared row is what connects them. After the first deploy:

1. Sign in to the Binder Book and save a new client.
2. Open the AMS on its new URL and sign in.
3. The client appears within a minute, or immediately if you switch away
   from the AMS tab and back.

Step 3 works because the AMS re-pulls the shared rows on a timer and
whenever its tab returns to the foreground. It does not redraw while a
dialog is open or a field has focus, so a pull cannot discard something
half-typed.

## What changes for the people using it

- **Separate sign-in.** A browser session belongs to one domain, so an
  agent signed into the Binder Book is not automatically signed into the
  AMS. They sign in once per app, and it is remembered per app after that.
- **One minute, not instant.** On a single domain the two apps shared the
  browser's storage, so a Binder Book entry showed up in an open AMS tab
  at once. On separate domains the shared Supabase row is the only
  connection, so it takes a refresh cycle. Switching back to the AMS tab
  forces one immediately.
- **Nothing else.** The data, the logins and the documents are unchanged —
  they were already in Supabase, not in the browser.

## Shared files

Both apps use the same cloud-sync layer. Those files are listed in
`shared-files.txt` in the AMS repository and are **copies of the ones
here** — this repository is where they are edited.

That is not bookkeeping. `uib-binder-sync.js` is what merges the shared
book of business before writing it; if the two apps ever carry different
versions, they write the same Supabase row by different rules, which is
how entries get overwritten. A scheduled Action in the AMS repository
compares the copies daily and opens a pull request when they differ, so
drift shows up as a pull request instead of as missing data.

**So: change a shared file here, and let the sync carry it across.** A
change made in the AMS repository is overwritten by the next sync, and
until then the two apps disagree.

## Still to do

This repository still contains its own copy of the AMS (`ams.html`,
`ams.js`, the certificate files) and serves it at `/ams`. That stays until
the new deployment is verified — removing a working page before its
replacement is live would be the wrong order.

Once the AMS project is up and the agents are using it, the follow-up is
to delete those files from this repository and redirect `/ams` to the AMS
domain, so there is exactly one copy of the AMS in existence.
