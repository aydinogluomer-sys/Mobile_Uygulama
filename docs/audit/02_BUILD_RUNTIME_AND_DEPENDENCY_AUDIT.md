# 02 — Build, Runtime and Dependency Audit

**Status:** `Verified` for static checks; `Blocked` for device runtime
**Phase:** Gate A

---

## 1. Summary

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **PASS** — exit 0 |
| ESLint | `npx eslint .` | 23 errors, 82 warnings — **all 105 classified in §3** |
| Expo Doctor | `npx expo-doctor` | **15/18 passed, 3 failed** — §4 |
| Dependency currency | `npx expo-doctor` | **21 packages out of date**, 12 major mismatches |
| Device runtime | — | **`Blocked`** — see §7 |

The static build is healthier than expected. TypeScript is clean under
`strict: true` with **zero** `@ts-ignore` / `@ts-expect-error` in the codebase —
genuinely uncommon and worth preserving. The problems are concentrated in the
dependency tree and app configuration, not in the application's type safety.

---

## 2. TypeScript

`npx tsc --noEmit` exits 0. Verified four times during Phase 0A — after each
source commit group — and it passed every time.

| Setting | Value | Note |
|---|---|---|
| `strict` | `true` | `tsconfig.json:4` |
| `skipLibCheck` | `true` | `tsconfig.json:5` — **masks the SDK skew in §5**; declaration mismatches in mismatched native modules are never surfaced |
| `paths` | `{"@/*": ["./*"]}` | configured but unused; every import is relative |
| Missing | `noUncheckedIndexedAccess` | would flag `focusReport.ts:91` `arr[getMonth()]` and `:96` `arr[getHours()]` |

`skipLibCheck: true` is the reason `tsc` stays green while 12 packages sit at the
wrong major version. It is not wrong, but it means **`tsc` passing is not
evidence that the dependency tree is coherent**.

---

## 3. ESLint — all 105 findings classified

Classification vocabulary: `cosmetic` · `potential runtime bug` ·
`confirmed runtime bug` · `intentional` · `unknown`.

### 3.1 Errors (23)

| Rule | Count | Classification | Reasoning |
|---|---|---|---|
| `react/no-unescaped-entities` | 21 | **cosmetic — rule misapplied** | A web-React rule about HTML entity ambiguity. These are literal `"` and `'` inside React Native `<Text>`, which renders them correctly. Sites: `eisenhower.tsx:199` ×2, `journal-archive.tsx:102`, `journal-reader.tsx:123`, `okr.tsx:121`, `profile.tsx:66` ×2, `habits.tsx:424,454,504` ×2 each, `timeline.tsx:482,515,554` ×2 each, `HabitOnboarding.tsx:161,830`. **Recommended fix: disable the rule for this project rather than escape 21 strings** — it does not apply to RN. |
| `no-undef` (`__dirname`) | 2 | **cosmetic — config gap, not a defect** | `scripts/fix-expo-tsconfig.js:6,28`. `__dirname` **is** defined at runtime: the file is CommonJS executed by Node via `postinstall`. ESLint has no Node env configured for `scripts/`. The lint config is wrong, the code is correct. |

**No error is a real defect.** Both categories are configuration mismatches.

### 3.2 Warnings (82)

| Rule | Count | Classification |
|---|---|---|
| `react-hooks/exhaustive-deps` | 43 | **mixed — individually triaged in §3.3** |
| `@typescript-eslint/no-unused-vars` | 21 | cosmetic — dead imports/vars, e.g. `ui/Button.tsx:1` (`View`), `ui/Button.tsx:3` (`space`), `ui/StatTile.tsx:1` (`View`) |
| `import/first` | 7 | cosmetic — `settings.tsx:28-37`, imports below other statements. Hoisting makes this behaviourally identical; it signals an 869-line file that grew organically. |
| `@typescript-eslint/array-type` | 6 | cosmetic — `Array<T>` vs `T[]`, `reportMetrics.ts:69,70,97,98,107,143` |
| `no-unused-expressions` | 4 | **intentional** — ternary-as-statement for side effects. `timeline.tsx:243` `tracking_type === 'numeric' ? setMeasureHabit(h) : handleYesNoTap(h)`; `HabitListView.tsx:70,74,78` `n.has(x) ? n.delete(x) : n.add(x)`. Verified by reading each site: all four execute correctly. |
| `import/no-named-as-default-member` | 1 | cosmetic — `utils/api.ts:7`, `axios.create`. Moot once the legacy client is retired (Phase 2A). |

### 3.3 `react-hooks/exhaustive-deps` — 43 warnings across 34 files

The dominant pattern is `useEffect(() => { fetchX(); }, [])` — a mount-only
fetch whose Zustand action is omitted from the dependency array. Zustand action
identities are stable across renders, so these do not go stale.
**Classification: `intentional` (38 of 43).** `calendar.tsx:63` already documents
the pattern with an explicit `// eslint-disable-line`.

Five warrant individual attention:

| Site | Code | Classification | Why |
|---|---|---|---|
| `app/screens/recovery.tsx:165` | `useEffect(() => { load()... }, [])` where `load = useCallback(..., [today])` | **potential runtime bug** | `load` gets a new identity when `today` changes, but the effect never re-runs. An app left open across midnight keeps loading yesterday's recovery data. Compounds the midnight-rollover defect in `willpowerStore` (doc 07). |
| `components/CommandPalette.tsx:90` | `useMemo(..., [q])` reading `tasks` | **potential runtime bug** | The memo will not recompute when `tasks` changes, so search results can be stale. Currently unreachable — the component is never mounted (doc 03) — so impact is latent. |
| `components/CommandPalette.tsx:57` | `useEffect(..., [visible])` reading `tasks.length`, `notes.length`, `projects.length` | potential runtime bug | Same file, same latency caveat. |
| `app/screens/recovery.tsx:163,169` | `[habits]` deps calling `computeStreaks` | cosmetic | Derived value is in deps; the omitted item is a stable action. |
| remaining 38 | mount-only fetch | **intentional** | Stable Zustand action references. |

**Recommendation:** add explicit `// eslint-disable-line react-hooks/exhaustive-deps`
with a one-line reason at the 38 intentional sites (matching the existing
`calendar.tsx:63` convention) so the 5 real ones stop being buried in noise.
Assigned to Phase 2B.

---

## 4. Expo Doctor — 3 failed checks

### 4.1 `app.json` schema errors — store-blocking

```
Field: androidStatusBar/backgroundColor        - not a valid 6/8-char hex colour
Field: android/adaptiveIcon/backgroundColor    - not a valid 6-char hex colour
Field: Android.adaptiveIcon.foregroundImage    - not square: 512x513
Field: icon                                    - not square: 512x513
```

**The app icon is 512×513, one pixel off square.** Both Google Play and the App
Store reject non-square icons, and Expo's prebuild will distort them. This is a
confirmed release blocker, cheap to fix, and belongs in Phase 6E — but the asset
itself can be corrected any time.

### 4.2 Duplicate native modules — build-breaking risk

```
@expo/vector-icons   14.1.0  +  15.1.1
expo-constants       17.1.8  +  18.0.13 (x4 nested copies)
expo-font            13.3.2  +  14.0.11
```

A native build may contain only one version of a given native module. Three are
duplicated, `expo-constants` five times over. This is the mechanical consequence
of §5: top-level packages pinned to SDK 53 while `expo` itself pulls SDK 54
transitives.

### 4.3 Version mismatches — 21 packages

**Major (12):** `@expo/vector-icons` 14.1.0 → ^15.0.3 · `expo-blur` 14.1.5 → ~15.0.8 ·
`expo-constants` 17.1.8 → ~18.0.13 · `expo-font` 13.3.2 → ~14.0.12 ·
`expo-haptics` 14.1.4 → ~15.0.8 · `expo-image` 2.4.1 → ~3.0.11 ·
**`expo-router` 5.1.11 → ~6.0.24** · `expo-splash-screen` 0.30.10 → ~31.0.13 ·
`expo-status-bar` 2.2.3 → ~3.0.9 · `expo-symbols` 0.4.5 → ~1.0.8 ·
`expo-system-ui` 5.0.11 → ~6.0.9 · **`react-native-reanimated` 3.17.5 → ~4.1.1** ·
`eslint-config-expo` 9.2.0 → ~10.0.0

**Minor (7):** `react-native-gesture-handler` 2.24.0 → ~2.28.0 ·
`react-native-safe-area-context` 5.4.0 → ~5.6.0 · `react-native-screens` 4.11.1 → ~4.16.0 ·
`react-native-svg` 15.15.5 → 15.12.1 · `react-native-web` 0.20.0 → ^0.21.0 ·
`react-native-webview` 13.13.5 → 13.15.0 · `typescript` 5.8.3 → ~5.9.2

**Patch (1):** `expo` 54.0.34 → ~54.0.36

### The two that matter most

- **`expo-router` 5 → 6.** Routing is the application's backbone; every one of the 40 route files depends on its behaviour.
- **`react-native-reanimated` 3.17 → 4.x with `newArchEnabled: true`** (`app.json:10`). Reanimated 4 is the New Architecture line. Running 3.17 under the new architecture is the single riskiest pin in the tree.

This is a **stalled SDK 53 → 54 migration**: `expo`, `expo-linking`,
`expo-notifications`, `expo-device` and `expo-web-browser` were moved to SDK 54
lines; the rest were not.

### 4.4 The postinstall symptom

`frontend/package.json:12` runs `scripts/fix-expo-tsconfig.js` on every install,
which **writes into `node_modules`** — `fs.writeFileSync` on
`expo-web-browser/tsconfig.json:23` and `expo-module-scripts/package.json:37`.
It swallows all errors and `process.exit(0)`s (`:41-44`), so a silent failure
surfaces later as a confusing `tsc` break.

This script exists to paper over the version skew above. **It should be deleted
as part of Phase 2B, not maintained.** Patching `node_modules` is not a fix; it
is a fresh-install-dependent side effect that no CI runner will reproduce
reliably.

---

## 5. Package manager inconsistency

| Signal | Value |
|---|---|
| `frontend/package.json:63` | `"packageManager": "yarn@1.22.22+sha512..."` |
| Lockfile present | `frontend/package-lock.json` (npm) |
| `yarn.lock` | **absent** |

The project declares Yarn 1 and ships an npm lockfile. `yarn install
--frozen-lockfile` cannot succeed — there is no `yarn.lock` to freeze against —
and plain `yarn install` would resolve a different tree from the committed one,
very likely changing the duplicate-module picture in §4.2.

**No install was run during this audit.** Every command used `npx`, which is
package-manager neutral, so the existing `node_modules` was left untouched and
the results above describe the tree as it actually exists on this machine.

Decide one manager in Phase 2B, delete the other's lockfile, and align
`packageManager`.

---

## 6. Other build configuration

| Item | Location | Finding |
|---|---|---|
| `maxWorkers = 2` | `metro.config.js:23` | Hard-caps bundling to 2 workers regardless of host. Reads as a low-RAM workaround; materially slows cold builds and CI. |
| Dead code | `metro.config.js:15-20` | Two commented-out `blacklistRE` blocks. |
| EAS config | `app.json` | **No `extra.eas.projectId`, no `runtimeVersion`, no `updates` block.** EAS Build and EAS Update are not configured — there is no release path from this config. Phase 6B. |
| Store versioning | `app.json:5,11-20` | `version: "1.0.0"` with no `ios.buildNumber` and no `android.versionCode`. Store submission requires both. Phase 6E. |
| Identity | `app.json:3,4,8` | `name`, `slug` and `scheme` are all literally `"frontend"`. The deep-link scheme is generic enough to collide with another app, and it is what `Linking.createURL('spotify-callback')` and `google-calendar-callback` resolve against (`googleCalendarStore.ts:23`). |
| Unused dependencies | `package.json` | `axios ^1.13.2` (app uses supabase-js + fetch), `react-native-dotenv ^3.4.11` (env comes from `EXPO_PUBLIC_*`; the babel plugin is never referenced in `metro.config.js`), `@expo/ngrok ^4.1.3` **in `dependencies` rather than devDependencies**, `react-native-animatable` alongside Reanimated (two animation systems). |

---

## 7. Runtime verification — `Blocked`, then partially unblocked

At audit start the Supabase project `kbcuolhjjnmhjaarxxmu` was **`INACTIVE`
(paused)**, so no meaningful device run was possible: auth, every store fetch,
and every edge-function call would fail at the network boundary.

Phase 0C restored the project. During restore, `list_tables` returned `{"tables":[]}`
— this was **an artifact of the incomplete restore, not data loss**, confirmed by
a direct query returning `FATAL: 57P03: the database system is starting up`.
That distinction is recorded here because an empty-table result is exactly the
kind of observation that becomes a false finding if taken at face value.

**Still `UNVERIFIED` and owned by doc 06:** whether the app boots on a device,
whether auth completes, and whether each screen's data path works end to end.

### One runtime defect already confirmed without a device

`google-auth` is **not deployed**. The live function list on
`kbcuolhjjnmhjaarxxmu` contains `generate-routine`, `notion-auth`, `notion-sync`,
`subscription-webhook` and `spotify-auth` — no `google-auth`. But
`store/googleCalendarStore.ts:34,62,78,109` calls
`${SUPABASE_FUNCTIONS_URL}/google-auth?action=…` for status, url, callback and
disconnect. **Every Google Calendar operation returns 404.** See doc 07 §2.

---

## 8. Findings

| # | Finding | Severity | Phase |
|---|---|---|---|
| 1 | App icon 512×513 — not square; store-blocking | P2 | 6E (fixable now) |
| 2 | Duplicate native modules (`expo-constants` ×5, `@expo/vector-icons`, `expo-font`) | P2 | 2B |
| 3 | 12 major version mismatches; `expo-router` 5 vs 6 and Reanimated 3 vs 4 under `newArchEnabled` | P2 | 2B |
| 4 | `postinstall` writes into `node_modules` and swallows errors | P2 | 2B |
| 5 | `packageManager: yarn` with only `package-lock.json` | P2 | 2B |
| 6 | `google-auth` called but not deployed → Google Calendar is broken | **P1** | 1D / 2C |
| 7 | Invalid hex colours in `app.json` | P3 | 2B |
| 8 | No EAS config, no `buildNumber`/`versionCode` | P2 | 6B / 6E |
| 9 | `metro maxWorkers = 2` | P3 | 2B |
| 10 | 5 `exhaustive-deps` warnings are potential stale-closure bugs; 38 are intentional | P3 | 2B |
| 11 | `react/no-unescaped-entities` misapplied to React Native (21 errors) | P4 | 2B — disable the rule |
| 12 | Generic `scheme: "frontend"` used for OAuth deep links | P3 | 2C |
| 13 | Unused deps: axios, react-native-dotenv, @expo/ngrok in prod deps | P3 | 2B |

**Nothing in this document blocks Phase 1.** Items 1–5 and 7–13 are Phase 2B/6
work. Item 6 is P1 and is carried into Phase 1D alongside the other edge-function
findings.
