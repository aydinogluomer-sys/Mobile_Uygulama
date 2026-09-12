# Privacy Declaration Matrix — Apple App Privacy / Google Data Safety

Evidence sheet for the owner to fill the two store consoles. **Nothing here has
been submitted to App Store Connect or Play Console.**

Every row was derived from the actual schema, the actual network calls and the
actual dependency list on `1267794` + Step 11B. Where the correct declaration
depends on a judgement the owner or their counsel must make, the row says
`NEEDS_OWNER_CONFIRMATION` rather than guessing — a wrong declaration is worse
than an absent one.

---

## 0. What the app does NOT do

Stated first because both consoles ask, and because "no" is a claim that has to
be checkable:

| Claim | Evidence |
|---|---|
| No advertising, no ad network | No ad SDK in the 39 runtime dependencies |
| No tracking / no ATT prompt | No IDFA/AAID access, no tracking SDK, `NSUserTrackingUsageDescription` deliberately absent |
| No analytics SDK | None in dependencies |
| No ad/analytics SDK bundled with crash reporting | Sentry is present (owner decision, Step 11B.1) and is configured with tracing, session tracking, replay and breadcrumbs all off |
| No push token collected | `profiles.push_token` column exists but **no code writes it**; notifications are local (`scheduleNotificationAsync`) only |
| No location, contacts, photos, files | No such permission or dependency |
| No audio recording retained | `expo-speech-recognition` returns a transcript; no audio is stored or uploaded by Aderyth |
| No payment data | No IAP and no payment SDK in this build. Owner decision is FREE MVP; the paywall screen was removed entirely |
| Crash reports carry no identity | `beforeSend` deletes `event.user`, which also removes the SDK's own random installation id |

---

## 1. Apple — App Privacy

`Linked to user` = tied to the account identity. `Tracking` = used to track
across other companies' apps/sites; **none** of these are.

| Aderyth data | Apple category | Collected | Linked | Tracking | Purpose |
|---|---|---|---|---|---|
| Email address | Contact Info → Email Address | Yes | Yes | No | App Functionality (authentication) |
| Username (optional) | User Content → Other / Identifiers | Yes | Yes | No | App Functionality, leaderboard display |
| Account user id | Identifiers → User ID | Yes | Yes | No | App Functionality |
| Habits, logs, tasks, projects, goals, OKRs, routines, recovery plans, focus & deep-work sessions, willpower/capacity, bad habits, reading list, life areas, events | User Content → Other User Content | Yes | Yes | No | App Functionality |
| Notes and journal entries (free text) | User Content → Other User Content | Yes | Yes | No | App Functionality |
| AI Coach messages (user + assistant) | User Content → Other User Content | Yes | Yes | No | App Functionality |
| Focus Point balance, tier, credit ledger | Purchases → Other / Usage Data | Yes | Yes | No | App Functionality |
| AI request metadata (request id, mode, status, cost) | Usage Data → Product Interaction | Yes | Yes | No | App Functionality, abuse/replay protection |
| XP, level, badges, pets, quests, streaks | Usage Data → Product Interaction | Yes | Yes | No | App Functionality |
| Microphone audio | — | **No** | — | — | Transcribed by the OS; Aderyth stores no audio |
| Diagnostics / crash data | Diagnostics → Crash Data | **Yes** | **No — not linked** | No | App Functionality (diagnosing crashes) |

**Third-party processing to declare:** AI Coach content is sent to **Anthropic**
for processing, and crash diagnostics are sent to **Sentry**. Apple treats both
as collection by the app (collected, then processed by a service provider), not
as tracking.

**Why Crash Data is "not linked".** Apple's "linked to the user" means tied to
identity. Aderyth attaches none: `lib/sentryClient.ts` deletes `event.user`
before send, so neither an account id nor the SDK's own installation id
leaves the device, and breadcrumbs — where an account-scoped URL would
otherwise appear — are never recorded.

`NEEDS_OWNER_CONFIRMATION` — whether the owner wishes to declare `Username` under
*User Content* or *Identifiers*; both are defensible and the leaderboard makes it
partly public.

---

## 2. Google — Data Safety

Google's definitions used deliberately:
- **Collected** = transmitted off the device.
- **Shared** = transferred to a *third party*. Google explicitly says transfer to
  a **service provider processing on your behalf** is generally **not** "shared".
  Anthropic and Supabase are service providers here.

| Aderyth data | Play category | Collected | Shared | Purpose | Required? | Encrypted in transit | Deletable |
|---|---|---|---|---|---|---|---|
| Email address | Personal info → Email address | Yes | No | Account management | Required | Yes (HTTPS/TLS) | Yes |
| User id | Personal info → User IDs | Yes | No | Account management, app functionality | Required | Yes | Yes |
| Username | Personal info → Name (optional) | Yes | No | App functionality, leaderboard | Optional | Yes | Yes |
| Notes / journal free text | Personal info → Other personal info | Yes | No | App functionality | Optional | Yes | Yes |
| AI Coach messages | Personal info → Other personal info | Yes | No¹ | App functionality | Optional | Yes | Yes |
| Habits, logs, tasks, goals, routines, focus sessions, reviews | App activity → Other actions | Yes | No | App functionality | Required for the product to work | Yes | Yes |
| Focus Point / subscription state | App activity → Other actions | Yes | No | App functionality | Required | Yes | Yes |
| Gamification (XP, level, badges) | App activity → Other actions | Yes | No | App functionality | Required | Yes | Yes |
| Microphone audio | Audio → Voice or sound recordings | **No** | No | — | — | — | — |
| Crash logs | App info & performance → Crash logs | **Yes** | No² | Diagnostics / app functionality | Optional | Yes (HTTPS/TLS) | n/a — not linked to an account³ | — |

¹ `NEEDS_OWNER_CONFIRMATION` — AI Coach text is transmitted to Anthropic. Under
Google's definition a service provider is not "sharing", but the owner should
confirm the Anthropic arrangement is a processor relationship before answering
"not shared". The **User Data policy still requires disclosure** of the
third-party AI processing regardless of how this box is answered, and the
privacy policy does disclose it.

² Sentry is a service provider processing on Aderyth's behalf, the same
analysis as Anthropic in footnote 1. Disclosure is required regardless of how
the "shared" box is answered, and the privacy policy does disclose it.

³ Play asks whether users can request deletion of each collected type. Crash
logs are not associated with an account, so there is nothing to look up and
delete per user; state that in the free-text explanation rather than claiming a
deletion path that cannot exist. Every other row IS deletable, in-app and
immediately.

**Data deletion:** answer **"Users can request that their data be deleted"** and
**"Users can delete their data in-app"** — Aderyth has both an in-app path
(Settings → Hesap → Hesabı Sil) and, once the owner publishes it, a web request
URL (`ACCOUNT_DELETION_WEB_REQUIREMENTS.md`).

**Encryption in transit:** Yes. All traffic is HTTPS/TLS; `NSAllowsArbitraryLoads`
is now `false` on iOS and no cleartext endpoint is configured.

---

## 3. Leaderboard — the one genuinely cross-user projection

`get_global_leaderboard` / `get_weekly_leaderboard` are `SECURITY DEFINER` and
return, across users: `user_id, username, level, total_xp, willpower_rank, rank`
(+ `weekly_xp`). **No email, no push token, no free-text content.** Disclosed in
the privacy policy; declare `Username` as visible to other users.

---

## 4. Data retention

| Data | Retention |
|---|---|
| Everything user-owned | Until the user deletes the account, then removed immediately |
| Account deletion | Cascades across all 47 `public` tables holding a `user_id` — verified live in Step 11B |
| Anthropic-side retention | **Not under Aderyth's control.** Not claimed either way in the policy |
| Sentry-side retention | Set by the Sentry project's own retention policy, which the owner controls once the project exists. `NEEDS_OWNER_CONFIRMATION` |
| Backups | `NEEDS_OWNER_CONFIRMATION` — Supabase project backup retention is a hosting setting; state it once confirmed |
