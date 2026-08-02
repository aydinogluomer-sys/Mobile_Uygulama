# Verify Feature End To End

**Purpose:** Establish whether a feature actually works, distinguishing observed from inferred.

**Status:** `Created` - not yet validated on a task

## When to use
Before claiming any feature is done, and when auditing claims made by docs or commit messages.

## When NOT to use
Not for pure functions - a unit test is cheaper and stronger.

## Inputs
Feature name - entry point - expected outcome.

## Outputs
Given/When/Then cases, each with an explicit verdict class.

## Steps
1. Find the UI entry point. If nothing navigates to it, stop - the feature is unreachable regardless of code quality.
2. Trace UI -> store/state -> network -> database, naming `file:line` at each hop.
3. Confirm the target exists. A called edge function may not be deployed; a queried column may not exist.
4. Check the error path. Does the code read `error`, or destructure `{ data }` only?
5. Assign exactly one verdict: `VERIFIED-STATIC`, `VERIFIED-DB`, `VERIFIED FAIL`, `PREDICTED FAIL`, `BLOCKED-DEVICE`, `BLOCKED-WRITE`.

## Prohibitions
- **Never mark a case passing because the code looks right.** Passing requires observation.
- Never merge "predicted to fail" with "observed failing" - that distinction is the document's value.
- Never test a privileged function by invoking it. If a revoke failed, the test itself becomes the exploit.
- Never report a blocked case as passing.

## Quality criteria
Every verdict names its evidence. Every blocked case names what would unblock it.

## Definition of done
Every case has a verdict; blocked cases have an owner and a phase; nothing asserted without evidence.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
