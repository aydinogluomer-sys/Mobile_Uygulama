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
| **§9** | Monthly review cloud persistence | AsyncStorage only | — | no `reviews` table created | **NOT_DONE** |
| **§10** | Structural tests on current contract | three shallow proxies | all three rewritten to pin real contracts, each mutation-verified | `run-tests.js` 144/144. The monthly-review gate still encodes AsyncStorage, which matches today's code but not the target | **NOT_DONE** (blocked on §9) |
| **§11** | XP idempotency | assumed broken | **premise disproven** — see §3 below | 6/6 live: duplicate INSERT `23505`, replay ×4 adds 0 XP | **PASS** (idempotency) / reconstructibility **NOT_DONE** |
| **§12** | Focus-Point charging atomicity | `spend_focus_points` error unchecked | — | not addressed | **NOT_DONE** |
| **§13** | Pagination | unbounded reads across the data layer | keyset paging, per-tab paging, server-side search, `LoadMoreFooter` in four screens; 3 further unbounded queries found and bounded | Bounding is now checked PER QUERY (`queryBounding`), generating `docs/QUERY_BOUNDING_MATRIX.md`: 64 queries, 32 collection SELECTs, **0 UNCLASSIFIED**. Runtime paging proven with 65 rows at page size 30 — no duplicates, nothing missing, stable under insert/delete, id tie-breaker exercised. 3 mutations each turn it red | **PASS** |
| **§14** | Navigation IA | today/tasks/focus/timeline/stats | Bugün · Plan · Alışkanlıklar · İçgörüler · Profil; hubs compose the existing screens, old routes kept as `href: null` | `run-tests.js` parses visible vs hidden; 3 mutations verified | **PASS** |
| **§15** | Legacy FastAPI retirement | 2 client call sites, `user_id="default"` | — | still 2 call sites | **NOT_DONE** |
| **§16** | Dependency security | 2 critical, 16 high | `npm audit fix`, no `--force` | **0 critical, 9 high**, all build-time and **absent from the shipped bundle** (grep over `dist/`) | **PASS** |
| **§17** | Lint zero | 0 err / 73 warn (CI scope) | — | unchanged; full repo 3 err / 163 warn | **NOT_DONE** |
| **§18** | Package manager | `yarn@1.22.22`, no yarn.lock | `npm@11.16.0`; CI comment corrected | manifest/lockfile/CI all name npm | **PASS** |
| **§19** | Design tokens | 1727 hex | — | 1728 | **NOT_DONE** |
| **§20** | Branding / store assets | Expo template | — | unchanged | **NOT_DONE** |
| **§21** | Widget | absent | — | absent | **NOT_DONE** |
| **§22** | Crash monitoring sink | dev console only | — | no DSN provided | **BLOCKED_EXTERNAL** |
| **§23** | Offline queue account safety | one global key, no owner | per-account key + `userId` + replay filter + lossless migration | 6 behaviour tests; mutations (4 red / 1 red) | **PASS** |
| **§24** | Recovery vocabulary | lossy v1/v2 adapter | — | unchanged | **NOT_DONE** |
| **§25** | Negative + measurable habits | reward inverted; two disagreeing scorers; negative habits due on no day | ceiling scoring unified AND the lifecycle closed: `isDueOn` no longer reads `behavior_type`; `isMissedOn`/`countsTowardAverage` carry the real asymmetry (absence of a log is not failure for a negative habit) | reports, analytics and the recovery backlog now include negative measurable habits; 3 mutations red (7/1/1). Also fixed: an explicit `miss` log landed in the done set, so a day the user recorded as failed could never be offered a make-up | **PASS** |
| **§26** | Auth lifecycle | — | partially (queue on sign-out) | register blocked, so the full cycle is untestable | **BLOCKED_EXTERNAL** |
| **§27** | Cache isolation | sync queue global | queue scoped per account | `atlas_notion_login_session` is still global — one account can see another's Notion workspace name on a shared device | **NOT_DONE** |
| **§28** | One canonical edge tree | two writable trees | `backend/supabase/functions/` removed | gate: duplicate tree absent, function list pinned | **PASS** |
| **§29** | Edge error contract | silent success in 2 places | notion-sync, notionStore and both disconnects fixed | Not every client-called edge function has been audited for transport error / non-2xx / `success:false` / malformed JSON / timeout | **NOT_DONE** |
| **§30** | Obsolete comments | "NOT APPLIED", "migration blocked" | corrected in migration, recovery, routineProposal | — | **PASS** |
| **§31** | No hardcoded secrets | unknown | scanned; repo is clean | The deployed `spotify-auth` carries a literal client secret as a `??` fallback. Rotation is the owner's | **BLOCKED_EXTERNAL** |
| **§32** | Release env guards | guard depends on local state | stale DENIED link removed, guard PASSes clean | `predeploy_guard.sh` exit 0, no warning | **PASS** |
| **§33** | Test quality | — | 11 new suites, all mutation-verified | 1156 tests, 80 suites. Covers what was built; the untouched requirements have no new coverage | **PASS** |
| **§34** | CI as merge gate | green | unchanged scope | CI runs `expo lint`, whose scope is narrower than the repo — 3 errors live outside it. §17 requires full-repo 0/0, so CI does not yet gate the stated requirement | **NOT_DONE** (tied to §17) |
| **§35** | Full live smoke | — | duration, ceilings, RLS, XP, notion-sync, child-row ownership verified live | Registration is the first step and is externally blocked, so the journey cannot run end to end | **BLOCKED_EXTERNAL** |
| **§36** | Performance profiling | — | — | not done | **NOT_DONE** |
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

Monthly review cloud persistence (§9) · legacy FastAPI retirement (§15) ·
Focus-Point charging atomicity (§12) · lint zero (§17) · design tokens (§19) ·
branding (§20) · widget (§21) · recovery vocabulary (§24) · performance
profiling (§36).

Completed since the first version of this document: the repository boundary
(§8), pagination (§13) and the navigation IA (§14).

### P2 — recorded gaps

| # | Gap | Evidence |
|---|---|---|
| G-1 | `profiles.total_xp` not reconstructible; one real account already drifted −30 | §3.2 |
| G-2 | ~~`isDueOn` excludes negative habits~~ — **CLOSED**, see §25 | `ceilingSemantics.test.ts` now pins the fixed behaviour |
| G-3 | `atlas_notion_login_session` is global — one account can see another's Notion workspace name | §27 |
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
