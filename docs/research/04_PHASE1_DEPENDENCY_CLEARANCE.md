# 04 — Phase 1 Dependency Clearance

**Status:** Gate B remediation **C6**, made **executable** at round 2
**Agent:** Open-Source Research — activated for this clearance only
**Scope:** exactly three dev/test dependencies. Nothing else is cleared here.

---

## The deadlock this resolves

`plan/00 §2.2` asserted the licence block "blocks nothing in Phase 1, which
introduces only `jest-expo`, `supabase/cli` and `pgTAP` — all of which must pass
the gate first." Those two clauses contradict each other:

- `1E-L1` requires `jest-expo`; `1E-L2` requires `pgTAP` and `supabase/cli`
- Both are **Phase 1 exit criteria**
- The adoption gate was unsatisfied for all 15 candidates
- The only agent permitted to clear it was **inactive until Phase 8**

**1E was blocked by a gate nobody was scheduled to open.** This document clears
only these three, as `1E-000`, an entry dependency of Phase 1E. The remaining 12
candidates stay blocked until Phase 8A.

---

## What changed at round 2

The round-2 reviewer accepted the deadlock as genuinely resolved but flagged that
"**conditional clearance**" was left undefined — no pinned version, no command,
no owner, no statement of what would turn it into a PASS. A condition that cannot
be discharged is not a condition; it is an unverified assumption with a label.

**Every entry below now carries eight executable fields.** The clearance is
`PENDING` until `1E-000` runs the stated commands and records the results. Gate B
does **not** depend on these tools being installed — it depends on the procedure
being unambiguous, which it now is.

---

## 1 · `jest-expo`

| Field | Value |
|---|---|
| **Exact pinned version** | `jest-expo@~54.0.0` — must match the installed Expo SDK major (**54**). Resolve to a concrete patch at install and record it |
| **Official licence source** | `LICENSE` at the root of `github.com/expo/expo` (the monorepo containing `packages/jest-expo`), read **at the tag matching the resolved version** |
| Expected licence | **MIT** |
| **Compatibility source** | `package.json` `peerDependencies` of the resolved version, plus the Expo SDK 54 release notes. Required: RN 0.81 · React 19.1 · Node 18+ |
| **Approval owner** | Open-Source Research proposes · **QA & Test accepts** (it is QA's tool) |
| **Install task** | `OPS-1E-001` (Repository Audit) adds it to `devDependencies`. Open-Source Research does **not** edit `package.json` |
| **Validation command** | `npm view jest-expo@~54 version license` → records version + licence string; `npx jest --version` succeeds after install |
| **Rollback** | `npm uninstall jest-expo` and revert `package.json`/lockfile. Nothing else consumes it; no production code imports it |
| **Condition to PASS** | Resolved version recorded **and** licence string returns `MIT` **and** it appears only under `devDependencies` |

## 2 · `supabase/cli`

| Field | Value |
|---|---|
| **Exact pinned version** | Latest stable supporting **Postgres 17** (the project runs 17.6.1). Pin the exact version string at install; do not float |
| **Official licence source** | `LICENSE` at the root of `github.com/supabase/cli`, read at the pinned release tag |
| Expected licence | **Apache-2.0** |
| **Compatibility source** | The CLI release notes for Postgres 17 support. Required subcommands: `db reset`, `db diff`, `test db`, `migration repair` — all used by `1A-002`, `1A-003` and `1E-L2` |
| **Approval owner** | Open-Source Research proposes · **Supabase & Security accepts** |
| **Install task** | Machine-level tool, not a repo dependency. Installed by the operator; version recorded in `1E-000`'s output |
| **Validation command** | `supabase --version` matches the pin · `supabase test db --help` exits 0 · **`docker info` succeeds** (H-13) |
| **Rollback** | Uninstall the CLI. No repository artefact changes, so nothing to revert in git |
| **Condition to PASS** | Version recorded · licence confirmed Apache-2.0 · the four subcommands present · **not** added to `package.json` |

> Apache-2.0 requires licence text and NOTICE **on redistribution**. This is a
> local and CI tool that is never redistributed, so **no in-app attribution
> obligation arises**. Recorded explicitly so it is not re-litigated later.

## 3 · `pgTAP`

| Field | Value |
|---|---|
| **Exact pinned version** | The version bundled with the pinned Supabase local stack. If installed separately, the `theory/pgtap` release tag compatible with Postgres 17 |
| **Official licence source** | `LICENSE` in `github.com/theory/pgtap` at that release tag |
| Expected licence | **PostgreSQL Licence** (permissive, BSD/MIT-equivalent) |
| **Compatibility source** | pgTAP release notes for Postgres 17 |
| **Approval owner** | Open-Source Research proposes · **QA & Test accepts** |
| **Install task** | `1E-L2` enables the extension **on the local stack only** — `CREATE EXTENSION IF NOT EXISTS pgtap;` inside the test setup |
| **Validation command** | `supabase test db` executes a trivial `SELECT plan(1); SELECT pass('ok'); SELECT * FROM finish();` and reports green |
| **Rollback** | `DROP EXTENSION pgtap;` on the local stack. **Never installed on the live project**, so there is nothing to roll back there |
| **Condition to PASS** | Release tag recorded · licence confirmed · extension present **only** on local · confirmed absent from the live extension list |

> **Never install pgTAP on the live project.** It is a test-only extension. If
> pgTAP helper source is ever copied into `supabase/tests/`, the copyright notice
> travels with the copied file.

---

## Summary

| Dependency | Licence expected | Ships in bundle? | Install task | Accepting owner | State |
|---|---|---|---|---|---|
| `jest-expo` | MIT | **no** — devDependency | `OPS-1E-001` | QA & Test | **PENDING `1E-000`** |
| `supabase/cli` | Apache-2.0 | **no** — machine tool | operator | Supabase & Security | **PENDING `1E-000`** |
| `pgTAP` | PostgreSQL | **no** — local test extension | `1E-L2` | QA & Test | **PENDING `1E-000`** |

**No production dependency is cleared by this document.** The other 12 candidates
in `research/01` remain blocked pending Phase 8A.

### What `PENDING` means, precisely

It is **not** a soft PASS. `1E-000` is a `MUST` task and a hard `depends_on` of
`1E-L1` and `1E-L2`: **no test code may be written until all three rows above
read PASS.** Each becomes PASS only when its stated validation command has been
run and its resolved version and licence string recorded — `1E-000`'s acceptance
criteria forbid an entry that says "recalled" or "expected".

If any of the three returns a non-permissive licence, `1E-000` **fails** and the
tool is not adopted; Phase 1E is re-planned around a replacement. That outcome is
unlikely — all three are permissive by long-established convention — but the
procedure does not assume it.

---

## Transitive exposure — explicitly out of scope

A permissive direct licence says nothing about a package's own dependency tree,
and `jest-expo` pulls a substantial one.

**Not assessed here.** Full-tree licence scanning is a **Phase 6E** task, before
store submission. It does not block Phase 1 because nothing in this document
ships in the app bundle. Recorded as risk **R-23**.
