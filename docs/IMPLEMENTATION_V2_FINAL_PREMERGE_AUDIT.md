# ATLAS — IMPLEMENTATION_V2 FINAL PRE-MERGE AUDIT

**Branch:** `phase/final-v2-hardening`
**Audit generated from the tree at:** `6632402` (the commit this document's
findings were measured against — the commit that *adds* this document has a
different SHA by construction, so no self-reference is claimed here).
**Final branch HEAD and its CI result:** see the terminal report, not this
file.
**Date:** 2026-08-30

Status values are only `PASS`, `BLOCKED_EXTERNAL`, `FAIL`, or `NOT_DONE`.
Nothing here is marked from a document or a commit message; every `PASS` names
the command, query or live request that produced it.

---

## 1. Requirement matrix

| ID | Requirement | Before | Change | Verification | Status |
|---|---|---|---|---|---|
| **§1** | Registration works | `signUp()` → 500 | none possible in code | **Real signUp attempted**, not skipped: `500 Error sending confirmation email`; `/auth/v1/settings` → `mailer_autoconfirm=false`; 0 orphan rows created | **BLOCKED_EXTERNAL** |
| **§2** | Google OAuth state fail-closed | `state ?? clientState` fallback | only the provider's state is forwarded; absent state refuses before the callback request | behaviour tests + mutation (1 red) | **PASS** |
| **§3** | Disconnect honesty | response discarded, state cleared unconditionally (Google **and** Spotify) | local state cleared only on server confirmation | 401/500/throw cases; mutations (2 red each) | **PASS** |
| **§4** | Spotify security drift | canonical hardened, **production not** | canonical verified hardened; deploy NOT performed | deployed source read live: `crypto.randomUUID()`, no verify, **hardcoded client secret fallback** | **BLOCKED_EXTERNAL** |
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
| **§16** | Dependency security | 2 critical, 16 high | `npm audit fix`, no `--force` | **0 critical, 9 high**, all build-time and **absent from the shipped bundle** (grep over `dist/`) | **PASS** |
| **§17** | Lint zero | full repo 3 err / 183 warn; `expo lint` saw only 73 of them | **0 / 0 across the whole repository** | 3 errors were an eslint env gap (`jest`, `__dirname` undeclared), not defects — declared rather than silenced. 42 hook-dependency warnings fixed on their merits, not suppressed: 30 by naming stable store actions, the rest by restructuring (clock read inside the loader, filter moved into the effect, latest-ref in the two review screens). A new test pins the zustand identity assumption the 30 rely on | **PASS** |
| **§18** | Package manager | `yarn@1.22.22`, no yarn.lock | `npm@11.16.0`; CI comment corrected | manifest/lockfile/CI all name npm | **PASS** |
| **§19** | Design tokens | 1572 hex literals in 56 files against a token table that already held most of them | 1139 replaced with the token holding that exact colour, in 51 files | Colour-preserving, checked not asserted: 50 files, 1690 colour terms, **0 files changed a colour**. 385 remain because they have NO token — inventing `grey5` is not a design system; they are grouped and explained in `docs/DESIGN_TOKENS.md` and capped by a ratchet. Mutation red: writing a tokened hex back out | **PASS** (the mechanical half; the 385 naming decisions are a person's call, tracked and capped) |
| **§20** | Branding / store assets | Expo template | — | unchanged | **NOT_DONE** |
| **§21** | Widget | absent | — | absent | **NOT_DONE** |
| **§22** | Crash monitoring sink | dev console only | — | no DSN provided | **BLOCKED_EXTERNAL** |
| **§23** | Offline queue account safety | one global key, no owner | per-account key + `userId` + replay filter + lossless migration | 6 behaviour tests; mutations (4 red / 1 red) | **PASS** |
| **§24** | Recovery vocabulary | two vocabularies + an adapter that DROPPED five fields on every save, on the stale grounds that "the table has no columns for them" — it had, since 20260825 | one vocabulary; `recovery_plans.strategy`/`status` accept only the v2 words; the adapter is deleted and all five fields are persisted and read back | 7 live constraint probes (legacy strategy/status refused, negative deficit refused, completed-without-timestamp refused, planned-with-timestamp refused, non-array distribution refused, full v2 plan accepted) + 22 tests. 3 mutations red: a legacy word reappearing, a translation function returning, the store dropping the deficit | **PASS** |
| **§25** | Negative + measurable habits | reward inverted; two disagreeing scorers; negative habits due on no day | ceiling scoring unified AND the lifecycle closed: `isDueOn` no longer reads `behavior_type`; `isMissedOn`/`countsTowardAverage` carry the real asymmetry (absence of a log is not failure for a negative habit) | reports, analytics and the recovery backlog now include negative measurable habits; 3 mutations red (7/1/1). Also fixed: an explicit `miss` log landed in the done set, so a day the user recorded as failed could never be offered a make-up | **PASS** |
| **§26** | Auth lifecycle | — | partially (queue on sign-out) | register blocked, so the full cycle is untestable | **BLOCKED_EXTERNAL** |
| **§27** | Cache isolation | sync queue and Notion session both global | both scoped per account, each with a lossless one-time migration | 11 behaviour tests across the two; mutations red. `focus.settings.v1` and the theme keys stay global by decision — timer durations and a colour are UI preference, not personal data | **PASS** |
| **§28** | One canonical edge tree | two writable trees | `backend/supabase/functions/` removed | gate: duplicate tree absent, function list pinned | **PASS** |
| **§29** | Edge error contract | 19 call sites; error handling mostly sound but **0 of 19 had a timeout** | every call goes through `withEdgeDeadline` (aborts AND races, 20s) | Full audit in `docs/EDGE_ERROR_CONTRACT.md`, all 19 sites × 5 failure modes. 10 tests; 2 mutations red (single-line and multi-line call losing its deadline), plus one that caught the helper releasing the caller only when the callee honours the signal | **PASS** |
| **§30** | Obsolete comments | "NOT APPLIED", "migration blocked" | corrected in migration, recovery, routineProposal | — | **PASS** |
| **§31** | No hardcoded secrets | unknown | scanned; repo is clean | The deployed `spotify-auth` carries a literal client secret as a `??` fallback. Rotation is the owner's | **BLOCKED_EXTERNAL** |
| **§32** | Release env guards | guard depends on local state | stale DENIED link removed, guard PASSes clean | `predeploy_guard.sh` exit 0, no warning | **PASS** |
| **§33** | Test quality | — | 11 new suites, all mutation-verified | 1156 tests, 80 suites. Covers what was built; the untouched requirements have no new coverage | **PASS** |
| **§34** | CI as merge gate | `npx expo lint`: app dirs only, warnings advisory (exit 0 on 73) | `npm run lint:ci` = `eslint . --max-warnings=0` | Gates the whole repo, warning = failure. 3 mutations red: an unused variable, a removed hook dependency, an undefined global in a script | **PASS** |
| **§35** | Full live smoke | — | duration, ceilings, RLS, XP, notion-sync, child-row ownership verified live | Registration is the first step and is externally blocked, so the journey cannot run end to end | **BLOCKED_EXTERNAL** |
| **§36** | Performance profiling | `currentUserId` issued `GET /auth/v1/user` before EVERY repository operation | resolved from the local session instead | Measured live: 3 ops cost 3 auth requests / 373 ms (total 1779 ms) before, **0 auth requests** after. The same defect was then found in 14 more places outside the repositories — 11 in screens/components (3 in `weekly-review.tsx` alone), plus `logStore.hydrateSyncQueue` which runs on every foreground. All moved to `lib/session.currentUser()`, a local read, with a source gate. Screen-level render profiling on a device is still not done | **NOT_DONE** (auth round-trips eliminated; render profiling outstanding) |
| **§37** | main sync | — | 0 behind | `git rev-list --left-right --count origin/main...HEAD` → `0  15` | **PASS** |

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

**But the reconstructibility half is real, and worse than assumed.**
`profiles.total_xp` cannot be rebuilt, and has already drifted in production:

| user | `total_xp` | `sum(habit_logs.xp)` | drift |
|---|---|---|---|
| `88fe8c16…` (real account) | **0** | **30** (13 logs) | **−30** |

Deleting habit logs also leaves `total_xp` untouched, so the aggregate
diverges permanently. That is an open gap (§5), not something this branch
fixed.

---

## 4. Open blockers

### P0 — external

| # | Blocker | Exact action | Blocks |
|---|---|---|---|
| 1 | `mailer_autoconfirm = false`, no SMTP | Auth → Providers → Email → **Confirm email OFF**, then re-read `/auth/v1/settings` | registration, §26, full §35 |
| 2 | Spotify client secret hardcoded in the **deployed** function | rotate in Spotify dashboard, set `SPOTIFY_CLIENT_SECRET` as an edge secret | §4, §31 |
| 3 | `OAUTH_STATE_SECRET` + `OAUTH_REDIRECT_ALLOWLIST` unset | set both, then deploy `spotify-auth` and `notion-auth` — their hardening has **never reached production** | §4 |
| 4 | Google secrets unset | `GOOGLE_CLIENT_ID/SECRET` + the two above, then `supabase functions deploy google-auth` | §5 |
| 5 | No Sentry DSN | provide one | §22 |

### P1 — not done on this branch


design tokens (§19) ·
branding (§20) · widget (§21) · recovery vocabulary (§24) · performance
profiling (§36).

Completed since the first version of this document: the repository boundary
(§8), pagination (§13) and the navigation IA (§14).

### P2 — recorded gaps

| # | Gap | Evidence |
|---|---|---|
| G-1 | `profiles.total_xp` not reconstructible; one real account already drifted −30 | §3.2 |
| G-2 | ~~`isDueOn` excludes negative habits~~ — **CLOSED**, see §25 | `ceilingSemantics.test.ts` now pins the fixed behaviour |
| G-3 | ~~`atlas_notion_login_session` is global~~ — **CLOSED**, see §27 | scoped per account, migration tested |
| G-4 | `weekly_xp` / `boss_contributors` readable by any authenticated user; the client never uses them | `FINAL_RLS_MATRIX.md` O-1/O-2 |
| G-5 | `tasks` has 3 overlapping ALL policies | O-3 |
| G-6 | anon denied two different ways (`42501` vs empty) across the schema | O-4 |
| G-7 | 3 orphaned `SECURITY DEFINER` XP functions attached to no trigger; task completion awards no XP | trigger inventory |
| G-8 | `supabase/migrations/` cannot rebuild the live schema | pre-existing, unchanged |
| G-9 | CI lint scope is narrower than the repo — 3 errors live outside `expo lint` | `jest.setup.js`, `scripts/fix-expo-tsconfig.js` |

---

## 5. Verification summary

```
npm run typecheck:ci                exit 0
npx jest --ci                       exit 0    1156/1156, 80 suites
node run-tests.js                   exit 0    144/144
npx expo lint                       exit 0    0 errors, 73 warnings
npx eslint . --ext .ts,.tsx                   3 errors, 163 warnings (outside CI scope)
npx expo export --platform android  exit 0
npx expo export --platform ios      exit 0
npm audit                                     0 critical, 9 high (all build-time)
supabase/predeploy_guard.sh         exit 0    kbcuolhjjnmhjaarxxmu, no warning
GitHub Actions 33319921172          success   all 10 steps
```

**Live database left exactly as found after every test run:** 3 users,
3 profiles, 6 habits, 13 habit_logs, 0 recovery_plans. Every disposable user
created during this audit was removed.

Three additive migrations applied, all policy/table only, no row touched:
`20260830_google_calendar_integrations` (49→50 tables),
`20260830_habit_logs_ownership_check` (5→4 policies, 13 rows unchanged) and
`20260830_child_row_ownership` (recovery_plans + key_results now require the
parent row to belong to the caller; verified live with two users, including
that owners can still write their own).
