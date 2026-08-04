# Gate B audit tooling

Non-production tooling that verifies the structural invariants the Gate B
planning documents depend on.

## Why this lives in the repository

Gate B round-6 finding **M6**: earlier rounds cited a verification script that
existed only in a session scratchpad, so the evidence was unreproducible by
anyone but its author. A checker whose output is quoted as proof has to be
runnable by the reader.

## Running it

```bash
python tools/audit/verify_gate_b.py            # from the repository root
python tools/audit/verify_gate_b.py --repo .   # explicit root
```

Exit code `0` if every invariant holds, `1` otherwise.

## What it asserts

| # | Check |
|---|---|
| 1 | Every open task carries all **13** mandatory fields — each parsed individually (7 header + 6 body), not a 6-field proxy |
| 2 | `depends_on` in each block equals its index row, **including human tokens** (`H-13`, `H-14`, `Gate B PASS`). Human dependencies are real dependencies |
| 3 | Files edited by more than one task are serialised by a transitive `depends_on` path |
| 4 | No file has two agent owners; no task violates its agent's "never touches" list; test files belong to QA & Test only |
| 5 | No XL task, no scope over 5 files, no declared dependency cycles |
| 6 | **Migration ordering** — versions are **parsed from the `1A-002` scope line and from the filenames on disk**, then compared. No hardcoded version is used as a comparison source |
| 7 | **Validation-block executability** — variables used inside the ```bash fence must be assigned inside it and before use; `ON_ERROR_STOP=1` must reach a real `psql` invocation; the second-application test must guard against a setup-error false positive and must capture and assert an exit status |
| 8 | **Two-stage validation** — a baseline-alone stage that asserts posture **before** the Emergency migrations, plus a full-chain stage. A full `db reset` alone is rejected as posture evidence |
| 9 | **Acceptance-criteria deletion regression** — compares `1A-002` against `--baseline-rev` (default `HEAD~1`) and FAILS if a critical criterion has been removed |
| 10 | Stale-metric scan over **every** `.md` under `docs/` |
| 11 | **H-01 closure** — no document may present it as an open decision |
| 12 | **Artefact resolution** — every repository path referenced in a fence resolves to a producing task, correctly ordered |
| 13 | **Plan-graph referential integrity** — every task token in the 5 active plan graphs resolves; matched by *shape*, so an unknown id cannot pass by not being recognised |
| 14 | **Task-internal contradictions** — a task may not both require an action and declare it out of scope |
| 15 | **Self-test** — every `check_*` defined must be reachable from `main()`. A defined-but-uncalled check has happened twice |
| 16 | **Fence shell syntax** — `bash -n` on every validation fence |

## Constraints, deliberate

- **Read-only.** Opens files for reading. Runs `git show` (read-only) for check 9 and nothing else. Never writes; never mutates git.
- **No network, no database.** Nothing here connects anywhere.
- **Deterministic and fixture-free.** Same repository state, same output.
- **Not application code.** Nothing in `frontend/` imports it; it ships in no
  bundle and is not part of the Expo build.

## Two design decisions worth keeping

**Nothing is verified by existence alone.** Round 8's governing rule: checking
that a piece of text exists is not verification — the checker must test the
behaviour and executability that text claims. Checks 6, 7, 8 and 9 exist because
earlier versions passed vacuously: check 6 once compared two hardcoded constants
to each other and could never fail; check 7 catches variables defined *outside*
the bash fence they are used in, which made a non-idempotency test pass while
proving nothing; check 9 catches a criterion being deleted during a rewrite.

**Task IDs come from the real H2 headings**, matched by literal alternation
(longest first), never from a guessed pattern. An earlier checker used a regex
that could not match `DEMO-001A`/`DEMO-001B` — an uppercase suffix defeats `\b` —
so the two tasks with a defect were invisible to the check that claimed to cover
them.

**The stale scan has no document whitelist.** An earlier version skipped six
plan documents by filename and let a stale figure survive. Every `.md` under
`docs/` is scanned; a historical value is ignored only when its own line marks it
superseded, or when it sits inside a table whose header names a "Was" /
"Previously" / "Claimed" column — an explicit correction record.

## Interpreting section 8

The stale scan is deliberately over-inclusive and reports *candidates*. Each
requires adjudication. Known false-positive classes: source line references
(`logStore.ts:21-27`), criterion IDs (`AC-S12`), commit hashes (`42b64a0`),
transition arithmetic (`41 + 7 = 48`), and figures that are simply correct
(`32 − 14 = 18`; "21 live migrations, 4 repo files, 2 matching").

The current adjudication is recorded in
[`docs/plan/14_GATE_B_ROUND_6_REMEDIATION.md`](../../docs/plan/14_GATE_B_ROUND_6_REMEDIATION.md) §4.
