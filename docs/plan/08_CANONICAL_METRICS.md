# 08 — Canonical Metrics

**Status:** authoritative · **single source of truth for every count in this project**
**Recomputed:** 2026-08-03, Gate B remediation C3/C4

> **Rule:** no other document states a count. Every document references this table.
> If a figure here changes, it changes in exactly one place.

---

## 1. The table

| Metric | **Value** | How it is derived |
|---|---|---|
| **E2E cases** (doc 06) | **62** | `grep -c "^\| E2E-" docs/audit/06_*.md` |
| — VERIFIED PASS | **16** | rows matching `VERIFIED-DB` or `VERIFIED-STATIC` |
| — VERIFIED FAIL | **7** | rows matching `VERIFIED FAIL` |
| — **PREDICTED FAIL** | **23** | rows matching `PREDICTED FAIL` |
| — BLOCKED-DEVICE | **15** | rows matching `BLOCKED-DEVICE` |
| — BLOCKED-WRITE | **1** | rows matching `BLOCKED-WRITE` |
| — sum check | **62** ✓ | 16+7+23+15+1 |
| **Acceptance criteria** (qa/02) | **91** | 51 individually-listed (blocks A–E) + 40 ranged (block F) |
| — individually listed rows | **51** | blocks A(10) B(10) C(9) D(16) E(6) |
| — **known failing** | **32** | rows marked FAIL |
| — **failing at Layer 1** | **14** | failing rows with layer `L1` |
| — failing at Layer 2 | **17** | 11 explicit `L2` + 6 in block E (section-level `L2`) |
| — failing, mixed layer | **1** | AC-I02 is `L1+L2` |
| — sum check | **32** ✓ | 14+17+1 |
| **Open P1 findings** (doc 09 §5) | **13 rows** | table row count |
| — underlying defects | **~24** | several rows aggregate (DOMAIN=4, WILL=4, SEC=3, B1/B2=2) |
| **Live migration ledger** | **21** | `list_migrations` on `kbcuolhjjnmhjaarxxmu` |
| **Repo migration files** | **4** | `ls supabase/migrations \| wc -l` |
| — matching a ledger entry | **2** | the two Emergency Gate 0 migrations |
| — **history gap** | **19** | 21 − 2 |
| **Backlog tasks** | **49** | task index rows (round 2) |
| — DONE | **1** | 1D-010, commit `42b64a0` |
| — **open** | **48** | 49 − 1 |
| — fully specified | **48** | every open task has all 13 fields |
| — XL | **0** | largest is M (S=24, M=16, XS=8) |
| — scope > 5 files | **0** | scope field |
| — dependency cycles | **0** | DFS over every `depends_on` |
| — cross-listing pointers | **1** | `1B-006` → `DEMO-001A`/`B`; **not** a task, not indexed |
| **Files with two edit owners** | **0** | ownership matrix regenerated from scope fields |
| **`never touches` violations** | **0** | same |
| Distinct Phase 1 files | **70** | same |
| **Live tables** | **48** | `pg_tables where schemaname='public'` |
| — with RLS enabled | **48** | `rowsecurity = true` |
| — ERROR-level advisors | **0** | `get_advisors(security)` |
| **Gate A deliverables** | **19** | + 1 gate record = 20 files |
| **Gate B artefacts** | **5** | 00, 02, 03, 04, 05 |
| **Skills** | **10** | all `Validated on one task`; 0 `Applied project-wide` |
| **Parity** | see §3 | **not restated** — the totals are unreconciled |

---

## 2. Corrections applied

Every figure below was **wrong** in a previously-committed document and is now
corrected everywhere.

| Metric | Was | **Is** | Where it appeared |
|---|---|---|---|
| E2E cases | 58 | **62** | doc 06 §9, qa/02 header, doc 09 |
| VERIFIED PASS | 12 | **16** | doc 06 §9 |
| VERIFIED FAIL | 6 | **7** | doc 06 §9 |
| PREDICTED FAIL | 21 | **23** | doc 06 §9, plan/00, plan/03, plan/05 R-01, doc 09, qa/01 |
| BLOCKED-DEVICE | 18 | **15** | doc 06 §9 |
| **Failing L1 criteria** | **20** | **14** | plan/00 §2.3 & §4, plan/02 §1/§4/§7, plan/03, qa/02 §Summary |
| Live migrations | 20 *(in plan/01)* | **21** | plan/01 |
| Repo migrations | 3 *(in plan/01)* | **4** | plan/01 |
| Backlog tasks | 31, then 36, then 42 | **49** | plan/01, plan/00 |

**Why 42 → 49 at round 2.** Not a counting error this time — a deliberate
structural change. The round-2 ownership rebuild could only separate the six
double-owned files by splitting the tasks that shared them: `1E-L1` → 3 tasks,
`1E-L2` → 3 tasks, `DEMO-001` → 2 tasks, plus `OPS-1E-001` (`package.json`
belongs to Repository Audit) and `1A-004` (`plan/10`'s live-cutover steps had no
owning task). **41 + 7 = 48 open, 49 rows.** No task was removed.

**The backlog count was wrong twice.** The pre-remediation figure was 31. The
first remediation pass reported 36 — also wrong, in two independent ways: it
miscounted its own index rows (37, not 36) *and* it left `SEC-1D-005a–f` as one
collapsed row standing for six tasks. A duplicate `OPS-0B-001` heading and a
`SEC-1D-005e` block missing its `goal` were found in the same recount. All four
defects are fixed in `plan/01`; the verified figure is **42 rows · 1 DONE ·
41 open · 41 fully specified**.

This is recorded rather than quietly corrected because it is the second
counting error in the same document, found by the same method — recounting from
source instead of trusting a stated total.

### The one that mattered

**"20 of 32 failing criteria are Layer 1" → 14.**

The error: I counted rows whose *layer column* said `L1` (20 of them) and
reported that as the count of *failing* L1 rows. Fourteen of those 20 are
failing; six already pass.

This figure was the **sole justification** for starting the Habit Domain stream
ahead of the H-01 schema decision, and it appeared in five places. The
justification is rebuilt from the correct number in `09_PHASE_1B_EARLY_START.md`.

---

## 3. Parity percentages — withdrawn pending recomputation

`05_FEATURE_PARITY_MATRIX.md` states totals (UI 65 %, Func 65 %, Data 91 %,
Back 91 %, UX 68 %, Test 26 %) whose numerators **do not reconcile** with the
document's own per-section subtotals. Only *Test* has a reproducible numerator.

**These percentages are withdrawn as authoritative** and must not be quoted in a
decision until recomputed (remediation **C12**, not yet done).

What survives as directionally sound, because it holds under any reasonable
recount:

- Data and backend parity are **substantially higher** than UI parity — the gaps are screens not built, not models missing
- UI and functional parity are **close to each other** — this codebase does not ship UI shells over dead logic
- Test parity is the **lowest** axis by a wide margin, and behavioural test parity is effectively **0 %**

The *conclusions* drawn from parity in the roadmap do not depend on the exact
percentages. The percentages themselves should not be cited until C12 lands.

---

## 4. Figures deliberately NOT stated

| Figure | Why |
|---|---|
| Phase durations | no device run, no baseline, no CI — any estimate would be invented |
| Bundle size | never measured |
| Frame rate / startup | never measured; `qa/03` targets are provisional |
| Contrast ratios | palette defined but ratios never computed |
| Coverage percentage | no runner exists; would be 0 % and uninformative |

---

## 5. Verification

Reproduce every §1 figure:

```bash
# E2E case counts
grep -c "^| E2E-" docs/audit/06_END_TO_END_FUNCTIONAL_AUDIT.md

# acceptance criteria: failing, and failing-at-L1
python scratchpad/count.py .

# migrations
ls supabase/migrations | wc -l          # repo
# live ledger: list_migrations on kbcuolhjjnmhjaarxxmu

# backlog tasks
grep -c "^| 1[ABCDE]-\|^| SEC-1D-\|^| DEMO-\|^| OPS-" docs/plan/01_IMPLEMENTATION_BACKLOG.md

# live tables and RLS
# select count(*), count(*) filter (where rowsecurity) from pg_tables where schemaname='public';
```

Any document that states a count contradicting §1 is stale and must be corrected
here first, then propagated.
