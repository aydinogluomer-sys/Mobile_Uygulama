# 05 — Feature Parity Matrix

**Status:** `Verified` at screen level; per-requirement verdicts carry an evidence grade
**Denominator:** the 97 in-scope requirements from doc 04

---

## Scoring rules

Six dimensions, scored **independently** per requirement:

| Dimension | Question |
|---|---|
| **UI** | Does the mobile app render the surface? |
| **Func** | Does interacting with it actually do the thing? |
| **Data** | Is the required data model present (client + DB)? |
| **Back** | Is the server side wired and working? |
| **UX** | Loading, empty, error and accessibility states present? |
| **Test** | Is there a test that would catch a regression? |

Marks: `✓` full · `◐` partial · `✗` absent · `n/a` not applicable

**A requirement with UI but no working behaviour scores UI `✓` and Func `✗`.**
UI parity never counts toward functional parity.

**Evidence grade** — stated because it changes how much weight a row carries:
- **[L]** line-level: the specific file:line was read
- **[S]** screen-level: inferred from the verified per-screen audit (doc 03 / the screens audit), not from reading every line
- **[U]** unverified: needs a device or deeper read

---

## A · Bugün — 18 requirements · evidence [L]

`app/tabs/today.tsx` (388 ln) + `components/today/{TodayHero,MetricGrid,NextUpStrip,RecoveryRailCard}` + `components/InlineComposer`

| REF | Requirement | UI | Func | Data | Back | UX | Test | Note |
|---|---|---|---|---|---|---|---|---|
| 001 | Editorial hero | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `TodayHero` :181 |
| 002 | Hero CTAs | ✓ | ✓ | n/a | n/a | ✓ | ✓ | :185 |
| 003 | Next task named inline | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | `lib/todayNarrative` |
| 004 | 4-card metric grid | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `MetricGrid` :192 |
| 005 | Semantic metric tone | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | |
| 006 | Live focus session time | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ | shows session **count**, not a live timer |
| 007 | Masadakiler 2-line rows | ◐ | ✓ | ✓ | ✓ | ✓ | ✗ | renders a task card, not the 2-line editorial row |
| 008 | Bucket ordering | ✗ | ✗ | ✓ | ✓ | n/a | ✗ | `pendingTasks` is `filter(...).slice(0,5)` :66 — no ordering |
| 009 | Masadakiler ⇄ Zaman tabs | ✗ | ✗ | n/a | n/a | n/a | ✗ | absent |
| 010 | Timeline view on Today | ✗ | ✗ | ✓ | ✓ | n/a | ✗ | links out to `/tabs/timeline` :115 |
| 011 | Always-visible composer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `InlineComposer` :211 |
| 012 | Enter creates · Esc clears | ◐ | ◐ | n/a | n/a | ◐ | ✗ | `onSubmitEditing` :43 only; no Esc |
| 013 | New-task highlight | ✗ | ✗ | n/a | n/a | ✗ | ✗ | |
| 014 | Completed collapsible | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | |
| 015 | "Sırada" strip | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `NextUpStrip` :248 |
| 016 | Recovery rail card | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `RecoveryRailCard` |
| 017 | Week-progress rows | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | |
| 018 | Habits-this-week trend | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ | count only (:261-271), no 7-day trend |

**A: UI 9.5/18 · Func 10/18 · Data 16/18 · Back 16/18 · UX 11/18 · Test 6/18**

---

## B · Odak — 26 requirements · evidence [S]

`app/tabs/focus.tsx` (425 ln) + `components/focus/*` (5 modals, all mounted :13-17) + `store/focusStore.ts` (312 ln)

| Group | REF | UI | Func | Data | Back | UX | Test |
|---|---|---|---|---|---|---|---|
| Timer core | 019-025 | ✓ | ✓ | ✓ | ✓ | ◐ | ✗ |
| Task panel | 026-031 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Session recording | 032-033 | ✓ | ✓ | ✓ | ✓ | ◐ | ✗ |
| Sound + notify | 034-035 | ✓ | ✓ | ✓ | n/a | ◐ | ✗ |
| Themes | 036-039 | ✓ | ✓ | ✓ | n/a | ✓ | ✗ |
| Settings modal | 040-041 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Spotify | 042 | ✓ | ✓ | ✓ | ✓ | ◐ | ✗ |
| Report + export | 043-044 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |

**Odak is the strongest area — near-full parity.** `store/focusStore.ts` carries
the full FSM, `lib/focusReport.ts` the reporting, `lib/focusThemes.ts` the
presets, and all five modals are mounted. Known defects: `focusReport` mixes UTC
and local date keys (doc 07), and `FocusSpotifyCard.tsx:71` renders
`logo-google` inside the **Spotify** button.

**B: UI 26/26 · Func 26/26 · Data 26/26 · Back 22/22 · UX 18/26 · Test 0/26**

---

## C · Görevler — 12 · evidence [S]

`app/tabs/tasks.tsx` (331) · `app/screens/eisenhower.tsx` (333)

| REF | Requirement | UI | Func | Data | Back | UX | Test |
|---|---|---|---|---|---|---|---|
| 045 | Grouped list | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 046 | Kanban board | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| 047 | List ⇄ board toggle | ✗ | ✗ | n/a | n/a | ✗ | ✗ |
| 048 | Drag between columns | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| 049 | Status pills | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 050 | Relative "when" | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ |
| 051 | Full task modal | ◐ | ◐ | ◐ | ✓ | ✓ | ✗ | no quadrant/recurrence in mobile modal |
| 052 | Recurrence next occurrence | ✗ | ✗ | ✗ | ✗ | n/a | ✗ |
| 053 | Per-group quick add | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 054 | Summary stats bar | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ |
| 055 | Soft delete + undo | ✗ | ✗ | n/a | n/a | ✗ | ✗ |
| 056 | Eisenhower 2×2 | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | no loading/empty state |

**C: UI 6/12 · Func 6/12 · Data 9.5/12 · Back 10/12 · UX 7/12 · Test 2/12**

---

## D · Alışkanlıklar — 11 · evidence [S]

`app/tabs/habits.tsx` (795) · `app/tabs/timeline.tsx` (777) · `components/HabitListView.tsx`

| REF | UI | Func | Data | Back | UX | Test | Note |
|---|---|---|---|---|---|---|---|
| 057 pill grid | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 058 today count | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 059 habit row | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 060 mini week dots | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ | |
| 061 streak | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | server-maintained |
| 062 90-day % | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ | |
| 063 365-day heatmap | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `stats.tsx` |
| 064 year stats | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ | |
| 065 frequency modes | ◐ | **✗** | ✓ | ✓ | n/a | ✗ | **`frequency_config.count` never read — X-per-week is due on no day** |
| 066 habit CRUD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| 067 measurable increment | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | `MeasurableInputModal` |

**D: UI 8.5/11 · Func 8/11 · Data 11/11 · Back 11/11 · UX 10/11 · Test 5/11**

---

## E · Takvim — 8 · evidence [S] — `app/screens/calendar.tsx` (265), **READ_ONLY**

| REF | UI | Func | Data | Back | UX | Test |
|---|---|---|---|---|---|---|
| 068 week grid | ✗ (month grid) | ✗ | ✓ | ✓ | ◐ | ✓ |
| 069 positioned events | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| 070 now-line | ✗ | ✗ | n/a | n/a | ✗ | ✗ |
| 071 all-day chips | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| 072 category colour | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ |
| 073 week navigation | ◐ | ◐ | n/a | n/a | ✓ | ✓ |
| 074 tap → task modal | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| 075 legend + free hours | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |

Mobile has a **month** calendar with dots; the reference is an **hour-grid week**
view. Different product surface. Zero mutations (`:148` sets local state only).

**E: UI 1/8 · Func 1/8 · Data 6/8 · Back 6/8 · UX 3/8 · Test 2/8**

---

## F · Telafi — 6 · evidence [S] — `app/screens/recovery.tsx` (593), **FULL**

| REF | UI | Func | Data | Back | UX | Test |
|---|---|---|---|---|---|---|
| 076 debt hero | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 077 metric rows | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 078 sleep chart | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 079 actionable callout | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ |
| 080 log sleep | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 081 wind-down reminder | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ |

Mobile's telafi is **more developed than the reference** in the habit-recovery
direction (13 mutations, real `recovery_plans` CRUD, reminders) but has **no
sleep tracking at all** — the reference's sleep UI is fixture-driven and would
need a real data source.

**Known defect:** completing a telafi writes no `habit_log`, awards no XP and
moves no metric (doc 07).

**F: UI 3/6 · Func 3/6 · Data 4/6 · Back 4/6 · UX 4/6 · Test 1/6**

---

## G · Haftalık rapor — 7 · evidence [S]

`app/screens/weekly-review.tsx` (314) · `monthly-review.tsx` (317)

| REF | UI | Func | Data | Back | UX | Test |
|---|---|---|---|---|---|---|
| 082 4-step wizard | ◐ | ◐ | ✓ | ✓ | ✓ | ✓ |
| 083 wins | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 084 drops + why | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ |
| 085 lesson | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 086 next-week commitments | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ |
| 087 step nav + autosave | ◐ | ◐ | ✓ | ✓ | ◐ | ✗ |
| 088 planner wizard | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Mobile **adds** a monthly review the reference lacks — but its reflections
persist to AsyncStorage only (`monthly-review.tsx:129`).

**G: UI 4/7 · Func 4/7 · Data 6/7 · Back 6/7 · UX 5.5/7 · Test 1/7**

---

## H · Listeler — 8 · evidence [L]

| REF | UI | Func | Data | Back | UX | Test |
|---|---|---|---|---|---|---|
| 089-096 | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |

**No mobile equivalent of any of the four list views.** `app/tabs/tasks.tsx:29`
hardcodes `useState('inbox')` and `hub.tsx`'s four deep links (`?tab=inbox|
this_week|someday|done`) are stripped at `hub.tsx:74` — and `hub.tsx` is
orphaned anyway.

The **data** exists (tasks with `due_date`, `project_id`, `completed`), so this
is a presentation gap, not a modelling one.

**H: UI 0/8 · Func 0/8 · Data 8/8 · Back 8/8 · UX 0/8 · Test 0/8**

---

## I · Projeler — 8 · evidence [S] — `app/screens/projects.tsx` (257)

| REF | UI | Func | Data | Back | UX | Test |
|---|---|---|---|---|---|---|
| 097 detail page | ◐ | ◐ | ✓ | ✓ | ✓ | ✓ | modal, not a page |
| 098 5-stat strip | ◐ | ◐ | ✓ | ✓ | ✓ | ✓ |
| 099 next-move callout | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| 100 open/done sections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 101 linked notes | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| 102 archive/delete | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 103 new-project flow | ◐ | ◐ | ✓ | ✓ | ✓ | ✗ |
| 104 HSL colour wheel | ✗ | ✗ | ◐ | ✓ | ✗ | ✗ | mobile has a fixed swatch row |

**I: UI 3.5/8 · Func 3.5/8 · Data 7.5/8 · Back 8/8 · UX 5/8 · Test 3/8**

---

## J · Other pages — 10 · evidence [S]

| REF | Page | Mobile | UI | Func | Data | Back | UX | Test |
|---|---|---|---|---|---|---|---|---|
| 105 | Pomodoro | folded into Odak | ◐ | ✓ | ✓ | ✓ | ◐ | ✗ |
| 106 | Deep work | `deep-work.tsx` FULL | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 107 | AI coach | `ai-coach.tsx` FULL | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 108 | Goals | `goals.tsx` FULL | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 109 | OKR | `okr.tsx` FULL | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 110 | Life areas | `life-areas.tsx` FULL | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 111 | Journal | `journal.tsx` FULL + archive/reader/insights | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 112 | Notes | `notes.tsx` FULL | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 113 | Analytics | `stats.tsx` (626) | ◐ | ◐ | ✓ | ✓ | ✓ | ✓ |
| 114 | Settings | `settings.tsx` (869) | ◐ | ◐ | ✓ | ◐ | ◐ | ✓ |

**J: UI 8/10 · Func 8.5/10 · Data 10/10 · Back 9.5/10 · UX 9/10 · Test 3/10**

---

## K · Cross-cutting — 4 · evidence [L]

| REF | UI | Func | Data | Back | UX | Test | Note |
|---|---|---|---|---|---|---|---|
| 115 command palette | ✓ | **✗** | ✓ | ✓ | ✗ | ✗ | 256 working lines **never mounted** |
| 116 theme light/dark/system | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | |
| 117 4 accents | ✓ | ◐ | ✓ | n/a | ✓ | ✓ | tokens reach ~11% of files |
| 118 toast + undo | ◐ | ✗ | n/a | n/a | ✗ | ✗ | no undo anywhere |

**K: UI 3.5/4 · Func 1.5/4 · Data 3/3 · Back n/a · UX 2/4 · Test 2/4**

---

## Totals

| Dimension | Score | % |
|---|---|---|
| **UI parity** | 63.0 / 97 | **65 %** |
| **Functional parity** | 63.5 / 97 | **65 %** |
| **Data parity** | 87.0 / 96 | **91 %** |
| **Backend parity** | 84.5 / 93 | **91 %** |
| **UX parity** (loading/empty/error/a11y) | 64.5 / 95 | **68 %** |
| **Test parity** | 25.0 / 97 | **26 %** |

### How to read this

- **Data and backend are far ahead of presentation (91 % vs 65 %).** The schema and stores already support most missing features. The gaps are overwhelmingly *screens not built*, not *models missing*. That makes Phase 3 cheaper than the UI number suggests.
- **UI and functional parity are within half a point of each other.** That is unusual and good: this codebase does not ship UI shells over dead logic. The one clear exception is REF-115 (command palette), which is pure UI-without-function.
- **Test parity 26 % is the real risk.** It is inflated by `run-tests.js`, which asserts on source *text*, not behaviour (doc 03 §P3). Behavioural test parity is closer to **0 %**.

### Largest gaps by area

| Area | Func parity | Verdict |
|---|---|---|
| H Listeler | **0 %** | 4 whole views missing; data already present |
| E Takvim | 13 % | different surface (month vs hour-grid week), read-only |
| C Görevler | 50 % | no kanban, no recurrence, no undo |
| I Projeler | 44 % | modal instead of page, no colour wheel |
| G Haftalık rapor | 57 % | no planner wizard |
| A Bugün | 56 % | no tabs, no bucket ordering, no week-progress rail |
| **B Odak** | **100 %** | strongest area |
| **J Diğer** | **85 %** | most pages fully built |

### Features mobile has that the reference does not

Not parity gaps — scope the reference never had. Excluded from all denominators:
XP / levels / ranks · badges · global + weekly leaderboard · willpower budget ·
telafi (habit recovery) · paywall + Focus Point credits + credit history ·
reading list · journal archive / reader / AI insights · monthly review ·
seasonal month backgrounds · ADHD task splitter · bad-habit tracker ·
push notifications · Notion / Google Calendar / Spotify integrations.

**The mobile app is a superset in product scope and a subset in UI surface.**
