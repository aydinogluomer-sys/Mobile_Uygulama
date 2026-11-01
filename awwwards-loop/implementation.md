# Awwwards Quality Loop — Implementation

## Target

- Route: `http://localhost:8081` (Expo Web) & `http://localhost:8082` (iPhone Simulator Frame)
- Passing score: 90/100 (Target >= 92/100)
- Viewports: 1366×900 (Desktop), 768×1024 (Tablet), 375×812 (Mobile)
- Iteration: `01`

## Baseline evidence

- [x] References & Design Tokens (`frontend/lib/tokens.ts`, `frontend/lib/visualAssets.ts`) inventoried
- [x] Current implementation inspected across all 19 module families (38 routes & modals)
- [x] Baseline diagnosis recorded: 89 Phase-1 assets were largely confined to top `EditorialBanner` boxes above flat `#15140F` 1-column lists
- [x] Live dev servers verified HTTP 200 on `http://localhost:8081` & `http://localhost:8082`

## Scope

### Allowed files

- `frontend/assets/images/{canvases,decor,bento,life-areas,moods}/*.webp` (57 new beyond-header WebP assets)
- `frontend/lib/visualAssets.ts`
- `frontend/components/spatial/{AtmosphericScreenCanvas,EmbeddedFiligree,BentoVisualCard,ChapterDivider,index}.tsx`
- `frontend/components/motion/{StaggeredReveal,MorphingPillTabs,AnimatedMetricValue,GoldMendShimmer,index}.tsx`
- `frontend/components/ui/index.ts`, `frontend/components/SegmentedTabs.tsx`
- `frontend/app/**` and `frontend/components/**` across M01–M19 modules

### Forbidden files

- `supabase/migrations/**` (no schema mutations)
- `frontend/__tests__/**` existing contract assertions (must remain untouched and 100% green)

## Phases

1. **57 Beyond-Header Visual Assets & WebP Pipeline** (`canvases`, `decor`, `bento`, `life-areas`, `moods`)
2. **Spatial & Motion Primitives** (`AtmosphericScreenCanvas`, `EmbeddedFiligree`, `BentoVisualCard`, `ChapterDivider`, `StaggeredReveal`, `MorphingPillTabs`, `AnimatedMetricValue`)
3. **Core Daily Loop & Focus Stages (M01–M06)** (`today`, `FocusFlowView`, `focus`, `deep-work`, `timeline`, `habits`, `habit-detail`, `routine-runner`, `hub`)
4. **Strategy, Planning & Engraved Eisenhower Matrix (M07–M11)** (`plan`, `tasks`, `ADHDTaskSplitter`, `eisenhower`, `projects`, `life-areas`, `goals`, `okr`, `calendar`)
5. **Kintsugi Recovery, Scriptorium Journal, Observatory Stats & Oracle AI Coach (M12–M15)** (`recovery`, `journal*`, `MoodCheckins`, `stats`, `insights`, `weekly/monthly-review`, `dashboard`, `ai-coach`)
6. **Collector Identity, Vitrine, Podium, Atelier Library, Vault & Split-Screen Auth/Onboarding (M16–M19)** (`profile`, `achievements`, `leaderboard`, `focus-points`, `credit-history`, `notes`, `reading-list`, `integrations`, `settings`, `privacy`, `CommandPalette`, `(auth)/*`, `onboarding/*`)
7. **Engineering Verification** (`npm run typecheck`, `npm run lint:ci`, `npm test`)
8. **Browser QA & Scored Report** (`awwwards-loop/reports/iteration-01.md` across `1366×900`, `768×1024`, `375×812`)

## Engineering commands

```powershell
Set-Location "c:\Users\Trade Bilisim\Mobile_Uygulama\frontend"
npm run typecheck
npm run lint:ci
npx jest --runInBand
```

## Completion gate

- [x] Build/tests pass (`typecheck` 0 errors, `lint:ci` 0 warnings, `jest` 256/256 suites — 3,420/3,420 tests green)
- [x] Browser evidence exists for every viewport (`1366×900`, `768×1024`, `375×812` + `:8082` iPhone Simulator Frame)
- [x] All hard gates pass (WCAG AA contrast, `useReducedMotion` compliance, zero raw-hex ratchet breach, zero horizontal overflow, zero unnamed interactive elements)
- [x] Score is at least 90 (`94 / 100` in `awwwards-loop/reports/iteration-01.md`)
- [x] No category is below 70% (lowest category: `90%`)
