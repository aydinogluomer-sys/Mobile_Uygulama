# Owner Decisions — Store Release

Only decisions that have **actually been made** are recorded as made. Everything
else is listed as open, with what each answer would cost, so the choice can be
made once rather than re-litigated.

Nothing in this file was decided by the engineering pass. Where a technical
finding constrains an answer, the finding is given and the choice is still the
owner's.

---

## OPEN — 1. Monetization: FREE MVP or PAID subscriptions

**Status:** UNRESOLVED — blocks store submission.

**Why it cannot ship as-is.** `app/screens/paywall.tsx` today shows Plus/Pro
tiers, weekly/monthly/yearly prices and an "Abone Ol" button. In a release
build pressing it produces an alert saying purchase is not available, and the
screen carries the line *"Test modu: Abone Ol şu an krediyi hemen yükler.
Gerçek ödeme … yayına çıkmadan eklenecek."* A reviewer sees advertised prices,
a buy button that does nothing, and an internal note about unfinished work.
Apple 3.1.1 and Play's payments policy both reject that shape.

**A. FREE MVP** — remove the price table and the "Abone Ol" affordances,
replace the paywall with a truthful description of the free tier and its Focus
Point grant, leave FP economics untouched. Smallest change, ships soonest, and
nothing about the current server-side FP machinery is wasted: it keeps working
for the free grant.

**B. PAID** — implement StoreKit + Google Play Billing behind one entitlement
source of truth, with restore, server-side verification, transaction
idempotency, upgrade/downgrade, cancellation and expiry, plus store product
IDs and sandbox/licence testers. This is a substantial piece of work with its
own security review, and it needs a vendor decision of its own (a maintained
native IAP layer, or a service such as RevenueCat). **No vendor or account has
been chosen on the owner's behalf.**

Prices, tier names and FP grants are **not** to be changed by engineering
either way.

---

## OPEN — 2. iPad support

**Status:** UNRESOLVED.

**Finding.** `app.json` sets `ios.supportsTablet: true`, and the resolved
Info.plist consequently declares all four orientations for iPad
(`UISupportedInterfaceOrientations~ipad`) while the app itself declares
`orientation: portrait` and ships portrait-only iPhone orientations. No iPad
layout work, iPad QA or iPad screenshots exist anywhere in the repository. So
tablet support is currently switched on by default rather than by intent.

**A. Keep iPad** — requires iPad layout acceptance testing and a separate set
of iPad screenshots for App Store Connect.

**B. iPhone only for MVP** — set `supportsTablet: false`. One line, removes an
untested surface and an asset requirement.

Not changed silently, because it alters what the app claims to support.

---

## OPEN — 3. Crash observability

**Status:** UNRESOLVED.

**Finding.** There is no crash reporting of any kind: no Sentry, Bugsnag,
Crashlytics, native crash sink, source-map upload or release tagging in the
39 runtime dependencies. There is no global JS exception handler and no
top-level `ErrorBoundary`. A production crash today is invisible.

**A. Sentry** — official SDK-57 integration; DSN via EAS environment, auth
token via EAS secret, source maps uploaded, PII minimised, AI Coach and journal
text scrubbed by default. Adds a processor to the privacy inventory.

**B. Another named provider** — same constraints.

**C. Accept no external sink for MVP** — legitimate, but then a crash is only
visible through store console crash reports.

**No external SaaS account has been opened.**

---

## OPEN — 4. Public URLs

**Status:** UNRESOLVED — blocks store submission. All three are required
fields in the store consoles and none exists today.

| URL | Needed by | Current |
|---|---|---|
| Privacy policy | App Store Connect + Play Console | none — in-app screen only |
| Support | App Store Connect | none |
| Account deletion request | Play Console (external web resource) | none |

No placeholder domain has been invented and no broken link has been shipped.
The in-app privacy screen (`app/screens/privacy.tsx`) exists so the *product*
discloses correctly while the *listing* still needs a real HTTPS URL.

See `ACCOUNT_DELETION_WEB_REQUIREMENTS.md` for what the deletion page must say.

---

## OPEN — 5. Apple Developer team and iOS signing

**Status:** EXTERNAL ACCOUNT ACTION REQUIRED — blocks any iOS store artifact.

`eas credentials --platform ios` cannot proceed without an interactive Apple
account login, which was not performed. Therefore **none** of the following
could be verified: Apple Developer Program enrolment, team membership, the
`com.aderyth.app` App ID, a distribution certificate, or a provisioning
profile. No certificate was revoked, no membership purchased, no agreement
accepted.

**Owner action:** confirm Apple Developer Program enrolment, then run
`eas credentials --platform ios` interactively (or `eas build --platform ios
--profile production`, which provisions on first run) and confirm the App ID
`com.aderyth.app` is registrable under the team.

---

## OPEN — 6. Legal review of the privacy policy

**Status:** DRAFT — owner/legal review required.

`docs/store/PRIVACY_POLICY_DRAFT.md` and `app/screens/privacy.tsx` describe the
app's real data flows, written from the schema, the network paths and the
dependency list. That makes them *accurate*, not *approved*. Publishing is a
legal decision.

---

## OPEN — 7. Export compliance acknowledgement

**Status:** technical finding complete; owner acknowledgement outstanding.

Technical result: **USES_NO_OR_ONLY_EXEMPT_ENCRYPTION** — evidence in
`EXPORT_COMPLIANCE.md`. `ITSAppUsesNonExemptEncryption: false` has been set on
that basis. The owner should confirm they accept the declaration; no
`ITSEncryptionExportComplianceCode` was invented and this is not legal advice.

---

## OPEN — 8. Google Play app registration

**Status:** EXTERNAL ACCOUNT ACTION REQUIRED.

Whether `com.aderyth.app` is reserved in Play Console could not be verified —
no Play Console access was available and no Google service account key is
configured on the EAS project. The package name is **not** in use by this
project's EAS credentials for submission purposes.

**Owner action:** create the app entry in Play Console under
`com.aderyth.app`, and enrol in Play App Signing (the existing EAS upload
keystore is suitable as the upload key — fingerprints in `RELEASE_CHECKLIST.md`).
