# Store Account Setup — manual owner steps

Everything here needs an interactive login to an account only the owner holds.
None of it was performed, simulated or assumed by the engineering pass:
**no certificate was created or revoked, no membership purchased, no agreement
accepted, nothing uploaded.** Repository-side, both platforms are ready; the
steps below are what turns "ready" into "registered".

Where a step is verified from this machine it says so. Where it says
"owner confirms", nobody has looked yet.

---

## A. Apple — from nothing to the first production iOS build

Repository facts the console must match:

| Item | Value | Where |
|---|---|---|
| Bundle identifier | `com.aderyth.app` | `frontend/app.json` → `ios.bundleIdentifier` |
| Device family | iPhone only | `ios.supportsTablet: false` |
| Orientation | portrait | `orientation: portrait` |
| Encryption declaration | `ITSAppUsesNonExemptEncryption: false` | `ios.infoPlist` — see `EXPORT_COMPLIANCE.md` |
| ATS | `NSAllowsArbitraryLoads: false` | `ios.infoPlist` |
| Store build profile | `production` (`distribution: store`, `simulator: false`, `autoIncrement`) | `frontend/eas.json` |
| Version | `1.0.0`; iOS build number is EAS-remote, currently **1** | `appVersionSource: remote` |

### A1. Apple Developer Program

1. Sign in at <https://developer.apple.com/account> with the Apple ID that
   will own the app.
2. If the account shows no membership: enrol in the **Apple Developer
   Program** (individual or organization — organization needs a D-U-N-S
   number and takes days). This costs money and is the one step nobody can
   do for you.
3. Accept the current **Program License Agreement** when the console prompts
   for it. An unaccepted agreement blocks `eas build` with a misleading
   "authentication" error, so do this first.
4. Note the **Team ID** (10 characters, Membership → Team ID). It goes into
   nothing in the repository; EAS asks for it interactively.

### A2. App ID

1. Certificates, Identifiers & Profiles → **Identifiers** → `+` → **App IDs**
   → App.
2. Description: `Aderyth`. Bundle ID: **Explicit**, `com.aderyth.app`.
3. Capabilities: leave the defaults. Aderyth needs **none** of Push
   Notifications (reminders are local), Sign in with Apple (not offered),
   In-App Purchase (FREE MVP), or Associated Domains.
4. Register. If it says the bundle ID is already in use by another team, the
   identifier is taken and the app cannot ship under that name — stop and
   decide before anything else.

### A3. Let EAS provision (recommended over doing it by hand)

From `frontend/`, signed in to the Expo account `omeraydinoglu`:

```
eas credentials --platform ios
```

Choose the `production` build profile, then **Set up a new
Distribution Certificate and Provisioning Profile**. EAS signs in to Apple
(App-Specific Password or the Apple ID login it prompts for), creates the
distribution certificate, and generates an App Store provisioning profile
for `com.aderyth.app`. The private key is stored on EAS servers, not in the
repository. Alternatively skip this step entirely — the first
`eas build --platform ios --profile production` performs the same
provisioning interactively on its first run.

If the team already has a distribution certificate at its limit (Apple allows
a small number), EAS will offer to reuse it or ask you to revoke one. **Do not
revoke** a certificate that any shipping app depends on; reuse instead.

### A4. App Store Connect record

1. <https://appstoreconnect.apple.com> → Apps → `+` → **New App**.
2. Platforms: **iOS** only. Name: `Aderyth`. Primary language: Turkish.
   Bundle ID: pick `com.aderyth.app` from the list (it appears once A2 is
   done). SKU: `aderyth-ios` or any stable string.
3. This creates the record only. Nothing is submitted.

### A5. First production iOS build

```
eas build --platform ios --profile production
```

This requires macOS-hosted builders on EAS (cloud, not this Windows
machine) and the credentials from A3. It produces an `.ipa` signed for App
Store distribution. **It does not upload anything** — that is `eas submit`,
which is Step 11C and is not to be run.

Verify afterwards on the EAS build page: bundle id `com.aderyth.app`, build
number auto-incremented from 1, profile `production`, and the Info.plist
values above in the build's resolved config.

---

## B. Google Play — from nothing to an app entry that can receive an AAB

Repository facts the console must match:

| Item | Value | Where |
|---|---|---|
| Package name | `com.aderyth.app` | `frontend/app.json` → `android.package` |
| `targetSdkVersion` | **36** (verified in the built AAB) | RN 0.86 version catalog |
| `minSdkVersion` | 24 | same |
| Signing | EAS-managed JKS **upload** key | `RELEASE_CHECKLIST.md` — fingerprints below |
| Version | `1.0.0`; Android `versionCode` is EAS-remote (`autoIncrement`) | `appVersionSource: remote` |

Upload key public fingerprints (read from the signed AAB; safe to record —
these are what Play shows for an upload key):

```
SHA-1    3A:7E:76:6E:7B:44:0A:23:40:44:D7:C2:78:88:83:2B:02:DD:F1:04
SHA-256  3E:6B:F9:E7:12:EE:5A:67:5F:A3:6F:5B:B4:BD:5F:21:9A:45:29:39:7B:B5:21:10:51:84:EC:EC:53:B8:E6:B7
```

### B1. Play Console developer account

1. <https://play.google.com/console> — sign in with the Google account that
   will own the app. A first-time developer account has a one-time
   registration fee and identity verification that can take days.
2. Accept the Developer Distribution Agreement when prompted.

### B2. Create the app

1. **Create app**. App name `Aderyth`, default language Turkish,
   **App** (not Game), **Free**. The Free/Paid choice here is permanent —
   Free is correct and matches the owner's decision.
2. Declarations: accept the Developer Program Policies and US export laws
   checkboxes (this is the console's own acknowledgement, not the
   `ITSAppUsesNonExemptEncryption` declaration, which is Apple-only).
3. The **package name is bound on the first upload**, not at creation. So
   `com.aderyth.app` becomes this app's package the first time an AAB with
   that package is uploaded to any track. If Play rejects the first upload
   with "package name already exists", the name is taken by another
   developer account — stop and decide.

### B3. Play App Signing with the existing EAS key as the upload key

Play App Signing is mandatory for new apps. The first AAB upload sets it up;
choose the option that **keeps the existing EAS keystore as the upload key**
rather than letting Play generate a new one:

1. On first upload, in **Release → Setup → App signing**, pick
   **"Use Google-generated key"** for the *app signing key* (Google holds
   the key that signs what users install — this is the standard, recoverable
   choice) — and let Play take the **upload key** from the uploaded bundle's
   signature. The fingerprints above are what it will register.
2. Confirm afterwards in App signing that **Upload key certificate** shows
   SHA-1 `3A:7E:76:6E:…`. If it shows something else, the AAB was not signed
   with the EAS keystore — do not proceed.
3. Do **not** export or download the EAS keystore to do this; nothing in this
   flow needs the private key outside EAS.

### B4. The upload — later, not now

The artifact to upload is the `production`-profile AAB from EAS (currently
build `151cc1a3…`, versionCode 3 — see the Step 11B.1 report). Upload it to
**Internal testing** first, never straight to Production. That upload is
Step 11C and is **not** to be performed in this step.

### B5. Console content that needs the URLs (blocked today)

Store listing → **Privacy policy** and App content → **Data safety** →
**Account deletion URL** both require URLs that return 200. All three
`aderyth.com` pages return **404** as of 2026-09-08. Publish
`docs/store/web/` first (`docs/store/web/README.md` has the order).

### B6. `eas submit` prerequisite (Step 11C, for completeness)

`eas submit --platform android` needs a **Google service account JSON key**
with the Play Console *Release manager* role, stored as an EAS secret or
referenced from `eas.json` `submit.production.android.serviceAccountKeyPath`.
Not created, not needed until 11C.

---

## C. Things that look like blockers and are not

| Observation | Why it is fine |
|---|---|
| The built AAB's manifest lists `com.google.android.c2dm.permission.RECEIVE` and Firebase Messaging meta-data | Pulled in by `expo-notifications`, which bundles FCM. No `googleServicesFile` is configured, so Firebase never initialises and no push token is ever requested or stored (`profiles.push_token` has no writer). Custom/signature-level, not a runtime permission |
| ~20 `*.launcher.permission.*` / `badge` entries in the manifest | ShortcutBadger, also inside `expo-notifications`, for launcher badge counts. Vendor-specific custom permissions, not dangerous permissions, not shown to users |
| `expo.modules.updates.ENABLED` meta-data present | Set to `false`; `expo-updates` is not in the dependency tree. The embedded JS bundle is what runs |
| `ingest.sentry.io` string in the JS bundle | The SDK's own host constant. No DSN-shaped `https://<key>@…ingest` string exists in the bundle until the owner configures `EXPO_PUBLIC_SENTRY_DSN` |
