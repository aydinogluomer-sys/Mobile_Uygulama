# Design Habit Domain Model

**Purpose:** Model habit scheduling, completion, streaks and recovery so the metrics stay correct.

**Status:** `Created` - not yet validated on a task

## When to use
Designing or auditing habit frequency, completion, streak, XP or recovery logic.

## Inputs
Habit schema - scheduling function - metrics module - log table.

## Outputs
A correctness review naming each defect with a concrete failing case.

## Steps
1. Enumerate every frequency mode the schema permits, then confirm the scheduling function handles each. A declared-but-unread field means that mode silently never fires.
2. **Verify the metrics layer actually calls the scheduling function.** If the denominator is `habits x days` rather than `due days`, weekly habits are structurally capped below 100 percent.
3. Check target direction. An "at most" habit must score higher for lower values.
4. Check which log states count as completion. Missed and skipped must not.
5. Trace whether recovery or makeup completion writes a real log. If it only flips a status, it is decorative.
6. Establish XP authority. If a BEFORE trigger overwrites the client value, client-side XP is dead code and any "spoofable" claim is false.
7. Check historical stability - does filtering on current status mutate past reports?

## Prohibitions
- Never assume a declared schema field is read by the code.
- Never assume streaks are client-side without checking triggers.
- Never fix a metric without a failing test first.

## Quality criteria
Every defect has a concrete failing input and the expected output.

## Definition of done
Every frequency mode verified; metric formulas checked against direction and state; recovery linkage traced; XP authority established.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
