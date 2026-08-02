# 03 — Performance and Accessibility Budget

**Status:** `Planned` — targets set from measured code evidence; runtime figures `Blocked`
**Enforcement:** Phase 6A/6B (CI), with Phase 5E delivering the a11y work

---

## 1. What is measured versus what is assumed

**Measured (static):** hex-literal counts, a11y prop counts, touch-target
dimensions, file sizes, asset sizes, dependency versions, duplicate native
modules.

**Not measured:** frame rates, JS thread blocking, memory, startup time, bundle
size on device, real contrast ratios.

No device or emulator run was performed, and `awwwards-loop/state.json` records
three failed browser-capture attempts. **Every runtime number below is a target,
not a baseline.** The first Phase 6A task is establishing the baseline; targets
may need revision once real numbers exist.

---

## 2. Performance budget

### 2.1 Runtime targets

| Metric | Target | Rationale |
|---|---|---|
| Frame rate, list scroll | ≥ 55 fps sustained | 60 is the ideal; 55 tolerates GC |
| Frame rate, screen transition | ≥ 55 fps | |
| JS thread block, single task | < 100 ms | beyond this a tap feels dropped |
| Cold start to first paint | < 2.5 s mid-range Android | |
| Habit toggle → visual feedback | **< 100 ms** | the app's primary interaction; optimistic UI required |
| Screen transition | < 300 ms | matches the `base` motion token |

The habit-toggle figure is the one that matters most: it is the core loop, and
`logStore.logHabit` currently updates local state only **after** the network
round-trip (`:85`). Optimistic update plus rollback is a Phase 1B change with a
direct performance benefit.

### 2.2 Known risks from static evidence

| Risk | Evidence | Action |
|---|---|---|
| **Duplicate native modules** | `expo-constants` ×5, `@expo/vector-icons` ×2, `expo-font` ×2 | Phase 2B — a native build may contain only one version |
| **Reanimated 3.17 under `newArchEnabled`** | `app.json:10` vs `package.json:46` | Phase 2B — highest-risk pin |
| `metro maxWorkers = 2` | `metro.config.js:23` | Phase 2B — build time only, not runtime |
| Large screens re-rendering | `HabitOnboarding` 1173 ln, `settings` 869, `habits` 795, `timeline` 777 | Phase 5C — memoisation + split |
| Unused deps in the bundle | `axios`, `react-native-dotenv`, `@expo/ngrok` **in `dependencies`** | Phase 2B — remove |
| Two animation systems | `react-native-animatable` alongside Reanimated | Phase 2B — pick one |

### 2.3 Asset budget

| Asset | Current | Target |
|---|---|---|
| 12 monthly WebP backgrounds | shipped | lazy-load per month; never preload all 12 |
| App icon | **512×513 — not square** | fix to 512×512 (store blocker) |
| `frontend/dist/` | 9.4 MB | build output, gitignored — not shipped |

`components/seasonalMotion/` already gates on `useReducedMotion` and an intensity
setting — the right pattern. Extend it so background images load only for the
displayed month.

### 2.4 List virtualisation

Any list that can exceed ~50 rows must use `FlatList`/`FlashList`, never
`ScrollView` + `.map()`. Candidates: habits, tasks, timeline, journal archive,
notes, reading list, leaderboard, credit history. **Audit each in Phase 5C** —
not verified in this audit.

---

## 3. Accessibility budget

### 3.1 Measured baseline — the worst axis in the product

| Metric | Current | Target |
|---|---|---|
| `accessibilityLabel` | **20** across ~103 files | 100 % of interactive elements |
| `accessibilityRole` | **20** | 100 % of interactive elements |
| `accessibilityState` | **1** (`today.tsx:307`) | 100 % of toggles/checkboxes |
| `accessibilityHint` | **0** | all non-obvious actions |
| Style defs with w+h < 44 pt | **54** | 0 without `hitSlop` |
| Style defs with `minHeight ≥ 44` | **6** | — |

### 3.2 Hard requirements before release

| Requirement | Standard |
|---|---|
| Touch target | ≥ 44×44 pt (iOS HIG) / 48×48 dp (Material), or `hitSlop` to reach it |
| Text contrast | ≥ 4.5:1 normal, ≥ 3:1 large (WCAG AA) |
| Non-text contrast | ≥ 3:1 for interactive boundaries and state |
| Status never colour-only | text or icon companion |
| Dynamic type | layout survives 200 % text scale |
| Reduced motion | honoured in all three motion tiers |
| Screen reader | every control announces role, label and state |
| Focus order | matches visual order |

### 3.3 Specific violations to fix first

| Location | Violation |
|---|---|
| `components/Drawer.tsx:141-151` | 26 navigation rows, zero a11y props |
| `projects.tsx:252` | 22×22 checkbox — ~¼ of minimum area |
| `reading-list.tsx:248` | 30×30 |
| `monthly-review.tsx:288` | 32×32 |
| `tabs/_layout.tsx:55` | 32×32 header button |
| habit/task checkboxes | no `accessibilityState={{checked}}` |

Drawer first: densest concentration of unlabelled controls, and on the path to
every screen. Then the habit and task checkboxes — the app's primary interaction,
today unusable with a screen reader.

### 3.4 Contrast — unverified

`lib/tokens.ts` defines the palette; ratios were **not computed**. Pairs needing
verification in Phase 5E: `#827E72` on `#1D1C17` (dim text on surface),
`#BFBBAE` on `#15140F`, accent `#D97757` on both surfaces, and every
`hexA()`-derived translucent colour.

The glass/frosted surfaces (`GlassPanel`, focus-mode cards) are the highest risk:
translucency over a variable photographic background makes contrast
content-dependent. The focus module already computes image luminance to pick a
text mode (`FocusStore.computeImageLuminance`) — **that mechanism should be the
model**, and its thresholds verified rather than assumed.

---

## 4. Enforcement

| Gate | Checks |
|---|---|
| **Gate C** (per task) | no new sub-44pt interactive element · new interactive elements carry role + label · no new raw hex in touched files |
| **Phase 5 exit** | hex < 100 · `components/ui/` in > 70 files · a11y labels 100 % · targets 100 % · reduced motion all tiers |
| **Phase 6 exit (Gate D)** | fps target met on a mid-range Android · cold start < 2.5 s · a11y automation green · contrast verified · icon square · no duplicate native modules |
| **CI (6B)** | typecheck · lint · Layer 1 · Layer 2 · bundle-size regression |

---

## 5. Deliberately not in the budget

| Excluded | Why |
|---|---|
| Lighthouse / web vitals | this is a native app; `react-native-web` is incidental |
| Bundle-size hard cap | no baseline exists yet; set one after the first measurement |
| 60 fps absolute | unrealistic on low-end Android for image-heavy screens; 55 sustained is the honest target |
| WCAG AAA | AA is the shippable bar; AAA would constrain the warm low-contrast palette that is central to the product's identity |

---

## 6. The honest summary

Performance is **unmeasured** — targets here are provisional and the first task
is a baseline.

Accessibility is **measured and poor**: 20 labels and a single
`accessibilityState` across ~103 files, with 54 sub-44pt interactive elements.
It is the only axis where this product is not close to shippable — and, unlike
performance, it needs no new tooling to fix. It is the highest impact per unit
of effort in the entire remediation plan.
