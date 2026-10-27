# Running the AMS as its own Vercel project

The AMS and the Binder Book are one repository that deploys twice. The
Binder Book project keeps serving the Binder Book at `/`; a second Vercel
project, built from the **same repository and the same commit**, serves the
AMS at `/` on its own domain.

Nothing is copied or forked. Both projects build the identical files, so a
fix never has to be applied twice and the two apps can never drift apart.

## Why it is set up this way

The obvious alternative — copy the AMS files into a second repository — is
the thing to avoid. The two apps share eleven files (`uib-config.js`,
`supabase.js`, `uib-binder-sync.js`, `uib-auth.js`, `storage-codec.js`,
`uib-theme.css` and the rest). Duplicating them means every future change
has to be made in two places, and the day someone forgets is the day the
AMS starts writing the shared book of business with older rules than the
Binder Book uses. One repo, two projects avoids that entirely.

## 1. Create the second project

In the Vercel dashboard:

1. **Add New ▸ Project**, and import the **same** `uib-binderbook`
   repository the Binder Book already uses. Vercel allows a repository to
   back any number of projects.
2. Name it so the hostname's **first label is `ams` or starts with `ams-`**
   — e.g. `ams-uib`, giving `ams-uib.vercel.app`. This matters: the host
   rewrite in `vercel.json` keys on it (see step 3).

   | Hostname | Serves the AMS at `/`? |
   |---|---|
   | `ams-uib.vercel.app` | yes |
   | `ams.universalinsurancebroker.com` | yes |
   | `amsuib.vercel.app` | **no** — no `-` or `.` after `ams` |
   | `uib-ams.vercel.app` | **no** — `ams` is not the first label |
3. Framework preset **Other**. Leave Root Directory, Build Command and
   Output Directory empty — it is a static site.
4. Deploy.

Both projects now redeploy on every push to `master`.

## 2. Point a domain at it (optional)

Add a custom domain under the new project's **Settings ▸ Domains**. Use a
hostname whose first label is `ams` — such as
`ams.universalinsurancebroker.com` — for the same reason as above.

## 3. How the root rewrite works

`vercel.json` is shared by both projects, so it decides what `/` means from
the **hostname of the request**:

```json
"rewrites": [
  { "source": "/", "has": [{ "type": "host", "value": "^ams([-.].*)?$" }], "destination": "/ams.html" }
]
```

On a matching host, `/` serves `ams.html`. On every other host — the Binder
Book's — `/` serves `index.html` exactly as before.

**Check it after the first deploy:** open the AMS project's URL at `/`. If
you get the Binder Book, the hostname did not match; either rename the
project per the table above or add the host to that `value`, which is a
regular expression.

`https://<the-ams-host>/ams` serves the AMS whatever the hostname, so it is
the fallback if you would rather not rename anything.

## 4. Check the two apps still share data

Both projects talk to the same Supabase project, named once in
`uib-config.js`. That row — `app_store.binderData` — is what connects them.

After the first deploy, confirm the round trip:

1. Sign in to the Binder Book and save a new client.
2. Open the AMS on its new domain and sign in.
3. The client appears within a minute, or immediately if you switch away
   from the AMS tab and back.

Step 3 works because the AMS re-pulls the shared row on a timer and
whenever its tab returns to the foreground. It does **not** redraw while a
dialog is open or while a field has focus, so a pull can never discard
something half-typed.

## What changes for the people using it

- **Separate sign-in.** A browser session belongs to one origin, so an
  agent signed into the Binder Book is not automatically signed into the
  AMS on its new domain. They sign in once per app, and it is remembered
  per app from then on.
- **One minute, not instant.** On a single domain the two apps shared the
  browser's storage, so a Binder Book entry showed up in an open AMS tab at
  once. On separate domains the shared Supabase row is the only connection,
  so it takes a refresh cycle. Switching back to the AMS tab forces one
  immediately.
- **Nothing else.** The data, the logins and the documents are unchanged —
  they were already in Supabase, not in the browser.

## What protects the data during and after the split

The split makes the AMS a long-lived tab on its own origin, holding its own
copy of the book. That is exactly the situation in which a careless save
overwrites other people's work, so the AMS now writes the shared keys the
same way the Binder Book always has, through `uib-binder-sync.js`:

- Every save **merges** the cloud copy in first, so it can only ever add
  entries — it can never replace the book with one device's view of it.
- A save that would come back **smaller** than the live cloud copy is
  refused outright, recorded in `localStorage.uibBlockedShrink`, and
  reported to the user. Nothing is written.
- If the cloud cannot be **read**, the save is not attempted at all. (A
  failed read used to look like an empty cloud, and writing that back is
  how a whole book gets replaced by a handful of records.)
- Deletions travel as **tombstones** in `binderDeletedIds`, so a delete
  survives the merge instead of being undone by it — and a shortened array
  on its own can no longer delete anything.

## Rolling it back

Delete the second Vercel project. The Binder Book is untouched: it never
depended on the AMS project existing, and `/ams` on the Binder Book's own
domain keeps serving the AMS as it does today.
