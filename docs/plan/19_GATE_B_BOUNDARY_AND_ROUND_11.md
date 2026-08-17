# 19 — Gate B Boundary and Round 11

**Trigger:** independent review at `2717af0` — **FAIL**, 1 BLOCKER · 5 MAJOR · 6 MINOR (valid: HEAD stable, tree clean, 20 break-tests executed)
**Decision:** stop growing the verifier into a semantic checker. Fix the narrow defects, then state honestly what the tool does and does not establish.
**Scope:** narrow. No product architecture, no production code, no migration SQL body, no live operation.

> **Why the approach changed.** Seven consecutive rounds followed the same shape:
> fix the instance, add a check matched to that instance's exact wording, and the
> next reviewer finds a variant. The last reviewer devised 20 mutations and the
> verifier missed 12 — after ~1000 lines and 19 checks. The conclusion is not
> that the verifier needs a twentieth check. It is that **a structural checker
> cannot establish semantic correctness**, and pretending otherwise is what kept
> producing false assurance.

---

## 1. `1A-003` dependency correction (BLOCKER-A)

`1A-003` runs `supabase db reset` in the **canonical repository directory**. That
requires `supabase/config.toml`. Its sole producer is **`1D-009`**.

The gate existed **only in a blockquote**. The `depends_on` field said
`1A-002B, H-13`; the index row and `plan/02` agreed with the field, not the prose.

| Location | Before | After |
|---|---|---|
| `plan/01` block header | `1A-002B, H-13 (Docker)` | **`1A-002B, 1D-009, H-13 (Docker)`** |
| `plan/01` index row | `1A-002B, H-13` | **`1A-002B, 1D-009, H-13`** |
| `plan/02 §2` | `1A-002B, H-13` | **`1A-002B, 1D-009, H-13`** |
| blockquote | "additionally gated on `1D-009`" | now adds "**encoded in `depends_on`, not only stated here**" |

This was the same failure the transfer from `1A-002B` was meant to end: the
criterion moved, and the unmet file requirement moved with it.

---

## 2. `plan/05` dangling reference

`plan/05:16` (**R-03**, an active risk row) still named `1A-002`, a task the
round-8 split removed. Corrected semantically rather than by replacement:

> `db reset` still fails after **`1A-002A`** — undiscovered drift.
> Mitigation: `1A-001` three-way diff **before** writing the migration;
> **`1A-002B`** proves the baseline alone, **`1A-003`** verifies the canonical chain.

`1A-002A` is right for the risk statement (the drift is a property of the
*authored* baseline); `1A-002B` and `1A-003` are right for the mitigation (both
are proofs).

---

## 3. Graph referential-integrity fix (MAJOR-B)

The range guard matched a bare em/en dash **anywhere on the line**. The em-dash
is this project's standard empty-cell marker, so the guard silently disabled the
check on **31 of 69** eligible rows in `plan/02` and **10 of 53** in `plan/05` —
and the `plan/05:16` token above was already hiding behind it while the verifier
reported `unresolved graph tokens: 0`.

**Fixed:** the range test is now anchored to the token itself —
`_is_ranged(token, line)` matches `SEC-1D-001..003`, not any dash on the row.

**A second over-broad skip was found by break-testing the fix.** The supersession
filter matched `history` and `was` — ordinary English. R-02 says "history is
fabricated", so that entire live row was skipped. The filter is now
`superseded | ~~ | split into | round-N figure/record` only.

**Break-test:** injecting `1A-777` into R-02 (an em-dash row containing "history")
now yields `UNRESOLVED TASK TOKEN '1A-777' … unresolved graph tokens: 1`. Before
both fixes it reported **0**.

---

## 4. Verifier self-test fix (MAJOR-C)

The self-test matched `check_[a-z_]+`, which cannot match a name containing a
digit. **`check_h01` was invisible**: the verifier printed `defined: 18,
reachable: 18` when there were **19**, so deleting `check_h01`'s call kept it
green — the guarantee that every check runs did not hold.

**Round 11 fixed the COUNT** (`check_[A-Za-z0-9_]+`, reporting 19/19) but **not
the guarantee.** The reviewer showed `src.index("def main(")` matched the string
literal on its own line, so every check defined *below* it counted as reachable
regardless — `check_h01`, `check_stale` and `check_fence_syntax` could all have
their calls deleted and stay green.

**Round 12 fixed the guarantee:** `main()` is now located with `ast`. Mutation-
tested — deleting any of those three calls now fails, as does passing a throwaway
`Report()`.

**Also added:** every check must receive the **shared** `report` object. A check
called with a throwaway `Report()` would have its failures silently discarded;
that now fails the self-test.

---

## 5. H-11 as a real dependency (item 5)

`SEC-1D-005a`'s criteria required `last_ai_context` ownership to be confirmed —
that is **H-11**, a user decision — but it appeared in **no** `depends_on`, so the
graph did not show the task waiting on a person.

- `H-11` added to `HUMAN_TOKENS` in the verifier
- `SEC-1D-005a` block header and index row: `depends_on: 1A-002A, **H-11**`
- `plan/02 §2` row updated to match

---

## 6. Verifier scope — stated honestly

Recorded in the module docstring and `tools/audit/README.md`:

**The verifier GUARANTEES — structural properties only:**

- task and reference **existence** across `plan/01`–`plan/05` — **active content only**: table rows, `depends_on` headers and mandatory task fields. Prose, blockquotes and history tables are not scanned
- **block ↔ index equality** of `depends_on`, human tokens included
- **graph reachability** — no dangling token, no cycle, no unresolved human dependency
- **ownership uniqueness** and `never touches` compliance
- **file scope and count consistency**
- a fixed set of **known structural invariants**

**The verifier does NOT guarantee:**

- shell procedure semantics — that a fence does what its comments say
- SQL correctness
- Supabase runtime behaviour
- privilege correctness on any real database
- schema equivalence with live
- business-logic correctness

**These are established by human review (Gate B) and execution evidence (Gate C),
never by this tool.**

Claims of a "semantic verifier" or "execution correctness proven" are removed.
The known limits from `plan/18 §4` stand and are not re-argued here: role-count
and comparison-operator inversion are text-matched; `BOOTSTRAP_CONTRACT` is keyed
on fence content; artefact resolution scans bash fences only; producer
recognition needs a `(new)`/`(moved)` marker; `1A-002A`'s idempotent-form grep
still contradicts its own exception clause.

---

## 7. Gate B and Gate C — the boundary

| | **Gate B PASS requires** | **Gate C PASS requires** |
|---|---|---|
| Nature | the plan is **structurally executable** | the plan **has been executed** |
| 1 | no dangling reference across `plan/01`–`plan/05` | Docker / local Supabase running |
| 2 | no task-internal contradiction | `1A-002B` executed — baseline-alone posture proven |
| 3 | ownership and dependency model complete | `1A-003` canonical reset executed |
| 4 | file scope and counts consistent | schema hash verified against live |
| 5 | **a human reviewer accepts the task semantics** | pgTAP / Layer 2 evidence green |

**H-13 (Docker) does not block Gate B.** It blocks **Phase 1A execution and Gate
C**. That distinction is the practical consequence of this round: the plan can be
judged complete and coherent without a database; it cannot be judged *correct in
execution* without one.

**Gate B's remaining requirement is human acceptance of task semantics** — not a
further tooling round.

---

## 8. Human dependency status

| # | Status | Blocks |
|---|---|---|
| **H-01** | **CLOSED** — Option A, post-revoke posture | — |
| **H-11** | **OPEN** — `last_ai_context` ownership. **Now a real `depends_on` edge** | `SEC-1D-005a` |
| **H-13** | **OPEN** — Docker not running | `1A-002B`, `1A-003`, Layer 2 lane → **Phase 1A execution and Gate C**, *not* Gate B |
| **H-14** | **OPEN** — separate approval for the live ledger cutover | `1A-004` only; not executed in Phase 1 |
| **H-03** | **OPEN** — relocate `backend/.env.local` | `OPS-0B-001` (Phase 2C) |
| H-02, H-04..H-10, H-12 | **OPEN** | later phases |

---

## 9. Remaining human approvals

1. **Gate B acceptance** — a human judgement that the task semantics are right. The verifier cannot supply this, and no further round of it will.
2. **H-13** — start Docker to make Phase 1A executable and Gate C reachable.
3. **H-11** — `last_ai_context` ownership, now blocking `SEC-1D-005a` in the graph.
4. **H-14** — separate approval before `1A-004` touches the live ledger.
5. **Phase 1 start** — explicit, after Gate B acceptance. Not implied by any verifier output.

---

## 10. Canonical metrics — unchanged

50 rows · 1 DONE · 49 open · 49 fully specified · 0 XL · largest M · 75 distinct
files · 0 block/index mismatches · 0 unresolved graph tokens · 0 unknown
dependency tokens · 0 acceptance-artefact cycles · 0 artefact resolution issues ·
0 task contradictions · 0 unreachable checks (**19/19**) · 0 fence syntax errors ·
0 ownership conflicts · 0 active stale assertions.

No task or scope count changed this round.

---

## 11. Not done

- **Nothing has been executed against a database.** H-13. The pre-Docker setup section of `1A-002B` was executed for real at round 10; everything past `supabase start` is unrun.
- The baseline SQL, `baseline_privileges.test.sql` and `supabase/config.toml` do not exist — `1A-002A`, `1A-002B`, `1A-003` and `1D-009` are unstarted.
- The `plan/18 §4` known limits are **not** closed and are not claimed to be.
- No production code, migration SQL body, live migration, SQL write or Edge Function deploy. No Mas Technic operation.
