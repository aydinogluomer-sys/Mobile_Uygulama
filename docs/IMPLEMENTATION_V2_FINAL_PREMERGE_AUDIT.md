# ATLAS — IMPLEMENTATION_V2 FINAL PRE-MERGE AUDIT

**Branch:** `phase/final-v2-hardening`
**Audit measured against the tree at:** `ac93d28` — the parent of the commit
that carries this revision. A document cannot state its own SHA, so the commit
adding these rows is by construction not the one they were measured on.
**Final branch HEAD and its CI result:** see the terminal report, not this
file. Nothing here claims a CI run it cannot have observed.
**Date:** 2026-08-31

Status values are only `PASS`, `BLOCKED_EXTERNAL`, `FAIL`,
`REQUIRED_BEFORE_MERGE` or `DEFERRED_WITH_JUSTIFICATION`. `NOT_DONE` is gone:
every item that carried it has been classified as one or the other, because
"not done" was doing the work of a decision nobody had made. Nothing here is
marked from a document or a commit message; every `PASS` names the command,
query or live request that produced it.

---

## 0. Live schema vs `main` — RESOLVED by a compatibility rollback

`20260831_recovery_vocabulary` narrowed `recovery_plans.strategy` and
`.status` to the v2 vocabulary on the live project. The v2 branch is not
released, so the client running against that database is still `main`, which
writes the legacy words — and `main`'s recovery flow broke: it could not
create, complete or skip a plan.

**Resolved.** `20260831_recovery_vocabulary_compat_rollback` restores the
legacy `strategy` contract and the six-value compatibility `status` set.
Verified live as an ordinary `authenticated` caller under RLS, not as the
service role:

| step | result |
|---|---|
| acting as | `authenticated`, `auth.uid()` resolved |
| CREATE `strategy='full'` `status='planned'` | PASS |
| COMPLETE `status='done'` | PASS |
| CREATE `strategy='reschedule'` `status='planned'` | PASS |
| SKIP `status='skipped'` | PASS |
| CREATE `strategy='half'` and `'mini'` | PASS |
| INVALID `strategy='garbage'` | refused (check violation) |
| INVALID `status='garbage'` | refused (check violation) |
| v2 `strategy='complete_today'` | refused — the rollback took effect |
| rows before / after | 0 / 0 (unchanged) |

Scope of the rollback is the vocabulary and nothing else. `source_log_id`,
`deficit_type`, `deficit_value`, `distributed_days`, `completed_at` and the
three constraints that guard them are untouched — none of them caused the
incompatibility, and `main` never writes them.

The migration history is not rewritten: `20260831_recovery_vocabulary` remains
exactly as applied, and the rollback is a new forward migration that
supersedes its vocabulary half.

**This is a deployment postponement, not a retraction of the work.** The v2
vocabulary is re-applied as part of a coordinated release — see the release
gate in §0b.


---

## 0b. Release gate — the v2 vocabulary must be re-applied

`20260831_recovery_vocabulary` is **authored, applied once, and currently
rolled back** on the live project so the unreleased-branch situation does not
break `main`.

```
Recovery V2 code                                   : PASS
Recovery V2 migration authored                     : PASS
Recovery V2 vocabulary live                        : ROLLED BACK FOR MAIN COMPATIBILITY
Coordinated V2 migration required before/with release : YES
```

**This is a gate, not a note.** Shipping the v2 client without re-applying the
vocabulary migration breaks the branch's recovery flow in the exact mirror of
what the rollback fixed: the client would write `complete_today` / `completed`
into a table whose CHECK accepts only `full|half|mini|reschedule` for
`strategy`. Create, complete and skip would all fail.

Re-apply order, whichever way the release goes:

1. re-apply `20260831_recovery_vocabulary` (it is idempotent — it drops and
   recreates the two CHECKs by name); then
2. deploy the v2 client.

Doing it the other way round leaves a window in which the shipped client
cannot write a recovery plan. `recovery_plans` is expected to stay small; if
it has rows by then, the legacy values must be mapped first —
`full→complete_today`, `reschedule→push_tomorrow`, `half→split_two_days`,
`mini→skip`, `done→completed`, `skipped→cancelled` — which is the mapping the
deleted adapter used and the migration's own header records.

---

## 1. Requirement matrix

| ID | Requirement | Before | Change | Verification | Status |
|---|---|---|---|---|---|
| **§1** | Registration works | `signUp()` → 500 | none possible in code | **Real signUp attempted**, not skipped: `500 Error sending confirmation email`; `/auth/v1/settings` → `mailer_autoconfirm=false`; 0 orphan rows created | **BLOCKED_EXTERNAL** |
| **§2** | Google OAuth state fail-closed | `state ?? clientState` fallback | only the provider's state is forwarded; absent state refuses before the callback request | behaviour tests + mutation (1 red) | **PASS** |
| **§3** | Disconnect honesty | response discarded, state cleared unconditionally (Google **and** Spotify) | local state cleared only on server confirmation | 401/500/throw cases; mutations (2 red each) | **PASS** |
| **§4** | Spotify security drift | canonical hardened, **production not** | canonical verified hardened; deploy NOT performed; and the client now **refuses to start a new authorization** rather than pointing users at the vulnerable deployment | Deployed function probed live on the final day: unsigned UUID state, callback never checks it, and `redirect_uri=https://attacker.example/steal` returns 200 with that URL embedded — no allowlist. `SPOTIFY_OAUTH_ENABLED=false` refuses in the store before any I/O; playback and `disconnect` still work for an already-connected account. 5 tests, mutation red 3/5 | **BLOCKED_EXTERNAL** (securely disabled meanwhile) |
| **§5** | Google Calendar deployed | function absent, table absent | table created (49→50), canonical function written, client fails closed | migration verified; deploy pending secrets | **BLOCKED_EXTERNAL** (code complete) |
| **§6** | Notion sync E2E | `success:true, synced_habits:0` forever | columns fixed, errors checked, honest partial reporting; **deployed v2** | code/schema/deploy sub-checks pass live (v1 query → `42703`, v2 → OK, function authenticating). A linked-account round trip needs Notion credentials | **BLOCKED_EXTERNAL** |
| **§7** | Full RLS semantic audit | policy counting only | 127 live checks, 2 users + anon; 1 defect found and fixed | `docs/FINAL_RLS_MATRIX.md` | **PASS** |
| **§8** | Repository **and service** boundary | **72** direct DB calls across 17 stores (the 34/11 figure was a mis-measurement — see §2b) | UI→Store→Service→Repository→Supabase. 10 services holding named domain rules, 21 repositories | 0 services touch supabase; 0 UI files import a repository; the 7 orchestrated stores reach the DB only through their service; the 10 CRUD-only stores are explicitly classified rather than left unaccounted for. `layerBoundary` pins each service's rule BY NAME; 4 mutations verified | **PASS** |
| **§9** | Monthly review cloud persistence | `monthly_review_<YYYY-MM>` in AsyncStorage — no account in the key, one device, unrecoverable | `monthly_reviews` table (owner RLS, unique per month, jsonb answers with a DB-enforced shape); AsyncStorage demoted to a per-account draft | 15 behaviour tests on precedence + lossless migration; 7 live constraint probes; 3 mutations red (global draft key, draft cleared before the write is confirmed, legacy adopted over cloud content). The old structural assertion was migrated, not deleted, and mutation-checked | **PASS** |
| **§10** | Structural tests on current contract | three shallow proxies; the monthly-review gate encoded AsyncStorage | all rewritten to pin real contracts; the monthly-review gate migrated with §9 and mutation-checked | `run-tests.js` 145/145 | **PASS** |
| **§11** | XP idempotency + reconstructibility | idempotent already (premise disproven, see §3); but `profiles` UPDATE was granted on `total_xp`, `level`, `willpower_rank`, `coins`, `skill_points` with no `WITH CHECK`, so a user could set their own leaderboard position — **proven live**, not inferred; 3 award trigger functions attached to nothing; and nothing could tell whether the number was right | grant narrowed to `username`; `WITH CHECK` added; dead functions dropped; `xp_drift()` + `rebuild_profile_xp()` | 6/6 idempotency live + 4 live grant probes (self-grant XP / level+rank / coins+skill points all refused, `username` still allowed) + drift/rebuild proven end to end. Backfill found and repaired one real profile: 30 XP earned across 13 logs, never credited. Drift now 0 | **PASS** |
| **§12** | Focus-Point charging atomicity | read balance -> call Anthropic -> debit, with the RPC's `ok` flag never read and its `error` never destructured: a refused debit returned the UN-debited balance as success (free AI output), a failed RPC returned a fabricated `balance - cost`, and a retry charged twice | debit FIRST through `spend_focus_points_v2` (idempotent on `(user_id, request_id)`), refund on every AI failure path, real balance returned | 7 live DB probes (spend / replay / insufficient / exact / empty / refund / double-refund / reused-refunded-key / zero / negative amount) + 20 source assertions on ordering. 3 mutations red: debit moved after the AI client, one refund path deleted, balance fabricated again. Edge deployed v12 ACTIVE | **PASS** |
| **§13** | Pagination | unbounded reads across the data layer | keyset paging, per-tab paging, server-side search, `LoadMoreFooter` in four screens; 3 further unbounded queries found and bounded | Bounding is now checked PER QUERY (`queryBounding`), generating `docs/QUERY_BOUNDING_MATRIX.md`: 64 queries, 32 collection SELECTs, **0 UNCLASSIFIED**. Runtime paging proven with 65 rows at page size 30 — no duplicates, nothing missing, stable under insert/delete, id tie-breaker exercised. 3 mutations each turn it red | **PASS** |
| **§14** | Navigation IA | today/tasks/focus/timeline/stats | Bugün · Plan · Alışkanlıklar · İçgörüler · Profil; hubs compose the existing screens, old routes kept as `href: null` | `run-tests.js` parses visible vs hidden; 3 mutations verified | **PASS** |
| **§15** | Legacy FastAPI retirement | 3 features on an UNAUTHENTICATED service (`grep -c` for Depends/jwt/Authorization/verify_token = 0) where every row is `user_id = "default"`; `GET /api/export` returned every user's habits, tasks, completions and webhooks to any caller, and settings.tsx opened the Excel/CSV variants in the system browser | webhooks + bad habits on Supabase with owner RLS; export assembled on the device from the repositories; `utils/api.ts` and `axios` gone | 50 tests. 4 mutations red: re-reading `EXPO_PUBLIC_BACKEND_URL`, re-adding axios, un-stripping webhook headers from the backup, restoring the negative-savings bug. Live probes: `http://` refused, unknown event type refused, negative cost refused, blank name refused, `https://` accepted | **PASS** |
| **§16** | Dependency security | 2 critical, 16 high | `npm audit fix`, no `--force` | **0 critical, 9 high** — all in the build toolchain (metro, @expo/cli, image-size, postcss). Absence from the shipped bundle is now PROVEN, not asserted: string search over the 6.5 MB Hermes bundle with a positive control (`supabase` 15, `generate-routine` 1, `monthly_reviews` 1 — so the search works on `.hbc`), and `node_modules/image-size` / `require('image-size')` = 0. The one raw `image-size` hit is the Ionicons glyph `image-size-select-small` | **PASS** |
| **§17** | Lint zero | full repo 3 err / 183 warn; `expo lint` saw only 73 of them | **0 / 0 across the whole repository** | 3 errors were an eslint env gap (`jest`, `__dirname` undeclared), not defects — declared rather than silenced. 42 hook-dependency warnings fixed on their merits, not suppressed: 30 by naming stable store actions, the rest by restructuring (clock read inside the loader, filter moved into the effect, latest-ref in the two review screens). A new test pins the zustand identity assumption the 30 rely on | **PASS** |
| **§18** | Package manager | `yarn@1.22.22`, no yarn.lock | `npm@11.16.0`; CI comment corrected | manifest/lockfile/CI all name npm | **PASS** |
| **§19** | Design tokens | 1572 hex literals in 56 files against a token table that already held most of them | 1139 replaced with the token holding that exact colour; then the remaining 385 enumerated one at a time and split — **181 were semantic UI chrome and are now tokens** (Tailwind greys, cool near-blacks, 90 alpha variants of existing tokens, the journal paper set, selected-state tints), 181 are a categorical palette, illustration constants, theme triples, third-party brand colours or a heatmap ramp | Colour-preserving both times, checked not asserted: the second pass compared 30 files and 1325 colour terms, **0 files changed a colour**. The gate's real assertion is now *no semantic UI colour is left as a bare literal* (previously it was only a count), plus the six exempt categories asserted by exact count — mutation red on both a re-hardcoded token and a brand-new unexplained colour. Full taxonomy in `docs/DESIGN_TOKENS.md` | **DEFERRED_WITH_JUSTIFICATION** (unexplained magic colours: 0; what remains is one design decision — whether the legacy neutral ramp should collapse into `textDim`/`bg` — which changes pixels and belongs to a designer) |
| **§20** | Branding / store assets | installs as "frontend" with Expo's blue "e"; three icons byte-identical; deep-links as `frontend://`; launch on `#000` against a `#15140F` app; notification tint an indigo from no palette; **and the Android notification icon was the opaque app icon, which Android renders as a solid white block** | named Atlas, own scheme, generated mark from `colors.bg`/`colors.accent`, launch colours read from tokens, 6 dead template assets deleted (1056 KB -> 18 KB), and a real white-on-transparent `notification-icon.png` | 13 tests. The notification gate decodes the PNG (inflates IDAT, undoes all five scanline filters) and asserts the alpha spans 0-255 — mutation red pointing it back at `icon.png` with `Expected: 0, Received: 255`. `docs/BRANDING.md` records what is NOT done and why | **DEFERRED_WITH_JUSTIFICATION** for artwork; **bundle identifiers are REQUIRED_BEFORE_STORE_RELEASE** and BLOCKED_EXTERNAL — they are tied to the owner's Apple/Google accounts and a domain they control, and a guess like `com.atlas.app` can collide with a real listing |
| **§21** | Widget | absent | — | absent, and the spec is where that was checked rather than assumed: `PROGRESS.md` records it as assumption **A-05** ("Widgets are deferred, with cause") and `docs/FINAL_GAP_AUDIT_V2.md` files it as **P3-4 — QUALITY**. It appears in no Definition of Done. Building one needs a WidgetKit extension (Swift) or an AppWidgetProvider (Kotlin) plus a config plugin, in a managed-workflow repo with no `ios/` or `android/` directory and no Android SDK on this machine (`adb`/`emulator` absent, checked) | **DEFERRED_WITH_JUSTIFICATION** (P3 polish in the source-of-truth spec, never a merge requirement) |
| **§22** | Crash monitoring sink | dev console only | — | no DSN provided | **BLOCKED_EXTERNAL** |
| **§23** | Offline queue account safety | one global key, no owner | per-account key + `userId` + replay filter + lossless migration | 6 behaviour tests; mutations (4 red / 1 red) | **PASS** |
| **§24** | Recovery vocabulary | two vocabularies + an adapter that DROPPED five fields on every save, on the stale grounds that "the table has no columns for them" — it had, since 20260825 | one vocabulary in the code; the adapter is deleted and all five fields are persisted and read back | **Code PASS. Live vocabulary ROLLED BACK for `main` compatibility** — see §0 and the release gate in §0b. 22 tests + 3 mutations red; the branch keeps the v2 source unchanged | **PASS** (code) |
| **§25** | Negative + measurable habits | reward inverted; two disagreeing scorers; negative habits due on no day | ceiling scoring unified AND the lifecycle closed: `isDueOn` no longer reads `behavior_type`; `isMissedOn`/`countsTowardAverage` carry the real asymmetry (absence of a log is not failure for a negative habit) | reports, analytics and the recovery backlog now include negative measurable habits; 3 mutations red (7/1/1). Also fixed: an explicit `miss` log landed in the done set, so a day the user recorded as failed could never be offered a make-up | **PASS** |
| **§26** | Auth lifecycle | — | partially (queue on sign-out) | register blocked, so the full cycle is untestable | **BLOCKED_EXTERNAL** |
| **§27** | Cache isolation | sync queue and Notion session both global | both scoped per account, each with a lossless one-time migration | 11 behaviour tests across the two; mutations red. `focus.settings.v1` and the theme keys stay global by decision — timer durations and a colour are UI preference, not personal data | **PASS** |
| **§28** | One canonical edge tree | two writable trees | `backend/supabase/functions/` removed | gate: duplicate tree absent, function list pinned | **PASS** |
| **§29** | Edge error contract | 19 call sites; error handling mostly sound but **0 of 19 had a timeout** | every call goes through `withEdgeDeadline` (aborts AND races, 20s) | Full audit in `docs/EDGE_ERROR_CONTRACT.md`, all 19 sites × 5 failure modes. 10 tests; 2 mutations red (single-line and multi-line call losing its deadline), plus one that caught the helper releasing the caller only when the callee honours the signal | **PASS** |
| **§30** | Obsolete comments | "NOT APPLIED", "migration blocked" | corrected in migration, recovery, routineProposal | — | **PASS** |
| **§31** | No hardcoded secrets | unknown | scanned; repo is clean | The deployed `spotify-auth` carries a literal client secret as a `??` fallback. Rotation is the owner's | **BLOCKED_EXTERNAL** |
| **§32** | Release env guards | guard depends on local state | stale DENIED link removed, guard PASSes clean | `predeploy_guard.sh` exit 0, no warning | **PASS** |
| **§33** | Test quality | — | every new suite mutation-verified | 1402 tests, 97 suites. Several gates were found blind by their own mutation checks and fixed: the edge-deadline scanner missed multi-line calls, the XP write detector's template-literal `\s` collapsed to a literal `s`, the waterfall scanner flagged genuine dependencies | **PASS** |
| **§34** | CI as merge gate | `npx expo lint`: app dirs only, warnings advisory (exit 0 on 73) | `npm run lint:ci` = `eslint . --max-warnings=0` | Gates the whole repo, warning = failure. 3 mutations red: an unused variable, a removed hook dependency, an undefined global in a script | **PASS** |
| **§35** | Full live smoke | — | duration, ceilings, RLS, XP, notion-sync, child-row ownership verified live | Registration is the first step and is externally blocked, so the journey cannot run end to end | **BLOCKED_EXTERNAL** |
| **§36** | Performance profiling | `currentUserId` issued `GET /auth/v1/user` before EVERY repository operation, and 13 more sites did the same; the waterfall shape had only ever been checked on one screen | 14 sites moved to a local session read; waterfall scan extended to the whole app | Re-measured live at the transport on the final HEAD, counting requests by service: `currentUser()` x10 -> **0** auth and **0** rest requests; a six-collection screen load -> **6** rest, **0** auth, **0** rpc; `getSession()` x40 -> **0** auth. Batching the same six saves 751 ms of latency (983 -> 232 ms) at an identical request count. Waterfall runs across app/components/store/services: **0**. Full write-up in `docs/PERFORMANCE_V2.md` | **DEFERRED_WITH_JUSTIFICATION** (every source-observable cause is measured and zero; on-device render profiling needs a device or emulator — none available here — and is a store-release QA gate) |
| **§37** | main sync | — | 0 behind | `git rev-list --left-right --count origin/main...HEAD` → `0  15` | **PASS** |

---

## 1c. Live end-to-end verification on a fresh account

Everything below ran against the live project through the app's OWN code —
its repositories, services and stores, signed in with a real JWT under RLS —
rather than through hand-written SQL. 40 assertions across 9 suites, all
passing on the final HEAD.

**How the accounts were made, and why that does not close §1.** `signUp()` is
still broken (see the P0 table), so three accounts were created the way this
project's own `create_test_user_v2` migration does. The
`on_auth_user_created` trigger fires either way, so profile bootstrap is
exercised exactly as a real signup would exercise it — but the SIGNUP GATE
ITSELF is untested by this and stays BLOCKED_EXTERNAL. A journey that starts
one step past the broken door does not prove the door opens.

| § | What was checked | Result |
|---|---|---|
| 5.1 | fresh account: JWT `role=authenticated`, `sub` matches; `lib/session` resolves locally; profile bootstrap `level 1 / xp 0 / rank Acemi / 3 makeup credits`; habits, today's logs, tasks, notes and recovery plans all answer `ok` and empty | PASS |
| 5.2 | binary habit: `done` stored, read back, 100% | PASS |
| 5.3 | numeric `at_least` 10000, logged 8000 -> `partial`, **80%** | PASS |
| 5.4 | duration 20 min, logged 12 -> `partial`, **60%** | PASS |
| 5.5 | negative numeric `at_most` 2: 0/1/2 -> `done` 100%, 3 -> `partial` 50%, 4 -> `miss` 0%. Lifecycle too: `isDueOn` true, an UNLOGGED day is not a miss, an unlogged day is excluded from the average | PASS |
| 5.6 | abstinence: abstained day `done` (30 XP), relapse `miss` (0 XP) | PASS |
| 6 | recovery, both contracts: legacy `full`/`half`/`mini`/`reschedule` + `done`/`skipped` all accepted live; `garbage` refused (23514); the v2 client's `complete_today` refused **for the right reason** (`recovery_plans_strategy_check`); v2 domain functions correct on the branch | PASS |
| 7 | monthly reflection: cloud row with the right `user_id`/`month_key`/answers; survives the screen closing, the local draft being dropped, and a **second device** (storage wiped, fresh login); an unwritten month reads empty, not as an error; `2026-13` and a non-string answer refused (23514) | PASS |
| 8 | offline queue: a tap while the transport fails stays optimistic and pending, 0 server rows; survives a queue reload; flushes to **exactly one** row and **exactly one** XP award; a second flush replays nothing and awards nothing; account B sees none of A's pending work, flushes none of it, and is refused (`42501`) writing to A's habit; A returns and drains it | PASS |
| 9 | XP: one award per completion; a replay of the same intent awards nothing and leaves one row; upgrading `partial`->`done` awards only the difference; `miss`/`skip` earn nothing; a client sending `xp: 999999` gets the server's 10; `total_xp = sum(habit_logs.xp) + purged_xp` | PASS |
| 10 | Focus Points: a real provider failure debits then refunds (`ai_coach -5`, `ai_error +5`, balance restored); the same `request_id` retried adds nothing to either side; an unaffordable call returns **402** with no debit, no output and no negative balance; a refund cannot be replayed into a second credit | PASS |
| 11 | account isolation: B sees none of A's habits, tasks, notes or reflections, cannot reach them by id, cannot update or delete them, inherits none of A's device caches; A signs back in and everything returns. Every surviving device key is account-scoped — **0 unscoped keys hold personal data** | PASS |
| 17 | request counts, measured at the transport: `currentUser()` x10 -> **0** auth requests; a six-collection screen load -> **6** rest, **0** auth, **0** rpc; `getSession()` x40 -> **0** auth; batching saves 751 ms at an identical request count | PASS |

One scenario could NOT be produced: a **successful** AI generation. The
Anthropic account attached to this project is out of credit — the function's
own log says so — so §10 scenario A is BLOCKED_EXTERNAL. That failure is what
made scenario D testable with a genuine provider error instead of a simulated
one, which is a stronger result than the one that was planned.

---

## 2. Defects found and fixed on this branch

Each was found by looking at the running system, not at documentation.

| # | Defect | How it was found | Evidence |
|---|---|---|---|
| 1 | **CRLF made 2 of 4 source gates a no-op.** `.` does not match `\r`, so `/\/\/.*$/` never matched on a Windows checkout and comments were never stripped — gates were matching text inside comments. | Suite failed locally while CI was green | mutation: `await`→`void` 1 red, delete call 4 red |
| 2 | **`notion-sync` had never synced a habit** and reported success. `target_value`/`date` do not exist; the error was never read and `?? []` turned it into "nothing to sync". | Read the deployed source, checked columns live | live: `42703: column habit_logs.target_value does not exist` |
| 3 | **Canonical `generate-routine` would have broken two AI features** — 2 modes vs production's 4, no rejection branch, so `summarize`/`insights` fall through to `routine` at 25 FP. | Compared client call sites to canonical to deployed | gate: 4 red on the stale version |
| 4 | **Google Calendar 404'd entirely** — function in neither the canonical tree nor the deployment, table absent. | Live `list_edge_functions` + `information_schema` | 0 rows for `google_calendar_integrations` |
| 5 | **OAuth `state` fallback defeated CSRF protection** — the client backfilled its own state when the provider returned none, so verification always passed. | Reading the client after hardening the server | mutation: 1 red |
| 6 | **Disconnect claimed a revocation that had not happened** (Google and Spotify). | Comparing the three integrations' disconnect paths | mutations: 2 red each |
| 7 | **`at_most` scoring was inverted** — 0 of 2 cigarettes scored 0% and was recorded `miss`; 20 scored 100% `done`. Two scorers disagreed on the same day. | Followed through from making negative+numeric expressible | mutations: 18 red / 10 red |
| 8 | **`habit_logs` accepted foreign habit ids** — any user could attach logs to another user's habit. | Live cross-user RLS matrix | live: insert accepted → after fix `42501` |
| 9 | **The offline queue was shared by every account** on a device — A's writes drained through B's session. | Reading the replay path's user resolution | mutations: 4 red / 1 red |
| 10 | **`notion-auth` canonical was undeployable** — it had dropped `createAtlasDatabases` and wrote null database ids, which would break new connections *and* wipe working ones via upsert. | Comparing canonical to deployed before deleting the duplicate tree | gate: 3 assertions |
| 11 | **The offline queue treated every offline tap as a server rejection.** `logStore` classified connectivity failure as "the call threw"; supabase-js never throws — it returns `{ data: null, error, status: 0 }`. So the `network` branch was unreachable on a device: five offline taps exhausted `MAX_ATTEMPTS`, the op went `dead`, and a logged completion was dropped; each one also rolled the optimistic row back. | Ran the real store against the live project with a failing transport | live probe: `threw: false`, `status: 0`. Fix classifies on HTTP status; the test mock (which threw) now answers the way the client does — 3 of its 9 assertions go red without the fix |
| 12 | **A ceiling habit was scored as a floor by the server.** `habit_xp_value` never read `target_direction`, so "at most 2" with a logged 3 paid the FULL 30 XP — the same as a perfect 0. §25's ceiling fix had landed on the client, but XP is decided by a trigger that overwrites whatever the client sends. | Live XP journey on a real account | before: every value 0-6 paid 30. After `20260831_ceiling_xp`: 0/1/2 -> 30, 3 -> 15, 4 -> 0 |
| 13 | **`xp_drift()` accused users of drifting because they deleted a habit,** and `rebuild_profile_xp` would have confiscated the XP. `habit_logs.habit_id` is ON DELETE CASCADE and `purgeHabit` is reachable from two tabs, so the logs vanish and the XP stays. | Reproduced from zero on an untouched account | log one habit (+10), delete it -> `xp_drift` reports 10. After `20260831_xp_drift_survives_purge`: 0, and a hand-edited total still makes it fire (0 -> 1 -> 0) |
| 14 | **`anon` and `authenticated` held TRUNCATE on all 53 public tables.** RLS does not apply to TRUNCATE, so every ownership policy in this project is bypassed by one statement. Not reachable through PostgREST (no TRUNCATE verb, no DDL) — a property of today's call sites, not of the permission system. | `has_table_privilege` across every table | after revoke: 0 of 53 for both roles on TRUNCATE/REFERENCES/TRIGGER; SELECT/INSERT/DELETE still 53 |
| 15 | **The Android notification icon was the opaque app icon.** From API 21 Android reads the ALPHA CHANNEL ONLY and fills the shape with the accent colour, so every notification would have shown a solid white block. | Decoded `icon.png`'s alpha: min and max both 255 | new white-on-transparent icon; the gate inflates the PNG and undoes all five scanline filters to assert alpha spans 0-255 — mutation red with `Expected: 0, Received: 255` |
| 16 | **The UI showed an XP number the client invented.** `timeline.tsx` renders `+{log.xp}` from the optimistic row, whose `xp` came from a formula the server does not use — 30 against 10 for a binary done, 18 against 6 for a 12/20 duration day. Brief when online; as long as the queue waits when not. | Comparing client and server XP on the same live log | the optimistic row now carries the last CONFIRMED xp; the badge's own `xp > 0` guard hides it until the server answers |
| 17 | **`xp_drift()` and `rebuild_profile_xp()` were callable by `anon`** — both documented "Service-role only". With only the publishable key that ships in the app bundle and no session, `rpc/rebuild_profile_xp` returned `200` and RAN against a real account's uuid; `xp_drift` returns every profile's id and totals whenever the database is not balanced. The revoke that was supposed to prevent it (`revoke all ... from public`) does not remove the EXPLICIT `anon`/`authenticated` grants Supabase's default privileges hand out at CREATE time — and **this pass repeated that same line** when it replaced the functions. | Asked "who can actually call this" instead of "did we write a revoke" | before: `200 {before_total: 30, after_total: 30, ...}` as anon. After `20260831_lock_admin_functions`: `401 42501 permission denied`. Triggers re-verified after the revoke — a logged habit still sets xp 10, awards 10, moves the streak to 1 and files 10 in the purge ledger |
| 18 | **The deployed `spotify-auth` accepts any `redirect_uri`.** Not previously probed. It returns a Spotify authorize URL pointing at whatever target it is handed, and the `state` it issues is never verified — so a crafted link delivers the victim's authorization code. | Probed the deployed function directly instead of reading its source | `redirect_uri=https://attacker.example/steal` -> `200` with that URL embedded. Connect is now refused in `spotifyStore.connect()` before any I/O; mutation red 3/5 |

---

## 2b. A measurement I got wrong, and corrected

The first pass reported **34 direct database calls across 11 stores**. That
was produced by grepping `supabase\.from\(`, which does not match the
multi-line form this codebase mostly uses:

```ts
const { data } = await supabase
  .from('habits')
```

Re-measured with a whitespace-tolerant pattern and comments stripped, the real
figure on `main` was **72 calls across 17 stores** — more than half the call
sites were invisible to the original count, including `journalStore`,
`profileStore`, `willpowerStore`, `logStore`, `insightsStore` and
`lifeAreasStore`, none of which appeared in the first survey at all.

Recorded rather than quietly replaced, because the same class of error —
a pattern that looks like it measures the thing and does not — is what this
audit keeps finding elsewhere.

---

## 3. Two audit premises that the evidence refuted

Recorded because acting on either would have produced work that fixed nothing.

### 3.1 `spotify_accounts` did not need policies

The earlier pass flagged its zero policies as a defect. Adding owner-scoped
CRUD would have made an OAuth **refresh token** readable by anything holding
that user's JWT. Zero policies is the correct fail-closed design, matching
`google_calendar_integrations`. No policy was added.

### 3.2 XP was already idempotent

§11 assumed retries double-award and asked for an `xp_events` ledger. XP is
awarded by two database triggers: a BEFORE trigger high-water-marks
`NEW.xp = greatest(award, OLD.xp)`, and an AFTER trigger awards only
`NEW.xp - OLD.xp` when positive. With `UNIQUE (habit_id, completed_at)` and
the client's 23505→UPDATE recovery, every replay path converges on an UPDATE
with delta 0.

Proven live, 6/6:

| Scenario | Result |
|---|---|
| first completion | 0 → 30 XP |
| duplicate INSERT | `23505`, XP unchanged |
| replay as UPDATE | XP unchanged |
| three further replays | XP unchanged |
| downgrade to partial | no clawback, no negative |
| a different day | correctly awards again |

A ledger built to fix double-awarding would have added risk to a hot path for
a problem that does not exist. **The idempotency requirement in §40 is met.**

**The reconstructibility half was real — and is now closed.**

When this section was first written, `profiles.total_xp` could not be rebuilt
and one real account was already 30 XP behind its own logs. `xp_drift()` and
`rebuild_profile_xp()` were added for it, and the account was repaired.

What that pair still got wrong was WHY a profile can legitimately be ahead of
its logs. `habit_logs.habit_id` is `ON DELETE CASCADE`, and deleting a habit
is an ordinary action on two tabs, so the logs vanish while the XP they
awarded stays. The detector therefore reported every user who had ever deleted
a habit, and the repair it pointed at would have taken their XP away
(reproduced from zero on an untouched account: log one habit, +10, delete it,
drift 10). `20260831_xp_drift_survives_purge` records the purged XP so
`total_xp = sum(habit_logs.xp) + purged_xp` is true again — see §2 defect 13.

Live at the end of this pass: **`xp_drift()` returns 0 users**, and the
account that was −30 now reads `total_xp 30 / logs 30 / purged 0`, i.e. it
balances on its own rather than by being papered over.

---

## 4. Open blockers

### P0 — external, and one of them blocks the merge

| # | Blocker | Evidence, read live today | Exact action | Blocks |
|---|---|---|---|---|
| 1 | **Registration has never succeeded.** `mailer_autoconfirm = false` and the configured SMTP server rejects the credentials. | Re-probed on the final day, not carried over: `/auth/v1/settings` -> `disable_signup=false`, `mailer_autoconfirm=false`; a fresh `POST /auth/v1/signup` -> `500`, `request_id 01a057a2-0dd2-7c36-b578-013d2fc67c90`; that exact id in the auth log -> `535 "Incorrect authentication data"`. Every auth error in the log window is this one and nothing else (3 occurrences, 2026-08-30 14:33 to 2026-08-31 11:43). What the 535 proves without reading a single value: a custom SMTP server IS configured and reachable, the session gets as far as AUTH, and the credential pair is refused. The user row is rolled back, so no orphans accumulate. | EITHER fix the SMTP credentials, OR Auth -> Providers -> Email -> **Confirm email OFF**. Then re-read `/auth/v1/settings` and run a real `signUp`. | §1, §26, the merge |
| 2 | **The DEPLOYED `spotify-auth` accepts ANY redirect target**, carries a hardcoded client-secret fallback, and issues an OAuth `state` it never verifies. | Re-probed live on the final day; deployment unchanged (v2, `ezbr_sha256 977309e1…`). `action=url` returns a bare 36-char UUID where the branch returns `<payload>.<hmac>`; the callback never reads `state`; and `redirect_uri=https://attacker.example/steal` returns **200 with an authorize URL pointing at it** — there is no allowlist. A crafted link therefore delivers the victim's Spotify authorization code to whoever made it. | rotate the secret in the Spotify dashboard, set `SPOTIFY_CLIENT_SECRET`, `OAUTH_STATE_SECRET` and `OAUTH_REDIRECT_ALLOWLIST` as edge secrets, THEN deploy the canonical function | §4, §31 |
| 3 | **`OAUTH_STATE_SECRET` / `OAUTH_REDIRECT_ALLOWLIST` unset.** The branch's functions fail closed without them (500), which is why deploying them before the secrets exist would break a flow that currently "works". | `spotify-auth` and `notion-auth` both return an unsigned UUID state | set both, then deploy `spotify-auth` and `notion-auth` | §4 |
| 4 | **Notion is not configured at all.** | `notion-auth?action=url` returns `client_id=undefined` | set `NOTION_CLIENT_ID`/`NOTION_CLIENT_SECRET` (+ #3), then a linked-account round trip | §6 |
| 5 | **`google-auth` is not deployed.** | `functions/v1/google-auth` -> `404 NOT_FOUND`; 5 functions live, google-auth is not one | set `GOOGLE_CLIENT_ID/SECRET` (+ #3), then `supabase functions deploy google-auth` | §5 |
| 6 | **The Anthropic account is out of credit,** so no AI feature can return output. | `generate-routine` log: `400 ... "Your credit balance is too low to access the Anthropic API"` | top up the Anthropic account | §10 scenario A |
| 7 | **No crash-reporting sink.** Console only. | no DSN anywhere; `lib/crashReporting.ts` ships a transport seam and a dev sink | provide a DSN and attach a transport at boot | §22 |
| 8 | ~~**Bundle identifiers absent.**~~ **RESOLVED.** | was: `app.json` had no `ios.bundleIdentifier` / `android.package` | owner confirmed control of `aderyth.com`; both are now `com.aderyth.app` and the slug is `aderyth`, set in `app.json` and pinned by `brandingIdentity` / `crossProjectIsolation` | closed |

Only **#1 blocks the merge**. The rest are integrations the app already fails
closed on, and #8 is a store-release gate rather than a merge one. #1 is
different because registration is the product's entry point: an app nobody can
sign up for is not shippable, whatever else passes.

### P1 — the four remaining items, classified

Every one is now `REQUIRED_BEFORE_MERGE` or `DEFERRED_WITH_JUSTIFICATION`.
There is no third status and none of them is left as a bare "not done".

| Item | Classification | Why |
|---|---|---|
| **§19 Design tokens** | DEFERRED_WITH_JUSTIFICATION | The obligation was "semantic UI colours belong in tokens", and that is now met: **0 unexplained magic UI colours**. 181 were moved with zero pixel change; the 181 that remain are a categorical palette, illustration constants, theme triples, brand colours and a heatmap ramp — none of which wants a semantic name. What is left is one design decision (collapse the legacy neutral ramp into `textDim`/`bg`?) that changes pixels. |
| **§20 Branding** | Artwork: DEFERRED_WITH_JUSTIFICATION. **Bundle identifiers: REQUIRED_BEFORE_STORE_RELEASE**, BLOCKED_EXTERNAL | Everything that does not need an account is done, including a real notification icon that Android can actually render. Identifiers are tied to accounts and a domain; inventing one can collide with a live listing. Not a merge blocker — a store-release one. |
| **§21 Widget** | DEFERRED_WITH_JUSTIFICATION | Checked against the source-of-truth documents rather than assumed: `PROGRESS.md` assumption **A-05** and `FINAL_GAP_AUDIT_V2.md` **P3-4 (QUALITY)**. It is in no Definition of Done. It also needs a native target this managed-workflow repo has no directory for, and there is no Android SDK on this machine — but the spec, not the environment, is the reason it is deferred. |
| **§36 Performance** | DEFERRED_WITH_JUSTIFICATION | Every source-observable cause is measured and zero (see §1c row 17). On-device render profiling needs a device or emulator; `adb` and `emulator` are both absent here. This is a **store-release QA gate**, and saying so is the honest version of "we did not get to it". |

### P2 — recorded gaps

| # | Gap | Evidence |
|---|---|---|
| G-1 | ~~`profiles.total_xp` not reconstructible~~ — **CLOSED**. `total_xp = sum(habit_logs.xp) + purged_xp` holds live, and `xp_drift()` reports 0 users | §2 defect 13 |
| G-2 | ~~`isDueOn` excludes negative habits~~ — **CLOSED**, see §25 | `ceilingSemantics.test.ts` |
| G-3 | ~~`atlas_notion_login_session` is global~~ — **CLOSED**, see §27 | verified live in §1c row 11 |
| G-4 | `weekly_xp` / `boss_contributors` readable by any authenticated user; the client never uses them | `FINAL_RLS_MATRIX.md` O-1/O-2 |
| G-5 | `tasks` has 3 overlapping ALL policies | O-3 |
| G-6 | anon denied two different ways (`42501` vs empty) across the schema | O-4 |
| G-7 | 3 orphaned `SECURITY DEFINER` XP functions attached to no trigger; task completion awards no XP | trigger inventory |
| G-8 | `supabase/migrations/` cannot rebuild the live schema | pre-existing, unchanged |
| G-9 | ~~CI lint scope is narrower than the repo~~ — **CLOSED**; `lint:ci` runs `eslint .` over everything at `--max-warnings=0` | `.github/workflows/ci.yml` |
| G-10 | `google_calendar_integrations` and `spotify_accounts` have RLS on and **0 policies** — deny-all for clients, reachable only through the service role. Deliberate, and recorded here so it is not mistaken for a gap | live policy inventory |
| G-11 | ~15 SECURITY DEFINER RPCs that DO scope on `auth.uid()` (`spend_focus_points_v2`, `log_makeup_completion`, `buy_shop_item`, `upgrade_skill`, `claim_quest_reward`, `interact_with_pet`, the `get_*` readers) are still EXECUTE-able by `anon`. Not exploitable — `auth.uid()` is NULL there, so they act on nothing or raise — but the grant is meaningless and should go. Deliberately not swept in at the end of an unrelated pass: each one wants a live check that revoking it breaks no signed-in path | `has_function_privilege('anon', …)` across `public` |
| G-12 | 22 functions have a mutable `search_path` (Supabase advisor `function_search_path_mutable`), most of them SECURITY DEFINER gamification RPCs. A known escalation shape. Every function this branch wrote or replaced pins `SET search_path TO 'public'`; the pre-existing ones do not | advisor run, 0 ERROR-level findings overall |

---

## 4b. The final verification round, and what it changed

Everything in this section was re-read on the last day rather than carried
forward, because a release decision made from a stale probe is a guess with a
timestamp.

### Registration: unchanged, and now pinned to a fresh request id

See P0 row 1. The failure is identical, the request id is new, and the SMTP
inventory is stated only as far as the evidence reaches — configured,
reachable, credentials refused. No field value was read, because none can be:
there is no auth-config endpoint in the tooling available here, which is why
this is a dashboard action and not a code change.

### Spotify: worse than previously recorded

The earlier pass recorded an unsigned `state` and a callback that never checks
it. The redirect target had not been probed. It is the more serious of the
three:

```
redirect_uri = https://attacker.example/steal
-> 200 {"url": "https://accounts.spotify.com/authorize?...&redirect_uri=https%3A%2F%2Fattacker.example%2Fsteal&..."}
```

The deployed function will mint an authorize URL for any target it is handed.
Combined with a `state` nobody verifies, a crafted link is enough to receive a
victim's authorization code.

**So the flow is withheld rather than shipped.** `SPOTIFY_OAUTH_ENABLED` is
`false` and `spotifyStore.connect()` refuses before any I/O — the store, not
the card, because a disabled button is decoration and any other caller would
still walk in. Playback for an already-connected account is untouched (it uses
stored tokens and never re-enters OAuth), and `disconnect` still works, because
anyone who connected under the old build has to be able to get out. The card
states the reason instead of hiding the section.

`lib/featureGates.ts` carries the four conditions that turn it back on, so the
flag cannot be flipped without a diff that sits next to its evidence.
Mutation-checked: setting it `true` turns 3 of the 5 assertions red, including
the one proving no request is made.

### Anthropic: still out of credit, and the refund path proved it again

A fresh call on the final day returned the function's own honest message, and
the provider's reason is in the function log verbatim: *"Your credit balance is
too low to access the Anthropic API."* So the SUCCESSFUL provider path is still
unverifiable and is not claimed.

What it did demonstrate, on a real provider failure rather than a simulated
one:

```
FP before 30 -> ai_coach -5 -> ai_error +5 -> FP after 30
```

### A flaky gate, found by not accepting the green re-run

`uiPrimitivesAccessibility.test.tsx` failed about one full run in ten. Chasing
it rather than re-running: the file mounts 38 components, the first also pays
for `@expo/vector-icons` resolving its font promise, and under contention for a
worker the first two tests blew jest's 5 s default — reproducible on demand
with `--maxWorkers=16`, which failed them every time.

A gate that goes red at random is the same disease as one that is green for the
wrong reason: both teach people to press the button again. Given 30 s of
headroom — a real hang threshold, not `Infinity` — three previously-failing
contended runs and four normal runs all pass 1410/1410.

---

## 5. Verification summary

```
npm run typecheck:ci                exit 0
npm run lint:ci                     exit 0    whole repo, 0 errors 0 warnings
npx jest --ci                       exit 0    1410/1410, 98 suites, 0 console blocks
node run-tests.js                   exit 0    145/145
npx expo export --platform android  exit 0    6.5 MB .hbc
npx expo export --platform ios      exit 0    6.5 MB .hbc
npm audit                                     0 critical, 9 high, 13 moderate
live release-readiness suite        exit 0    40/40 across 9 suites, real JWTs under RLS
jest under induced contention        exit 0    --maxWorkers=16, 3 runs, no timeout flake
```

CI on the final HEAD is reported in the terminal, not here: a document cannot
observe a run of the commit that contains it.

### The 9 high advisories, re-proved on THIS build

All nine are Expo/Metro build-chain packages (`@expo/cli`, `@expo/metro*`,
`metro*`, `postcss`, `image-size`, `expo`). The proof that none of them ships
was re-run against a bundle exported minutes before this line — not carried
over from an earlier one — with three positive controls so a scanner that
silently matches nothing cannot pass:

```
CONTROL react-native      24 hits   present, as it must be
CONTROL supabase          58 hits   present
CONTROL "Telafi"           8 hits   present (the app's own Turkish copy)
postcss                    0
metro-config               0
metro-transform-worker     0
@expo/cli                  0
@expo/metro-config         0
@expo/prebuild-config      0
xcode                      0 (android) / 1 (ios)
image-size                 3 (android) / 0 (ios, as a package path)
```

The two non-zero rows were opened rather than assumed. Every `image-size` hit
is an icon glyph name — `image-size-select-small`, `-actual`, `-large`. The
single iOS `xcode` hit straddles two adjacent glyph names in the font table
(`...codesandbo` + `xcode` + `space...`). Neither is the package.

### The live database was left exactly as found

```
                     before   after
auth.users              3       3
profiles                3       3
habits                  6       6
habit_logs             13      13
recovery_plans          0       0
monthly_reviews         0       0
credit_transactions     3       3   (all pre-existing, dated 2026-08-30)
xp_drift()              -       0   users
```

Three accounts were created for the live journey and all three were deleted;
the cascade took their habits, logs, tasks, notes, reflections and ledger rows
with them.

### Migrations applied by this pass

| migration | what it does | risk to `main` |
|---|---|---|
| `20260831_recovery_vocabulary_compat_rollback` | restores the legacy recovery vocabulary so `main` works | fixes a break, does not cause one |
| `20260831_ceiling_xp` | `habit_xp_value` reads `target_direction` | only ever lowers an award that was too high; `main` writes the same column |
| `20260831_xp_drift_survives_purge` | `profiles.purged_xp` + a BEFORE DELETE trigger; `xp_drift`/`rebuild_profile_xp` account for it | additive column, server-written only |
| `20260831_revoke_ddl_grants` | revokes TRUNCATE/REFERENCES/TRIGGER from `anon`/`authenticated` | removes privileges nothing uses; SELECT/INSERT/UPDATE/DELETE untouched |
| `20260831_lock_admin_functions` | revokes EXECUTE on `xp_drift`/`rebuild_profile_xp`/`habit_xp_value` and every trigger function from `anon`+`authenticated`; stops future functions defaulting EXECUTE to `anon` | removes access nothing legitimate used; trigger firing re-verified live |

Each was applied to the live project and verified there, and each is committed
as a file so the tree and the database say the same thing.

---

## 6. Merge decision

**NOT MERGE READY**, on one blocker and one thing that is not mine to invent.

**Registration has never succeeded.** `signUp()` returns 500 because the
configured SMTP server refuses the credentials it is given
(`535 "Incorrect authentication data"`, re-confirmed on the final day against a
fresh request id), and email confirmation is required. Everything downstream of
the front door works — verified live, on real accounts, through the app's own
code — but an app nobody can sign up for is not shippable, and no amount of
green elsewhere changes that.

That single fact also holds the recovery release sequence: re-applying
`20260831_recovery_vocabulary` and deploying the v2 client is a coordinated
step (§0b) that must not happen while the product cannot take a new user.

**Store identifiers — settled.** They were pending the owner, because
`ios.bundleIdentifier` and `android.package` are tied to their Apple and Google
accounts and a domain they control, and a guess can collide with a real
listing. Asking rather than inventing was the right call and the answer has
since arrived: the owner controls `aderyth.com`, so the namespace is
`com.aderyth` and both platforms use `com.aderyth.app`. The Expo slug moved to
`aderyth` in the same change, which was safe precisely because no EAS project
existed to be pointing at the old one. The URI scheme stays `atlas` — it is
registered in the Notion and Google consoles and in the edge allowlist.

Still open, and distinct from the above: the identifier is owner-approved but
not yet **store-registered**. No App Store Connect or Play Console listing
exists, so nothing has reserved the name. That check belongs before first
publication.

Two things that would have been merge blockers are closed rather than deferred:
the Spotify flow is **securely disabled** instead of pointing at a deployment
that accepts any redirect target, and the anon-executable admin RPCs are shut.

Everything else is either PASS, deliberately DEFERRED with the reason written
down, or BLOCKED_EXTERNAL on a secret this branch must not invent.
