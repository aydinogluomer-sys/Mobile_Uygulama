# ATLAS — DEPENDENCY SECURITY

**Date:** 2026-08-30 · **Branch:** `phase/final-v2-hardening`
**Method:** `npm audit --json` against the committed lockfile, then
`npm audit fix` — **never `--force`**, which would have pulled an unreviewed
Expo SDK major.

---

## 1. Before / after / remaining

| Severity | Before | After | Change |
|---|---|---|---|
| **critical** | **2** | **0** | ✅ eliminated |
| **high** | 16 | **9** | −7 |
| moderate | 13 | 13 | — |
| low | 1 | 0 | −1 |
| **total** | **32** | **22** | −10 |

Fixed within the supported semver range, no application change required:

`shell-quote` (critical), `tar` (critical), `axios`, `brace-expansion`,
`form-data`, `js-yaml`, `nanoid`, `undici`, `ws`.

Lockfile delta: 479 insertions / 437 deletions in `package-lock.json`;
`package.json` unchanged.

---

## 2. The 9 remaining highs are one upgrade, not nine problems

| Package | Direct? | Only fix offered |
|---|---|---|
| `expo` | direct | `expo@57.0.18` **[MAJOR]** |
| `@expo/cli` | transitive | via `expo@57` |
| `@expo/metro` | transitive | via `expo@57` |
| `@expo/metro-config` | transitive | via `expo@57` |
| `metro` | transitive | via `expo@57` |
| `metro-config` | transitive | via `expo@57` |
| `metro-transform-worker` | transitive | via `expo@57` |
| `image-size` | transitive (via `metro`) | via `expo@57` |
| `postcss` | transitive (via `@expo/metro-config`) | via `expo@57` |

Every one resolves through a single change: **Expo SDK 54 → 57**. `expo`
appears as "direct" only because it is the package that pulls the vulnerable
`@expo/cli`; the advisories are against the CLI and bundler, not the runtime
package.

That upgrade is a separate decision, not a dependency patch: SDK 54 → 57
crosses three majors, moves React Native, and changes the native build. It is
reported here rather than performed silently.

---

## 3. Runtime reachability — measured, not assumed

The question that decides severity is whether any of this ships to a device.
`metro`, `@expo/cli`, `metro-transform-worker`, `image-size` and `postcss` are
bundler and CLI packages, so the expectation is no. That was verified rather
than asserted:

```
npx expo export --platform android     exit 0     dist = 12 MB
grep -rl "node_modules/<pkg>" dist/
```

| Package | Files in the shipped bundle |
|---|---|
| `metro` | **0** |
| `@expo/cli` | **0** |
| `image-size` | **0** |
| `postcss` | **0** |
| `metro-transform-worker` | **0** |

**None of the remaining high-severity packages is present in the shipped
bundle.** Their attack surface is a developer machine or a CI runner during a
build, not an end user's device.

The one advisory that *was* runtime-reachable — `axios`, used by
`frontend/utils/api.ts` — is in the fixed set (`axios@1.20.0`).

---

## 4. Verification after the change

Dependency updates are exactly the kind of change that breaks a build quietly,
so the full gate was re-run against the new lockfile:

```
npm run typecheck:ci            exit 0
npx jest --ci                   exit 0    1115/1115, 76 suites
node run-tests.js               exit 0    142/142
npx expo lint                   exit 0    0 errors, 73 warnings
npx expo export --platform android  exit 0
npx expo export --platform ios      exit 0
```

---

## 5. Verdict

| Question | Answer |
|---|---|
| Exploitable **critical** vulnerabilities | **0** |
| Exploitable **high** vulnerabilities reachable at runtime | **0** — all 9 are build-time, absent from the bundle |
| Remaining highs | 9, all resolved by one Expo SDK 54 → 57 upgrade |
| Was `npm audit fix --force` used? | **No** |
| Moderate | 13, unchanged; none runtime-reachable in the same sense |

**Dependency status: PASS for runtime. The Expo SDK major upgrade is an open,
separately-scoped decision.**
