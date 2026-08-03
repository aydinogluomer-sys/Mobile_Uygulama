# 00 — Skill Manifest

**Status: 10/10 `Validated on one task` · 0/10 `Applied project-wide`**
**Location:** `.claude/skills/<name>/` — each with `SKILL.md`, `references/`, `checklists/`, `templates/`

---

## Status vocabulary

Every skill carries **exactly one** current status. `Created` is a historical
state only — once a skill has been exercised it is no longer `Created`, and
reporting both would double-count.

`Created` → `Validated on one task` → `Applied partially` → `Applied project-wide`
(or `Deprecated` / `Not yet applied`)

| Current status | Count |
|---|---|
| `Validated on one task` | **10** |
| `Applied partially` | 0 |
| `Applied project-wide` | **0** |
| `Deprecated` | 0 |
| `Not yet applied` | 0 |

---

## Manifest

| Skill | Responsibility | Input | Output | Agent | Success criterion | **Status** |
|---|---|---|---|---|---|---|
| `audit-expo-react-native-project` | Evidence-based Expo/RN audit | repo root, lockfiles, `app.json` | docs 00, 02 | Repository Audit | every number reproducible by a stated command | **Validated on one task** — produced docs 00 and 02 |
| `map-reference-html-to-mobile-features` | Reference → atomic `REF-NNN` | reference file, route tree | doc 04 | Product & Feature Parity | every REF cites reference evidence; denominator explicit | **Validated on one task** — produced doc 04 (139 requirements) |
| `verify-feature-end-to-end` | Does it actually work? | feature, entry point | doc 06 | QA & Test | every case has a verdict class; nothing passes on inference | **Validated on one task** — produced doc 06 (58 cases) |
| `design-mobile-product-system` | Design quality + system extension | tokens, components, screens | docs design/01, 02 | Mobile Design System | scores carry code evidence; `n/r` where unrendered | **Validated on one task** — produced both design docs |
| `audit-supabase-security` | Live security posture | project ref, read-only SQL | doc 07 | Supabase & Security | every claim is a query result | **Validated on one task** — produced doc 07; found the P0 payment bypass |
| `design-habit-domain-model` | Habit/streak/recovery correctness | schema, scheduling, metrics | doc 07 §5, backlog | Habit Domain | every defect has a failing input | **Validated on one task** — found 4 metric defects |
| `verify-date-time-and-streak-logic` | UTC/local defect class | date-deriving modules | doc 06 §4, qa/02 §A | Habit Domain | one canonical module; boundary tests | **Validated on one task** — found 8 patterns, 7 failing cases |
| `research-and-adapt-github-repositories` | OSS selection + licence gate | defect, stack versions | docs research/01–03 | Open-Source Research | every entry names its defect; unresolved licence = blocked | **Validated on one task** — produced all three research docs |
| `plan-small-agent-tasks` | Findings → executable backlog | audit findings | docs plan/01, 04 | (all) | no XL tasks; every task revertible | **Validated on one task** — produced the Phase 1D backlog |
| `review-mobile-release-quality` | Independent review | proposed change | review verdict | **Skeptical Reviewer** | never reviews its own work | **Validated on one task** — the two Emergency Gate 0 reviews |

---

## An honest reading of that table

Every skill says "Validated on one task" because each was exercised producing
this audit. **None is `Applied project-wide`**, and saying otherwise would be
false: they have each been used once, in one direction, by one operator.

The distinction matters most for three:

- **`review-mobile-release-quality`** is the only skill whose *value was proven by it disagreeing with the author.* Its first run corrected the rollback SQL (an `anon` grant that would have created ACL drift), corrected a "five trigger functions" claim to two, and found that the revoke does **not** close self-inflation. Its second run found the XP functions were `anon`-callable, not merely `authenticated`-callable. A skill that only ever agrees is not doing its job.
- **`verify-feature-end-to-end`** is validated but its central instruction — never mark passing without observation — has not yet been tested under pressure, because no device run happened. It will be genuinely exercised in Phase 6A.
- **`design-mobile-product-system`** produced scores with `Motion` and `Performance` marked `n/r`. That is the skill working correctly, but it means the design skill is only half-validated.

---

## Where each skill is applied next

| Phase | Skills exercised |
|---|---|
| 1A | `audit-supabase-security`, `plan-small-agent-tasks` |
| 1B | `verify-date-time-and-streak-logic`, `design-habit-domain-model` |
| 1C | `design-habit-domain-model`, `audit-supabase-security` |
| 1D | `audit-supabase-security`, `review-mobile-release-quality` |
| 1E | `verify-feature-end-to-end`, `verify-date-time-and-streak-logic` |
| 2A | `verify-feature-end-to-end` |
| 2B | `audit-expo-react-native-project`, `research-and-adapt-github-repositories` |
| 3 | `map-reference-html-to-mobile-features`, `verify-feature-end-to-end` |
| 5 | `design-mobile-product-system` |
| 6 | `review-mobile-release-quality`, `verify-feature-end-to-end` |
| 8B | all — final status assignment |

---

## Design principles these skills encode

Each was written from a mistake this audit actually made or nearly made:

| Principle | Origin |
|---|---|
| Never treat a filename as evidence | 268 files existed; most of the app was uncommitted |
| An empty result can mean "not ready", not "empty" | `list_tables` returned `[]` during a restore; reading it as data loss would have been a false finding |
| Never invoke a privileged function to test it | a "test call" on `mock_activate_subscription` would itself have granted Pro |
| Separate observed from predicted | doc 06 keeps 6 VERIFIED FAIL apart from 21 PREDICTED FAIL |
| Prefer the pattern over the dependency | TanStack Query rejected for "we forgot to check `error`" |
| Unresolved licence defaults to blocked | an unlicensed repo is not public domain |
| An author cannot review their own diff | Emergency Gate 0 was applied once without independent review — recorded as a process failure |
| A superset is not a rollback | the reviewer caught a rollback that would have added an `anon` grant that never existed |

---

## Deliberately not created

| Candidate | Why |
|---|---|
| `write-react-native-component` | too broad; no failure mode to encode |
| `optimize-performance` | no baseline exists; would be guesswork |
| `manage-git-workflow` | standard practice, not project-specific |
| `deploy-to-app-store` | folded into `review-mobile-release-quality`; a separate skill would duplicate its checklist |

A skill exists to prevent a specific, observed mistake. Without one, it is
documentation pretending to be tooling.
