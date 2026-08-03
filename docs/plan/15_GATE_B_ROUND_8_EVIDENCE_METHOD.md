# 15 — Gate B Round 8: Evidence Method

**Trigger:** round-7 independent review — **FAIL**, 2 BLOCKER · 5 MAJOR · 5 MINOR
**Reviewed commit:** `045199a` (HEAD stable start→end, tree clean both times — a valid review)
**Scope:** evidence method + verified blocker/major findings. No new architecture, no feature, no production code, no migration SQL body, no live operation.

> **Governing rule for this round:**
> **Checking that a piece of text exists is not verification. The verifier must
> test the behaviour and executability that text claims.**

---

## 1. Why the method had to change first

Rounds 4–7 each produced the same shape of failure: a rule written into a
document that *describes* it, while the task block that must *execute* it did not
carry it — and the checker reported PASS. Round 7 made the cause explicit:

| The checker did | Consequence |
|---|---|
| Compared `BASELINE_VERSION` to `EMERGENCY_VERSIONS` — **two hardcoded constants** | The ordering assertion could never fail, whatever the documents said. Its `ok` was quoted as evidence |
| Printed *"all 48 tasks carry all **13** fields"* while checking **6** | A 6-field proxy presented as a 13-field guarantee |
| Filtered `H-13`/`H-14` out of the block↔index comparison | An H-token divergence — the exact shape of the H-01 defect — was invisible |
| Checked only that keywords were **present** | A block *inverting* a rule would still pass |
| Skipped any line containing `->`, `closed` or `answered` | Real assertions were skipped wholesale |

**So the verifier was fixed before any document was touched**, and it was
required to *fail* on the known defects before being trusted.

### It did fail on them

Run against the unfixed documents, the rewritten verifier independently
reproduced all three round-7 findings:

```
[7] 1A-002 VALIDATION BLOCK EXECUTABILITY
   FAIL  variables used but never assigned INSIDE the bash fence: ['BASE', 'PSQL']
         -> they expand to empty and the test passes vacuously
   FAIL  ON_ERROR_STOP=1 present but not wired to any psql invocation
   FAIL  no `test -f $BASE` guard

[8] TWO-STAGE VALIDATION
   FAIL  privilege assertion BEFORE Emergency migrations
   FAIL  full `db reset` is used as the only posture evidence

[9] ACCEPTANCE-CRITERIA DELETION REGRESSION (vs HEAD~1)
   FAIL  REGRESSION: 'before-Emergency validation' was in 1A-002 at HEAD~1 and is now GONE
```

Check 9 caught B1 **as a deletion**, against the previous commit — the class of
defect that had gone undetected for four rounds.

---

## 2. Verifier changes (item 1, A–E)

| Item | Was | Now |
|---|---|---|
| **A** ordering | two hardcoded constants compared to each other | baseline version **parsed from the `1A-002` scope line**; emergency versions **parsed from the filenames on disk**; compared numerically *and* lexically. Reports "PLANNED filename" when the baseline is not yet on disk. Flags any other active migration that would sort before it |
| **B** 13 fields | 6 body fields, reported as 13 | all 13 parsed individually — `id`, `title`, `priority`, `MUST/SHOULD/COULD`, `agent`, `depends_on`, `size`, `scope`, `goal`, `acceptance_criteria`, `validation`, `risk`, `rollback` |
| **C** block↔index | human tokens filtered out | `H-01`/`H-13`/`H-14`/`Gate B PASS` included on both sides |
| **D** executability | not checked | variables must be assigned **inside** the fence and **before use**; `ON_ERROR_STOP=1` must reach a real `psql`; `test -f $BASE` guard required; exit status must be captured and asserted |
| **E** deletion regression | not checked | `git show <rev>:backlog` vs current for seven critical `1A-002` criteria; a criterion present before and absent now is a **FAIL** |

Additional: check 8 (two-stage validation) and check 11 (H-01 closure). The
stale scan's over-broad markers (`->`, `closed`, `answered`) were removed; the
H-01 check skips correction-record rows only.

---

## 3. B1 — the baseline-alone distinction test, restored and made real

`1A-002` now carries **two stages**, because a full `db reset` runs all three
migrations and therefore *cannot* distinguish "the baseline produced the secure
ACL" from "the Emergency revokes produced it" — and that distinction **is**
posture (a).

**Stage A — baseline alone, Emergency migrations NOT applied**
A1 ordering invariant on real filenames · A2 no client `GRANT` · A3 no blanket
idempotent forms · A4 apply **only** the baseline to a fresh database · A5 all
four functions exist · **A6 the defining assertion** — five-role
`has_function_privilege` showing `public/anon/authenticated = f`,
`service_role/postgres = t`, **before either Emergency migration is applied** ·
A7 `AC-S01..S07` privilege assertions in the baseline-only state.

**Stage B — full chain**
B1 both Emergency migrations apply **cleanly** (functions exist; already-absent
privileges make the `REVOKE` a no-op) · B2 posture **unchanged** · B3
`supabase db reset` exit 0 · B4 second application returns **non-zero**.

---

## 4. M2 — the bash block is now executable

`PSQL` and `BASE` were defined as inline markdown **above** the fence, so inside
it they expanded to empty: `-f ""` → exit 127 → the "expect non-zero" assertion
passed while proving nothing. Both are now assigned **inside** each fence, with
`set -euo pipefail`, a `test -f "$BASE"` guard so a missing file cannot produce a
false pass, and an explicit `status=$?` / `test "$status" -ne 0`.

---

## 5. Remaining round-7 findings

| # | Finding | Remediation | Status |
|---|---|---|---|
| **B2** | H-01 open in five active sites | `plan/09:96,100,140` rewritten; `plan/10:236,244` → **H-14**. Verifier check 11 asserts closure | **CLOSED** |
| **M1** | `plan/13 §10` omits `bc84d4a` | §10 now states it covers `e89e265` only and names `bc84d4a`'s two files | **CLOSED** |
| **M3** | `1A-002` scope (2 files) could not execute its own criteria | scope → **5 files**, adding the three `archive/` paths. Distinct Phase 1 files **70 → 73** | **CLOSED** |
| **M4** | H-13 scoped to "Layer 2 only" in six documents | **H-13 added to `1A-002` and `1A-003` `depends_on`** (block + index). Impact statements corrected in `plan/00`, `plan/04`, `plan/09`, `plan/13`, `plan/14`. **Phase 1A cannot be completed without Docker — only authored** | **CLOSED** |
| **M5** | circular acceptance dependency: `1A-002` required `1E-L2b` to pass, and `1E-L2b` → `1E-L2` → `1A-003` → `1A-002` | `1A-002` runs `security_regression.test.sql` **directly**; `1E-L2b` separately owns the same assertions as a permanent regression test | **CLOSED** |
| **m2** | "(validation 5)" citation broken by renumbering | → "(Stage A2 and Stage A6)" | **CLOSED** |

---

## 6. Verifier result at this commit

> ⚠ **Superseded by the round-8 execution correction.** The counts below were
> true at commit `5bf56ce`. `1A-002` has since been split into `1A-002A` +
> `1A-002B`, giving **50 rows · 49 open · 75 files**, and two further checks were
> added. Current state: `16_GATE_B_ROUND_8_EXECUTION_CORRECTION.md` and
> `08_CANONICAL_METRICS.md`.

```
[1] all 48 open tasks carry all 13 fields
[2] block and index agree for all 48 tasks, human tokens included
[3] 0 unserialised shared-file pairs
[4] 0 ownership conflicts, 0 never-touches violations
[5] 0 XL, no scope over 5 files, 0 declared cycles
[6] baseline 20260801000000 < both emergency versions (numeric and lexical),
    parsed from the scope line and from disk
[7] every variable assigned inside the fence; ON_ERROR_STOP reaches psql;
    test -f guard present; exit status captured and asserted
[8] Stage A present; privilege assertion BEFORE Emergency migrations; Stage B present
[9] all seven critical 1A-002 criteria present — no deletion regression
[11] no document presents H-01 as an open decision

FAILURES: NONE
```

**Stale candidates: 25, adjudicated 0 active** — correct values (`32 − 14 = 18`;
`research/03:126` "21 live migrations, 4 repo files, 2 matching"), the commit
hash `42b64a0`, transition arithmetic (`41 + 7 = 48`), and explicit correction
records in `plan/06`, `07`, `08`, `09`, `11` and `qa/02`.

---

## 7. Human dependencies

| # | Status |
|---|---|
| **H-01** | **CLOSED** — Option A, posture (a) |
| **H-13** | **OPEN** — and its blast radius is now correctly recorded: it gates the Layer 2 lane **and** `1A-002`'s validation and all of `1A-003`. **Phase 1A cannot complete without it** |
| **H-14** | **OPEN** — gates `1A-004` only; does not block Phase 1 start |

---

## 8. Not done

- **Neither stage has been executed.** H-13: no Docker, so `db reset`, the `psql` runs and the pgTAP assertions are specified but unrun. Their correctness is reasoned, not observed.
- The baseline SQL does not exist — `1A-002` is unstarted.
- No production code, migration SQL body, live migration, SQL write or Edge Function deploy. No Mas Technic operation.
