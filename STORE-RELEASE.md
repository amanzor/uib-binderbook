# UIB Binder Book — publishing to the App Store and Google Play

The Binder Book is the agency's internal tool (binders, AMS, commissions,
Auto Rater). The website at https://uib-binderbook.vercel.app is the
product; `native/` holds the Capacitor apps that ship the **same web app
bundled inside** an iOS and an Android shell, with a native splash screen,
status bar, offline start and the device camera/photo pickers for document
uploads. The separate consumer lead app, **MAX**, has its own app and store
listing in the `uibautorater` repository; the Binder Book links to it from
the dashboards.

## 0. Before anything else

1. The website must be deployed (it is, on Vercel). The app is bundled, so
   it does not depend on the site address, but Supabase must be reachable.
2. **Demo account for the reviewers.** The app opens on the Binder Book
   sign-in. Both stores reject login-gated apps that come without test
   credentials: create a reviewer agent (Admin ▸ Agents) with a password,
   and enter that name and password in App Store Connect (App Review
   Information ▸ Sign-in required) and in Play Console (App content ▸ App
   access ▸ "All or some functionality is restricted").
3. Privacy policy URL for both stores: publish one for the Binder Book, or
   reuse the MAX policy at `https://uibautorater.vercel.app/privacy` only if
   its wording is adjusted to cover agency staff use.

## 1. One-time accounts

| Store | Account | Cost | Needs |
|---|---|---|---|
| Google Play | Play Console developer account | $25 once | Any computer with Android Studio |
| Apple App Store | Apple Developer Program | $99 / year | A Mac with Xcode |

The same accounts serve MAX and the Binder Book.

## 2. Build the Android app (Google Play)

On a computer with [Android Studio](https://developer.android.com/studio) and Node.js:

```bash
cd native
npm install
npm run build               # copies the web app into native/www and syncs the plugins
npx cap open android        # opens the project in Android Studio
```

In Android Studio: **Build ▸ Generate Signed Bundle / APK ▸ Android App
Bundle.** Create a keystore the first time and **back it up** (it is
ignored by git and cannot be recovered). Upload the `.aab` in Play Console
(Create app ▸ "UIB Binder Book" ▸ Production or Internal testing), fill in
the listing (icon `icons/uib-512.png`, screenshots, feature graphic
1024×500), the Data safety form (collects client names, contact details,
policy documents and photos for the agency's own business use; not sold),
the privacy policy URL, content rating and the demo account.

## 3. Build the iOS app (App Store)

On a Mac with Xcode 15 or newer (the project uses Swift Package Manager,
no CocoaPods needed):

```bash
cd native
npm install
npm run build
npx cap open ios            # opens App.xcodeproj in Xcode
```

In Xcode: select the **App** target ▸ Signing & Capabilities ▸ your Apple
team; bundle identifier `com.universalinsurancebrokers.binderbook`. The
camera and photo-library usage texts are already in `Info.plist`. Then
Product ▸ Archive ▸ Distribute App ▸ App Store Connect ▸ Upload, and finish
the listing in App Store Connect (screenshots, description, privacy
answers, demo account).

**App Review notes (paste into App Store Connect ▸ App Review
Information ▸ Notes).** "UIB Binder Book is the internal management app of
Universal Insurance Brokers, a licensed Florida insurance agency, for its
agents and staff. It is bundled in the app (not a web wrapper), uses the
device camera and photo library to capture policy documents, licenses and
VINs, works offline for the cached shell, and takes no payments. Agents
sign in with agency credentials; a demo account is provided." Because the
app is for the agency's own staff, Apple may suggest distributing it
through Apple Business Manager (custom app) instead of the public store;
either route uses this same build.

## 4. What the bundle changes

`native/scripts/copy-web.js` copies the pages, scripts, styles and icons
from the repository root into `native/www`. Two adjustments apply to the
copies only: Vercel-style clean links (`./rater`, `./dailysalesentry`, …)
are rewritten to the real files (`./rater.html`, …) because the bundled app
has no URL rewriting, and the service-worker registrations are removed
because the files are already on the device. The website itself is not
touched. Icons and splash screens are generated from `native/assets/` with
`npx @capacitor/assets generate`.

## 5. After launch

- The website updates on every deploy. The store apps carry their own copy
  of the pages, so after changes to the HTML, JavaScript or CSS run
  `npm run build` in `native/`, bump the version/build number in Android
  Studio and Xcode, and upload a new build.
- Only changes under `native/` (icons, name, permissions, plugins) need a
  rebuild on their own.
