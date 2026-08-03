# 03 — Pattern Adoption Guide

**Status:** `Audited` — patterns identified; application is phase-assigned
**Principle:** adopt the *pattern*, not the dependency, wherever the pattern alone fixes the defect

---

## The rule this project should follow

Every candidate in doc 01 was tested against one question:

> Does this fix a defect the audit actually found, or does it fix a defect it
> would be *fashionable* to have?

Four patterns pass. Two libraries were rejected in favour of a pattern. One is a
genuine dependency the project cannot substitute.

---

## P1 · Read the error — the highest-value pattern in this codebase

**Defect.** Error results are systematically discarded:

| Site | Code |
|---|---|
| `logStore.ts:71-84` | destructures `{ data }` only — a unique-constraint violation is swallowed |
| `habitStore.ts:80,87,105` | `removeHabit`/`restoreHabit`/`purgeHabit` ignore the result entirely |
| `taskStore.ts:87` · `recoveryStore.ts:73,79,85` · `focusStore.ts:200` | same shape |

Only `googleCalendarStore` and `subscriptionStore` expose an `error` field.

**This single omission causes E2E-H04**: the double-tap *is* blocked by the
database, but the user sees nothing happen and no error.

**Pattern (no dependency):**

```ts
const { data, error } = await supabase.from('habit_logs').upsert(row).select().single();
if (error) { set({ error: error.message }); return { ok: false, error }; }
```

Plus a shared `AsyncState<T> = { data: T | null; loading: boolean; error: string | null }`
so every store exposes the same shape and screens can render one error component.

**Rejected alternative:** adopting TanStack Query for this. It would rewrite all
26 stores to fix "we forgot to check a return value." Disproportionate.
**Phase 1B/1C · every store · XS per store.**

---

## P2 · One canonical date module

**Defect.** Eight distinct date-derivation patterns, no shared helper, and
two byte-identical `ymd()` implementations (`focusReport.ts:22-24`,
`journalStats.ts:12-14`). UTC and local keys are compared against each other in
four modules.

**Pattern:**

```ts
// lib/date.ts — the only place a "today" is derived
export const todayLocal = (): string => format(new Date(), 'yyyy-MM-dd');
export const ymd = (d: Date): string => format(d, 'yyyy-MM-dd');
export const startOfWeekLocal = (d: Date) => startOfWeek(d, { weekStartsOn: 1 });
export const parseLocalDate = (s: string) => new Date(`${s}T00:00:00`);
```

Then a lint rule or review check banning `toISOString().slice(0,10)` /
`.split('T')[0]` on a local date.

`date-fns` is already a dependency. **`date-fns-tz` is only needed if the product
ever supports a timezone other than the device's** — Türkiye is permanent UTC+3
with no DST, so the immediate fix needs no new package.

**Phase 1B · `lib/date.ts` + ~8 call sites · S.**

---

## P3 · Zustand slice pattern — adapt, do not add

**Defect.** 26 stores, several owning multiple domains: `focusStore` (312 ln)
holds a timer FSM, an 18-field settings object *and* a second task CRUD surface;
`profileStore` holds identity, badges, leaderboard and rank.

**Pattern** (from `pmndrs/zustand` docs — pattern only, no new dependency):

```ts
const createTimerSlice = (set, get) => ({ /* FSM only */ });
const createSettingsSlice = (set, get) => ({ /* settings only */ });
export const useFocusStore = create((...a) => ({
  ...createTimerSlice(...a),
  ...createSettingsSlice(...a),
}));
```

Splits responsibility without changing the public API or any consumer.

**Deliberately not Phase 1.** This is a testability and maintainability
improvement, not a correctness fix. **Phase 2 · L · only if the store layer keeps
generating defects.**

---

## P4 · Two-layer testing — the one place a dependency is unavoidable

**Defect.** `run-tests.js` asserts on source **text**. It cannot detect any of
the 23 predicted failures in doc 06.

**Pattern:**

| Layer | Tool | Proves |
|---|---|---|
| 1 — unit | `jest-expo` | pure logic in `lib/` (dates, scheduling, metrics, ranks, triage) + store reducers |
| 2 — database | `supabase start` + pgTAP | RLS denies cross-tenant reads · `UNIQUE(habit_id, completed_at)` holds under concurrency · a hardened `add_xp` rejects a foreign `user_id` · willpower debit is atomic |

**Why both.** A client mock can assert that the store *called* upsert; it cannot
prove Postgres *rejected* a cross-tenant read. Layer 1 alone would produce green
tests over an insecure database.

**Phase 1E · M.**

---

## P5 · Migration-as-source-of-truth

**Defect.** 21 live migrations, 4 repo files, 2 matching. `implementation.md:159`
records that schema changes were applied via `execute_sql` on the live database
and never written back.

**Pattern:**

1. Every schema change is a file in `supabase/migrations/` **first**
2. Applied via `supabase db push` / `apply_migration` **second**
3. CI asserts `supabase db diff` is empty against a fresh reset
4. Every migration header carries pre-change state and exact rollback SQL

Steps 1–2 and 4 are already demonstrated by
`20260802181931` and `20260802205850`, both of which carry captured pre-change
ACLs and exact rollback. **The pattern is proven in this repo; it needs to become
the rule.** Step 3 is the enforcement that makes drift impossible to reintroduce.

**Phase 1A establishes the baseline · Phase 6B adds CI enforcement.**

---

## P6 · Column-level grants over policy-only protection

**Defect.** Protection currently rests on the *absence* of a policy rather than
the absence of a grant:

- `user_subscriptions` / `credit_transactions` — `anon` and `authenticated` hold `INSERT/UPDATE/DELETE/TRUNCATE`; only RLS default-deny stops them
- `profiles` — `authenticated` holds column-level `UPDATE` on **all 17 columns** including `total_xp`, `level`, `coins`

Add one permissive `FOR ALL` policy anywhere and the protection evaporates
silently.

**Pattern:** grant the minimum, then add policies. `REVOKE` unused write grants;
grant `UPDATE` only on genuinely user-editable columns.

**Verified low-risk here:** the app writes exactly three `profiles` columns
(`id`, `email`, `username`), so removing the rest cannot break a feature.

**Phase 1 · SEC-1D-004, SEC-1D-005b.**

---

## Patterns deliberately NOT adopted

| Pattern | Why not |
|---|---|
| Offline-first sync (WatermelonDB / Legend-State) | **No offline requirement exists.** Adopting an SQLite layer, sync engine and conflict rules to solve an unasked question. `Reference only`; Deferred Scope Registry. |
| Repository/service layer over Supabase | Real smell (22 stores call Supabase directly), but a full abstraction layer is a large rewrite. P1 achieves most of the benefit at a fraction of the risk. Revisit after Phase 2. |
| A third UI kit | The project has `components/ui/` used by 11 of ~103 files. The fix is *applying* it (Phase 5B), not adding another. |
| Server-driven UI | No requirement; large architectural commitment. |
| Monorepo restructure | One app, one backend. Nothing to gain. |

---

## Adoption order

| Order | Pattern | Phase | Size | Unblocks |
|---|---|---|---|---|
| 1 | P2 canonical date module | 1B | S | 7 of 8 E2E date cases |
| 2 | P1 read the error | 1B/1C | XS × N | E2E-H04 and the silent-failure class |
| 3 | P4 two-layer testing | 1E | M | every other verification |
| 4 | P5 migration-as-truth | 1A | M | reproducible environment |
| 5 | P6 minimum grants | 1D | XS–S | SEC-1D-004/005 |
| 6 | P3 store slices | 2 | L | maintainability only |

**P4 should arguably be first** — without it nothing else can be proven. It is
placed third because P2 and P1 are the failing behaviours the tests would assert,
and writing the assertions first against known-broken code is the point.
