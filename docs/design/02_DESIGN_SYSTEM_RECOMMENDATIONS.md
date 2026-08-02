# 02 — Design System Recommendations

**Status:** `Planned` — implementation is Phase 5
**Governing constraint:** the target has already been demonstrated by `components/today/`. This is propagation, not reinvention.

---

## R1 · Extend `lib/tokens.ts` — do not replace it

The existing module is sound. It is missing four scales that the 1,671 hex
literals implicitly encode:

```ts
// additions only — colors, space, radius, font, fontFamily, hexA, ACCENTS stay
export const elevation = { none: 0, low: 1, medium: 3, high: 8 } as const;
export const shadow = { card: {...}, modal: {...}, sheet: {...} } as const;
export const motion = {
  instant: 0, fast: 140, base: 220, slow: 320,
  ease: 'cubic-bezier(0.22,1,0.36,1)',
} as const;
export const z = { base: 0, sticky: 10, drawer: 40, modal: 80, toast: 90 } as const;
export const opacity = { disabled: 0.4, muted: 0.6, subtle: 0.78 } as const;
```

**Do not add a token library.** The project has one; it is simply incomplete.

### Migration order — by leverage, not by file size

| Wave | Files | Why first |
|---|---|---|
| 1 | `components/ui/*` (11 files) | everything else should consume these |
| 2 | `Drawer.tsx`, `tabs/_layout.tsx`, `screens/_layout.tsx` | navigation chrome is seen on every screen |
| 3 | `habits.tsx` (129 hex), `timeline.tsx` (101), `settings.tsx` (80) | highest literal density |
| 4 | `HabitOnboarding.tsx` (175 hex) | largest single file; deserves its own task |
| 5 | remainder | |

**Acceptance per wave:** raw hex count in the touched files reaches zero, and
toggling `themeStore` visibly changes every colour on those screens.

---

## R2 · Close the `components/ui/` barrel and make it the only import path

`index.ts` omits `FloatingLabelInput` and `GlassPanel`, so they are deep-imported
(`login.tsx:12`, `calendar.tsx:14`). Export them, then make deep imports a lint
error. A barrel with holes teaches developers to bypass the barrel.

**Missing primitives** the audit found being re-implemented inline:
`ListRow` · `Sheet` · `Skeleton` · `ErrorState` · `FormField` · `ChartContainer`.

`EmptyState` already exists and is used — extend that precedent rather than
inventing a parallel set.

---

## R3 · Accessibility — the highest impact per unit of effort

Current: 20 labels, 1 `accessibilityState`, 0 hints across ~103 files.

**Minimum bar before any release:**

| Element | Requirement |
|---|---|
| Every `TouchableOpacity` / `Pressable` | `accessibilityRole` + `accessibilityLabel` |
| Every checkbox / toggle | `accessibilityState={{ checked }}` |
| Every icon-only button | `accessibilityLabel` (icons convey nothing to a screen reader) |
| Every interactive element | ≥ 44×44 pt, or `hitSlop` to reach it |
| Every status conveyed by colour | a text or icon companion |

**Start with `components/Drawer.tsx:141-151`** — 26 navigation rows with zero
a11y props. It is the single densest concentration of unlabelled controls and it
is on the path to every screen.

Then the habit and task checkboxes: those are the app's primary interaction, and
today they are unusable with a screen reader.

**Sub-44pt targets to fix:** `projects.tsx:252` (22×22 — roughly a quarter of
minimum area), `reading-list.tsx:248` (30×30), `monthly-review.tsx:288` (32×32),
`tabs/_layout.tsx:55` (32×32).

---

## R4 · Motion — hierarchy, not decoration

Three tiers, mapped to the `motion` tokens in R1:

| Tier | Duration | Use |
|---|---|---|
| Feedback | `fast` (140 ms) | press, toggle, check |
| Transition | `base` (220 ms) | screen change, sheet, expand |
| Ambient | `slow` (320 ms+) | seasonal background, decorative only |

**Every tier must respect reduced motion.** `components/seasonalMotion/useReducedMotion.ts`
already exists — promote it to `lib/` and apply it globally rather than in one
module.

**Do not add animation work before the Reanimated 3 → 4 upgrade lands**
(Phase 2B). Building motion on the legacy line under `newArchEnabled: true` means
rewriting it. SDK 55 makes New Arch mandatory, so the upgrade is not optional.

Haptics: `lib/haptics.ts` exists and is used in `HabitListView`. Standardise —
`select` for toggles, `light` for navigation, `success`/`warning` for outcomes —
and route every call through that module.

---

## R5 · Screen priority for Phase 5C

Ordered by (daily use) × (current gap), not by how broken they look:

| Order | Screen | Rationale |
|---|---|---|
| 1 | `tabs/habits.tsx` | primary loop · 129 hex · a11y 3/10 · 795 ln |
| 2 | `tabs/timeline.tsx` | primary loop · 101 hex · a11y 3/10 · 777 ln |
| 3 | `components/Drawer.tsx` | on the path to everything · 26 unlabelled rows |
| 4 | `tabs/settings.tsx` | lowest clarity · also needs the product-honesty fixes |
| 5 | `tabs/tasks.tsx` | high use, moderate gap |
| 6 | `HabitOnboarding.tsx` | 1173 ln, 175 hex — first impression for every new user |
| 7 | `screens/integrations.tsx` | 100 hex · stale status flags |
| 8+ | remainder | |

`tabs/today.tsx` and `components/today/` are **already at target** — leave them
alone except for the Phase 3 parity additions.

---

## R6 · `/tabs/today` iteration (Phase 5F) — unblock the loop first

`awwwards-loop/state.json` is `"status": "blocked"`, `"hardGatesPassed": false`,
`"lastScore": null`, blocked on browser capture across three attempts.

**Resolve the capture problem before scoring anything.** Options, in order of
preference:

1. Physical device + Expo Go screenshots at the three required viewports
2. Android emulator / iOS simulator capture
3. `npx expo export --platform web` + Playwright (already a root dependency)

Option 3 is likely fastest given `playwright` is in the root `package.json`, but
**web capture is not mobile evidence** — it validates composition, not touch
ergonomics or native feel. Use it to unblock, not to conclude.

Reference-alignment work already done in iteration 2 (1240px frame, fluid main +
320px rail, action-ordered sequence) is desktop-web composition. **On mobile the
rail must stack, and the reference's hardcoded recovery figures must stay
rejected** — as iteration 2 correctly decided.

---

## R7 · Product honesty is a design concern

Three items from doc 03 are design defects, not just engineering ones:

| Item | Design fix |
|---|---|
| `settings.tsx:109-112` false export success | never show success on an unverified outcome |
| `constants/features.ts` advertises 3 non-working features | remove, or mark unavailable in the same list |
| `constants/integrations.ts` mislabels Spotify, AI Coach, Google Calendar | make status reflect reality |

A user who taps Export, sees "Başarılı", and finds no file has learned the
product lies. No amount of visual craft recovers that.

---

## Definition of done for Phase 5

| Criterion | Target |
|---|---|
| Raw hex literals in `app/` + `components/` | **< 100** (from 1,671) |
| Files importing `components/ui/` | **> 70** (from 11) |
| `accessibilityLabel` coverage on interactive elements | **100 %** |
| Interactive elements ≥ 44 pt or `hitSlop` | **100 %** |
| Reduced-motion respected | **all tiers** |
| Theme toggle visibly affects | **every screen** |
| `awwwards-loop` | **unblocked, scored, ≥ 90** |
| Product-honesty items | **all three closed** |

**Not a target:** more animation, novel navigation, or visual density. Every
criterion above makes the app easier to use, which is the only defensible reading
of "Awwwards quality" for this product.
