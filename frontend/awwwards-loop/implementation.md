# Awwwards Quality Loop — Implementation

## Target

- Route: `/tabs/today`
- Product: Atlas personal operating system dashboard (Expo / React Native Web)
- Reference direction: existing HTML-parity editorial system documented in the codebase; warm near-black canvas, clay accent, serif narrative, mono metrics, compact utility controls
- Passing score: 90/100
- Viewports: 1366×900, 768×1024, 375×812

## Baseline evidence

- Reference HTML supplied at `C:\Users\Trade Bilisim\Desktop\personal-os-v2 (8).html` and inspected in full for the target dashboard sections.
- Reference signature: 1240px shell, `minmax(0,1fr) + 320px` sticky rail, 40px rhythm, 44px serif hero, calm four-card metric grid, task-first main column, recovery/progress/habit rail.
- Current dashboard has strong base tokens but lacks a desktop content frame and authored composition.
- Turkish strings contain visible mojibake in several target files, which is a hard content-quality defect.
- Worktree contains extensive unrelated user changes, especially Metro cache and backend files; they are forbidden scope.

## Scope

### Allowed files

- `app/tabs/today.tsx`
- `app/tabs/_layout.tsx`
- `components/today/*.tsx`
- `awwwards-loop/**`

### Forbidden files

- Stores, backend, Supabase functions, auth behavior, Metro cache
- Unrelated screens and existing user changes

## Phases

1. Preserve the clarified Turkish copy and CTA hierarchy from iteration 01.
2. Align desktop composition with the reference's task-first main column and 320px sticky context rail.
3. Refine metrics, task flow, progress and recovery surfaces without copying HTML implementation details.
4. Add accessibility labels, roles, focus affordances and reduced-motion-safe behavior.
5. Run TypeScript, lint and Expo web export.
6. Inspect desktop, tablet and mobile; score and iterate from failures.

## Acceptance criteria

- No mojibake remains in the target route or shared header.
- One primary action is visually dominant; secondary actions remain legible.
- Desktop content is centered and intentionally composed; tablet/mobile do not clip or overflow.
- Interactive targets expose accessible names/roles and keyboard focus remains visible on web.
- Empty, loaded and task/habit completion states retain meaningful copy.

## Engineering commands

```bash
npx tsc --noEmit
npm run lint
npx expo export --platform web
```

## Completion gate

- Build/tests pass, or pre-existing failures are isolated with evidence.
- Browser evidence exists for every viewport.
- All hard gates pass.
- Score is at least 90 and no category is below 70%.
