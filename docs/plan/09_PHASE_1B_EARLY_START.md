# 09 — Phase 1B Early-Start Rationale (rebuilt)

**Status:** Gate B remediation **C3**
**Supersedes:** every prior statement based on "20 of 32 failing criteria are Layer 1"

---

## 1. The withdrawn argument

Previous documents argued that Phase 1B could start ahead of the H-01 schema
decision because **"20 of the 32 known failing criteria are Layer 1 — no device,
no database."**

**That figure was wrong.** It counted rows whose layer column read `L1` (20 of
them), not rows that are both `L1` **and** failing. Six of the twenty already
pass.

**The correct figure is 14.** The argument is rebuilt below from that number. It
still holds — but for a slightly different reason than originally claimed, and
the difference matters.

---

## 2. The 14 failing Layer 1 criteria, named

| # | ID | What fails today | Task that fixes it |
|---|---|---|---|
| 1 | AC-D01 | habit completed 00:30 attributed to yesterday | 1B-002 |
| 2 | AC-D03 | `taskStore.dueToday()` returns yesterday at 01:00 | 1B-002 |
| 3 | AC-D04 | `taskStore.overdue()` drops yesterday's overdue task | 1B-002 |
| 4 | AC-D05 | focus streak breaks on a 01:30 session | 1B-002 |
| 5 | AC-D06 | journal streak drops a late-night entry | 1B-002 |
| 6 | AC-D07 | life-area save at 01:00 overwrites yesterday | 1B-002 |
| 7 | AC-D08 | Sunday 22:00 deep-work lands in the wrong week | 1B-002 |
| 8 | AC-H03 | "X times per week" habit is due on no day of the year | 1B-003 |
| 9 | AC-H04 | Mon/Wed/Fri habit capped at 43 % | 1B-004 |
| 10 | AC-H05 | `at_most` habit scores higher for worse values | 1B-004 |
| 11 | AC-H06 | `at_most` at the limit scores as success | 1B-004 |
| 12 | AC-H07 | `state:'miss'` counted as a completed day | 1B-004 |
| 13 | AC-H08 | `state:'skip'` counted as a completed day | 1B-004 |
| 14 | AC-H09 | pausing a habit today mutates last month's report | 1B-004 |

**Coverage: three tasks — `1B-002` (7), `1B-003` (1), `1B-004` (6).**

---

## 3. Which of those are independent of the schema decision

| Task | Needs a migration? | Evidence |
|---|---|---|
| **1B-001** date module | **No** | New pure module; no schema surface |
| **1B-002** purge UTC/local | **No** | Reads/writes existing columns only |
| **1B-003** `frequency_config.count` | **No** | `frequency_config` is live JSONB; `count` already permitted by the type |
| **1B-004** metric correctness | **No** | `target_direction` and `state` both exist live |
| **1B-005** log error handling | **No** | Relies on `UNIQUE (habit_id, completed_at)`, **verified present** |

**All five are independent of H-01.** So are the 14 criteria above.

### Depends on the schema decision

| Task | Why |
|---|---|
| 1C-001 willpower RPC | new function → migration |
| 1C-004 telafi linkage | new trigger → migration |
| 1C-005 recovery unique | new constraint → migration |
| 1D-001/003/008 | new tables → migration |
| SEC-1D-* | function bodies → migration |
| 1E-L2 | needs a reproducible database |

### Not schema-dependent but differently owned

| Task | Owner | Note |
|---|---|---|
| 1B-007 remaining store files | Habit Domain | 11 further `toISOString()` sites |
| **1B-008** `frontend/app/**` | **Expo Architecture** | **5 sites** — the 5 highest-impact screens. **Without this, `today.tsx` still shows the wrong day at 00:30 even after 1B "passes"**. The other 5 sites are `1B-009`, deferred to Phase 2A (`plan/05` D-17) |
| **DEMO-001A** seeder library guard | Habit Domain | independent |
| **DEMO-001B** seeder UI removal | **Expo Architecture** | **depends on `DEMO-001A`** — source guard lands first |
| 1D-000, 1D-009 | Supabase & Security | independent of schema |
| 1D-005 → 1D-006 → 1D-007 | Supabase & Security | independent of schema; **serialised**, shared files |
| OPS-1E-001 npm scripts | Repository Audit | independent |
| 1E-000 licence clearance | Open-Source Research | independent |

---

## 4. The rebuilt argument

**Original claim:** "20 of 32 failing criteria close without the schema decision."
**Corrected claim:** **14 of 32** close without it — **44 %, not 63 %.**

That is materially weaker, and worth stating rather than glossing. But the
argument to start 1B early holds, for three reasons that do not depend on the
count:

1. **The 14 are the widest-blast-radius defects in the product.** They span habits, tasks, focus, journal, life areas and deep work — six subsystems — and every downstream metric is computed from them. Fixing metrics *after* building on wrong ones multiplies the correction cost.
2. **They need no device, no database and no user decision.** They are pure functions with an injectable clock. The only prerequisite is `1E-000` (licence clearance) plus `1B-001`.
3. **1B shares no file with the 1A lane** (`04 §5`), so it costs nothing and blocks nothing. H-01 is now answered, so 1A is unblocked too — but **H-13 (Docker) gates 1A's *completion***: `1A-002` Stage A/B validation and all of `1A-003` need a running local stack. 1B needs neither.

**What the corrected number changes:** it no longer supports the claim that Phase 1
is "mostly closable" without the schema decision. **18 of 32 failing criteria —
the majority — do require it.** That decision is **now made** (H-01 closed:
Option A, post-revoke), so those 18 are unblocked in principle — but they are
largely Layer 2, so **H-13 (Docker) is now the binding constraint**, not H-01.

---

## 5. Test-first is mandatory, not advisory

Risk **R-01** is that these 14 are *predicted* failures, diagnosed by reading code,
**not observed**. No device run and no executing test has confirmed a single one.

**Therefore, for every one of the 14:**

1. Write the test **first**, against unmodified code.
2. **Confirm it fails**, and that it fails for the diagnosed reason.
3. Only then apply the fix.
4. Confirm it passes.

**If a test does not fail, the diagnosis was wrong.** That is a finding, not a
nuisance — stop and re-diagnose rather than adjusting the test until it agrees
with the fix.

This is the only mechanism that converts 23 predicted failures into evidence.
Without it, Phase 1 could "fix" defects that never existed while the real ones
survive.

---

## 6. Recommended start order

| Order | Task | Gate |
|---|---|---|
| 1 | `1E-000` licence clearance | unblocks writing any test |
| 2 | `1B-001` date module + its tests | foundation |
| 3 | Write the 14 failing tests | **must fail first** |
| 4 | `1B-003`, `1B-004` | closes 7 |
| 5 | `1B-002` | closes 7 |
| 6 | `1B-005`, `1B-007` | error handling, remaining stores |
| 7 | `1B-008` | `app/**` — different owner, can run in parallel from step 2 |

`1A-001` (three-way diff) runs alongside from step 1: it is read-only analysis
and needs no local stack. `1A-002` can be **authored** immediately (H-01 is
answered) but cannot be **completed** without H-13, because its Stage A and
Stage B validation both require a running local database.
