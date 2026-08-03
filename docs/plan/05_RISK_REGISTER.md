# 05 — Risk Register and Deferred Scope Registry

**Status:** Gate B artefact

---

## 1. Active risks

Scored `likelihood × impact`, each with a named owner and a trigger that would
force re-evaluation.

| ID | Risk | L | I | Score | Owner | Mitigation | Trigger to re-evaluate |
|---|---|---|---|---|---|---|---|
| **R-01** | **23 failures are predicted, not observed.** No device run happened. A fix could be written against a misdiagnosis | M | H | **HIGH** | QA & Test | `1E-L1a`/`1E-L1b` convert each into a failing-then-passing test **before** any fix lands; a test that does not fail first stops the task | any predicted failure that does **not** reproduce as a test |
| **R-02** | Schema reconciliation picks the wrong strategy and history is fabricated | L | H | MED | Supabase & Security | Option A recommended precisely to avoid inventing history; decision is the user's | user selects Option B |
| **R-03** | `db reset` still fails after 1A-002 — undiscovered drift | M | H | **HIGH** | Supabase & Security | 1A-001 three-way diff **before** writing the migration; 1A-003 verifies | any table/RPC the diff missed |
| **R-04** | Reanimated 3→4 under `newArchEnabled` breaks animations app-wide | M | H | **HIGH** | Repository Audit | one migration per commit; device smoke after each | any animation regression |
| **R-05** | SDK 55 forces New Arch before 2B completes | M | M | MED | Repository Audit | 2B scheduled before any SDK bump | Expo announces SDK 55 GA |
| **R-06** | A future migration silently reopens a closed Emergency Gate 0 exploit | M | H | **HIGH** | QA & Test | AC-S01..S07 are permanent regression tests | any migration touching grants |
| **R-07** | Willpower RPC changes break the habit XP trigger pipeline | L | H | MED | Supabase & Security | verified: both live callers are `SECURITY DEFINER` owned by `postgres`; AC-S07 guards it | AC-S07 fails |
| **R-08** | Retiring `backend/supabase/` before re-implementation loses `google-auth`/`notion-sync` | L | H | MED | Supabase & Security | 2C runs **only after** 1D re-implementations land | any 2C task scheduled before 1D closes |
| **R-09** | Foreign Mas Technic key is misused or leaked from this tree | L | H | MED | **user** | relocation proposal OPS-0B-001; no rotation in scope | any sign of use |
| **R-10** | Pruned `.claude/settings.local.json` passwords are still live | M | M | MED | **user** | entries removed from the repo; rotation is the user's (H-02) | any sign of unauthorised access on those accounts, or H-02 being answered either way |
| **R-11** | Adopting an OSS repo whose licence was never read at the pinned commit | M | M | MED | Open-Source Research | adoption gate: 0/15 currently satisfy it | any adoption attempt |
| **R-12** | Transitive GPL/AGPL in the resolved dependency tree | L | H | MED | Open-Source Research | full-tree licence scan is a Phase 6E task | store submission |
| **R-13** | `awwwards-loop` stays blocked; design never gets rendered evidence | M | M | MED | Mobile Design System | three unblock options in design/02 §R6 | Phase 5F start |
| **R-14** | Accessibility work is deferred repeatedly because it is never a blocker | **H** | M | **HIGH** | Mobile Design System | Gate C blocks any *new* sub-44pt element; Phase 5 exit criteria are numeric | any phase closing with a11y untouched |
| **R-15** | Fixing dates in `lib/` while screens keep deriving their own | M | M | MED | Habit Domain | 1B-002 covers stores; a lint rule bans the pattern repo-wide | any new `toISOString().slice(0,10)` |
| **R-16** | Session/context limits interrupt a multi-file change midway | **H** | M | MED | all | small tasks (0 XL, max 5 files); commit per task; typecheck before each commit | any task left with an uncommitted partial edit, or any task growing past 5 files mid-flight |
| **R-17** | Product decisions (bad habits, webhooks, export) never made, so 2A stalls | M | M | MED | **user** | decision list in the Gate B report §6 | 2A start |
| **R-18** | Supabase free-tier project auto-pauses again mid-work | **H** | L | MED | Supabase & Security | restore is one call; `INACTIVE` returns misleading empties — always check status first | any empty result |

### The three highest

- **R-01** is the deepest. Everything downstream assumes the diagnoses in doc 06 are right. The mitigation is not "test more later" — it is that **no fix lands before a test reproduces the defect**.
- **R-14** is the most likely to actually happen. Accessibility has no natural forcing function; it is never what blocks a release until a store review or a user complains.
- **R-06** is the one that would undo completed work. Two migrations closed real exploits; without permanent regression tests a future migration reopens them silently.

---

## 2. Deferred Scope Registry

Work consciously **not** being done, with the reason and the condition that would
change it. Nothing here is forgotten; everything here is a decision.

| ID | Deferred | Reason | Revisit when |
|---|---|---|---|
| **D-01** | Git history cleanup (~13,500 cache blobs) | Phase 7 by design. `.git` is 45 MB. **Not a security matter** — the full-history scan found no committed credential | repo size becomes an actual problem, **and** explicit history-rewrite approval is given |
| **D-02** | Offline-first architecture | **No offline requirement exists** anywhere in the product or docs. Adopting SQLite + a sync engine + conflict rules would answer an unasked question | offline becomes a stated product requirement |
| **D-03** | TanStack Query / data-layer framework | The actual defect is discarded `error` values. A framework to fix a missing null-check is disproportionate | store layer keeps generating defects after Phase 2 |
| **D-04** | Repository/service layer over Supabase | Real smell (22 stores call Supabase directly) but a large rewrite. P1 pattern captures most of the benefit | after Phase 2, if justified |
| **D-05** | Zustand slice refactor | Maintainability, not correctness. `focusStore` owns three domains | Phase 2, if the store layer is still a defect source |
| **D-06** | Rebuilding the 19 missing migrations individually | Would fabricate history nobody has | never — superseded by the squashed baseline |
| **D-07** | Real IAP (App Store / Play) | Paywall is a disclosed mock; the mock RPC is revoked and `__DEV__`-gated | monetisation is activated |
| **D-08** | `backend/server.py` decision | Unauthenticated FastAPI/Mongo service, appears dead. **Not confirmed unreachable** | Phase 2C — escalates to P0 if found reachable |
| **D-09** | Sleep tracking (reference REF-078/080) | Reference values are fixtures; real implementation needs a health data source | health integration is scoped |
| **D-10** | Kanban board, project colour wheel, planner wizard | Phase 3 REF parity; not correctness | Phase 3 |
| **D-11** | `notion-auth` 341-line variant | Classified legacy/superseded; incompatible with live schema | never, unless its DB-provisioning feature is wanted |
| **D-12** | Full E2E + device matrix | Phase 6A. No CI exists to run it in | Phase 2D establishes the foundation |
| **D-13** | `search_path` pinning on 17 SECURITY DEFINER functions | P2 hardening. Exploitation needs schema-create rights `authenticated` lacks | Phase 1D, with the body hardening |
| **D-14** | `react-native-animatable` removal | Two animation systems coexist; removal is bundled with the Reanimated upgrade | Phase 2B |
| **D-15** | In-app licences screen | No third-party code ships requiring attribution *yet* | first attributed dependency, or Phase 6E |
| **D-16** | Debug screenshots (`ss_*.png`) in the repo | Committed for a clean tree; ~130 KB, harmless | Phase 2 cleanup |
| **D-17** | **`1B-009`** — the remaining 5 UTC date sites in `frontend/app/**` | `1B-008` covers the 5 highest-impact screens. The rest are lower-traffic and share an owner with the Phase 2A `hub.tsx` orphan work, so they are done together | **Phase 2A**. Escalates immediately if any of the 5 turns out to drive a user-visible date, as `today.tsx` did |

### Added at Gate B remediation round 2

`R-19` was referenced in `07_GATE_B_REMEDIATION_REPORT.md` while existing nowhere
in this register — the reference pointed at nothing. It is now a real entry, with
four further risks the round-2 review exposed as distinct failure classes.

| ID | Risk | L | I | Score | Owner | Mitigation | Trigger to re-evaluate |
|---|---|---|---|---|---|---|---|
| **R-19** | **Redeploying the stale `generate-routine`.** The committed file supports 2 modes; the app sends 4; deployed is **v11**. `1D-001..004` all modify and redeploy this file, so any of them could ship a function that silently breaks two working AI modes | **H** | H | **HIGH** | Supabase & Security | **`1D-000` must land before any 1D deploy** — it reconciles the committed file against v11. Encoded in `depends_on` in the **task blocks** of `1D-001` and `1D-003` and in their index rows, not only stated here. All five tasks touching this file form one chain: `1D-000` → `1D-001` → `1D-002` → `1D-003` → `1D-004` | any 1D deploy scheduled before `1D-000` closes; any new mode added to the client |
| **R-20** | **Demo seeder pollutes real user data.** `seedDemoData()` writes to **8 tables** including `willpower_state`, with no `__DEV__` guard and no `is_demo` marker. Seeded rows are indistinguishable from real ones and corrupt exactly the metrics 1B and 1C exist to fix | **H** | H | **HIGH** | Habit Domain (`DEMO-001A`) + Expo Architecture (`DEMO-001B`) | Guard at both the library and the UI, sharing one predicate. Read-only detection plan for already-seeded data; **cleanup requires separate approval** — no heuristic delete | any report of anomalous metrics from a user who may have tapped the row; discovery of a seed path not covered by the guard |
| **R-21** | **Ownership drift.** Two rounds of review found files with two edit owners, tasks violating their own agent's prohibition, and one document asserting a rule it contradicted elsewhere. Concurrent edits to one file produce lost work or a silent overwrite | **H** | M | **HIGH** | Skeptical Reviewer | `plan/04` now has **exactly one** assignment table, regenerated from `plan/01` scope fields rather than hand-maintained. Ownership is **recomputed programmatically** at every gate, never asserted | any new task added without recomputing the ownership matrix; any file appearing in two agents' scopes |
| **R-22** | **Stale canonical metrics.** The same counting error survived a full remediation round because the verification grep was narrower than the phrasings in use. Numbers stated in one document and copied into six others drift silently | **H** | M | **HIGH** | Skeptical Reviewer | `08_CANONICAL_METRICS.md` is the sole source. Sweep is a **numeric scan with context matching**, not a phrase grep, and distinguishes a live assertion from a deliberate quotation of a corrected value | any count restated outside `plan/08`; any gate review that finds a figure disagreeing with it |
| **R-23** | **Licence-condition drift.** `jest-expo`, `supabase/cli` and `pgTAP` were cleared *conditionally* — none read at a pinned version. A conditional clearance that is never discharged becomes a permanent unverified assumption | M | M | MED | Open-Source Research (`1E-000`) | `research/04` now carries pinned versions, an install task, a validation command, a rollback and an explicit **condition-to-PASS**. `1E-000` blocks `1E-L1`/`1E-L2` in `depends_on` | any test code written before `1E-000` closes; any of the three proving non-permissive; any version bump away from the pin |

---

## 3. Risks explicitly accepted

| Risk | Why accepted |
|---|---|
| `.git` stays 45 MB | Clone cost only. Rewriting history breaks every existing clone and SHA — worse than the problem |
| Free-tier auto-pause | Restore is one call; no data loss. Paying to avoid it is not justified pre-launch |
| Turkish-only product | No i18n requirement surfaced. Adding a framework speculatively is unjustified |
| `skipLibCheck: true` | Masks SDK type skew, but removing it before 2B would produce noise, not signal |
| Mock paywall in dev | Disclosed to the user, revoked server-side, `__DEV__`-gated |

---

## 4. Register maintenance

- Reviewed at every phase boundary.
- A `HIGH` risk that materialises **stops the phase** — it does not become a footnote.
- Deferred items are re-read at each gate; a deferral that no longer holds is promoted to the backlog, not silently kept.
- New risks are added with the same fields. A risk without an owner and a trigger is not a risk entry, it is a worry.
