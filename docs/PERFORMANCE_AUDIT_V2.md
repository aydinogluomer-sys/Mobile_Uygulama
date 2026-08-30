# Performance Audit — Atlas V2

> Plan reference: §24 Phase 4 "performance audit", measured against §28 Quality Gates.
> Date: 2026-08-30. Branch: `phase/1-core-engine`.
> Method: static analysis of every data-fetching call site in `store/`,
> `repositories/`, `app/tabs/` and `app/screens/`, plus the render path of every
> chart-like component. No runtime profiling — see *Limits* at the end.

---

## Verdict against §28

| §28 criterion | Verdict | Detail |
|---|---|---|
| No blocking dashboard query waterfall | **1 violation found — FIXED** | `app/tabs/stats.tsx` |
| No unbounded chart render | **PASS** | all chart inputs are structurally capped |
| No unnecessary full-data fetch | **4 violations found — REPORTED, NOT FIXED** | see §3 for why |

---

## 1. Query waterfall — one real violation, fixed

`app/tabs/stats.tsx`'s `loadData` awaited four independent things on four
separate lines:

```
await supabase.auth.getUser()          // auth gate — legitimately first
await fetchHabitLogsHeatmap({ since })     // 365-day heatmap
await fetchHabitIdsCompletedSince({ since30 })  // 30-day per-habit rollup
await Promise.all([fetchHabits(), fetchTasks()])
```

**None of the last three consumes another's output.** They need only `since` /
`since30`, both computed locally from `now`. They were serialised purely because
each `await` was written on its own line — so the Stats tab paid **four
sequential round trips** for work that needs two.

This was not a missing capability: `app/tabs/today.tsx:74` already batches its
five fetches into a single `Promise.all`. The pattern existed in the repo and
was simply not applied here.

**Fixed** — the three independent fetches now share one `Promise.all`, behind
the auth gate. Round trips on the Stats tab: **4 → 2**. The processing logic is
untouched; only the waiting changed.

Guarded by `__tests__/repo/statsNoQueryWaterfall.test.ts`, whose most useful
assertion is not "there is a `Promise.all`" but *"no `await fetch…(` exists
outside the batch"* — the realistic regression is someone adding a fifth query
later and reaching for a bare `await` because it is the shorter diff. Mutation:
restoring the original four-stage waterfall turns **all 6** real assertions red
while the 4 scanner-sanity tests correctly stay green.

---

## 2. Chart rendering — PASS

Every chart input is structurally capped rather than being however-many-rows-
the-user-has:

| Surface | Bound | Where |
|---|---|---|
| Stats 365-day heatmap | fixed 365-cell grid | `app/tabs/stats.tsx` |
| Stats 14-day trend | `Array.from({ length: 14 })` | same |
| Insights per-habit rates | `MAX_HABIT_ENTRIES` slice | `app/screens/insights.tsx:358` |
| Habit detail history | single-habit log index | `app/screens/habit-detail.tsx:336` |

No violation. Note the caps are on *render*, not on the fetch behind them — the
heatmap query is separately bounded by `since` (365 days), which is what makes
this honest rather than accidental.

---

## 3. Full-data fetch — four unbounded queries, reported not fixed

Four stores fetch **every row the user has ever created**, with no `limit`, no
date window and no pagination:

| Store | Table | Bound |
|---|---|---|
| `store/noteStore.ts:31` | `notes` | **none** |
| `store/taskStore.ts:58` | `tasks` | **none** |
| `store/projectStore.ts:35` | `projects` | **none** |
| `store/readingListStore.ts:42` | `reading_list` | **none** |

These tables grow monotonically for an engaged user — which is precisely the
user the product is for. A person three years into Atlas re-downloads every task
they have ever written on each mount of the Tasks tab.

For contrast, the stores that got this right:

| Store | Bound |
|---|---|
| `store/journalStore.ts:38` | `.limit(365)` |
| `store/deepWorkStore.ts:38` | `.gte('date', since)` |
| `store/insightsStore.ts` | `.eq(period)` + `.eq(period_key)` |
| `store/goalStore.ts:41` | `.eq('archived', false)` |

**Why this is reported and not fixed.** Adding `.limit(n)` without pagination UI
would not make the app faster in any meaningful sense — it would make it
**silently wrong**: the user's older tasks and notes would stop appearing, with
no indication that anything had been withheld. Truncating a user's data behind
their back is a worse defect than the one being fixed, and it is not what
"performance audit" authorises. The real fix is paginated or windowed loading
with a UI affordance, which is a feature-shaped change and belongs in its own
unit with its own acceptance criteria.

Recommendation, in priority order:

1. `tasks` — highest churn, mounted on the default tab, worst growth curve.
2. `notes` — unbounded text payloads, so the row count understates the cost.
3. `reading_list`, `projects` — lower volume; a simple `archived`/`status`
   filter (the pattern `goalStore` already uses) may be sufficient.

---

## 4. Boot path — no finding

`app/_layout.tsx` runs `hydrateNotionSession()` and `hydrateSyncQueue()` in one
`Promise.all` rather than in sequence, with a comment explaining that they are
independent stores. The auth `getSession()` that follows genuinely depends on
nothing before it but must resolve before routing. No waterfall.

---

## Limits of this audit

Static analysis only. It can prove that four requests are issued in one batch
and that a chart's input is capped; it cannot measure frame time, list scroll
performance, bundle size or memory. Specifically **not** covered:

- render-time cost of the 365-cell heatmap on a low-end device;
- `FlatList` vs `ScrollView` choices and virtualisation thresholds;
- re-render volume from store subscriptions (a selector returning a fresh object
  each call re-renders every subscriber — not audited here);
- bundle size and startup time.

Those need a profiler on a real device and should be their own exercise. This
document covers exactly the three properties §28 names, and says plainly which
of them is a fix and which is a finding.
