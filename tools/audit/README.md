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
| 1 | Every open task carries all 13 mandatory fields |
| 2 | `depends_on` in each task block equals its task-index row |
| 3 | Files edited by more than one task are serialised by a transitive `depends_on` path |
| 4 | No file has two agent owners; no task violates its agent's "never touches" list; test files belong to QA & Test only |
| 5 | No XL task, no scope over 5 files, no dependency cycles |
| 6 | **Migration ordering (B1)**: `20260801000000 < 20260802181931 < 20260802205850`, and `1A-002` pins the baseline version with no placeholder |
| 7 | `1A-002` carries the full post-revoke contract and no permissive-grant clause |
| 8 | Stale-metric scan over **every** `.md` under `docs/` |

## Constraints, deliberate

- **Read-only.** Opens files for reading. Never writes; never runs a git command.
- **No network, no database.** Nothing here connects anywhere.
- **Deterministic and fixture-free.** Same repository state, same output.
- **Not application code.** Nothing in `frontend/` imports it; it ships in no
  bundle and is not part of the Expo build.

## Two design decisions worth keeping

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
