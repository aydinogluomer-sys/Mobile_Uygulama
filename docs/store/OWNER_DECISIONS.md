# Owner Decisions — Store Release

> **Kapsam kararı (2026-09-13).** Bu belgedeki her iş, owner'ın kapsam eki
> (`docs/plan/21_KAPSAM_EKI_2026-09-13.md` §6.3) gereği **ertelenmiş bir release/distribution
> fazıdır** ve ürünün implementation-completeness hesabına **dahil değildir**.
> İçerik hazır tutulur; store konsolu, Apple/Google hesap işlemleri ve yayın,
> çekirdek implementation bittikten sonra ayrı bir fazda ele alınır.

Only decisions that have **actually been made** are recorded as made.
Everything still open is listed as open, with what each answer would cost.

Nothing here was decided by the engineering pass. Where a technical finding
constrains an answer, the finding is given and the choice stays the owner's.

Decisions 1, 2 and 3 were taken by the owner on **2026-09-08** (Step 11B.1).

---

## DECIDED — 1. Monetization: **FREE MVP**

**Decision: FREE.** No in-app purchase, no subscription, no payment processor
in this release.

**What shipped as a result.** `app/screens/paywall.tsx` is gone — deleted, not
unlinked, because a file left in `app/screens/` is still a route. It is
replaced by `app/screens/focus-points.tsx`, which shows the balance, what each
AI action costs, and when the balance renews. Removed with it: the
weekly/monthly/yearly period switcher, both price columns, the "EN POPÜLER"
ribbon, both "Abone Ol" buttons and the "Test modu … gerçek ödeme … yayına
çıkmadan eklenecek" footnote.

Five entry points were changed, not one — the screen, the AI Coach Focus Point
bar, the journal-insights Focus Point bar, the "Üyeliği Yükselt" row inside
`AIRoutineModal`, and the drawer's "Üyelik & Krediler" item. Each now reads
"Krediler" / "Focus Points" and leads to a screen that promises nothing.

**What did NOT change.** Focus Point economics: `ACTION_COST` (coach 5,
routine 25, summarize 3, insights 5) and the 30 FP free grant are untouched,
and `__tests__/repo/freeMvpReleaseShape.test.ts` asserts it. `lib/subscription.ts`
keeps its tier definitions and prices so that reversing this is a rendering
change rather than archaeology. The `__DEV__`-only mock activation stays; it
never existed in a release build.

**To reverse:** `PAID_SUBSCRIPTIONS_ENABLED` in `frontend/lib/featureGates.ts`,
plus everything listed there under "What must be true before this becomes
true". Reversing is a project, not a flag.

---

## DECIDED — 2. iPad support: **NO — iPhone-only MVP**

**Decision: iPhone only.** `ios.supportsTablet` is now `false`.

**Why it mattered.** It had been `true` by Expo default rather than by intent,
which made the resolved Info.plist advertise all four iPad orientations
(`UISupportedInterfaceOrientations~ipad`) for an app that declares
`orientation: portrait` and ships portrait-only on iPhone. No iPad layout
work, iPad QA or iPad screenshots exist anywhere in the repository.

**Consequence:** the App Store listing no longer needs iPad screenshots, and
the app will not be offered on iPad.

---

## DECIDED — 3. Crash observability: **SENTRY**

**Decision: Sentry**, official SDK.

**What shipped.** `@sentry/react-native@~7.11.0` plus its Expo config plugin,
and `frontend/lib/sentryClient.ts`. It attaches to the seam
`lib/crashReporting.ts` already had — one capture funnel, one swappable sink,
one scrubber — rather than adding a second reporting philosophy.

**What it sends:** error type, scrubbed message, scrubbed stack, device model,
OS version, app version.

**What it cannot send**, enforced four independent ways so no single mistake
leaks:

| Not sent | Mechanism |
|---|---|
| journal text, AI Coach transcripts, habit/task names | the existing scrubber runs on every event, at the funnel and again in `beforeSend` |
| `Authorization: Bearer <supabase jwt>`, request bodies, PostgREST URLs | `delete event.request` |
| any user identity, including the SDK's own random installation id | `delete event.user` |
| console / http / navigation breadcrumbs | `beforeBreadcrumb: () => null` |
| screen contents | no replay integration; both replay sample rates pinned at 0 |
| request URLs via spans | `tracesSampleRate: 0`, auto performance tracing off |

**Update 2026-09-13.** The owner created the Sentry project
(`omer-aydinoglu / aderyth-mobile`) and all five EAS production variables;
`SENTRY_AUTH_TOKEN` is `SENSITIVE`. `SENTRY_DISABLE_AUTO_UPLOAD` is `"false"`
(commit `a8b3f4a`). Source-map upload is **verified PASS** on three builds
(`677e477f` store AAB versionCode 4, `e6cef47e` +5, `2352cacd` +6). The
**runtime ingest** (a real event arriving in the project) is still
**UNVERIFIED** and is **deferred** by the scope addendum
(`docs/plan/21_KAPSAM_EKI_2026-09-13.md` §6.4). The table below is kept as
the record of what was required.

| Where | Name | Value | Notes |
|---|---|---|---|
| EAS environment variable (plain, `production`) | `EXPO_PUBLIC_SENTRY_DSN` | the project DSN | public by design — a DSN is write-only ingest and every shipped app embeds one |
| EAS environment variable (plain, optional) | `EXPO_PUBLIC_SENTRY_ENVIRONMENT` | `production` | defaults to `production` in a release build if unset |
| EAS environment variable (plain, `production`) | `SENTRY_ORG` | the org slug | build-time only, read by `sentry-cli` |
| EAS environment variable (plain, `production`) | `SENTRY_PROJECT` | the project slug | build-time only |
| **EAS secret** | `SENTRY_AUTH_TOKEN` | org auth token with `project:releases` | **secret** — never `EXPO_PUBLIC_`, never in git |
| `frontend/eas.json` → `production.env` | `SENTRY_DISABLE_AUTO_UPLOAD` | change `"true"` → `"false"` | set to `"true"` today so the build does not fail on a missing token; **flipping it is what turns source-map upload on** |

Create them with:

```
eas env:create --environment production --name EXPO_PUBLIC_SENTRY_DSN --value <dsn>
eas env:create --environment production --name SENTRY_ORG --value <org-slug>
eas env:create --environment production --name SENTRY_PROJECT --value <project-slug>
eas env:create --environment production --name SENTRY_AUTH_TOKEN --value <token> --visibility secret
```

Then set `SENTRY_DISABLE_AUTO_UPLOAD` to `"false"` in `eas.json` and rebuild.
Until that happens, crashes are not reported anywhere.

---

## DECIDED — 4. Public URLs: chosen, **but not live**

**Decision:** the URLs are
`https://aderyth.com/privacy`, `https://aderyth.com/support` and
`https://aderyth.com/delete-account`.

**Status: NOT PUBLISHED — blocks store submission.** Probed 2026-09-08:

| URL | HTTP |
|---|---|
| `https://aderyth.com/` | **200** |
| `https://aderyth.com/privacy` | **404** |
| `https://aderyth.com/support` | **404** |
| `https://aderyth.com/delete-account` | **404** |

So the domain exists and resolves; the three pages do not. Host-ready,
self-contained HTML for all three is written and waiting in
`docs/store/web/`.

Because they 404, **nothing in the app or in store metadata links to them
yet** — `PUBLIC_SITE_URLS_LIVE` in `frontend/lib/featureGates.ts` is `false`,
which is also what keeps the Settings → Destek row hidden. A privacy link that
404s is a named rejection reason in both stores and a visibly broken button in
the app.

**Update 2026-09-13.** The three placeholders are **filled** (owner-confirmed:
`support@aderyth.com`, `30 gün`, `Ömer Aydınoğlu`; commit `d225dfc`) and
GoDaddy paste-ready fragments exist in `docs/store/web/godaddy/`. Publishing is
**deferred** by the scope addendum (§6.3): it happens with the Aderyth web
project, and `PUBLIC_SITE_URLS_LIVE` stays `false` until the URLs are actually
live. When that day comes: publish, confirm 200, flip the flag, enter the URLs
in both consoles — in that order.

---

## OPEN — 5. Apple Developer team and iOS signing

**Status: EXTERNAL ACCOUNT ACTION REQUIRED — blocks any iOS store artifact.**

`eas credentials --platform ios` cannot proceed without an interactive Apple
account login, which was not performed. So **none** of the following could be
verified: Apple Developer Program enrolment, team membership, the
`com.aderyth.app` App ID, a distribution certificate, or a provisioning
profile. No certificate was revoked, no membership purchased, no agreement
accepted.

Repository-side the iOS build is ready: bundle id `com.aderyth.app`,
`supportsTablet: false`, `ITSAppUsesNonExemptEncryption: false`,
`NSAllowsArbitraryLoads: false`, and a `production` EAS profile with
`simulator: false`.

See the step report for the exact manual sequence.

---

## OPEN — 6. Legal review of the privacy policy

**Status: DRAFT — owner/legal review required.**

`docs/store/PRIVACY_POLICY_DRAFT.md`, `docs/store/web/privacy.html` and
`app/screens/privacy.tsx` describe the app's real data flows, written from the
schema, the network paths and the dependency list, and now including Sentry.
That makes them *accurate*, not *approved*. Publishing is a legal decision.

---

## OPEN — 7. Export compliance acknowledgement

**Status: technical finding complete; owner acknowledgement outstanding.**

Technical result: **USES_NO_OR_ONLY_EXEMPT_ENCRYPTION** — evidence in
`EXPORT_COMPLIANCE.md`, re-checked after adding Sentry (which uses OS HTTPS
and adds no custom cryptography). `ITSAppUsesNonExemptEncryption: false` is
set on that basis. No `ITSEncryptionExportComplianceCode` was invented and
this is not legal advice.

---

## OPEN — 8. Google Play app registration

**Status: EXTERNAL ACCOUNT ACTION REQUIRED.**

Whether `com.aderyth.app` is reserved in Play Console could not be verified —
no Play Console access, and no Google service account key is configured on the
EAS project.

See the step report for the exact manual sequence.
