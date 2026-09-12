# Store Release Checklist

State as of Step 11B on `1267794` + this commit. `[x]` = done and verified in
this repository. `[ ]` = still open, with who has to do it.

## Repository / configuration

- [x] Android `targetSdkVersion` **36** — from `react-native/gradle/libs.versions.toml`
      via `useExpoVersionCatalog()`, no gradle-property override. Meets the
      post-2026-08-31 Play requirement. `compileSdk` 36, `minSdk` 24.
- [x] `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`
      blocked via `android.blockedPermissions`; regenerated manifest shows
      `tools:node="remove"` on all three.
- [x] Remaining permissions justified: `INTERNET`, `RECORD_AUDIO` (mic button
      only), `VIBRATE` (expo-haptics), `POST_NOTIFICATIONS` +
      `RECEIVE_BOOT_COMPLETED` (expo-notifications, local reminders).
- [x] iOS `NSMicrophoneUsageDescription` / `NSSpeechRecognitionUsageDescription`
      present and specific.
- [x] `ITSAppUsesNonExemptEncryption: false` — see `EXPORT_COMPLIANCE.md`.
- [x] ATS: `NSAllowsArbitraryLoads` **false** (was Expo's default `true`),
      `NSAllowsLocalNetworking` true for Metro.
- [x] Account deletion in-app — Ayarlar → Hesap → Hesabı Sil.
- [x] `delete-account` edge function, `verify_jwt: true`, identity from JWT only.
- [x] All 47 `auth.users` foreign keys `ON DELETE CASCADE` (8 were not).
- [x] Privacy policy readable in-app.
- [x] EAS `production` profile — store distribution, AAB, non-simulator iOS,
      `autoIncrement`, `appVersionSource: remote` preserved.
- [x] Monetization: **FREE MVP** (owner, 2026-09-08). `paywall.tsx` deleted,
      replaced by `focus-points.tsx`; all five purchase entry points changed;
      `PAID_SUBSCRIPTIONS_ENABLED = false`. FP economics untouched.
- [x] iPad: **iPhone-only** (owner, 2026-09-08). `ios.supportsTablet: false`.
- [x] Crash observability: **Sentry** (owner, 2026-09-08). SDK + config plugin
      installed, wired to the existing scrubbed funnel, no user content and no
      identity sent. **Inert until the owner creates the DSN** — see below.
- [x] `__tests__/repo/freeMvpReleaseShape.test.ts` guards all three, plus the
      "no dead URL in the app" rule (24 assertions).

## External / accounts

- [ ] **Sentry project + EAS environment values** — **owner**, #3. Nothing is
      reported until these exist:
      `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` (plain env,
      `production`) and `SENTRY_AUTH_TOKEN` (**EAS secret**). Then change
      `SENTRY_DISABLE_AUTO_UPLOAD` from `"true"` to `"false"` in
      `eas.json` — it is `"true"` today only so the build does not fail on a
      missing token, and it is what gates source-map upload.
- [ ] Publish `docs/store/web/privacy.html` at `https://aderyth.com/privacy` —
      **owner**, #4. Probed 2026-09-08: **404**.
- [ ] Publish `docs/store/web/support.html` at `https://aderyth.com/support` —
      **owner**, #4. Probed 2026-09-08: **404**.
- [ ] Publish `docs/store/web/delete-account.html` at
      `https://aderyth.com/delete-account` — **owner**, #4. Probed 2026-09-08:
      **404**.
- [ ] Fill `{{DESTEK_EPOSTA}}`, `{{SILME_SURESI}}`, `{{YAYINCI}}` in those
      three files — **owner**. `grep -o '{{[A-Z_]*}}' docs/store/web/*.html`
- [ ] After all three return 200: flip `PUBLIC_SITE_URLS_LIVE` to `true` in
      `frontend/lib/featureGates.ts` (this is what shows the in-app Destek row),
      then enter the URLs in both consoles. **The flag goes last.**
- [ ] Apple Developer enrolment, App ID, distribution certificate, provisioning
      profile — **owner**, #5. Could not be verified: `eas credentials
      --platform ios` requires an interactive Apple login.
- [ ] Play Console app entry for `com.aderyth.app` + Play App Signing — **owner**, #8.
- [ ] Google service account key for `eas submit` — **owner**, Step 11C only.
- [ ] Legal review of the privacy policy — **owner**, #6.
- [ ] Store screenshots and Play feature graphic — **owner/design**.

## Android signing (existing, unchanged)

EAS holds a JKS upload keystore for `com.aderyth.app`, last updated 1 day
before this pass. Suitable as the **upload key** for Play App Signing; it was
not replaced and no private key material was printed.

```
Key alias    0fab1a7d7aa3b0757b1d6ebad3f01929
SHA-1        3A:7E:76:6E:7B:44:0A:23:40:44:D7:C2:78:88:83:2B:02:DD:F1:04
SHA-256      3E:6B:F9:E7:12:EE:5A:67:5F:A3:6F:5B:B4:BD:5F:21:9A:45:29:39:7B:B5:21:10:51:84:EC:EC:53:B8:E6:B7
```

Public certificate fingerprints only — these are what Play shows for an upload
key and are safe to record.

## Versioning

Marketing version `1.0.0` (app.json). EAS remote state at the time of this
pass: Android `versionCode` **1**, iOS `buildNumber` **1**. The `production`
profile sets `autoIncrement`, so the first store build takes the next value.
`appVersionSource: remote` was left as-is.

## Before Step 11C submission

1. Resolve every `[ ]` above.
2. Re-run the full gates.
3. Build `production` AAB (and iOS archive once signing exists).
4. Verify the artifact: package, targetSdk, versionCode, permissions, signing.
5. Complete Data Safety and App Privacy from `PRIVACY_DECLARATION_MATRIX.md`.
6. Paste `REVIEWER_NOTES.md`, replacing the credential placeholders in the
   console rather than in the repository.
