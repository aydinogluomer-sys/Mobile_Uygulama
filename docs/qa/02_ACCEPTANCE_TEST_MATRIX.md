# 02 — Acceptance Test Matrix

**Status:** `Planned` — executable specification for Phase 1E
**Source:** the 62 cases in doc 06, converted to acceptance criteria with an owning layer

---

## Layer key

`L1` jest-expo (Node) · `L2` pgTAP / Supabase local (real Postgres) ·
`L3` component (Phase 2D) · `L4` E2E device (Phase 6A)

**Rule:** a case is assigned to the *lowest* layer that can genuinely prove it.
Anything touching RLS, a constraint or concurrency is `L2` — never `L1`.

---

## A · Date and timezone — `L1`, run under `TZ=Europe/Istanbul`

The highest-value block: 7 of 8 currently predicted to fail, and **none needs a device**.

| ID | Given | When | Then | Layer | Now |
|---|---|---|---|---|---|
| AC-D01 | local time 00:30 on 3 Aug | habit completed | log date = `2026-08-03` | L1 | **FAIL** |
| AC-D02 | local time 23:30 on 3 Aug | habit completed | log date = `2026-08-03` | L1 | pass |
| AC-D03 | local time 01:00 | `taskStore.dueToday()` | returns today's tasks, not yesterday's | L1 | **FAIL** |
| AC-D04 | local time 01:00 | `taskStore.overdue()` | yesterday's overdue task is included | L1 | **FAIL** |
| AC-D05 | focus session 01:30 local | streak computed | day counted | L1 | **FAIL** |
| AC-D06 | journal entry 01:30 local | streak computed | day counted | L1 | **FAIL** |
| AC-D07 | life-area save 01:00 local | upsert | writes today, not yesterday | L1 | **FAIL** |
| AC-D08 | deep-work session Sun 22:00 | week bucket | lands in the week containing that Sunday | L1 | **FAIL** |
| AC-D09 | `todayLocal()` called at any hour | — | never differs from the device's calendar date | L1 | new |
| AC-D10 | any two modules derive "today" | — | identical string | L1 | new |

---

## B · Habit scheduling and metrics — `L1`

| ID | Given | When | Then | Layer | Now |
|---|---|---|---|---|---|
| AC-H01 | `{kind:'weekly', days:[0,2,4]}` | `isDueOn` Mon/Wed/Fri | `true` | L1 | pass |
| AC-H02 | same habit | `isDueOn` Tue/Thu/Sat/Sun | `false` | L1 | pass |
| AC-H03 | **`{kind:'weekly', count:3}`** | `isDueOn` any day | **`true` on at least 3 days/week** | L1 | **FAIL** — always `false` |
| AC-H04 | Mon/Wed/Fri habit, all 3 done | weekly completion % | **100 %**, not 43 % | L1 | **FAIL** — `isDueOn` never called |
| AC-H05 | `target_direction:'at_most'`, goal 10, value 2 | percent | **high** score | L1 | **FAIL** — rewards higher values |
| AC-H06 | same, value 10 | percent | **low** score | L1 | **FAIL** |
| AC-H07 | log `state:'miss'` | completed-days count | **not incremented** | L1 | **FAIL** |
| AC-H08 | log `state:'skip'` | completed-days count | **not incremented** | L1 | **FAIL** |
| AC-H09 | habit paused today | last month's report | unchanged | L1 | **FAIL** — filters `status==='active'` |
| AC-H10 | `lib/ranks.rankForLevel(n)` | for n = 1..100 | equals SQL `get_rank_for_level(n)` | **L2** | untested |

**AC-H10 must be `L2`** — it asserts parity between a TypeScript function and a
SQL function. Only a real database can evaluate the SQL side.

---

## C · Data integrity and concurrency — `L2` only

| ID | Given | When | Then | Layer | Now |
|---|---|---|---|---|---|
| AC-I01 | user A, habit H, date D | two concurrent inserts | exactly **one** row | L2 | pass (constraint exists) |
| AC-I02 | same | the second insert | **returns an error the client reads** | L1+L2 | **FAIL** — `logStore.ts:71-84` discards `error` |
| AC-I03 | budget 15, used 4 | two concurrent debits of 4 | `used = 12`, never 8 | L2 | **FAIL** — client read-modify-write |
| AC-I04 | budget 15, used 14 | concurrent activation of two cost-2 habits | exactly one succeeds | L2 | **FAIL** — TOCTOU |
| AC-I05 | habit never activated | pause | **no refund** | L2 | **FAIL** — unconditional |
| AC-I06 | cached `state_date` = yesterday | debit after midnight | writes today's row | L2 | **FAIL** |
| AC-I07 | plan for (habit H, source D) | create a second | **rejected** | L2 | **FAIL** — no constraint |
| AC-I08 | telafi plan completed | metrics recomputed | completion % **increases** | L2 | **FAIL** — no log written |
| AC-I09 | telafi plan completed | XP | awarded | L2 | **FAIL** |

---

## D · Security regression — `L2`, permanent

**These exist to stop a future migration silently reopening a closed exploit.**

| ID | Then | Layer | Now |
|---|---|---|---|
| AC-S01 | `authenticated` cannot EXECUTE `mock_activate_subscription` | L2 | **pass** — `20260802181931` |
| AC-S02 | `anon` cannot EXECUTE it | L2 | **pass** |
| AC-S03 | `anon`/`authenticated` cannot EXECUTE `add_xp` | L2 | **pass** — `20260802205850` |
| AC-S04 | …nor `track_weekly_xp` | L2 | **pass** |
| AC-S05 | …nor `deal_damage_to_active_boss` | L2 | **pass** |
| AC-S06 | `service_role` **can** still EXECUTE all four | L2 | **pass** |
| AC-S07 | habit completion still awards XP via trigger | L2 | **pass** — must stay passing |
| AC-S08 | user A cannot SELECT user B's `habit_logs` | L2 | pass |
| AC-S09 | …nor `journal_entries`, `notes`, `goals`, `tasks`, `profiles` | L2 | pass |
| AC-S10 | `authenticated` cannot UPDATE own `total_xp` | L2 | **FAIL** — SEC-1D-005 |
| AC-S11 | `authenticated` **can** update own `username` | L2 | pass — must stay |
| AC-S12 | `authenticated` cannot INSERT into `user_subscriptions` | L2 | pass (policy absence) |
| AC-S13 | client-supplied `xp` is overwritten by the trigger | L2 | **pass** |
| AC-S14 | concurrent AI calls cannot overspend credits | L2 | **FAIL** — TOCTOU |
| AC-S15 | a failed debit does **not** return the AI answer | L2 | **FAIL** — fail-open |
| AC-S16 | replayed webhook does not double-grant | L2 | **FAIL** — no idempotency |

**AC-S07 is the regression guard for the Emergency Gate 0 fixes.** The revoke was
proven safe because both live callers are `SECURITY DEFINER` owned by `postgres`;
this test keeps that true.

---

## E · Schema reproducibility — `L2`

| ID | Then | Now |
|---|---|---|
| AC-M01 | `supabase db reset` produces a schema the app runs against | **FAIL** — 41/48 tables missing |
| AC-M02 | every table the client uses exists after reset | **FAIL** |
| AC-M03 | every RPC the client calls exists after reset | **FAIL** — all 40 missing |
| AC-M04 | `supabase db diff` against live is empty | **FAIL** |
| AC-M05 | renamed columns match the client | **FAIL** — 5 renames |
| AC-M06 | `status='idea'` is accepted | **FAIL** — `001:20` CHECK rejects it |

---

## F · Deferred to L3 / L4

| ID | Case | Layer |
|---|---|---|
| AC-U01..10 | auth flows: register, login, reset, session restore, logout | L4 |
| AC-U11..18 | screen render, loading, empty, error states | L3 |
| AC-U19..24 | navigation reachability incl. command palette mount | L3 |
| AC-U25..30 | offline / network-failure behaviour | L4 |
| AC-U31..36 | Android + iOS device matrix | L4 |
| AC-U37..40 | a11y automation: labels, target size, contrast | L3 |

---

## Summary

| Block | Cases | Layer | Failing today |
|---|---|---|---|
| A dates | 10 | L1 | 7 |
| B scheduling/metrics | 10 | L1 (1×L2) | 7 |
| C integrity | 9 | L2 | 8 |
| D security | 16 | L2 | 4 (12 passing, must stay) |
| E schema | 6 | L2 | 6 |
| F deferred | 40 | L3/L4 | unknown |
| **Total** | **91** | | **32 known failing** |

### Phase 1E exit criterion

All of blocks **A, B, C, D, E** pass — 51 cases. Block F is Phase 2D/6A.

### The number that matters

**14 of the 32 known failures are `L1` — pure functions, no device, no database.**

This document previously said 20. That counted rows whose *layer* column read
`L1` — 20 of them — not rows that are both `L1` **and** failing. Six of the 20
already pass. The corrected figure is **14**, and the 14 are named individually
in `plan/09_PHASE_1B_EARLY_START.md` §2.

They can be written and fixed in a single focused pass, and they cover the
defect cluster with the widest blast radius (dates and metrics touch habits,
tasks, focus, journal, life areas, deep work and willpower simultaneously).
