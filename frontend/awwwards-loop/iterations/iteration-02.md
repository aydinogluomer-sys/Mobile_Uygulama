# Iteration 02

## Inputs

- Implementation plan: `../implementation.md`
- Previous report: `../reports/iteration-01.md`
- Supplied reference: `C:\Users\Trade Bilisim\Desktop\personal-os-v2 (8).html`

## Reference qualities to extract

- 1240px editorial shell with a fluid main column and a 320px sticky context rail.
- Main-column priority: narrative → four metrics → today's task table → compact next-up flow.
- Rail priority: recovery, weekly progress, habits; smaller type and padding than the main column.
- 40px macro rhythm, restrained 10px surfaces, serif/mono/sans role separation.
- Collapse to a single column below the desktop breakpoint.

## Reference defects not to copy

- Hardcoded recovery and sleep values.
- Desktop-specific sticky behavior on tablet/mobile.
- Dense inline styles and HTML-only keyboard assumptions.
- Placeholder/demo metrics presented as real user data.

## Failed criteria to address

- Iteration 01 lacked the reference's authored two-column desktop composition.
- Secondary progress, XP, willpower and recovery content competed with tasks in one long stream.
- The next-up flow appeared before the actionable task area.
- Browser evidence remains blocked and must be retried after implementation.

## Planned changes

- Expand the content frame to 1240px and introduce a responsive `main + 320px rail` layout.
- Keep tasks and next-up flow in the main column.
- Move XP, daily ritual progress, willpower, recovery and ritual controls into the secondary rail.
- Keep tablet/mobile as a deliberate single-column stack.
- Re-run typecheck, targeted lint, web export and browser matrix.
