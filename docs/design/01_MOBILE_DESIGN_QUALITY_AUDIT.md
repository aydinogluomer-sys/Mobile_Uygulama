# 01 — Mobile Design Quality Audit

**Status:** `Partially verified` — code-level evidence complete; rendered evaluation `Blocked`
**Phase:** Gate A

---

## 1. What "Awwwards quality" means for this product — and what it does not

The brief asks for Awwwards-grade craft. Applied to a **habit-tracking app for
an ADHD-aware audience**, that is deliberately *not* heavy animation or unusual
navigation. Those raise interaction cost, and interaction cost is the thing this
product exists to lower.

Quality here is:

- the user knows what to do within one second of opening the app
- completing a habit is one tap from the first screen
- information density is controlled, not maximal
- failure states are non-punitive
- motion clarifies hierarchy rather than decorating it
- it feels native on both platforms

**No recommendation in this document trades mobile usability for visual
ambition.** Where the reference HTML's desktop editorial style would harm a
one-handed mobile flow, the mobile pattern wins.

---

## 2. Rendered evaluation is blocked — stated plainly

Scores below are derived from **code-level evidence**: component composition,
token usage, accessibility props, touch-target dimensions, state coverage.

Not assessed: actual rendering, real contrast ratios, perceived motion quality,
frame rates, or one-handed reachability on a physical device.

`frontend/awwwards-loop/state.json` shows a prior attempt reached
`"iteration": 2` and is **`"status": "blocked"`** with
`"blocker": "Browser evidence unavailable after in-app browser, Edge and Chrome attempts."`
and `"hardGatesPassed": false`, `"lastScore": null`.

**That blocker is unresolved.** Any score presented as a rendered verdict would
be fabricated. Phase 5F resolves it.

One thing that prior loop got right and must be preserved: it **rejected** the
reference's hardcoded sleep/recovery figures rather than reproducing them
(`awwwards-loop/reports/iteration-02.md`). Verified — zero occurrences of
`−4s 12d`, `31%` or `6.4` anywhere in `app/` or `components/`.

---

## 3. Design system reality

| Metric | Value | Source |
|---|---|---|
| Files importing `lib/tokens` | **44** | grep |
| Files importing `components/ui/` | **11 of ~103** | grep |
| Raw hex literals in `app/` + `components/` | **1,671** | grep |
| `accessibilityLabel` occurrences | **20** | grep |
| `accessibilityRole` occurrences | **20** | grep |
| `accessibilityState` occurrences | **1** | grep |
| Style defs with width **and** height < 44 pt | **54** | grep |
| Style defs with `minHeight >= 44` | **6** | grep |
| `hitSlop` usages | 26 | grep |

### The core problem

Tokens exist and are good (`lib/tokens.ts` exports `colors`, `space`, `radius`,
`font`, `fontFamily`, `hexA`, `ACCENTS`). The primitive library exists
(`components/ui/`, 11 components). **Neither is applied broadly.**

Consequence: `themeStore.toggle` and the four accents **cannot reach roughly 80 %
of the UI**, because that UI hardcodes `#1D1C17`, `#383528`, `#827E72`,
`#D97757`, `#87A678`, `#EDEAE0`. Dark mode and accent switching are, in practice,
partially decorative.

Worst offenders: `HabitOnboarding.tsx` (175 hex), `habits.tsx` (129),
`timeline.tsx` (101), `integrations.tsx` (100), `settings.tsx` (80).

Even `app/screens/_layout.tsx` is internally inconsistent — `:27` and `:30`
hardcode colours while `:11`, `:20`, `:61` use `colors`/`hexA`.

`components/ui/index.ts` exports 11 primitives but **omits** `FloatingLabelInput`
and `GlassPanel`, which are therefore deep-imported (`login.tsx:12`,
`calendar.tsx:14`) — a barrel-file gap that quietly encourages bypassing the barrel.

---

## 4. Per-screen scores

**Basis: code-level only.** `Motion` and `Performance` are marked `n/r`
(not rendered) where no static signal exists — scoring them from source would be
invention.

Scale 1–10.

| Screen | Hierarchy | Usability | Consistency | A11y | Motion | Perf | Clarity | Craft |
|---|---|---|---|---|---|---|---|---|
| `tabs/today.tsx` | 8 | 8 | 8 | **6** | n/r | n/r | 9 | 8 |
| `tabs/focus.tsx` | 8 | 8 | 7 | 4 | n/r | n/r | 8 | 8 |
| `tabs/habits.tsx` (795 ln) | 6 | 7 | **3** | 3 | n/r | n/r | 7 | 5 |
| `tabs/timeline.tsx` (777) | 6 | 7 | **3** | 3 | n/r | n/r | 7 | 5 |
| `tabs/tasks.tsx` | 7 | 7 | 5 | 3 | n/r | n/r | 7 | 6 |
| `tabs/stats.tsx` | 7 | 7 | 6 | 3 | n/r | n/r | 7 | 6 |
| `tabs/settings.tsx` (869) | 5 | 6 | **3** | 4 | n/r | n/r | **4** | 4 |
| `screens/recovery.tsx` | 7 | 7 | 6 | 3 | n/r | n/r | 8 | 7 |
| `screens/calendar.tsx` | 7 | 6 | 6 | 3 | n/r | n/r | 7 | 7 |
| `screens/integrations.tsx` | 6 | 6 | **3** | 5 | n/r | n/r | **5** | 5 |
| `screens/paywall.tsx` | 7 | 6 | 5 | 3 | n/r | n/r | 6 | 6 |
| `components/HabitOnboarding.tsx` (1173) | 6 | 7 | **2** | 3 | n/r | n/r | 7 | 4 |

### Why `today.tsx` scores highest

It is the only screen built from the shared system: `TodayHero`, `MetricGrid`,
`NextUpStrip`, `RecoveryRailCard` are pure presentational components taking
props, with **zero store imports and zero colour literals**. It also holds 4 of
the 20 `accessibilityLabel`s and the single `accessibilityState` in the codebase
(`today.tsx:307`).

**`components/today/` is the proof the team can build to the target standard.**
The Phase 5 task is extending that pattern, not inventing one.

### Why `settings.tsx` scores lowest on clarity

869 lines, 80 hex literals, imports below other statements (7 `import/first`
warnings), and it surfaces three features that do not work (doc 03 §U1) plus a
**false success alert** on export. Clarity is a product-honesty score, not only a
visual one.

---

## 5. Accessibility — the most serious gap

20 labels across ~103 files. One `accessibilityState`. No `accessibilityHint`.

Concretely unusable with a screen reader:

- `components/Drawer.tsx:141-151` — **26 navigation rows, zero a11y props**
- every habit checkbox in `habits.tsx` / `timeline.tsx`
- every task checkbox in `tasks.tsx`
- `hub.tsx:90-105`

Touch targets below 44 pt with no `hitSlop`: `reading-list.tsx:248` (30×30),
`monthly-review.tsx:288` (32×32), `projects.tsx:252` (22×22 checkbox),
`tabs/_layout.tsx:55` (32×32), `CommandPalette.tsx:242` (34×34).

The 22×22 checkbox at `projects.tsx:252` is roughly a quarter of the minimum
recommended area — hard for anyone, disproportionately so for users with motor
variance, which overlaps this product's stated audience.

**A11y is the one axis where this product is not close to shippable.** It is also
the cheapest to fix relative to impact.

---

## 6. `Alert.alert` / `Share` inside `<Modal>`

30 `Alert.alert` calls; 13 files contain both a `<Modal>` and an `Alert`/`Share`.
Most are benign — the Alert fires from a list row outside the modal.

Genuinely risky: `Share` invoked from a presented modal. The authors already
applied the correct mitigation in two places —
`FocusReportModal.tsx:92` and `FocusSettingsModal.tsx:111` close the modal, then
`setTimeout(…, 350)` before `Share.share`.

But **`FocusReportModal.tsx:96` and `FocusSettingsModal.tsx:115` call
`await Share.share(...)` directly with no defer.** On iOS that is the path that
can present nothing or drop the sheet behind the modal. The fix pattern already
exists ten lines above; it simply was not applied to the second branch.

---

## 7. Strengths to preserve

1. **No fake data.** Verified across `app/`, `components/`, `constants/`.
2. **`components/today/` is genuinely well-built** — pure, prop-driven, token-based.
3. **`lib/tokens.ts` is a real token system**, including `ACCENTS` and an `hexA` alpha helper.
4. **Seasonal month backgrounds** (`components/seasonalMotion/`) ship with a `useReducedMotion` hook and an intensity setting — reduced-motion was considered before it was asked for.
5. **Empty states exist** on most primary screens and are written in a warm, non-punitive voice.
6. **Turkish copy is consistent and human**, not machine-translated.

---

## 8. Aggregate

| Axis | Score | Note |
|---|---|---|
| Visual hierarchy | 6.6 | strong on Today, weak on the three 800-line screens |
| Usability | 6.8 | core loops are short |
| **Consistency** | **4.2** | 1,671 hex literals; ui/ used by 11 % of files |
| **Accessibility** | **3.6** | worst axis; 20 labels, 1 state |
| Motion | n/r | rendered evidence blocked |
| Performance | n/r | rendered evidence blocked |
| Product clarity | 6.8 | dragged down by features advertised but broken |
| Overall craft | 6.0 | |

**Interpretation.** This is not a project that needs a redesign. It needs its
*existing* design system applied, its accessibility built, and its product claims
made honest. The bar has already been demonstrated by `components/today/` —
Phase 5 is a propagation exercise, not a reinvention.

Recommendations are doc 02.
