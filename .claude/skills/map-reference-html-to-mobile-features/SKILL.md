# Map Reference Html To Mobile Features

**Purpose:** Decompose a web reference prototype into atomic mobile requirements without importing desktop assumptions.

**Status:** `Created` - not yet validated on a task

## When to use
A web prototype or design file is the reference for a mobile build.

## When NOT to use
Not for scoring parity - that is a separate step consuming this output.

## Inputs
The reference file - the mobile route tree.

## Outputs
A numbered `REF-NNN` requirement inventory grouped by area, with an explicit in-scope denominator.

## Steps
1. Read the reference's route or page table first - it is the skeleton.
2. One requirement = one user-visible capability. A card, its hover state and its empty state are ONE requirement.
3. Mark desktop-only input mechanisms `N/A-MOBILE`: keyboard chords, hover reveals, right-click, fixed sidebars, window breakpoints.
4. **Separate the capability from its input mechanism.** Excluding `Cmd+K` must not silently exclude "global search". Record the capability; exclude only the trigger.
5. Exclude prototype scaffolding - seed data, browser storage, demo fixtures, hardcoded numbers. These are fixtures, not requirements.
6. State the in-scope denominator explicitly so parity percentages mean something.

## Prohibitions
- Never treat a hardcoded demo value as a requirement. If the reference shows a fixed sleep-debt figure, the requirement is "show sleep debt", not that number.
- Never let one DOM element become one requirement - it inflates the denominator and makes parity meaningless.
- Never silently drop a capability because its desktop trigger is out of scope.

## Quality criteria
Every `REF-NNN` cites reference evidence (selector, function or line) and carries an explicit scope mark.

## Definition of done
Every reference page represented; totals stated; exclusions listed individually with reasons.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
