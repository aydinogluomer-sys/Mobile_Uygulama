# 04 — Agent Task Graph and File Ownership

**Status:** Gate B artefact · **ownership model rebuilt at round 2**
**Binding rule:** **every file has exactly one edit owner.** No exceptions, no shared files, no "raises the change" arrangements that leave two agents writing one path.

> **Why this document was rebuilt.** The round-2 reviewer found six files with two
> edit owners, two tasks whose scope violated their own agent's prohibition, and a
> `1C-004` row in the assignment table that still carried the ownership violation
> §1a claimed to have fixed. The failure mode was structural: this document stated
> a rule in one section and contradicted it in another. It is now generated from
> one source — the `scope` and `agent` fields in `01_IMPLEMENTATION_BACKLOG.md` —
> and there is exactly one assignment table.

---

## 1. The ownership model

| Agent | Owns — exclusively | **Never touches** |
|---|---|---|
| **Supabase & Security** | `supabase/migrations/**` · `supabase/functions/**` · `supabase/config.toml` · Supabase deploy guards | `frontend/**` |
| **Habit Domain** | `frontend/store/**` · `frontend/lib/**` (domain modules) | `supabase/**` · `frontend/app/**` |
| **Expo Architecture** | `frontend/app/**` · navigation and UI entry points · `frontend/components/Drawer.tsx` | `supabase/**` · `frontend/lib/**` · `frontend/store/**` |
| **QA & Test** | `frontend/__tests__/**` · `supabase/tests/**` · `frontend/jest.config.js` · `frontend/jest.setup.js` | **all production source** |
| **Repository Audit** | `frontend/package.json` · `.gitignore` · `metro.config.js` · `app.json` · CI workflow files | `supabase/**` (incl. config) · `frontend/app/**` · `frontend/lib/**` · `frontend/store/**` |
| **Open-Source Research** | `docs/research/**` · `.research/**` | `supabase/**` · `frontend/**` |
| **Skeptical Reviewer** | **nothing — read-only** | **everything.** Writes no file in any phase |
| Product & Feature Parity | *(inactive in Phase 1)* | — |
| Mobile Design System | *(inactive in Phase 1)* | — |

### Three rules that follow from the table

1. **Test files are always QA & Test's.** A domain or security task never edits a test. It carries a `test_contract` naming the QA task that owns the file and specifying what must be asserted. This is what resolved the six conflicts.
2. **Repository Audit may not edit a production or Supabase-config file.** `supabase/config.toml` is Supabase & Security's; `frontend/package.json` is Repository Audit's.
3. **The Skeptical Reviewer is never an edit owner.** Review ownership and edit ownership are different things; the reviewer produces a verdict, never a diff.

---

## 2. Verified — computed, not asserted

Regenerated from every task's `scope` and `agent` field in `plan/01`:

| Check | Result |
|---|---|
| Distinct files across all Phase 1 tasks | **70** |
| **Files with two different agents as edit owner** | **0** |
| **`never touches` violations** | **0** |
| Test files with an owner other than QA & Test | **0** |
| Reviewer-owned production files | **0** |
| Tasks whose scope exceeds 5 files | **0** |

**Four files are edited by more than one task of the same agent.** That is permitted — the rule is one *edit owner* per file, not one task — but each is explicitly serialised so two tasks never edit concurrently:

| File | Tasks | Serialisation |
|---|---|---|
| `frontend/store/willpowerStore.ts` | `1C-003` → `1C-002` | encoded in `depends_on`, not prose |
| `supabase/functions/generate-routine/index.ts` | `1D-000` → `1D-001` → `1D-002` → `1D-003` → `1D-004` | single chain; `1D-000` gates all (**R-19**) |
| `supabase/functions/notion-auth/index.ts` | `1D-005` → `1D-006` → `1D-007` | chained in `depends_on` |
| `supabase/functions/spotify-auth/index.ts` | `1D-005` → `1D-006` | chained in `depends_on` |

---

## 3. Phase 1 assignment — the single authoritative table

This is the **only** assignment table in this document. No summary elsewhere restates ownership.

| Task | Agent | Files | Reviewer |
|---|---|---|---|
| 1A-001 three-way diff | Supabase & Security | `docs/audit/10_…md` | Skeptical Reviewer |
| 1A-002 baseline migration | Supabase & Security | `migrations/<ts>_baseline_schema.sql` · `migrations/README.md` | Skeptical Reviewer |
| 1A-003 reset verification | Supabase & Security | `docs/audit/11_…md` | Skeptical Reviewer |
| 1B-001 date module | Habit Domain | `frontend/lib/date.ts` | Skeptical Reviewer |
| 1B-002 purge UTC/local | Habit Domain | 5 store/lib files | Skeptical Reviewer |
| 1B-003 `isDueOn` count | Habit Domain | `frontend/lib/habitSchedule.ts` | Skeptical Reviewer |
| 1B-004 metric formulas | Habit Domain | `frontend/lib/reportMetrics.ts` | Skeptical Reviewer |
| 1B-005 log error handling | Habit Domain | `frontend/store/logStore.ts` | Skeptical Reviewer |
| 1B-007 remaining stores | Habit Domain | 4 store files | Skeptical Reviewer |
| **1B-008 `app/**` dates** | **Expo Architecture** | 5 files under `frontend/app/**` | Skeptical Reviewer |
| 1C-001 willpower RPC | Supabase & Security | migration **only** | Skeptical Reviewer |
| 1C-002 activation guard | Habit Domain | `willpowerStore.ts` · `habitStore.ts` | Skeptical Reviewer |
| 1C-003 midnight rollover | Habit Domain | `willpowerStore.ts` | Skeptical Reviewer |
| **1C-004 telafi linkage** | **Supabase & Security** | **migration only — no client file** | Skeptical Reviewer |
| 1C-005 recovery unique | Supabase & Security | migration | Skeptical Reviewer |
| **1C-006 recovery client** | **Habit Domain** | **`frontend/store/recoveryStore.ts`** | Skeptical Reviewer |
| 1D-000 reconcile generate-routine | Supabase & Security | `supabase/functions/**` | Skeptical Reviewer |
| 1D-001..008 edge-fn security | Supabase & Security | `supabase/functions/**` | Skeptical Reviewer |
| **1D-009 deploy guard** | **Supabase & Security** | `supabase/config.toml` · `supabase/predeploy_guard.sh` | Skeptical Reviewer |
| SEC-1D-001..004 | Supabase & Security | migrations **only** | Skeptical Reviewer |
| SEC-1D-005a/b/c/f | Supabase & Security | migrations, docs | Skeptical Reviewer |
| SEC-1D-005d profile client | Habit Domain | `frontend/store/profileStore.ts` | Skeptical Reviewer |
| SEC-1D-005e profiles tests | QA & Test | `supabase/tests/profiles.test.sql` | Skeptical Reviewer |
| 1E-000 licence clearance | Open-Source Research | `docs/research/04_…md` | Skeptical Reviewer |
| **OPS-1E-001 npm scripts** | **Repository Audit** | `frontend/package.json` | Skeptical Reviewer |
| 1E-L1 jest harness | QA & Test | `jest.config.js` · `jest.setup.js` | Skeptical Reviewer |
| 1E-L1a L1 date/schedule tests | QA & Test | 2 `__tests__` files | Skeptical Reviewer |
| 1E-L1b L1 metric/store tests | QA & Test | 2 `__tests__` files | Skeptical Reviewer |
| 1E-L2 pgTAP harness | QA & Test | `rls.test.sql` · `constraints.test.sql` | Skeptical Reviewer |
| 1E-L2a willpower/recovery tests | QA & Test | 2 `supabase/tests` files | Skeptical Reviewer |
| 1E-L2b security regression | QA & Test | 3 `supabase/tests` files | Skeptical Reviewer |
| **DEMO-001A seeder library** | **Habit Domain** | `frontend/lib/demoSeed.ts` · audit doc | Skeptical Reviewer |
| **DEMO-001B seeder UI** | **Expo Architecture** | `frontend/app/tabs/settings.tsx` | Skeptical Reviewer |
| OPS-0B-001 relocate env | Supabase & Security | `backend/.env.local` (moved out) | Skeptical Reviewer |

---

## 4. The three violations fixed at round 2

| # | Was | **Now** |
|---|---|---|
| **B1** | 6 files with two edit owners — `willpower.test.sql`, `recovery.test.sql`, and 4 `__tests__` files claimed both by a domain/security task and by `1E-L1`/`1E-L2`'s globs | Test files removed from every domain/security scope; `1E-L1`/`1E-L2` split into 6 tasks with **explicit file lists, no globs**. `package.json` moved to `OPS-1E-001` (Repository Audit) |
| **B2** | `§3` still read `1C-004 · Supabase & Security · migration + frontend/store/recoveryStore.ts`, contradicting `§1a` | `1C-004` is **migration only** in `plan/01` and in the single table above. `1C-006` (Habit Domain) owns the client file. There is now only one assignment table, so the two cannot disagree |
| **B3** | `1D-009` = Repository Audit → `supabase/config.toml`; `DEMO-001` = Habit Domain → `frontend/app/tabs/settings.tsx` | `1D-009` → **Supabase & Security**. `DEMO-001` split into `DEMO-001A` (Habit Domain, library) and `DEMO-001B` (**Expo Architecture**, UI) |

---

## 5. Review rules

1. **The Skeptical Reviewer writes nothing.** Read-only, always, in every phase.
2. **No agent reviews its own diff.** Where the reviewer is unavailable the task waits; it never self-approves.
3. **Every security change gets a pre-change review**, not only post-change. The first Emergency Gate 0 fix was applied without one; that is recorded as a process failure in `docs/audit/08 §4`.
4. **The reviewer's job is to disagree.** Demonstrated across three rounds: it corrected the rollback SQL, corrected a caller count from five to two, found the XP functions were `anon`-callable, found the six ownership conflicts above, and found `willpower_state` missing from the demo-seed table list. A reviewer that only agrees is not working.
5. **Reviewer prohibitions are absolute:** never invoke a privileged function to test it · never run a write · never touch `zdqiujpeewtyhtcqhdcj`.

---

## 6. Parallel execution map — Phase 1

```
Supabase & Security ── 1A-001 → 1A-002 → 1A-003 ─┬→ 1C-001, 1C-004, 1C-005
                                                  ├→ SEC-1D-001..005
                                                  └→ 1D-008
                       1D-000 ──→ 1D-001 → 1D-002 → 1D-003 → 1D-004
                                   (all also need 1A-002; R-19 gate.
                                    One file, one chain — no parallel edits)
                       1D-005 → 1D-006 → 1D-007   (serialised: shared files)
                       1D-009                      (no dependency)

Habit Domain        ── 1B-001 →┬→ 1B-002
                               ├→ 1B-007
                               └→ 1C-003 → 1C-002
                       1B-003 → 1B-004
                       1B-005              (no dependency)
                       DEMO-001A           (no dependency) ──┐
                       1C-006              (waits on 1C-004, 1C-005)

Expo Architecture   ── 1B-008              (waits on 1B-001)
                       DEMO-001B ◄────────────────────────────┘ (source guard first)

QA & Test           ── (waits 1E-000 + OPS-1E-001) → 1E-L1 →┬→ 1E-L1a
                                                             └→ 1E-L1b
                       (waits 1A-003 + 1E-000 + H-13) → 1E-L2 →┬→ 1E-L2a
                                                                └→ 1E-L2b
Repository Audit    ── OPS-1E-001          (no dependency)
Open-Source Research ─ 1E-000              (no dependency)

Skeptical Reviewer  ── continuous, read-only, on every diff
```

**Five agents are productive from day one.** Nothing in the Habit Domain, Expo Architecture, Repository Audit or Open-Source Research lanes depends on the H-01 schema decision.

---

## 7. Agent activation in Phase 1

| Agent | State | Scope |
|---|---|---|
| Supabase & Security | **active** | migrations, edge functions, `supabase/config.toml` |
| Habit Domain | **active** | `frontend/lib/**`, `frontend/store/**` |
| QA & Test | **active** | all test files, jest config |
| **Expo Architecture** | **active — two tasks** | `1B-008` (5 files) and `DEMO-001B` (1 file). No routing or reachability work; that stays Phase 2A |
| **Repository Audit** | **active — one task** | `OPS-1E-001` (`package.json`) |
| **Open-Source Research** | **active — one task** | `1E-000` licence clearance |
| Product & Feature Parity | inactive | REF implementation is Phase 3 |
| Mobile Design System | inactive | blocked on Reanimated (2B) |
| Skeptical Reviewer | **active, read-only** | reviews every diff; **owns no file** |

### Files with no Phase 1 owner — stated explicitly

| Path | Note |
|---|---|
| `frontend/app/**` beyond the 6 files in `1B-008` + `DEMO-001B` | deliberate — the remaining 5 date sites are `1B-009`, deferred to Phase 2A |
| `frontend/components/**` | no Phase 1 task touches components |
| `frontend/lib/tokens.ts`, `theme.ts` | frozen in Phase 1 |
| `backend/**` | except `OPS-0B-001`, which only moves files out |

Naming the unowned paths prevents the failure the reviewer found in round 1: a phase passing its exit criteria while a user-visible defect survives in a file nobody was allowed to touch.

---

## 8. Escalation

| Situation | Action |
|---|---|
| Two tasks need the same file | Stop. Serialise via `depends_on`. Never edit concurrently, never split ownership. |
| A task needs a file outside its agent's tree | Split the task. Never widen the agent's ownership. |
| An agent finds a defect outside its ownership | Report it into the backlog; do not fix it. |
| A reviewer returns FAIL | The task does not land. No override. |
| A P0 is found mid-phase | Emergency Gate 0 criteria apply — all five, including independent review **before** applying. |
| A task turns out to be XL | Stop and split before continuing. |
