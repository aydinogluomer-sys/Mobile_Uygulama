# Store Release Checklist

> **Kapsam kararı (2026-09-13).** Bu belgedeki her iş, owner'ın kapsam eki
> (`docs/plan/21_KAPSAM_EKI_2026-09-13.md` §6.3) gereği **ertelenmiş bir release/distribution
> fazıdır** ve ürünün implementation-completeness hesabına **dahil değildir**.
> İçerik hazır tutulur; store konsolu, Apple/Google hesap işlemleri ve yayın,
> çekirdek implementation bittikten sonra ayrı bir fazda ele alınır.

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

## Verified production artifact (Step 11B.1)

Built on EAS from `af8aec4`, profile `production`, and inspected offline
(protobuf manifest decoded, Hermes header checked, signer read with openssl):

| | |
|---|---|
| Build | `151cc1a3-e36c-46b9-a319-2a91aab532e3` |
| Artifact | `.aab`, 84,330,711 bytes, SHA-256 `c02e433a…c618b9` |
| Package / version | `com.aderyth.app` · `1.0.0` · versionCode **3** |
| `targetSdkVersion` / `minSdkVersion` | **36** / 24 |
| Signer | EAS upload key, SHA-1 `3A:7E:76:6E:…:F1:04` (matches above) |
| `android:debuggable` | absent (false) |
| JS | `index.android.bundle`, Hermes bytecode (magic verified), 6.8 MB, `expo.modules.updates.ENABLED=false` |
| Architecture | `libreactnative.so` + `libappmodules.so` (RN 0.86 — New Architecture only), `libhermesvm.so` |
| Blocked permissions | `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` — **all absent** |
| `RECORD_AUDIO` | present; speech input only |
| Purchase strings | `Abone Ol`, `Test modu`, `EN POPÜLER`, `Üyeliği Yükselt`, `Üyelik & Krediler`, `/screens/paywall` — **all absent** (searched latin1 + both UTF-16 alignments; the stale versionCode-2 AAB contained all six, so the probe is a positive control) |
| Mock path | `mock_activate_subscription` absent from the bundle — the `__DEV__` branch was eliminated |
| Secrets | no `service_role`, no `sb_secret_`, no Sentry token, no DSN-shaped string, zero JWT-shaped strings; the Supabase key present is the public `sb_publishable_…` |
| Sentry | native libs present, `io.sentry.auto-init=false` (JS-initialised, inert without a DSN) |

**Not to be uploaded anywhere in this step.** This is the artifact Step 11C
would take to Internal testing.

Observations that are not blockers, recorded so nobody rediscovers them:

- The merged manifest carries `com.google.android.c2dm.permission.RECEIVE`,
  Firebase Messaging meta-data and ~20 vendor `launcher.permission.*` badge
  entries. All come from `expo-notifications` (FCM + ShortcutBadger). No
  `googleServicesFile` is configured, so Firebase never initialises and no
  push token is requested; the badge permissions are custom/signature-level.
- `android:allowBackup` is `true` (Expo default). Android Auto Backup may
  therefore include AsyncStorage — session token and offline queue — in the
  user's device backup (end-to-end encrypted with the lock screen on
  Android 9+). Not a store requirement either way; if the owner prefers
  `false`, it is one `expo-build-properties` line and a rebuild.
- The Sentry Android SDK ships its replay module as a transitive artifact
  (`sentry-android-replay`). It is not enabled: no integration is registered
  and both replay sample rates are 0 in `lib/sentryClient.ts`.

## Before Step 11C submission

1. Resolve every `[ ]` above.
2. Re-run the full gates.
3. Build `production` AAB (and iOS archive once signing exists).
4. Verify the artifact: package, targetSdk, versionCode, permissions, signing.
5. Complete Data Safety and App Privacy from `PRIVACY_DECLARATION_MATRIX.md`.
6. Paste `REVIEWER_NOTES.md`, replacing the credential placeholders in the
   console rather than in the repository.

## Public URL vs In-App Link Gate Separation (Y03 / Y13)

Store console URL entry, in-app external web links, and live authentication /
account-deletion verification are governed as three sequential, independent
gates so an unpublished webpage never ships as a broken in-app button:

- [ ] [GATE-URL-CONSOLE] Harici HTTPS sayfaları (`https://aderyth.com/privacy`,
      `https://aderyth.com/support`, `https://aderyth.com/delete-account`)
      canlıda yayında, placeholder (`{{...}}`) içermiyor ve `HTTP 200` dönüyor
      (Mağaza konsolu girişi için önkoşul — `OWNER`).
- [ ] [GATE-URL-INAPP] Yukarıdaki 3 URL `HTTP 200` doğrulandıktan SONRA ayrı PR
      ile `frontend/lib/featureGates.ts` içindeki `PUBLIC_SITE_URLS_LIVE = true`
      çevrildi ve uygulama içi bağlantılar yalnız doğrulanmış sayfaları açıyor
      (`REL + OWNER`; `docs/implementation-v3/OWNER_ROLLOUT_QUICKSTART.md` ile
      aynı beklenti — bu PR açılana dek repoda `PUBLIC_SITE_URLS_LIVE = false`
      kalır ve uygulama içi gizlilik ekranı `app/screens/privacy.tsx` ile
      doğrudan `delete-account` akışı dış web sayfalarından bağımsız çalışır).
- [ ] [GATE-AUTH-RECOVERY-DELETE] Üretim SMTP parola sıfırlama bağlantısı
      (`resetPasswordForEmail` + Supabase Auth Redirect URL izin listesi) ve
      uygulama içi `delete-account` → Auth/DB cascade (`auth.admin.deleteUser`
      üzerinden 47 `ON DELETE CASCADE` FK) → yerel cache/outbox temizliği
      (`endAccountScope('account_deleted', userId)` + `AsyncStorage` süpürmesi)
      → yeni hesap izolasyonu izinli test hesabıyla uçtan uca doğrulandı
      (`OWNER + QA`).

## Candidate Reproducibility & Canary Halt Chain (Y09)

### Candidate Reproducibility Chain Template

Every store candidate must record an unbroken provenance chain from source
commit to store track; **any** change to commit, lockfile, build profile, or
signed binary digest constitutes a **new release candidate** and invalidates
prior QA sign-off:

```text
git_sha
  -> frontend/package-lock.json SHA-256 + supabase/functions/deno.lock SHA-256
  -> GitHub Actions CI run URI (all required jobs green on git_sha)
  -> EAS Build ID (profile: production)
  -> Signed .aab / .ipa SHA-256
  -> App Store TestFlight build ID / Google Play Internal Testing track ID
```

| Chain Link | Required Evidence | Rule |
|---|---|---|
| `git_sha` | Full 40-char commit SHA on release branch | Must match CI run and EAS build commit |
| Lockfile digests | `frontend/package-lock.json` SHA-256 + `supabase/functions/deno.lock` SHA-256 | Any dependency lock drift creates a new candidate |
| CI run URI | GitHub Actions workflow run URL | `typecheck`, `lint`, Jest, Deno edge, and DB migration gates green |
| EAS Build ID | UUID from `eas build --profile production` | `production` profile only; no local/dev overrides |
| Signed binary digest | `.aab` SHA-256 (Android) / `.ipa` SHA-256 (iOS) | Verified offline before upload; different artifact = new candidate |
| Store track ID | App Store TestFlight / Play Internal Testing track release ID | Promoted to wider tracks only from this exact digest |

### Canary Halt & Rollback Protocol

- **Decision & Execution Owner:** `OWNER / Release Lead` (single authority to
  halt staged rollout, freeze track promotion, and authorize rollback).
- **Mandatory Halt Triggers (any single trigger halts rollout immediately):**
  1. **XP Ledger Drift (`xp_drift() > 0`):** `SELECT count(*) FROM public.xp_drift()`
     returns any row (`> 0`) before, during, or after rollout.
  2. **Account Isolation Breach:** Cross-user data visibility in RLS,
     `accountScope` memory/read-cache bleed, or unsent outbox replay across
     accounts after sign-out / `delete-account`.
  3. **Duplicate Billing / Unrefunded Failed AI Request:** More than one net
     Focus Point debit for a single `request_id`, or a failed `ai_requests` row
     without a matching `request_id || ':refund'` compensation.
  4. **Crash-Free Rate Below Threshold:** Production crash-free sessions/users
     in Sentry drop below the release gate threshold on the active canary build.
- **Immediate Halt & Recovery Actions (`OWNER / Release Lead`):**
  1. Halt staged rollout in Play Console / remove build from TestFlight external
     testing; do **not** promote Internal Testing / TestFlight to production.
  2. Keep gated flags closed (`PUBLIC_SITE_URLS_LIVE = false`,
     `COACH_ACTIONS_V2_ENABLED = false`) or revert the flag-flip PR immediately.
  3. If a `028..044` DB migration is implicated, execute reverse-order SQL
     rollback strictly from `supabase/rollbacks/` with
     `SET aderyth.rollback_confirm = 'NNN';` per
     `docs/implementation-v3/OWNER_ROLLOUT_QUICKSTART.md` and re-verify
     `xp_drift() = 0`.
  4. Ship any fix only as a **new candidate** with a fresh `git_sha` → lockfile
     SHA-256 → CI URI → EAS Build ID → `.aab`/`.ipa` SHA-256 chain.
