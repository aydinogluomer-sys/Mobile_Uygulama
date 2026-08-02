# 01 — Test Strategy

**Status:** `Planned`
**Starting point:** zero executing tests

---

## 1. Honest starting position

`frontend/run-tests.js` is **not a test suite**. 351 lines of
`fs.readFileSync` + `.includes()` over source **text**. It imports zero
application modules. It asserts on Turkish UI copy (`:110` asserts the literal
string "Aktif alışkanlık yok"). It reads gitignored `.env` at `:144`, so it fails
on any clean clone or CI runner. It is wired to **no npm script**.

Current result **139/142**, with three long-standing failures. `todolist.md:11`
redefines success as "the count stays at 89/92" — the failures were normalised
rather than fixed.

**Not one of the 21 predicted failures in doc 06 would be caught**, because none
of that code is ever executed.

Treat the project as having **0 % behavioural test coverage**. The 26 % test
parity in doc 05 measures the text-matcher, not behaviour.

---

## 2. Two layers, and why one is not enough

| Layer | Tool | Runs against | Proves |
|---|---|---|---|
| **1 — Unit** | `jest-expo` | Node | pure logic in `lib/`, store reducers |
| **2 — Database** | `supabase start` + pgTAP | real Postgres | RLS, constraints, RPC behaviour, concurrency |

**Layer 1 cannot prove security or integrity.** A mocked Supabase client can
assert that `logStore` *called* upsert; it cannot prove Postgres *rejected* a
cross-tenant read, that `UNIQUE(habit_id, completed_at)` held under two
concurrent inserts, or that a willpower debit was atomic.

Adopting only Layer 1 would produce a green suite over an insecure database.
**Any claim about RLS or an RPC must rest on Layer 2.**

Later layers (component, E2E, visual, device matrix) are Phase 2D and 6A.

---

## 3. Layer 1 — what to test first

Roughly 860 lines of genuinely pure, immediately testable logic:

| Module | Lines | Priority | Why |
|---|---|---|---|
| `lib/habitSchedule.ts` | 41 | **P0** | `isDueOn` never reads `frequency_config.count` — X-per-week is due on no day |
| `lib/reportMetrics.ts` | 199 | **P0** | ignores `target_direction`; counts `miss`/`skip` as completed; never calls `isDueOn` |
| `lib/date.ts` *(new)* | — | **P0** | the canonical module Phase 1B creates |
| `lib/focusReport.ts` | 251 | **P1** | UTC/local key mismatch breaks the streak |
| `lib/journalStats.ts` | 63 | **P1** | same mismatch |
| `lib/ranks.ts` | 38 | **P1** | duplicates SQL `get_rank_for_level` — must assert parity |
| `lib/triage.ts` | 187 | P2 | pure, untested |
| `lib/todayNarrative.ts` | 80 | P2 | pure, untested |

### Write the failing test first

Every one of the 21 predicted failures in doc 06 becomes a test that **fails
today and passes after the Phase 1B fix**. That is the only way to prove the fix
worked rather than assert it.

### Determinism

`focusReport.rangeStart/inRange/buckets` already accept an injectable `now`
(`:31,46,88`) — good. But `focusReport.ranking` hardcodes `new Date()` at `:136`,
and `journalStats.computeJournalStats` at `:48,:54`. **Add a `now` parameter to
those three** as part of Phase 1B; half the pure layer is already testable and
the other half is not, for no reason.

### Timezone

Every date test runs under `TZ=Europe/Istanbul`, with explicit cases at
**00:30** and **23:30**. Türkiye is permanent UTC+3 with no DST, so a fixed
offset is sufficient and DST cases are not required.

---

## 4. Layer 2 — what only a real database can prove

| Area | Test |
|---|---|
| RLS isolation | user A cannot SELECT/UPDATE/DELETE user B's rows, per table |
| Anon lockout | `anon` reaches nothing owner-scoped |
| Habit-log uniqueness | two concurrent inserts for the same `(habit_id, completed_at)` → exactly one row |
| Willpower atomicity | two concurrent debits of 4 from 15 → `used = 8`, never 4 |
| Willpower rollover | a debit against yesterday's `state_date` does not corrupt today |
| Telafi linkage | completing a plan writes a `habit_log` and moves the metric |
| Recovery duplicates | two plans for the same `(habit_id, source_date)` → rejected |
| Emergency Gate 0 regression | `mock_activate_subscription`, `add_xp`, `track_weekly_xp`, `deal_damage_to_active_boss` are **not** executable by `anon`/`authenticated` |
| Profile column guard | `authenticated` cannot UPDATE `total_xp`/`level`/`coins` (after SEC-1D-005b) |
| XP trigger | `fn_habit_log_set_xp` overwrites a client-supplied `xp` |
| Migration reproducibility | `supabase db reset` yields a schema the app runs against |

**The Emergency Gate 0 regression tests matter most long-term.** Two migrations
now close real exploits; without a test, a future migration silently reopens them.

---

## 5. Scripts to add

`frontend/package.json` currently has **no `test` and no `typecheck` script**.

```json
"typecheck": "tsc --noEmit",
"test": "jest",
"test:unit": "jest --selectProjects unit",
"test:db": "supabase test db",
"test:all": "npm run typecheck && npm run test:unit && npm run test:db"
```

Keep `run-tests.js` temporarily as `test:smoke` — it does catch gross structural
regressions — but it is **not** counted as test coverage, and it must stop
reading `.env` (`:144`) so it survives a clean clone. Retire it once Layer 1
covers the same ground.

---

## 6. Coverage targets — behaviour, not lines

Line coverage is a poor proxy here; a 795-line screen with 100 % line coverage
proves little.

| Phase | Target |
|---|---|
| 1E | every P0/P1 module in §3 has tests; all Layer 2 cases in §4 pass |
| 2D | component-test foundation; CI runs typecheck + lint + Layer 1 |
| 6A | full E2E, device matrix, visual regression, a11y automation |

**Gate C rule:** a task is not complete until a test that would have caught its
defect exists and passes. For a bug fix, that test must have failed before.

---

## 7. What this strategy deliberately does not do

- **No E2E in Phase 1.** Tool choice is Phase 2D; there is no CI to run it in yet.
- **No snapshot tests.** They would freeze the 1,671 hex literals Phase 5 removes.
- **No coverage-percentage gate.** It would incentivise testing the 869-line settings screen over `reportMetrics.ts`.
- **No mocking of Postgres.** That is the failure mode this strategy exists to avoid.
