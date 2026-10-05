# UIB Auto Rater — setup guide

The Auto Rater is a new page in the Binder Book site (`/rater`) that works as a
website **and** as an installable app on iPhone and Android. It uses the same
colors, fonts, buttons and layout as the Binder Book, the same sign-in, and the
same Supabase cloud sync, so quotes and the carrier list follow you across
devices.

What it does:

- A full Florida personal-auto quote form (client, coverages, quote details,
  unlimited drivers with attributes, unlimited vehicles with attributes),
  abstracted from the quoting-system screens you shared.
- **Rate Quote** sends the quote to every enabled carrier at once and shows a
  ranked comparison (total premium, down payment, monthly, quote number).
- A **Carriers** tab where you build your own carrier list. Each carrier is
  rated one of three ways: API (automatic), Portal link (open + paste), or
  Manual entry.
- Saved quotes with search, copy, CSV export, and "best / selected carrier".
- VIN lookup (free NHTSA service) and ZIP → city auto-fill.
- Demo mode so you can try everything before any carrier is connected.

---

## 1. Deploy the website (5 minutes)

The site already deploys from this repository through Vercel, so merging this
branch is all it takes. After the deploy, open:

```
https://<your-vercel-domain>/rater
```

Sign in with your Binder Book agent name and password. The rater also appears
as a cyan **Auto Rater** button next to the AMS button on the agent and admin
dashboards.

Nothing else is required for the website, Demo mode, Portal rating and Manual
rating. Only API rating needs the backend function in step 3.

## 2. Install it as an app on your phone

The rater is a Progressive Web App (PWA). It installs from the browser, with
no app store, and opens full-screen with its own icon.

**Android (Chrome):**
1. Open `https://<your-domain>/rater` in Chrome.
2. Tap the **Install** button in the app header (or the blue banner), or open
   the Chrome menu (⋮) and choose **Install app** / **Add to Home screen**.

**iPhone / iPad (Safari):**
1. Open `https://<your-domain>/rater` in Safari.
2. Tap **Share** (the square with the arrow), then **Add to Home Screen**, then
   **Add**.

Every agent does this once on their own phone. Updates arrive automatically
the next time they open the app, because the app always fetches the newest
files when it has a connection and falls back to its cached copy when it does
not.

If you later want a listing in the Google Play Store or Apple App Store, the
same site can be wrapped without rewriting it:
- **Play Store:** https://www.pwabuilder.com — enter the `/rater` URL, choose
  Android, download the package, upload it to the Play Console.
- **App Store:** wrap with Capacitor (`npx cap add ios`) pointing at the live
  URL, then submit with Xcode. Apple requires a Mac and a $99/yr developer
  account. Most agencies skip this and use the Safari install above.

## 3. Deploy the rating function (only for API carriers)

API carriers are rated by a small server function that runs in your existing
Supabase project. It holds the carrier credentials, so they never reach the
browser or the phone.

1. Open the Supabase project (the same one the Binder Book uses).
2. Left sidebar ▸ **Edge Functions** ▸ **Deploy a new function**.
3. Name it exactly `rate`.
4. Paste the contents of `supabase/functions/rate/index.ts` and click
   **Deploy**.

   Or from a terminal with the Supabase CLI:
   ```
   supabase functions deploy rate
   ```

5. Go to **Edge Functions ▸ Manage secrets** and add one set of secrets per
   carrier. `PREFIX` is the short *Secret Prefix* you will type on the carrier
   card in the app (for example `PROG`):

   | Secret | Purpose |
   |---|---|
   | `RATER_PROG_USERNAME` | agency login for the carrier |
   | `RATER_PROG_PASSWORD` | agency password |
   | `RATER_PROG_APIKEY` | API key, if the carrier gives you one |
   | `RATER_PROG_TOKEN` | bearer token, if the carrier gives you one |
   | `RATER_PROG_HEADERS` | optional, JSON of extra headers, e.g. `{"x-producer-code":"12345"}` |
   | `RATER_ALLOWED_HOSTS` | optional but recommended, comma-separated list of carrier hostnames the function may call |

   Only add the ones the carrier actually needs.

## 4. Add your carriers in the app

Open the **Carriers** tab and press **Add Carrier**. For a quick start, the
empty list offers a starter set of common Florida carriers as Manual entry
that you can edit.

Fields on the carrier card:

- **Carrier Name / Short Code** – display name and a short code like `PROG`.
- **Rating Method**
  - *API (automatic)* – the app rates it for you through the `rate` function.
  - *Portal link* – the app opens the carrier's quoting site in a new tab and
    copies a one-page quote summary to the clipboard so you can paste it.
  - *Manual premium entry* – you type the premium, down payment and monthly
    into the comparison table.
- **Secret Prefix** – must match the secrets you created in step 3.
- **Rating Endpoint URL**, **HTTP Method**, **Body Format** (JSON, form, or
  XML/SOAP), **Authentication** (none/in body, Bearer, Basic, API-key header).
- **Request Template** – the exact body the carrier expects, with placeholders
  the function fills in. Leave it blank to send the whole quote as JSON.
  Placeholders:
  - `{{client.firstName}}`, `{{coverages.bi}}`, `{{drivers.0.dob}}`,
    `{{vehicles.0.vin}}` – single values (press **Show field keys** on the
    Quote tab for the full list)
  - `{{json:drivers}}`, `{{json:vehicles}}`, `{{json:quote}}` – raw JSON
  - `{{USERNAME}}`, `{{PASSWORD}}`, `{{APIKEY}}`, `{{TOKEN}}` – credentials,
    filled on the server
- **Response mapping** – where in the carrier's answer to find the numbers.
  Use dot paths into JSON (`quote.totalPremium`, `results.0.premium`) or, for
  XML/text responses, `regex:<TotalPremium>([0-9.]+)</TotalPremium>` – the
  first capture group is used.
- **Test connection** on the carrier card confirms the function is deployed,
  the endpoint is allowed and which secrets were found, without rating.

Example for a JSON carrier:

```
{
  "producerCode": "{{USERNAME}}",
  "password": "{{PASSWORD}}",
  "effectiveDate": "{{coverages.effectiveDate}}",
  "term": {{coverages.term}},
  "insured": { "first": "{{client.firstName}}", "last": "{{client.lastName}}", "zip": "{{client.zip}}" },
  "bi": "{{coverages.bi}}", "pd": "{{coverages.pd}}",
  "drivers": {{json:drivers}},
  "vehicles": {{json:vehicles}}
}
```

with response mapping `premium = quote.totalPremium`,
`downPayment = quote.downPayment`, `monthly = quote.installments.0.amount`,
`quoteId = quote.number`, `link = quote.bridgeUrl`.

### Where to get each carrier's API details

Each carrier (or your comparative rater vendor) documents its own rating API
and issues the credentials. Ask your carrier marketing rep for "agency rating
API / real-time rating access" and the request/response spec. Carriers that
do not offer an API are still fully usable through **Portal link** or
**Manual**. The carrier list, templates and mappings can be exported and
imported as a JSON file from the Carriers tab, so you set a carrier up once
and share it with every agent.

## MAX, the AI assistant

The **MAX** tab (left of Quote) is a chat assistant powered by Claude Haiku
4.5. Agents can take a photo of a driver's license or a VIN (dash plate,
door sticker, registration card) and MAX reads it and fills the quote: name,
date of birth, license number and state, address, and the VIN (which the
app then decodes into year, make and model). Typed instructions work too,
for example "add a driver named John Smith born 3/4/1990".

MAX talks to Claude through the Supabase edge function named `claude` that
the Binder Book already uses, so the API key never reaches the browser. If
that function is not deployed yet:

1. Supabase ▸ Edge Functions ▸ Deploy a new function named exactly `claude`
   and paste `supabase/functions/claude/index.ts` from the uib-binderbook
   repository.
2. Edge Functions ▸ Manage secrets ▸ add `ANTHROPIC_API_KEY` with your key
   from console.anthropic.com.

Photos are resized in the browser before upload and are not kept in the
chat history after MAX has read them.

## 5. Try it

1. Quote tab ▸ **Sample Data**.
2. Carriers tab ▸ tick **Demo mode** (sample premiums, no carrier calls).
3. Press **Rate Quote**. The Results tab fills in with a ranked comparison.
4. Untick Demo mode when your real carriers are configured.

## Files added

| File | Purpose |
|---|---|
| `rater.html` | the Auto Rater page (same look as the Binder Book) |
| `rater.js` | form schema, carriers, rating engine, saved quotes, sign-in, install |
| `rater.webmanifest`, `rater-sw.js`, `icons/` | makes the page installable as a phone app |
| `supabase/functions/rate/index.ts` | secure carrier-rating function (deployed to Supabase, not to the website) |
| `index.html` | cyan **Auto Rater** buttons on the dashboards |
| `storage-codec.js` | compresses saved quotes so they do not crowd out the book of business |

Data lives in the same places as the rest of the Binder Book: `raterCarriers`
and `raterQuotes` in the browser's storage, synced automatically to the
`app_store` table in Supabase by the existing cloud-sync layer.
