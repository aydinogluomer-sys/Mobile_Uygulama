# 01 — GitHub Repository Shortlist

**Status:** `Audited` — shortlist produced, adoption decisions deferred to Phase 8A
**Constraint:** max 15 · scored on Expo SDK 54 + RN 0.81 fit, maintenance, licence, security, architectural fit

---

## Selection rules applied

1. **Stars were not a criterion.** Fit against *this* project's stack decided ranking.
2. **A repo enters only if it addresses a defect this audit actually found.** No speculative additions.
3. **Nothing is cloned into the production tree.** Research clones live in `.research/repositories/` (gitignored). None has been cloned yet — Phase 8A does that if a decision requires source inspection.
4. **GPL/AGPL/unclear licence → `Reference only`, never copied.**

---

## Context that shapes every recommendation

Verified this session:

> **Expo SDK 54 is the final release supporting the Legacy Architecture. The New Architecture becomes mandatory from SDK 55**, and ~83 % of SDK 54 EAS builds already run New Arch.

This project sets `newArchEnabled: true` (`app.json:10`) while pinning
`react-native-reanimated ~3.17.4` — the *legacy* line. Reanimated 4 is the New
Arch line. **Every animation-adjacent recommendation below is therefore
constrained by an upgrade the project must do anyway** (Phase 2B), and no new
animation dependency should be added before it lands.

---

## Shortlist

| # | Repository | Purpose | Licence | Fit | Decision (provisional) |
|---|---|---|---|---|---|
| 1 | `expo/expo` | SDK 54 → 55 migration reference; `expo-router` v6 codemods | MIT | direct | **Reference only** — read migration guides, do not vendor |
| 2 | `software-mansion/react-native-reanimated` | Required 3 → 4 upgrade | MIT | direct | **Use as dependency** (version bump, already present) |
| 3 | `pmndrs/zustand` | Store patterns; slice pattern for the 26-store sprawl | MIT | direct | **Adapt pattern** — slices + `subscribeWithSelector` |
| 4 | `TanStack/query` | Server-state cache, retry, invalidation — replaces hand-rolled fetch/loading/error in 26 stores | MIT | high | **Evaluate** — see risk note |
| 5 | `Nozbe/WatermelonDB` | Offline-first SQLite + sync engine | MIT | medium | **Reference only** for now — see §Offline |
| 6 | `LegendApp/legend-state` | Fine-grained reactive state with a documented Supabase sync plugin | MIT | medium | **Evaluate** against TanStack |
| 7 | `supabase/supabase-js` | Already a dependency | MIT | direct | **Use as dependency** |
| 8 | `supabase/cli` | `db diff`, `db reset`, local Postgres — the Phase 1A three-way diff and Phase 1E Layer 2 both need it | Apache-2.0 | direct | **Use as dependency** (dev) |
| 9 | `theory/pgtap` | SQL unit tests for RLS, constraints, RPC behaviour | MIT-like (PostgreSQL licence) | direct | **Use as dependency** (dev) — Phase 1E Layer 2 |
| 10 | `expo/expo` → `jest-expo` | Expo-aware Jest preset | MIT | direct | **Use as dependency** (dev) — Phase 1E Layer 1 |
| 11 | `mobile-dev-inc/maestro` | Black-box E2E; YAML flows, no app instrumentation | Apache-2.0 | high | **Evaluate** vs Detox — Phase 2D |
| 12 | `wix/Detox` | Grey-box E2E, RN-native | MIT | medium | **Evaluate** — heavier setup than Maestro |
| 13 | `date-fns/date-fns` | Already a dependency; `date-fns-tz` for the timezone cluster | MIT | direct | **Use as dependency** — add `date-fns-tz` |
| 14 | `getsentry/sentry-react-native` | Crash + error monitoring (Phase 6C) | MIT | medium | **Evaluate** — Phase 6 |
| 15 | `gitleaks/gitleaks` | Secret scanning in CI | MIT | direct | **Use as dependency** (CI) — Phase 0B used a hand-rolled equivalent because it is not installed |

---

## Per-item rationale — only where the decision is non-obvious

### 4 · TanStack Query — high value, real risk

**Problem it addresses.** 22 of 26 stores call Supabase directly with hand-rolled
`loading` flags, and **error handling is systematically absent** — `logStore.ts:71-84`,
`habitStore.ts:80,87,105`, `taskStore.ts:87`, `recoveryStore.ts:73,79,85`,
`focusStore.ts:200` all discard `error`. That is the root cause of E2E-H04
(silent duplicate-log failure).

**Risk.** Introducing it is a cross-cutting refactor of the entire data layer —
exactly the kind of large rewrite this audit warned against. It would touch all
26 stores.

**Provisional decision: `Evaluate`, do not adopt in Phase 1.** The Phase 1
error-handling fix is *reading `error` and surfacing it* — a small change per
store. If, after Phase 2, the store layer is still the main source of defects,
revisit. Adopting a data-layer framework to fix "we forgot to check errors" is
disproportionate.

### 5 & 6 · Offline-first — not yet justified

The audit found **no offline requirement**. Every screen assumes connectivity;
there is no sync queue, no conflict resolution, and no user-facing offline mode.
`README`/`implementation.md` do not promise offline.

WatermelonDB and Legend-State are both credible for Supabase sync in 2026, but
adopting either means an SQLite layer, a sync engine and conflict rules — a large
architectural commitment to solve a problem **nobody has asked for**.

**Provisional decision: `Reference only`.** Revisit only if offline becomes a
stated product requirement. Recorded in the Deferred Scope Registry.

### 9 · pgTAP — the one that unblocks a Gate

Phase 1E Layer 2 must prove RLS denies cross-tenant reads, that
`UNIQUE(habit_id, completed_at)` holds under concurrency, and that a hardened
`add_xp` rejects a foreign `user_id`. **`jest-expo` cannot prove any of that** —
client mocks do not exercise Postgres. pgTAP plus `supabase start` is the only
credible path. This is the highest-value item on the list.

### 11 vs 12 · Maestro over Detox, provisionally

Maestro needs no app instrumentation and runs YAML flows against a build.
Detox is more powerful but requires native integration and a heavier CI.
Given the project has **zero** E2E today, the lower-friction option is likelier
to actually get used. Decide in Phase 2D.

### 15 · gitleaks

Phase 0B could not run it — not installed, and the Docker daemon was down. A
hand-rolled 15-pattern scan was used instead and found one benign hit. That
scan is **not** equivalent to a maintained ruleset. Adding gitleaks to CI closes
the gap permanently.

---

## Explicitly rejected

| Candidate | Why |
|---|---|
| UI kits (NativeBase, Tamagui, gluestack) | The project already has `components/ui/` and 1,671 raw hex literals. The fix is *applying* the system it has (Phase 5B), not adding a third one. |
| Redux / Redux Toolkit | Zustand is already in place and is not the problem. |
| A charting library | `stats.tsx` already renders working charts. |
| An i18n framework | Single-locale (Turkish) product; no requirement surfaced. |
| Any AGPL-licensed sync engine | Licence gate — cannot enter a commercial mobile product. |

---

## Adoption status

**No repository has been cloned, vendored or added as a dependency by this
audit.** Every row above is a *provisional* decision. Phase 8A converts each into
a final `Use as dependency` / `Adapt pattern` / `Reference only` / `Reject`, with
the licence matrix (doc 02) as the gate.

**Sources:**
- [Expo SDK 54 changelog](https://expo.dev/changelog/sdk-54)
- [React Native New Architecture — Expo docs](https://docs.expo.dev/guides/new-architecture/)
- [Offline-first React Native with Expo, WatermelonDB and Supabase](https://supabase.com/blog/react-native-offline-first-watermelon-db)
- [Using Supabase offline — discussion #357](https://github.com/orgs/supabase/discussions/357)
