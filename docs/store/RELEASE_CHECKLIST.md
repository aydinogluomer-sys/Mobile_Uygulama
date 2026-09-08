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
- [ ] Monetization branch chosen and paywall made truthful — **owner**,
      `OWNER_DECISIONS.md` #1.
- [ ] iPad support decision — **owner**, #2.
- [ ] Crash observability decision — **owner**, #3.

## External / accounts

- [ ] Privacy policy public HTTPS URL — **owner**, #4.
- [ ] Support URL / email — **owner**, #4.
- [ ] Account deletion web URL — **owner**, #4 + `ACCOUNT_DELETION_WEB_REQUIREMENTS.md`.
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
