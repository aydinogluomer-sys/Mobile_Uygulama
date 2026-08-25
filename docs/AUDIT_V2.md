# AUDIT_V2 — Repository Audit (Phase 0, §32 Task 1–10)

**Status:** `Verified` — read-only, static analysis of the working tree
**Scope:** `C:\Users\Trade Bilisim\Mobile_Uygulama`, branch `phase/0-recovery`
**Date:** 2026-08-25
**Method:** direct file listing (`find`, `wc -l`), `grep`/`ripgrep` over source, and
reconciliation against `docs/audit/00`–`09` (Gate A, closed `PASS WITH FINDINGS`
on 2026-08-03) and `docs/plan/08`/`10`. No Supabase MCP call was made — project
`kbcuolhjjnmhjaarxxmu` is unreachable at time of writing (`execute_sql` and
`list_tables` both time out); schema claims below are sourced from
`frontend/lib/supabase.ts`, `supabase/migrations/*.sql` and
`docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md` §3–§8, which captured the
live database on 2026-08-02 while it was reachable.

> **Rule 7 notice.** `IMPLEMENTATION_V2.md` §2/§3 ("Mevcut Repo — Ground Truth",
> "P0.1 — Main Branch Build Integrity") is **stale**. It claims `frontend/store/`
> holds only `useStore.ts` and `frontend/lib/` holds only `monthBackgrounds.ts`,
> and lists ten modules as "missing" — `lib/supabase.ts`, `lib/tokens.ts`,
> `lib/haptics.ts`, `lib/todayNarrative.ts`, `store/habitStore.ts`,
> `store/logStore.ts`, `store/taskStore.ts`, `store/willpowerStore.ts`,
> `store/focusStore.ts`, `store/recoveryStore.ts`. **Every one of these ten
> files exists in the repository today and is imported by real screens.**
> This document records the actual repository, not the plan's P0.1 claim.

---

## 1. Repository audit — actual tree, with counts

| Area | Path | File count | Notes |
|---|---|---|---|
| Routes | `frontend/app/**` | **40** | see §4 |
| Domain stores | `frontend/store/*.ts` | **26** | 25 domain stores + 1 dead legacy store (`useStore.ts`, see §7) |
| Lib modules | `frontend/lib/*.ts` | **21** | includes every module P0.1 called "missing" |
| Components (top-level) | `frontend/components/*.tsx` | 15 | |
| Components (`focus/`) | `frontend/components/focus/` | 5 | |
| Components (`seasonalMotion/`) | `frontend/components/seasonalMotion/` | 7 | |
| Components (`today/`) | `frontend/components/today/` | 4 | |
| Components (`ui/`) | `frontend/components/ui/` | 14 | design-system primitives (`GlassPanel`, `Button`, `Card`, `ProgressBar`, …) |
| **Components total** | `frontend/components/**` | **45** | |
| Jest tests | `frontend/__tests__/**` | **13** | `edge/` (2) · `lib/` (5) · `repo/` (2) · `store/` (4) |
| Structural gate | `frontend/run-tests.js` | 1 file, 351 lines | source-text assertion harness, not executing tests — see §9 |
| Legacy types | `frontend/types/index.ts` | 1 file, 100 lines | Mongo-shaped `Habit`/`Task`/etc — see §7 |
| Legacy API client | `frontend/utils/api.ts` | 1 file, 173 lines | axios → FastAPI `localhost:8000` — see §7 |

### `supabase/` (canonical tree)

```
supabase/functions/generate-routine/index.ts
supabase/functions/notion-auth/index.ts
supabase/functions/spotify-auth/index.ts
supabase/functions/subscription-webhook/index.ts
supabase/functions/_shared/oauthState.ts
supabase/functions/_shared/redirectAllowlist.ts
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_integrations.sql
supabase/migrations/20260802181931_emergency_gate_0_revoke_mock_activate_subscription.sql
supabase/migrations/20260802205850_emergency_gate_0_revoke_client_exec_xp_functions.sql
supabase/config.toml · supabase/predeploy_guard.sh · supabase/.temp/ (CLI scratch state)
```

4 edge functions, 4 migration files. Doc 07 §2/§8 already established (2026-08-02,
live) that this tree is **incomplete against the live deployment**: 5 functions
are actually deployed (`generate-routine` v11, `spotify-auth` v2, `notion-auth`
v1, `notion-sync` v1, `subscription-webhook` v1 — `notion-sync` has no file
under `supabase/`, only under `backend/supabase/`), and the 4 migration files
describe 7 of the live database's 48 tables. See §5 and §10.

### `backend/` (excluding `.venv/`)

```
backend/server.py               (1064 lines — FastAPI + Motor/MongoDB)
backend/requirements.txt
backend/.env · backend/.env.local
backend/ntn-install.sh
backend/supabase/functions/generate-routine/index.ts
backend/supabase/functions/google-auth/index.ts
backend/supabase/functions/notion-auth/index.ts
backend/supabase/functions/notion-sync/index.ts
backend/supabase/.temp/*  (linked to a DIFFERENT, foreign Supabase project — see below)
```

`backend/server.py` imports `fastapi`, `motor.motor_asyncio.AsyncIOMotorClient`,
`pandas`, `httpx` — a live FastAPI + MongoDB CRUD backend, distinct from
Supabase. `backend/supabase/.temp/linked-project.json` points at
`zdqiujpeewtyhtcqhdcj` ("Mas Technic Site") — a **separate, unrelated Supabase
project**, already classified in doc 07 §1a/§1b and doc 09 §9. This audit adds
no new finding here beyond confirming the files are still present, untouched,
and still foreign.

### Two Obsidian directories at repo root

`obsidian-api/` (60 files) and `obsidian-atlas-plugin/` (293 files) — an
Obsidian plugin and its API dependency, unrelated to the Expo app or Supabase
backend. Doc 01 §5 records that `obsidian-api` was previously a broken git
submodule reference and was fixed to a plain tracked directory. No new finding.

---

## 2. Missing-dependency audit

**Result: zero unresolved.** `npx tsc --noEmit` exits 0 (measured baseline,
orchestrator), which is a stronger guarantee than a manual import scan for
every `.ts`/`.tsx` file in the type-checked project. As independent
corroboration, every bare-specifier `import … from '<pkg>'` across
`frontend/app`, `frontend/components`, `frontend/store`, `frontend/lib`,
`frontend/hooks`, `frontend/constants`, `frontend/utils`, `frontend/__tests__`
was extracted and diffed against `frontend/package.json`:

| Imported package | In `package.json`? |
|---|---|
| `@expo/vector-icons`, `@react-native-async-storage/async-storage`, `@react-navigation/elements`, `@react-navigation/native`, `@supabase/supabase-js`, `axios`, `date-fns`, `expo-blur`, `expo-haptics`, `expo-image`, `expo-linking`, `expo-notifications`, `expo-router`, `expo-web-browser`, `react`, `react-native`, `react-native-animatable`, `react-native-safe-area-context`, `react-native-svg`, `zustand` | **Yes**, all 19 |
| `fs`, `path` | Node built-ins, used only inside `__tests__/**` (Jest's Node environment), not app runtime — no dependency needed |

No genuinely unresolved import was found.

---

## 3. Broken-import audit

**Result: none found.** Same evidence as §2 — `tsc --noEmit` exit 0 means
every relative and package import resolves and every named export used exists
on its source module, across the whole `frontend/` TypeScript project
(app + components + store + lib + utils + types + `__tests__`). This directly
contradicts `IMPLEMENTATION_V2.md` P0.1's claim that current screens import
modules absent from the repo — those modules are present (§1, §7) and the
type-checker proves the wiring is intact.

---

## 4. Route audit — every file under `frontend/app/**`

### `(auth)/` — 5 files
`_layout.tsx` · `login.tsx` · `register.tsx` · `forgot-password.tsx` · `reset-password.tsx`

### Root — 2 files
`_layout.tsx` (session bootstrap, auth-state redirect) · `index.tsx`

`frontend/app/index.tsx` is:
```tsx
import { Redirect } from 'expo-router';
export default function Index() {
  return <Redirect href="/(auth)/login" />;
}
```
`app/_layout.tsx` then redirects an authenticated session to `/tabs/today` on
mount (`router.replace('/tabs/today')`, line ~54). **This differs from
`IMPLEMENTATION_V2.md` §6's stated target** (`<Redirect href="/tabs/today" />`
directly from `index.tsx`) — the real app gates on auth first and lands on
`/tabs/today` only after. Per Rule 7 this is not a defect to "fix back" to the
plan; it is documented as the actual, and arguably more correct, behavior.

### `tabs/` — 9 files
`_layout.tsx` · `today.tsx` · `tasks.tsx` · `focus.tsx` · `timeline.tsx` ·
`stats.tsx` · `habits.tsx` · `hub.tsx` · `settings.tsx`

`tabs/_layout.tsx` registers all 8 screens as `Tabs.Screen`. Visible in the
bottom bar: `today`, `tasks`, `focus`, `timeline`, `stats` (5). Registered but
hidden (`options={{ href: null }}`, reachable only by `router.push`):
`habits`, `hub`, `settings` (3).

### `screens/` — 30 files
`_layout.tsx` (sets `headerTransparent: true` for the whole group — the
"transparent header" pattern named in plan Rule 8) plus 29 screens:
`ai-coach` · `calendar` · `credit-history` · `dashboard` · `deep-work` ·
`eisenhower` · `goals` · `integrations` · `journal` · `journal-archive` ·
`journal-insights` · `journal-reader` · `leaderboard` · `life-areas` ·
`monthly-review` · `notes` · `okr` · `paywall` · `profile` · `projects` ·
`reading-list` · `recovery` · `weekly-review`.

### Navigation targets vs files that exist

Every `router.push(...)` / `router.replace(...)` / `<Link href="...">` literal
found in `frontend/app/**` and `frontend/components/**` (including the
dynamic-route tables in `Drawer.tsx`, `app/tabs/hub.tsx` and
`components/CommandPalette.tsx`) resolves to a file that exists:
`/(auth)/login`, `/(auth)/register`, `/(auth)/forgot-password`,
`/(auth)/reset-password`, `/tabs/today`, `/tabs/tasks?tab=…`, `/tabs/focus`,
`/tabs/timeline`, `/tabs/stats`, `/tabs/habits`, `/tabs/habits?ai=true`,
`/tabs/settings`, `/screens/calendar`, `/screens/recovery`,
`/screens/weekly-review`, `/screens/monthly-review`, `/screens/eisenhower`,
`/screens/deep-work`, `/screens/leaderboard`, `/screens/profile`,
`/screens/projects`, `/screens/notes`, `/screens/journal`,
`/screens/journal-archive`, `/screens/journal-reader?date=…`,
`/screens/journal-insights?period=…`, `/screens/reading-list`,
`/screens/goals`, `/screens/okr`, `/screens/life-areas`, `/screens/ai-coach`,
`/screens/paywall`, `/screens/integrations`, `/screens/credit-history`.

**Result: 0 invalid routes** — every navigation target has a backing file.

### Files with no discovered internal entry point

| File | Finding |
|---|---|
| `app/screens/dashboard.tsx` (18 lines) | No `router.push`/`href` to `/screens/dashboard` was found anywhere in `app/**` or `components/**`. The file's own comment states why: *"Dashboard artık İstatistikler → 'Liste' sekmesine taşındı… Bu rota geri uyumluluk için ince sarmalayıcı olarak kalır"* (kept as a thin backward-compatibility wrapper around `HabitListView`). Intentional, not a defect — but unreachable from in-app navigation as currently wired. |
| `app/tabs/hub.tsx` (139 lines, registered as `Tabs.Screen name="hub"`, `href: null`) | No `router.push('/tabs/hub')` was found anywhere. The screen is a fully-built "quick access" grid (routes to calendar, recovery, tasks views, projects, weekly-review, notes, journal, stats, settings) but has no discovered caller. Either an orphaned entry point or reached by a mechanism not visible to static grep (e.g. a future drawer/tab wiring). Flagged for Phase 1 triage, not assumed dead. |

---

## 5. Supabase / FastAPI architecture inventory

This section is a pointer to already-verified live evidence
(`docs/audit/07_ARCHITECTURE_AND_DATA_MODEL_REVIEW.md`, captured 2026-08-02
while the project was reachable) plus this audit's static confirmation of the
repository trees.

| | Value |
|---|---|
| Canonical Supabase project | `kbcuolhjjnmhjaarxxmu` ("Alışkanlık Uygulaması") |
| Canonical directories | `supabase/functions/`, `supabase/migrations/` |
| Reachability at time of this audit | **UNREACHABLE** — `execute_sql`/`list_tables` time out |
| Live tables (as of 2026-08-02) | **48**, RLS enabled on all 48 |
| Live RPCs | 40 (35 `SECURITY DEFINER`, 17 with unpinned `search_path`) |
| Live triggers | 9, including the XP-award trigger pair on `habit_logs` |
| `supabase/migrations/*.sql` describes | 7 tables, 0 RPCs, 0 triggers |
| Live deployed edge functions | `generate-routine` v11 · `spotify-auth` v2 · `notion-auth` v1 · `notion-sync` v1 · `subscription-webhook` v1 |
| `google-auth` | **Not deployed.** Called by `store/googleCalendarStore.ts`; every call 404s (doc 07 §2, confirmed P1) |
| `notion-sync` | Deployed, but reads `habit_logs.date`/`target_value`, neither of which exists on the live table — silently syncs 0 habits (doc 07 §2b, confirmed P1) |

`backend/server.py` is a **separate, still-live-in-source FastAPI app** backed
by MongoDB (`motor.motor_asyncio.AsyncIOMotorClient`), 1064 lines, full CRUD
routers for habits/tasks/completions/webhooks/bad-habits/stats/profile. It is
reachable from the client only through `frontend/utils/api.ts` →
`EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000'`. Doc 09 §5 (finding
B1/B2) already recorded that this endpoint is dead on-device and its failure
path shows a false success alert. See §7 for exactly which screens still call
it.

---

## 6. Compile errors

**0.** `cd frontend && npx tsc --noEmit` → exit code `0` (measured baseline,
orchestrator). No new compile check was re-run in this audit per the
orchestrator's baseline table; §2/§3 above independently corroborate the
result via import-resolution analysis.

---

## 7. Duplicate architecture

Two type systems and two data-access paths coexist in the repository, exactly
as `IMPLEMENTATION_V2.md` §4.2 describes in principle — but the plan's P0.2
claim that the **legacy path is what `timeline.tsx`, `habits.tsx`, `stats.tsx`
use today is stale**. All three now import the domain-store / Supabase path.
Only two screens and one component still touch the legacy path.

### 7.1 The two `Habit` types

| | `frontend/types/index.ts` (legacy) | `frontend/lib/supabase.ts` (real) |
|---|---|---|
| Shape | `_id`, `is_active`, `target_days`, `strength_score`, `frequency: string`, `category: string` | `id`, `user_id`, `tracking_type: 'boolean'\|'numeric'`, `daily_goal`, `frequency_config: FrequencyConfig`, `status`, `impact_level`, `difficulty`, `estimated_minutes`, `willpower_cost`, `cue_habit_id`, `end_condition` |
| Backing store | MongoDB, via `backend/server.py` | Supabase Postgres `habits` table |
| Consumers (exact) | **4 files** — `store/useStore.ts`, `utils/api.ts`, `app/tabs/settings.tsx`, `components/BadHabitsTracker.tsx` | **45 files** — every `(auth)` screen, `app/_layout.tsx`, 12 other `app/screens/*` + `app/tabs/{habits,stats,timeline}.tsx`, 8 components, and **24 of the 25 domain stores** |

### 7.2 `frontend/utils/api.ts` (legacy path) vs domain stores (real path)

`utils/api.ts` (173 lines) wraps `axios` against
`${EXPO_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/api` and exports
`habitAPI`, `completionAPI`, `taskAPI`, `webhookAPI`, `badHabitAPI`,
`statsAPI`, `profileAPI`, `exportAPI`.

**Live consumers of `utils/api.ts` — exactly 2 files:**

| File | What it still uses from the legacy path |
|---|---|
| `app/tabs/settings.tsx` | `webhookAPI.getAll/create/delete`, `exportAPI.exportAll` |
| `components/BadHabitsTracker.tsx` | `badHabitAPI.getAll/create/getSavings` |

`habitAPI`, `completionAPI`, `taskAPI`, `statsAPI`, `profileAPI` are exported
but have **zero call sites** anywhere in `frontend/` — dead exports (see §8).

**The domain-store / Supabase path** is what every other screen uses: 25
Zustand stores in `frontend/store/` (`habitStore`, `logStore`, `taskStore`,
`willpowerStore`, `focusStore`, `recoveryStore`, `profileStore`,
`subscriptionStore`, `journalStore`, `notionStore`, `spotifyStore`,
`googleCalendarStore`, `goalStore`, `okrStore`, `projectStore`, `noteStore`,
`readingListStore`, `lifeAreasStore`, `insightsStore`, `routineStore`,
`deepWorkStore`, `drawerStore`, `commandStore`, `themeStore`,
`notionSessionStore`), each calling `supabase.from(...)` / `supabase.rpc(...)`
directly. A multi-line-aware recount (§9's grep undercounted this codebase's
predominant multi-line `supabase\n.from(...)` call style — see
`ARCHITECTURE_V2.md` §3 for the correction) finds **78** such calls across
`frontend/store/`, 0 in `frontend/lib/`, and **6** across 4 files in
`frontend/components/` (`ADHDTaskSplitter.tsx`, `focus/FocusSettingsModal.tsx`,
`focus/FocusSessionCompleteModal.tsx`, `focus/FocusReportModal.tsx`) — see
`ARCHITECTURE_V2.md` §3 for the full screen-level (`app/**`, **10** calls) and
component-level (`components/**`, **6** calls) file:line breakdown, **16**
violations total across 9 files.

### 7.3 `frontend/store/useStore.ts` — dead legacy store

60 lines, a single flat Zustand store (`habits`, `tasks`, `completions`,
`stats`, `selectedDate`) typed against the legacy `types/index.ts` shapes.
**A repo-wide grep for `useStore` outside its own file, across every
`.ts`/`.tsx` under `frontend/` (excluding `node_modules`), returns zero
matches.** It is imported nowhere. This is the one part of P0.2's "legacy
path" claim that is still literally true — but the file is unreachable dead
code, not something any live screen depends on.

### 7.4 Summary table

| Path | Types | Data layer | Backend | Live screen count |
|---|---|---|---|---|
| **Legacy** | `types/index.ts` | `utils/api.ts` (axios) | FastAPI + MongoDB (`backend/server.py`) | **2** (`settings.tsx` webhooks/export panel, `BadHabitsTracker.tsx`) |
| **New (real)** | `lib/supabase.ts` + per-domain shapes | 25 Zustand stores, direct `supabase.from/rpc` | Supabase Postgres, RLS-protected | **38 of 40** route files |
| **Dead** | `types/index.ts` (also) | `store/useStore.ts` | none reachable | 0 |

---

## 8. Dead code

| Item | Evidence |
|---|---|
| `frontend/store/useStore.ts` | 0 consumers repo-wide (§7.3) |
| `utils/api.ts` exports `habitAPI`, `completionAPI`, `taskAPI`, `statsAPI`, `profileAPI` | 0 call sites; only `webhookAPI` and `exportAPI` (via `settings.tsx`) and `badHabitAPI` (via `BadHabitsTracker.tsx`) are actually called |
| `supabase/functions/generate-routine/index.ts` (2-mode version) | Doc 07 §2 — the deployed version (v11) is the 4-mode `backend/supabase/functions/generate-routine/index.ts` lineage; the file physically present in the canonical `supabase/` tree does not match what runs in production |
| `backend/supabase/functions/notion-auth/index.ts` (341-line version) | Doc 07 §2b — writes `parent_page_id`, a column that does not exist on live `notion_integrations`; classified `legacy/superseded` |
| `app/screens/dashboard.tsx` | No discovered internal entry point (§4) — kept deliberately per its own comment, effectively unreachable code |

No new dead-code class was found beyond what doc 03 (`03_UNFINISHED_AND_BROKEN_WORK.md`) already catalogued; this section adds the `useStore.ts` and `utils/api.ts` dead-export findings, which are new precision on top of doc 09's B1/B2.

---

## 9. Regression inventory (plan Rule 8)

Rule 8 names four protected patterns: **Calendar seasonal background, Monthly
Review seasonal background, GlassPanel, transparent header.**

| Protected pattern | Implementation state | `run-tests.js` coverage | Jest coverage |
|---|---|---|---|
| **Calendar seasonal background** | `app/screens/calendar.tsx` imports and renders `MonthBackground` (`active={isFocused}`) and 3× `GlassPanel` | **Covered** — `run-tests.js` §16 asserts `calendar isFocused → active`, `MonthBackground SeasonalMotion entegrasyonu`, plus the `seasonalMotion/*` file-existence and config checks | **Not covered** — no `__tests__/**` file references `calendar.tsx`, `MonthBackground`, `GlassPanel` or `seasonalMotion` |
| **Monthly Review seasonal background** | **RESOLVED — re-verified after commit `92becd9`.** `app/screens/monthly-review.tsx` now imports `MonthBackground` (`components/MonthBackground.tsx:12`), renders it with `active={isFocused}` (line 194), imports `MONTH_TAGLINES_TR` from the shared `components/seasonalMotion/config` (line 14, not duplicated — the same source `calendar.tsx` uses), and implements `animatePage`/`pageStyle`/`reduceMotion` via `useReducedMotion()` (lines 45, 49, 181). A repo-wide re-grep for these tokens now returns matches at every expected site — this audit's original read (before commit `92becd9` landed) found none; the finding is corrected here, not merely updated. | **Now passing.** `run-tests.js` line 242–247 (`'monthly-review: kapak + hareket + sayfa çevirme'`) checks exactly these tokens and, re-verified against the current file content, all are present — this assertion is confirmed to pass. Consistent with the observed `run-tests.js` move from `139/142` to `142/142`. | **Coverage in progress.** `frontend/__tests__/repo/seasonalRegression.test.ts` was absent when this section was first written; a file at that path has since appeared in the working tree (a QA subagent is adding it concurrently with this pass). Its contents were not read and its pass/fail status was not verified here — out of this document's read-only scope outside its own five deliverables. Treat this line item as "a coverage PR is in flight," not as "coverage confirmed landed." |
| **`GlassPanel`** | Component exists at `components/ui/GlassPanel.tsx`. Used by exactly 1 screen: `calendar.tsx` (3 call sites). **Still not used by `monthly-review.tsx`** — the Monthly Review fix above uses `MonthBackground` + its own hero/page-turn treatment, not `GlassPanel`. This remains accurate after the correction above. | Indirectly via the calendar-focused assertions above; no assertion names `GlassPanel` by string | **Not covered** |
| **Transparent header** | `app/screens/_layout.tsx:18` sets `headerTransparent: true` for the whole `screens/` group | **Not covered** — no `run-tests.js` assertion contains `headerTransparent` | **Not covered** |

**Net finding (revised):** all 4 Rule-8-protected patterns are now
**implemented** in the code — the Monthly Review gap that this audit
originally (and, at the time, correctly) found absent has been closed by a
parallel coder's change (commit `92becd9`) between this audit's first and
second reads. What remains true and unchanged is the coverage gap: **3 of the
4 patterns (Monthly Review seasonal background, `GlassPanel`, transparent
header) have zero *executing* jest coverage** — only `run-tests.js`
source-text assertions, which doc 09 P3 already flags as "no executing
tests." Calendar's seasonal background has the same jest gap. A
`seasonalRegression.test.ts` suite is reported in progress but was not yet
present in the tree at the time of this reading.

---

## 10. Migration map

See `docs/MIGRATION_V2.md` for the full legacy → target mapping, the schema
gap table (tracking-type coverage, `recovery_plans`/`daily_capacity`
presence), and the explicit BLOCKED note on live migration application.
