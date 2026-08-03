# 04 — Agent Task Graph and File Ownership

**Status:** Gate B artefact
**Rule:** no two agents own the same file in the same phase. A reviewer never reviews its own diff.

---

## 1. Agents

| Agent | Domain | Owns | Never touches |
|---|---|---|---|
| **Repository Audit** | git hygiene, build config, dependencies | `.gitignore`, `package.json`, `metro.config.js`, `app.json`, `frontend/scripts/**` | `supabase/**`, `frontend/app/**` |
| **Supabase & Security** | schema, RLS, RPCs, edge functions | `supabase/migrations/**`, `supabase/functions/**` | `frontend/**` |
| **Habit Domain** | scheduling, metrics, streaks, willpower, dates | `frontend/lib/**`, `frontend/store/**` | `frontend/app/**`, `supabase/**` |
| **Expo Architecture** | routing, navigation, reachability | `frontend/app/**/_layout.tsx`, `frontend/app/index.tsx`, `frontend/components/Drawer.tsx` | `frontend/lib/**`, `supabase/**` |
| **Product & Feature Parity** | REF implementation | `frontend/app/screens/**`, `frontend/app/tabs/**` | `frontend/lib/**`, `supabase/**` |
| **Mobile Design System** | tokens, primitives, a11y, motion | `frontend/components/ui/**`, `frontend/lib/tokens.ts`, `frontend/lib/theme.ts` | `frontend/store/**`, `supabase/**` |
| **QA & Test** | both test layers, CI | `frontend/__tests__/**`, `supabase/tests/**`, `jest.config.*`, CI config | production source |
| **Open-Source Research** | OSS evaluation, licences | `.research/**`, `docs/research/**` | all production source |
| **Skeptical Reviewer** | independent review | **nothing** — read-only | everything (writes nothing) |

---

## 1a. Corrections applied at Gate B remediation (C7, C9)

The Gate B reviewer found this document contradicted itself. All four issues are
fixed here.

| Issue | Was | **Now** |
|---|---|---|
| **Ownership violation** | `1C-004` assigned Supabase & Security to `frontend/store/recoveryStore.ts`, which `§1` forbids | **`1C-004` is migration-only.** The client half is **`1C-006`**, owned by Habit Domain |
| **No `frontend/app/**` owner in Phase 1** | every agent owning it was marked inactive, yet 10 UTC date sites live there | **Expo Architecture is activated for `1B-008` only**, scoped to 5 named files |
| **R1 had no owner or task** | Gate A flagged the stale `generate-routine` as production-regressing, while `1D-001..004` would redeploy it | **`1D-000`**, Supabase & Security, **must land before any 1D deploy** |
| **Concurrent edits to one file** | `1C-002` and `1C-003` both touch `willpowerStore.ts` and were drawn as parallel | **serialised**: `1C-003` → `1C-002` |

### Review ownership is separate from edit ownership

| Kind | Who | Writes files? |
|---|---|---|
| **Edit ownership** | the agent named in the task | yes — exclusively |
| **Review ownership** | Skeptical Reviewer | **never** |

**The Skeptical Reviewer owns no production file, in any phase.** It has
read-only access and produces a verdict, never a diff. This is now stated as a
rule rather than left implicit.

---

## 2. Ownership conflicts and how they are resolved

Four genuine overlaps exist. Each is resolved by sequencing or by splitting the
task, never by shared ownership.

### Conflict 0 — `frontend/store/recoveryStore.ts` *(found by the Gate B reviewer)*

`1C-004` needed both a migration and a client change. Supabase & Security may not
touch `frontend/**`.

**Resolution:** split. `1C-004` is the migration (Supabase & Security);
**`1C-006`** is the client adaptation (Habit Domain), depending on it.

### Conflict 1 — `frontend/store/**`

Habit Domain owns it in Phase 1 (dates, metrics, willpower). Mobile Design System
would need it in Phase 5 for theming.

**Resolution:** Design System never edits stores. If a store must expose
something for theming, Habit Domain makes that change on request. Phase 5 touches
`components/**` and `lib/tokens.ts` only.

### Conflict 2 — `frontend/lib/tokens.ts`

Design System owns it. Habit Domain would touch it only incidentally.

**Resolution:** exclusive to Design System from Phase 5 onward. In Phase 1 it is
frozen — no task requires it.

### Conflict 3 — `supabase/functions/generate-routine/**`

Supabase & Security hardens it in 1D; it is also the file Phase 2C retires the
`backend/` counterpart of.

**Resolution:** single owner (Supabase & Security) across both phases. 2C is a
deletion in a *different* directory (`backend/supabase/**`), so no conflict in
practice.

---

## 3. Phase 1 assignment

| Task | Agent | Files | Reviewer |
|---|---|---|---|
| 1A-001 three-way diff | Supabase & Security | *(analysis only)* | Skeptical Reviewer |
| 1A-002 baseline migration | Supabase & Security | `supabase/migrations/<new>.sql` | Skeptical Reviewer |
| 1A-003 `db reset` verification | Supabase & Security | — | QA & Test |
| 1B-001 `lib/date.ts` | Habit Domain | `frontend/lib/date.ts` | Skeptical Reviewer |
| 1B-002 purge UTC/local | Habit Domain | `taskStore`, `deepWorkStore`, `lifeAreasStore`, `focusReport`, `journalStats` | Skeptical Reviewer |
| 1B-003 `isDueOn` count | Habit Domain | `frontend/lib/habitSchedule.ts` | Skeptical Reviewer |
| 1B-004 metrics correctness | Habit Domain | `frontend/lib/reportMetrics.ts` | Skeptical Reviewer |
| 1B-005 log error handling | Habit Domain | `frontend/store/logStore.ts` | Skeptical Reviewer |
| 1C-001 willpower RPC | Supabase & Security | `supabase/migrations/<new>.sql` | Skeptical Reviewer |
| 1C-002 activation guard | Habit Domain | `frontend/store/{willpowerStore,habitStore}.ts` | Skeptical Reviewer |
| 1C-003 midnight rollover | Habit Domain | `frontend/store/willpowerStore.ts` | Skeptical Reviewer |
| 1C-004 telafi linkage | Supabase & Security | migration + `frontend/store/recoveryStore.ts` | Skeptical Reviewer |
| 1C-005 recovery unique | Supabase & Security | migration | Skeptical Reviewer |
| 1D-001..009 edge-fn security | Supabase & Security | `supabase/functions/**` | Skeptical Reviewer |
| SEC-1D-001..003 XP bodies | Supabase & Security | migrations | Skeptical Reviewer |
| SEC-1D-004 money grants | Supabase & Security | migration | Skeptical Reviewer |
| SEC-1D-005a..f profiles | Supabase & Security + Habit Domain (005d) | migration + `profileStore.ts` | Skeptical Reviewer |
| 1E-L1 unit tests | QA & Test | `frontend/__tests__/**`, `jest.config.js`, `package.json` | Skeptical Reviewer |
| 1E-L2 database tests | QA & Test | `supabase/tests/**` | Skeptical Reviewer |

**`package.json` is owned by Repository Audit** but 1E-L1 must add `test` and
`typecheck` scripts. Resolution: QA & Test raises the change; Repository Audit
applies it. One file, one owner.

---

## 4. Review rules

1. **The Skeptical Reviewer writes nothing.** Read-only, always.
2. **No agent reviews its own diff.** Where the reviewer is unavailable, the task waits — it does not self-approve.
3. **Every security change gets a pre-change review**, not only post-change. Established the hard way: the first Emergency Gate 0 fix was applied without one and that is recorded as a process failure (doc 08 §4).
4. **The reviewer's job is to disagree.** Its value has been demonstrated: it corrected the rollback SQL, corrected a caller count from five to two, established the revoke did not close self-inflation, and found the XP functions were `anon`-callable. A reviewer that only agrees is not working.
5. **Reviewer prohibitions** are absolute: never invoke a privileged function to test it; never run a write; never touch an out-of-scope project.

---

## 5. Parallel execution map — Phase 1

```
Supabase & Security  ──  1A-001 → 1A-002 → 1A-003 → 1C-001,004,005 → 1D-001..004,008 → SEC-1D-*
                                                 ╲
                                                  ── 1D-005..007,009 (no dependency)

Habit Domain         ──  1B-001 → 1B-002 ─┐
                         1B-003 → 1B-004 ─┼→ 1C-002, 1C-003
                         1B-005 ──────────┘

QA & Test            ──  (waits on 1B-001) → 1E-L1
                         (waits on 1A-003) → 1E-L2

Skeptical Reviewer   ──  continuous, on every diff
```

Two agents run productively from day one. QA joins on day two. Nothing in the
Habit Domain lane depends on the schema decision.

---

## 6. Agent activation in Phase 1 — corrected

| Agent | Phase 1 state | Scope if active |
|---|---|---|
| Supabase & Security | **active** | migrations, edge functions, RPCs |
| Habit Domain | **active** | `frontend/lib/**`, `frontend/store/**` |
| QA & Test | **active** | `frontend/__tests__/**`, `supabase/tests/**`, jest config |
| Repository Audit | **active — one task** | `1D-009` deploy guard; `package.json` script additions |
| **Expo Architecture** | **active — one task** *(C9)* | **`1B-008` only** — 5 named files under `frontend/app/**`. No routing or reachability work; that stays Phase 2A |
| **Open-Source Research** | **active — one task** *(C6)* | **`1E-000` only** — clearance for `jest-expo`, `supabase/cli`, `pgTAP`. No other adoption |
| Product & Feature Parity | inactive | REF implementation is Phase 3 |
| Mobile Design System | inactive | blocked on Reanimated (2B) |
| Skeptical Reviewer | **active, read-only** | reviews every diff; **owns no file** |

Two agents were previously marked inactive while Phase 1 nonetheless required
work only they could legitimately do. Both are now activated with a **single
named task each**, which keeps the anti-scope-creep intent while removing the
deadlock.

### Files with no Phase 1 owner — stated explicitly

| Path | Phase 1 owner | Note |
|---|---|---|
| `frontend/app/**` except the 5 files in `1B-008` | **none** | deliberate — remaining 5 date sites are `1B-009`, deferred to Phase 2A with the `hub.tsx` orphan work |
| `frontend/components/**` | **none** | no Phase 1 task touches components |
| `frontend/lib/tokens.ts`, `theme.ts` | **none** | frozen in Phase 1 |
| `backend/**` | **none** | except `OPS-0B-001`, which only moves files out |

Naming the unowned paths prevents the failure the reviewer found: a phase
passing its exit criteria while a user-visible defect survives in a file nobody
was allowed to touch.

---

## 7. Escalation

| Situation | Action |
|---|---|
| Two tasks need the same file | Stop. Re-sequence. Never edit concurrently. |
| An agent finds a defect outside its ownership | Report it into the backlog; do not fix it. |
| A reviewer returns FAIL | Task does not land. No override. |
| A P0 is found mid-phase | Emergency Gate 0 criteria apply — all five, including independent review **before** applying. |
| A task turns out to be XL | Stop and split before continuing. |
