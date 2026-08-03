# 02 — Dependency Graph

**Status:** Gate B artefact
**Purpose:** establish what genuinely blocks what, so Phase 1 is sequenced by dependency rather than by severity

---

## 1. The critical path

```
                    ┌─────────────────────────────┐
                    │ 1A · Schema reconciliation  │  ← ROOT
                    │   three-way diff → baseline │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │ 1E-L2 · pgTAP    │  │ 1C · Willpower   │  │ 1D · Edge fn     │
   │ database tests   │  │  + telafi (RPC)  │  │  security        │
   └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
            │                     │                     │
            │  ┌──────────────────┴─────────────────────┘
            │  │
            ▼  ▼
   ┌─────────────────────────────────────────┐
   │ Gate C · Phase 1 exit                   │
   └─────────────────────────────────────────┘
            ▲  ▲
            │  │
   ┌────────┴──┴───────┐   ┌──────────────────┐
   │ 1E-L1 · jest-expo │◄──│ 1B · date module │  ← independent root
   └───────────────────┘   │   + metrics      │
                           └──────────────────┘
```

**Two independent roots:**

- **1A (schema)** blocks everything requiring a reproducible database — Layer 2 tests, the willpower RPC, and any migration.
- **1B (dates + metrics)** blocks nothing structurally. It is pure TypeScript and can start immediately, in parallel, by a different agent.

That parallelism matters: 1A involves a decision (§3) that may need discussion,
while 1B is 14 failing tests that can be written today.

---

## 2. Task-level dependencies

| Task | Depends on | Blocks | Can start |
|---|---|---|---|
| **1A-001** three-way schema diff | Gate B PASS | everything DB-side | immediately |
| **1A-002** reconciliation migration | 1A-001 + user decision | 1E-L2, 1C, 1D | after decision |
| **1A-003** `supabase db reset` verification | 1A-002 | 1E-L2 | — |
| **1B-001** `lib/date.ts` | Gate B PASS | 1B-002..004 | **immediately, parallel to 1A** |
| **1B-002** purge UTC/local mixing (5 store/lib sites) | 1B-001 | 1E-L1a date tests | — |
| **1B-003** `isDueOn` + `frequency_config.count` | Gate B PASS | 1B-004 | immediately |
| **1B-004** metrics: `target_direction`, `miss`/`skip`, `isDueOn` wiring | 1B-003 | — | — |
| **1B-005** habit-log error handling + upsert | Gate B PASS | — | immediately |
| **1C-001** atomic willpower debit RPC | 1A-002 | 1C-002 | after 1A-002 |
| **1C-002** activation TOCTOU + refund guard | 1C-001, **1C-003** | — | — |
| **1C-003** midnight rollover | 1B-001 | **1C-002** | after 1B-001 |
| **1C-004** telafi → `habit_log` + XP | 1A-002 | — | after 1A-002 |
| **1C-005** `recovery_plans` unique constraint | 1A-002 | — | after 1A-002 |
| **1D-000** reconcile generate-routine with live v11 | Gate B PASS | **1D-001..004** | immediately |
| **1D-001** rate limit | 1A-002, **1D-000** | 1D-002 | after 1A-002 **and 1D-000** (R-19) |
| **1D-002** cooldown | 1D-001 | 1D-003 | — |
| **1D-003** atomic credit debit | 1A-002, **1D-000**, **1D-002** | 1D-004 | — |
| **1D-004** fail-closed credits | 1D-003 | — | — |

> All five edit `generate-routine/index.ts`. They form **one chain**, not two
> branches — `1D-001`/`1D-003` and `1D-002`/`1D-004` were previously unordered
> relative to each other, which would have permitted concurrent edits to one file.
| **1D-005** OAuth `state` verification | Gate B PASS | **1D-006** | immediately |
| **1D-006** redirect-URI allowlist | **1D-005** | **1D-007** | after 1D-005 |
| **1D-007** Notion callback auth | **1D-006** | — | after 1D-006 |
| **1D-008** webhook idempotency | 1A-002 | — | after 1A-002 |
| **1D-009** wrong-project deploy guard | Gate B PASS | — | immediately |
| **1D-010** `__DEV__` paywall guard | — | — | **DONE** (`42b64a0`) |
| **1E-000** licence clearance | Gate B PASS | 1E-L1, 1E-L2 | immediately |
| **OPS-1E-001** npm test/typecheck scripts | Gate B PASS | 1E-L1 | immediately |
| **1E-L1** jest-expo harness | **1E-000, OPS-1E-001** | 1E-L1a, 1E-L1b | after both |
| **1E-L1a / 1E-L1b** L1 tests | 1E-L1 | Gate C | after 1E-L1 |
| **1E-L2** pgTAP harness | 1A-003, **1E-000**, **H-13 Docker** | 1E-L2a, 1E-L2b | after all three |
| **1E-L2a / 1E-L2b** L2 tests | 1E-L2 | Gate C | after 1E-L2 |
| **SEC-1D-001..003** XP function body hardening | 1A-002 | — | after 1A-002 |
| **SEC-1D-004** money-table grants | 1A-002 | — | after 1A-002 |
| **SEC-1D-005a..f** profiles column grants | 1A-002 | — | after 1A-002 |
| **1A-004** live ledger cutover | 1A-003, **H-14 approval** | — | **not executed in Phase 1** |
| **1B-007** remaining store date sites | 1B-001 | — | after 1B-001 |
| **1B-008** `app/**` date sites (Expo Arch) | 1B-001 | — | after 1B-001 |
| **1C-006** recovery store client | 1C-004, 1C-005 | — | after both |
| **DEMO-001A** seeder library guard | Gate B PASS | **DEMO-001B** | immediately |
| **DEMO-001B** seeder UI removal (Expo Arch) | **DEMO-001A** | — | after DEMO-001A — source guard lands first |
| **OPS-0B-001** relocate foreign env | **H-03 user approval** | — | blocked on user |

---

## 3. The decision that gates the critical path

**H-01 is ANSWERED — Option A, post-revoke posture.** `1A-002` is unblocked.
The two options are retained below as the decision record, **not** as an open
question:

### Option A — Squashed baseline *(recommended)*

Generate one migration representing the current live schema; archive
`001_initial_schema.sql` and `002_integrations.sql` as historical.

- **For:** fastest route to a working `db reset`; no attempt to reconstruct 19 migrations nobody has; matches how the schema actually came to exist.
- **Against:** loses per-change history — but that history is *already* lost, since 19 of 21 ledger entries have no repository counterpart.

### Option B — Incremental reconciliation

Write ~19 migrations reconstructing each live ledger entry.

- **For:** preserves a linear history.
- **Against:** **the history would be fabricated.** Nobody has the original SQL. Reconstructing it from the current end-state produces migrations that *look* authoritative while being invented. Also 19× the work with 19× the drift risk.

**Recommendation: Option A.** Option B manufactures evidence, which this audit
has consistently refused to do. Doc 07 §8 already documents the drift for the
record; the migration files do not also need to pretend to it.

**This decision is the user's and is listed in §6 of the Gate B report.**

---

## 4. What can run fully in parallel

Three independent streams, no shared files:

| Stream | Tasks | Agent | Files touched |
|---|---|---|---|
| **Schema** | 1A-001..003 | Supabase & Security | `supabase/migrations/**` |
| **Domain** | 1B-001..005, 1C-003 | Habit Domain | `frontend/lib/**`, `frontend/store/**` |
| **Edge-fn (partial)** | 1D-005..007, 1D-009 | Supabase & Security | `supabase/functions/**` |

The Schema and Edge-fn streams share an agent but not a file, so they serialise
by capacity, not by dependency. The Domain stream shares nothing and can run
alongside from day one.

**Practical consequence:** Phase 1 does not have to wait on the §3 decision to
begin. 1B alone is **14 of the 32** known failing acceptance criteria — enough
to start productively, but **not** a majority. The other 18 do require the
schema decision — which is now **answered** (H-01 closed: Option A, post-revoke),
so that path is open.

---

## 5. Cross-phase dependencies

| Later work | Blocked by | Why |
|---|---|---|
| 2A `CommandPalette` mount | — | independent; could be done any time |
| 2A retire `utils/api.ts` | product decision on bad-habits/webhooks/export | those features need a backend or removal |
| 2B Reanimated 3→4 | — | **but blocks all Phase 5 motion work** |
| 2C retire `backend/supabase/` | 1D re-implementations landing first | `google-auth`/`notion-sync` exist only there |
| 3 REF parity | 2A/2B | building on a stale router and dead navigation compounds the problem |
| 4A monthly-review persistence | 1A-002 | needs a stable schema |
| 5 design system | 2B (Reanimated) | motion built on the legacy line is thrown away |
| 6B CI | 1E both layers | nothing to run otherwise |
| 6E store submission | app icon fix, EAS config, licence screen | store blockers |
| 7 history rewrite | explicit approval | independent of everything else |
| 8A OSS adoption | licence gate (read at pinned commit) | doc research/02 |

---

## 6. Deadlocks and near-deadlocks found

| Risk | Resolution |
|---|---|
| **Gate A ⇄ Gate B cycle** | **Was real.** Gate B artefacts were counted in Gate A's denominator, so neither could close. Resolved by fixing the denominator to 19. |
| 2C retires the tree that 1D needs to copy from | 1D **re-implements** rather than relocates; 2C only retires afterwards |
| 1E-L2 needs a reproducible DB; 1A needs tests to prove it worked | Broken by ordering: 1A-003 verifies with `db reset` + a manual smoke check; L2 tests then codify it |
| Phase 5 motion vs Reanimated upgrade | Explicit: no motion work before 2B |
| OPS-0B-001 blocked on the user | Does not block anything else — isolated |

---

## 7. Shortest path to a green Phase 1

Assuming the §3 decision arrives promptly:

```
day 1   1B-001, 1B-003              ║  1A-001 (three-way diff)
day 1   1E-000, OPS-1E-001          ║  1D-000 (reconcile generate-routine)
day 1   DEMO-001A → DEMO-001B       ║  1D-005 (OAuth state)
day 2   1B-002, 1B-004, 1B-005      ║  (H-01 already answered)
day 2   1B-007, 1B-008              ║  1A-002 (baseline migration)
day 2   1E-L1 (harness)             ║  1D-006 → 1D-007, 1D-009
day 3   1E-L1a, 1E-L1b (L1 green)   ║  1A-003 (db reset verified)
day 4   1C-003 → 1C-002             ║  1C-001,004,005; 1D-008; SEC-1D-*;
                                     ║  1D-001→002→003→004 (one chain)
day 5   1C-006                      ║
day 5   1E-L2 → 1E-L2a, 1E-L2b      ║  (needs H-13 Docker)
        Gate C
        1A-004 cutover — NOT in Phase 1 (needs H-14 approval)
```

The left column needs no database and no decision. **If the schema decision
stalls, the Domain stream still closes 14 of the 32 failing criteria** — and the
remaining 18 needed the schema decision — **now answered**, so they are unblocked.
