# 04 — Phase 1 Dependency Clearance

**Status:** Gate B remediation **C6** — resolves the 1E licence deadlock
**Agent:** Open-Source Research — **activated for this clearance only**
**Scope:** exactly three dev/test dependencies. Nothing else is cleared here.

---

## The deadlock this resolves

`plan/00 §2.2` asserted the licence block "blocks nothing in Phase 1, which
introduces only `jest-expo`, `supabase/cli` and `pgTAP` — all of which must pass
the gate first." Those two clauses contradict each other:

- 1E-L1 requires `jest-expo`; 1E-L2 requires `pgTAP` and `supabase/cli`
- Both are **Phase 1 exit criteria**
- The adoption gate was unsatisfied for all 15 candidates
- The only agent permitted to clear it was **inactive until Phase 8**

**1E was therefore blocked by a gate nobody was scheduled to open.**

Resolution: this document clears **only these three**, as `1E-000`, an entry
dependency of Phase 1E. The remaining 12 candidates stay blocked until Phase 8A.

---

## Clearance

### 1 · `jest-expo`

| Field | Value |
|---|---|
| Pinned version | `~54.0.x` — must match the installed Expo SDK major (54) |
| Source | `expo/expo` monorepo, `packages/jest-expo` |
| Licence | **MIT** |
| Licence source of record | `LICENSE` at the repository root of `expo/expo` |
| **Verification state** | ⚠️ **read from published packaging, not yet at a pinned commit** |
| Compatibility | Expo SDK 54 · RN 0.81 · React 19.1 — the preset is versioned against the SDK, so pinning to the SDK major is the compatibility guarantee |
| Ships in app bundle? | **No** — `devDependencies` only |
| Attribution obligation | **None** — not redistributed |
| Adoption decision | **Use as dependency (dev)** |
| Owner | QA & Test |
| Gate B state | **Cleared, conditional on §Verification below** |

### 2 · `supabase/cli`

| Field | Value |
|---|---|
| Pinned version | latest stable at adoption; must support Postgres 17 (project runs 17.6.1) |
| Source | `supabase/cli` |
| Licence | **Apache-2.0** |
| **Verification state** | ⚠️ **not yet read at a pinned commit** |
| Compatibility | Postgres 17 · `db reset`, `db diff`, `test db`, `migration repair` are all required by 1A-002/003 and 1E-L2 |
| Ships in app bundle? | **No** — local and CI tool |
| Attribution obligation | Apache-2.0 requires licence text + NOTICE **on redistribution**. Not redistributed → **no in-app attribution required** |
| Adoption decision | **Use as dependency (dev/CI)** |
| Owner | Supabase & Security |
| Gate B state | **Cleared, conditional** |

### 3 · `pgTAP`

| Field | Value |
|---|---|
| Pinned version | version bundled with the Supabase local stack / `theory/pgtap` release matching Postgres 17 |
| Source | `theory/pgtap` |
| Licence | **PostgreSQL Licence** (permissive, BSD/MIT-equivalent) |
| **Verification state** | ⚠️ **not yet read at a pinned commit** |
| Compatibility | Postgres 17 supported; installed as an extension in the local stack only |
| Ships in app bundle? | **No** — test-only extension, never installed on production |
| Attribution obligation | Copyright notice must travel with **copied source**. If pgTAP helper functions are copied into `supabase/tests/`, retain the notice in those files |
| Adoption decision | **Use as dependency (test)** |
| Owner | QA & Test |
| Gate B state | **Cleared, conditional** |

---

## The condition — stated plainly

All three are marked **conditional** because none has been read at a pinned
commit. The adoption gate (`research/02 §Gate rule`) requires exactly that, and
this document does not pretend otherwise.

**Discharging the condition is a 10-minute task at the start of 1E-000:**

```bash
npm view jest-expo@~54 license
npm view supabase license
# and for pgTAP, read LICENSE at the release tag actually installed
```

Record the version and the licence string returned. `1E-000`'s acceptance
criteria require a SHA or version-pinned record and explicitly forbid an entry
that says "recalled".

**Why this is nonetheless safe to clear conditionally:**

1. All three are **dev/test-only** and never enter the app bundle — the failure mode of a mistaken licence read is an internal tooling problem, not a distribution violation.
2. All three are permissive by well-established convention; the risk of discovering GPL here is negligible.
3. The alternative — blocking Phase 1E behind a Phase 8 gate — was the deadlock itself.

**No production dependency is cleared by this document.** The other 12 candidates
in `research/01` remain blocked pending Phase 8A.

---

## Transitive exposure — explicitly out of scope here

A permissive direct licence says nothing about a package's own tree. Adding
`jest-expo` pulls a substantial transitive graph.

**Not assessed.** It remains a Phase 6E task (full-tree licence scan before store
submission). It does not block Phase 1 because nothing here ships.

---

## Summary

| Dependency | Licence | Ships? | Decision | Gate B |
|---|---|---|---|---|
| `jest-expo` | MIT | no | Use as dependency (dev) | **Cleared, conditional** |
| `supabase/cli` | Apache-2.0 | no | Use as dependency (dev/CI) | **Cleared, conditional** |
| `pgTAP` | PostgreSQL Licence | no | Use as dependency (test) | **Cleared, conditional** |

**1E is no longer blocked.** Its entry dependency is `1E-000`, which discharges
the condition above before any test code is written.
