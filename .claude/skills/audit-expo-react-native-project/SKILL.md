# Audit Expo React Native Project

**Purpose:** Audit an Expo/React Native project against evidence, never against filenames.

**Status:** `Created` - not yet validated on a task

## When to use
Starting work on an unfamiliar Expo codebase, or re-baselining one before a release.

## When NOT to use
Not for the database (use `audit-supabase-security`) and not for design scoring (`design-mobile-product-system`).

## Inputs
Repository root - lockfiles - `app.json` - ability to run read-only commands.

## Outputs
`docs/audit/00_REPOSITORY_BASELINE.md` and `02_BUILD_RUNTIME_AND_DEPENDENCY_AUDIT.md`, every claim carrying `file:line` or a command result.

## Steps
1. Run `git status --porcelain | wc -l` and `git ls-tree -r --name-only HEAD | wc -l`. **Compare them.** A large gap can mean source is uncommitted - check before anything else.
2. For 3-5 critical files run `git log --all --oneline -- <path>`. Empty output means that file has never been committed.
3. Group tracked files by top directory. Generated output (`.metro-cache`, `dist`, `node_modules`) appearing there is a hygiene defect.
4. Run `npx tsc --noEmit`, `npx eslint .`, `npx expo-doctor`. Record exit codes and full counts.
5. Classify EVERY lint finding as cosmetic / potential runtime bug / confirmed runtime bug / intentional / unknown. Read the code at the reported line before classifying.
6. Reconcile the `packageManager` field against the lockfiles actually present.
7. Check `app.json` `newArchEnabled` against the Reanimated major version.

## Prohibitions
- Never run an install - it mutates the tree you are auditing.
- Never call a lint rule cosmetic without reading its site.
- Never treat a filename as evidence that a feature works.
- Never grep only for TODO/FIXME. A codebase with zero markers can still be full of unreachable code.

## Quality criteria
Every number reproducible by a stated command. Anything unproven says `UNVERIFIED`.

## Validation
`npx tsc --noEmit` - `npx eslint . -f json` - `npx expo-doctor` - `git ls-tree -r --name-only HEAD | wc -l`

## Definition of done
Baseline and build documents exist; every lint finding classified; package manager resolved or flagged; no claim rests on a filename.

---

## Related
See `docs/skills/00_SKILL_MANIFEST.md` for status and ownership.
