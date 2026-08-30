# ATLAS — FINAL GAP AUDIT V2

**Audit HEAD:** `ea5dabd7672aa798a2b89f0c069cc7d772e4a20e`
**Branch:** `phase/final-v2-hardening` (cut from `main`, worktree clean)
**Canonical Supabase project:** `kbcuolhjjnmhjaarxxmu` — verified before every live read below.
**Date:** 2026-08-30

Every claim here is anchored to a command, a file:line, or a live query. Where an
earlier audit pass asserted something this pass could not reproduce, the earlier
claim is recorded as **CORRECTED** rather than quietly replaced — see §1.

---

## 1. CORRECTIONS TO THE PREVIOUS AUDIT PASS

The first audit pass of this task made five claims that do not survive verification.
They are corrected here before any of them could drive an implementation decision.

### 1.1 `spotify_accounts` — was "needs CRUD policies", is **correct as designed**

Previous verdict: *"RLS açık, policy sayısı 0 … user-owned tabloda CRUD policy yok"*,
listed as a P1 to fix by adding policies.

That verdict was reached by counting policies, which is not a security audit. The
evidence contradicts it:

| Question | Answer | Evidence |
|---|---|---|
| Does any frontend code query `spotify_accounts`? | **No** | `grep -rn spotify_accounts frontend/` → 0 hits |
| Who reads/writes it? | `spotify-auth` edge function only | `supabase/functions/spotify-auth/index.ts:71,84,180,204,214` — all via `admin` (service-role) client |
| What does it hold? | OAuth `access_token` / `refresh_token` | per `implementation.md:775` |
| Was zero-policy intentional? | **Yes, documented** | `docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md:211,216` records it as fail-closed and *safe* |

**VERDICT: `spotify_accounts` = SERVER-ONLY FAIL-CLOSED. Correct as-is.**

Adding owner-scoped CRUD policies would make an OAuth refresh-token table readable by
any authenticated client holding that user's JWT — a strict security *regression* in
exchange for a tidier policy count. **No policy will be added.** The table is
reclassified, not remediated.

### 1.2 Navigation — was "8 tabs → 5", is **5 visible → a different 5**

`frontend/app/tabs/_layout.tsx` declares 8 `Tabs.Screen`, but three carry `href: null`
(lines 147-149: `habits`, `hub`, `settings`) and are therefore not rendered in the tab
bar. Counting declarations as tabs was the error.

| | Count | Members |
|---|---|---|
| Declared routes | 8 | today, tasks, focus, timeline, stats, habits, hub, settings |
| **Visible bottom tabs** | **5** | Bugün(`today`), Görevler(`tasks`), Odak(`focus`), Alışkanlıklar(`timeline`), İstatistikler(`stats`) |
| **Target** | **5** | Bugün, Plan, Alışkanlıklar, İçgörüler, Profil |

The real work is **an information-architecture reshape, not a tab-count reduction**.
Three of the five target destinations (Plan, İçgörüler, Profil) do not exist as tabs
today; the behaviours that must move into them live in `tasks`, `timeline`, `stats`,
`hub` and `settings`. No route may be deleted until its behaviour has a new home.

### 1.3 `backend/supabase/.temp/` — was a P1 source finding, is **local environment hygiene**

The file holds `zdqiujpeewtyhtcqhdcj` (the DENIED ERP project). It is Supabase CLI
scratch state, already covered by `.gitignore`, and is not part of the shipped
source tree. Correct classification: **LOCAL ENVIRONMENT HYGIENE**, remediated by
cleaning local CLI state and re-running the guard — never by committing a corrected
`.temp` file as if it were config.

### 1.4 Legacy backend — was "production'da canlı", is **an active client dependency**

Nothing in this session tested whether the FastAPI/Mongo service is deployed and
reachable. What *is* proven is narrower and still sufficient to act on: shipped
frontend code imports and calls it. The finding is restated as **LEGACY BACKEND
REMAINS AN ACTIVE CLIENT DEPENDENCY** (§4.4). "Live" would require a deployment test
that was not run.

### 1.5 Re-measured numbers

Stale figures from the earlier pass, re-taken against this HEAD:

| Metric | Earlier claim | **Re-measured** | Command |
|---|---|---|---|
| CI-gated lint | 0 errors / 73 warnings | **0 errors / 73 warnings — CONFIRMED** | `npx expo lint` |
| Full-repo lint | *(not measured)* | **3 errors / 158 warnings** | `npx eslint . --ext .ts,.tsx` |
| Hardcoded hex | 1477 | **1727 occurrences / 46 files** | `grep -roE '#[0-9a-fA-F]{3,8}' app components` |
| npm audit | 2 crit / 16 high / 13 mod / 1 low | **identical — CONFIRMED** | `npm audit --json` |

The full-repo lint gap is itself a finding: `npx expo lint` does not cover
`jest.setup.js` ("jest is not defined") or `scripts/fix-expo-tsconfig.js`
("__dirname is not defined", twice). CI is green while three errors exist in the repo,
because the gate's scope is narrower than the repo. Recorded as P3-2.

---

## 2. VERIFIED — closed, no work required

| Item | Evidence |
|---|---|
| No direct DB access from UI | `supabase.from(` in `app/**` + `components/**` → **0** |
| RLS enabled on all public tables | 49/49 `relrowsecurity = true` |
| habits / habit_logs cross-user isolation | live: 6 foreign habits + 13 foreign logs present, test user saw 1 each, 0 leaked |
| Anonymous access | `42501 permission denied`, HTTP 401 — no table grant to `anon` at all |
| Gate B steps 2-8 | passed live over PostgREST with a real user JWT, RLS enforced |
| `habits_tracking_type_check` | live constraint accepts `boolean` / `numeric` / `duration` / `abstinence` |
| `spotify_accounts` | server-only fail-closed — §1.1 |

---

## 3. P0 — RELEASE BLOCKERS

### P0-1 — Registration is broken (EXTERNAL CONFIG REQUIRED)

Read live from GoTrue, **without attempting another signUp** (a previous retry loop
exhausted the built-in email rate limit; re-testing would have proven nothing and
cost the limit again):

```
GET https://kbcuolhjjnmhjaarxxmu.supabase.co/auth/v1/settings
-> mailer_autoconfirm = false
-> disable_signup     = false
```

`mailer_autoconfirm` is still **false**, so GoTrue still tries to send a confirmation
mail on every `signUp()`, and with no working SMTP the registration transaction rolls
back — matching the observed *"Error sending confirmation email"* and the zero
`gateb.reg%` rows in `auth.users`.

The repo owner reported having disabled email confirmation. **The setting did not take
effect.** This is measured, not inferred.

Status per §80: **IMPLEMENTATION COMPLETE / EXTERNAL CONFIG REQUIRED.** No new user can
register, and Gate B's first step stays unverifiable, until this flips to `true`
(or real SMTP is configured).

### P0-2 — `duration` tracking cannot be persisted end to end

The database accepts it; nothing upstream can produce it.

| Layer | State | Evidence |
|---|---|---|
| DB CHECK | accepts `duration` | live constraint |
| Domain adapter | **can never return `duration`** | `frontend/lib/habitEngine.ts` — `return habit.tracking_type === 'numeric' ? 'numeric' : 'binary'` |
| Onboarding UI | only *Evet/Hayır* and *Sayısal* | `frontend/components/HabitOnboarding.tsx` step 2 |

Additionally `behavior_type === 'negative'` **overrides** tracking type to
`abstinence`, collapsing two orthogonal domain concepts into one. A negative habit
tracked numerically (e.g. "at most 2 cigarettes") cannot be expressed.

### P0-3 — Google Calendar is entirely non-functional

`frontend/store/googleCalendarStore.ts` calls `google-auth` with four actions
(`status` :34, `url` :62, `callback` :78, `disconnect` :109). Against the live project:

| Check | Result |
|---|---|
| `google-auth` in live deployed functions | **ABSENT** — deployed set is `generate-routine`, `notion-auth`, `notion-sync`, `subscription-webhook`, `spotify-auth` |
| `google-auth` in canonical `supabase/functions/` | **ABSENT** |
| `google-auth` in `backend/supabase/functions/` | present (not canonical, not deployed) |
| `google_calendar_integrations` table live | **ABSENT** — no `google*` table exists in `public` |

Every Google Calendar action in the shipped app resolves to a 404. The UI presents the
integration as available. This is a user-visible broken feature, not a code-quality
issue.

### P0-4 — Dependency vulnerabilities

`npm audit` on the committed lockfile at this HEAD:

```
critical 2   high 16   moderate 13   low 1   total 32
```

critical: `shell-quote`, `tar`. high includes `axios`, `form-data`, `expo`,
`@expo/cli`, `@expo/metro`, `@expo/metro-config`, `brace-expansion`, `image-size`.

---

## 4. P1 — SECURITY / ARCHITECTURE / SILENT FAILURE

### P1-1 — `notion-sync` silently reports success while syncing zero habits

The **deployed** function (v1, read live) queries:

```ts
supabase.from('habit_logs')
  .select('habit_id, state, xp, value, target_value')
  .eq('date', syncDate)
```

Against the live `habit_logs` schema:

| Column referenced | Exists live? |
|---|---|
| `target_value` | **NO** — column does not exist |
| `date` | **NO** — the live column is `completed_at` (type `date`) |

Two non-existent columns in one query. PostgREST rejects it, so `logsRes.error` is
set and `logsRes.data` is null — **and the error is never checked**. The next line is
`(logsRes.data ?? [])`, which yields `[]`, so `habitInserts.length === 0` and the
function returns:

```json
{ "success": true, "synced_habits": 0, "errors": 0 }
```

A user syncing Notion is told it worked. No habit has ever synced. The `?? []`
fallback is what converts a hard failure into a silent one.

The habit_logs query is also missing an explicit `user_id` filter (tasks and habits
both have one), relying on RLS alone.

### P1-2 — Canonical edge-function tree does not match production

`/supabase/functions` is nominally the source of truth. It is not what runs.

| Function | Canonical tree | `backend/` tree | **Deployed** |
|---|---|---|---|
| `generate-routine` | 142 lines, **2 modes** | 196 lines, 4 modes | **v11 — 4 modes** |
| `notion-sync` | **absent** | present | v1 ACTIVE |
| `google-auth` | **absent** | present | **absent** (P0-3) |
| `notion-auth` | present | present | v1 ACTIVE |
| `spotify-auth` | present | — | v2 ACTIVE |
| `subscription-webhook` | present | — | v1 ACTIVE |

**`generate-routine` mode drift, exactly.** Client call sites use four modes:

| Mode | Call site |
|---|---|
| `routine` | `frontend/store/routineStore.ts:176` |
| `coach` | `frontend/app/screens/ai-coach.tsx:151`, `frontend/app/screens/insights.tsx:213` |
| `summarize` | `frontend/app/screens/ai-coach.tsx:211` |
| `insights` | `frontend/app/screens/journal-insights.tsx:68` |

Deployed v11 handles all four (`COST = { coach: 5, routine: 25, summarize: 3, insights: 5 }`).
Canonical handles two (`COST = { coach: 5, routine: 25 }`) and its selector is
`body?.mode === 'coach' ? 'coach' : 'routine'` — so `summarize` and `insights` would
**fall through to `routine`**, billing 25 FP instead of 3/5 and answering with the
wrong system prompt.

The canonical tree is the stale copy; `backend/` matches production. Anyone who
redeployed from the canonical tree in good faith would break two shipped AI features.

### P1-3 — Applied migration still documents itself as not applied

`supabase/migrations/20260825_phase1_core_engine.sql` header, line 4:

```
-- *** NOT APPLIED. ***
```

It **was** applied to `kbcuolhjjnmhjaarxxmu` on 2026-08-30 with verified pre/post
counts (habits 6→6, habit_logs 13→13, tables 48→49, `recovery_plans` 10→15 columns,
`daily_capacity` created with RLS + 1 policy). A future reader trusting the header
would re-run or re-author it.

### P1-4 — Legacy backend remains an active client dependency

`frontend/utils/api.ts` targets `EXPO_PUBLIC_BACKEND_URL/api` and exports eight API
objects. Two groups are imported by shipped code:

| Importer | Imports |
|---|---|
| `frontend/app/tabs/settings.tsx:21` | `webhookAPI`, `exportAPI` |
| `frontend/components/BadHabitsTracker.tsx:15` | `badHabitAPI` |

`backend/server.py` defaults `user_id: str = "default"` at lines 159, 185, 284, 326,
990 — there is no per-user scoping on that service. Neither webhooks, export, nor bad
habits has a Supabase home today (no `bad_habits`-shaped table exists live).

### P1-5 — No service layer; 34 direct DB calls in stores

`frontend/services/` does not exist. `supabase.from(` appears **34** times across 11
stores: habitStore 5, okrStore 5, goalStore 4, readingListStore 4, focusStore 3,
recoveryStore 3, taskStore 3, deepWorkStore 2, noteStore 2, projectStore 2,
routineStore 1. `repositories/` covers 9 entities, so the boundary is real but partial.

### P1-6 — Monthly review has no cloud persistence

`frontend/app/screens/monthly-review.tsx` reads (:195) and writes (:295) reflections
through `AsyncStorage` only. Live schema has `weekly_reviews` but **no** monthly or
generic `reviews` table. Reflections are lost on reinstall and invisible to any other
device.

### P1-7 — No XP ledger; XP is a mutable aggregate

Live schema has `weekly_xp` but **no `xp_events`**. `profiles.total_xp` is mutated in
place. With no `(source_type, source_id)` uniqueness there is nothing preventing a
retried habit-log sync from awarding XP twice, and no way to recompute a balance that
drifts.

### P1-8 — Unbounded queries

`noteStore`, `taskStore`, `projectStore`, `readingListStore` fetch entire collections
with no limit, cursor or window. Growth is unbounded in normal use.

---

## 5. P2 — PRODUCT CORRECTNESS

| # | Finding | Evidence |
|---|---|---|
| P2-1 | Navigation IA differs from target (§1.2) — Plan / İçgörüler / Profil do not exist | `app/tabs/_layout.tsx` |
| P2-2 | `packageManager: "yarn@1.22.22"` declared, no `yarn.lock` exists, CI runs `npm ci` | `frontend/package.json:70`, `.github/workflows/ci.yml` |
| P2-3 | Crash reporting has no production transport — capture seam + privacy scrubber exist, sink is dev-console only | `frontend/lib/crashReporting.ts` |
| P2-4 | Store identity is the Expo template: `name`/`slug`/`scheme` = `frontend`; icons byte-identical to template | `frontend/app.json`, `assets/` |

## 6. P3 — QUALITY

| # | Finding | Measurement |
|---|---|---|
| P3-1 | 73 lint warnings inside the CI gate | `npx expo lint` |
| P3-2 | 3 lint errors **outside** the CI gate's scope | `jest.setup.js:15`, `scripts/fix-expo-tsconfig.js:6,28` |
| P3-3 | 1727 hardcoded hex values across 46 files; top values are token duplicates (`#fff` x227, `#383528` x175, `#827E72` x169, `#D97757` x143) | `grep -roE` |
| P3-4 | No native widget | — |

---

## 7. SCHEMA REPRODUCIBILITY RISK

The live database holds 49 tables. `supabase/migrations/` cannot rebuild them: much of
the live schema predates this repo's migration tree and was created outside it (the
column renames documented in `docs/audit/07_...` §8 — `type`→`tracking_type`,
`target_value`→`daily_goal` — exist live but in no migration file, and
`001_initial_schema.sql` reproduces a schema the database no longer has).

**A database rebuilt from `supabase/migrations/` would not match production.** This is
recorded, not remediated: reverse-engineering 49 live tables into one synthetic
migration would be a large, high-risk change with no user-facing benefit, and the
scope of this task is additive migrations only. Carried into
`docs/KNOWN_LIMITATIONS_V2.md` as a known migration-history gap.

---

## 8. EXTERNAL BLOCKERS (§80)

| # | Blocker | Required action | Blocks |
|---|---|---|---|
| 1 | `mailer_autoconfirm = false` | Auth → Providers → Email → **Confirm email = OFF** (then re-read `/auth/v1/settings`), or configure real SMTP | P0-1, full Gate B |
| 2 | No Sentry DSN | provide DSN | P2-3 |
| 3 | Edge deploy permission | confirm deploy authority | P0-3, P1-1, P1-2 live smoke |
| 4 | Native build toolchain | — | P3-4 |
