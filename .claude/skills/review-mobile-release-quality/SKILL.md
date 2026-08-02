# Review Mobile Release Quality

**Purpose:** Independently review a change or release without having authored it.

**Status:** `Created` - not yet validated on a task

## When to use
Before a security change is applied, and before any gate is declared passed.

## When NOT to use
**Never on your own work.** An author cannot independently review their own diff.

## Inputs
The proposed or applied change - its claimed rationale - read-only access.

## Steps
1. Restate what the change claims to do, then try to falsify it.
2. Verify the target exists and is unique - check for overloads or a differing signature.
3. Capture pre-change state verbatim before anything is applied.
4. Verify the rollback restores state EXACTLY, not approximately. A superset is not a restore.
5. **Trace every internal caller.** For a privilege change, determine the effective role at each call site: a definer-rights caller owned by a privileged role is unaffected; an invoker-rights caller breaks.
6. Ask what the change does NOT close, and say so, so it is not over-reported.
7. Look for the same defect class elsewhere in the system.
8. Give `PASS`, `PASS WITH FINDINGS` or `FAIL`, plus any new issues ranked by severity.

## Prohibitions
- Never invoke a privileged function to test it.
- Never approve without checking the rollback.
- Never let "safe to apply" rest on the author's analysis - re-derive it.
- Never manufacture approval, and never manufacture problems.

## Quality criteria
Every verdict quotes evidence. Scope limits stated explicitly.

## Definition of done
Every item has a verdict; rollback verified exact; new findings ranked; scope limits recorded.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
