# 00 — Repository Baseline

**Status:** `Verified`
**Captured:** 2026-08-02
**Scope:** state of the repository at the moment the audit began, before any change.

Every row below is a command result, not an inference. Where a fact could not be
established, it is marked `UNVERIFIED` rather than estimated.

---

## 1. Git state at audit start

| Item | Value | Command |
|---|---|---|
| Remote | `aydinogluomer-sys/Mobile_Uygulama` | `git remote -v` |
| Branch | `main` | `git branch --show-current` |
| HEAD | `3f811b5ec7942fd0e19bc8b27ca1035aa0600ab5` | `git rev-parse HEAD` |
| HEAD subject | `feat: refine auth inputs and report actions` | `git log -1` |
| Commits reachable | 90 | `git rev-list --count HEAD` |
| Working-tree entries | **16,572** | `git status --porcelain` |
| `.git` size | 47 MB | `du -sh .git` |

### The defining anomaly

```
git ls-tree -r --name-only HEAD | wc -l                     -> 13,602
git ls-tree -r --name-only HEAD | grep -c metro-cache       -> 13,534
git ls-tree -r --name-only HEAD | grep -vc metro-cache      ->     68
```

**13,534 of 13,602 tracked files were Metro build cache.** Only 68 real files
were committed. The remaining 268 real files — 26 Zustand stores, ~25 screens,
~44 components, every Supabase migration and every edge function — were staged
but had **never been committed to any branch**:

```
git log --all --oneline -- frontend/store/habitStore.ts      -> (empty)
git log --all --oneline -- frontend/app/screens/journal.tsx  -> (empty)
git log --all --oneline -- supabase/migrations/001_*.sql     -> (empty)
```

A `git reset --hard`, a failed merge, or a clean checkout would have destroyed
the application. This is the finding that drove Phase 0A to the front of the plan.

### Commit-history character

The 90 commits are dominated by machine-generated messages — `auto-commit for
<uuid>` appears 85 times. Only five commits carry human intent
(`feat: refine auth inputs and report actions`, `feat(takvim): aylık mevsimsel
arka plan görselleri`, and three earlier). Commit history is therefore **not a
reliable record of when features were written**, and was not used as evidence
anywhere in this audit.

---

## 2. Technology stack

| Layer | Technology | Version | Source |
|---|---|---|---|
| Runtime | Expo | `^54.0.31` | `frontend/package.json:24` |
| Framework | React Native | `0.81.5` | `frontend/package.json:41` |
| UI runtime | React / React DOM | `19.1.0` | `frontend/package.json:39-40` |
| Routing | expo-router | `~5.1.4` | `frontend/package.json:33` |
| State | Zustand | `^5.0.10` | `frontend/package.json:52` |
| Backend SDK | @supabase/supabase-js | `^2.107.0` | `frontend/package.json:21` |
| Animation | react-native-reanimated | `~3.17.4` | `frontend/package.json:46` |
| Gestures | react-native-gesture-handler | `~2.24.0` | `frontend/package.json:44` |
| Dates | date-fns | `^4.1.0` | `frontend/package.json:23` |
| Language | TypeScript | `strict: true` | `frontend/tsconfig.json:4` |
| Database | Supabase Postgres 17.6 | project `kbcuolhjjnmhjaarxxmu` | `get_project` |
| Edge runtime | Deno (Supabase Functions) | — | `supabase/functions/**` |
| Legacy backend | FastAPI + MongoDB | — | `backend/server.py` |

RN 0.81 + React 19.1 is the correct pairing for Expo SDK 54. Several other
packages are still pinned at SDK 53 levels — analysed in `02_BUILD_RUNTIME_AND_DEPENDENCY_AUDIT.md`.

---

## 3. Package manager — unresolved inconsistency

| Signal | Value |
|---|---|
| `frontend/package.json:63` | `"packageManager": "yarn@1.22.22+sha512..."` |
| Lockfile actually present | `frontend/package-lock.json` (npm) |
| `frontend/yarn.lock` | **absent** |
| `frontend/pnpm-lock.yaml` | **absent** |

The project declares Yarn 1 but ships only an npm lockfile. `yarn install
--frozen-lockfile` cannot succeed — there is no `yarn.lock` to freeze against,
and Yarn would resolve a dependency tree different from the committed one.

**All commands in this audit were run with `npx`, which is package-manager
neutral, so no install was performed and the tree was not mutated.** Resolving
this belongs to Phase 2B.

## 4. Commands

```bash
cd frontend
npm install              # matches the committed package-lock.json
npm start                # expo start
npm run android | ios | web
npm run lint             # expo lint
npx tsc --noEmit         # no `typecheck` script exists
node run-tests.js        # not wired to any script; not a real test suite
```

There is **no `test` script and no `typecheck` script** in `frontend/package.json:5-13`.

---

## 5. Directory map

```
Mobile_Uygulama/
├── frontend/                    Expo app - the product
│   ├── app/          40 files   expo-router tree: (auth)/ tabs/ screens/
│   ├── components/   44 files   ui/ today/ focus/ seasonalMotion/ + top-level
│   ├── lib/          20 files   supabase client, domain helpers, tokens
│   ├── store/        26 files   Zustand stores (one per domain)
│   ├── constants/     2 files   features, integrations catalogues
│   ├── utils/                   legacy axios client -> localhost:8000
│   ├── types/                   dead MongoDB-era types (see doc 07)
│   ├── assets/                  fonts, icons, 12 monthly WebP backgrounds
│   ├── scripts/                 postinstall node_modules patch + helpers
│   ├── awwwards-loop/           prior design-iteration state (blocked)
│   ├── .metro-cache/  4,373 f.  generated - untracked as of Phase 0A
│   └── dist/          9.4 MB    web build output - gitignored
├── supabase/                    CANONICAL CANDIDATE (project kbcuolhjjnmhjaarxxmu)
│   ├── migrations/    2 files   001_initial_schema, 002_integrations
│   └── functions/     4 fns     generate-routine, notion-auth,
│                                spotify-auth, subscription-webhook
├── backend/
│   ├── server.py                unauthenticated FastAPI + Mongo (legacy)
│   └── supabase/functions/      4 fns, linked to a DIFFERENT project
│                                (zdqiujpeewtyhtcqhdcj "Mas Technic Site")
├── obsidian-atlas-plugin/       companion Obsidian plugin
├── obsidian-api/                vendored upstream clone (own .git; untracked)
├── docs/                        this audit
└── implementation*.md  ~95 KB   design/spec documents (claims, not proof)
```

**Source size:** 23,611 LOC across 130 `.ts`/`.tsx` files under
`app components lib store constants utils types`.

---

## 6. Repository weight

| Contributor | Size | Tracked? |
|---|---|---|
| `frontend/.metro-cache/` | 76 MB, 4,373 files on disk | was tracked (13,534 blobs in history); untracked as of Phase 0A |
| `frontend/dist/` | 9.4 MB | no — gitignored |
| `frontend/node_modules/` | — | no — gitignored |
| `obsidian-atlas-plugin/node_modules/` | — | no — gitignored |
| `frontend/assets/images/months/` | 12 WebP | yes — legitimate product assets |
| `ss_*.png` | 10 files, ~130 KB | yes — debug screenshots, removal candidates |

`.git` is 45 MB after Phase 0A. It does not shrink from untracking, because the
old cache blobs remain reachable from historical commits. Removing them requires
history rewriting, which is **Phase 7** and gated on explicit approval.

---

## 7. Baseline health checks

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0) | clean under `strict: true`, zero `@ts-ignore` in the codebase |
| `npx eslint .` | 23 errors, 82 warnings | **classification pending** — see doc 02 |
| App boots on device | `UNVERIFIED` | not attempted; the Supabase project is paused, so a device run cannot exercise auth or data |
| Supabase reachable | **NO** | `get_project` returns `"status":"INACTIVE"` |

### Lint breakdown (raw, unclassified)

| Rule | Count | Severity |
|---|---|---|
| `react-hooks/exhaustive-deps` | 43 | warning |
| `@typescript-eslint/no-unused-vars` | 21 | warning |
| `react/no-unescaped-entities` | 21 | **error** |
| `import/first` | 7 | warning |
| `@typescript-eslint/array-type` | 6 | warning |
| `no-unused-expressions` | 4 | warning |
| `no-undef` | 2 | **error** |
| `import/no-named-as-default-member` | 1 | warning |

`no-undef` and the 43 `exhaustive-deps` warnings are **not** assumed cosmetic.
Stale closures are a known source of silent state bugs, and each finding is
classified individually in doc 02.

---

## 8. State after Phase 0A

| Item | Before | After |
|---|---|---|
| Branch | `main` | `chore/commit-baseline` |
| Tracked files in HEAD | 13,602 | **317** |
| Tracked `.metro-cache` files | 13,534 | **0** |
| Working-tree entries | 16,572 | **0 (clean)** |
| Source files in history | 68 | **all** |
| `npx tsc --noEmit` | PASS | **PASS** |

Ten commits, listed in `01_REPOSITORY_HYGIENE_AND_SECURITY.md §5`.

---

## 9. Assumptions made during this audit

1. `personal-os-v2 (8).html` at `~/Desktop/Yazılım Projeleri/` is the intended
   design reference. It lives outside the repository and is not version
   controlled. A second path, `~/Desktop/personal-os-v2 (8).html`, is referenced
   by `frontend/awwwards-loop/state.json:12`; whether the two are identical is
   `UNVERIFIED`.
2. `supabase/` (project `kbcuolhjjnmhjaarxxmu`) is the app's real backend,
   corroborated by `implementation.md:534`. Formally declared in Phase 0C.
3. `backend/server.py` is dead legacy. **Not confirmed** — if it is deployed and
   reachable it escalates to P0 (unauthenticated, ~30 endpoints).
4. Documentation is treated as claims requiring verification, never as evidence.
   Doc 02 lists specific `implementation.md` claims the code contradicts.
5. No dependency install was performed, so `node_modules` reflects whatever was
   already present on this machine.
