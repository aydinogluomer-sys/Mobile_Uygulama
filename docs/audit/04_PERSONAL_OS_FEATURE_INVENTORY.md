# 04 — `personal-os-v2 (8).html` Feature Inventory

**Status:** `Verified` — decomposed from the reference file
**Source:** `~/Desktop/Yazılım Projeleri/personal-os-v2 (8).html` (single-file HTML/CSS/JS prototype, ~6,800 lines)
**Purpose:** atomic `REF-NNN` requirements. Parity scoring is doc 05.

---

## Method and boundaries

The reference is a **desktop web prototype**, not a mobile spec. Decomposition
rules applied:

1. **One requirement = one user-visible capability**, not one DOM element. A card, its hover state and its empty state are one requirement.
2. **Desktop-only affordances are marked `N/A-MOBILE`** and excluded from parity denominators — keyboard shortcut chords, hover reveals, the 248px sidebar, mac traffic lights, the `Cmd+K` pill.
3. **Prototype scaffolding is excluded entirely** — `seedDemoData()`, `localStorage` persistence, the `migrateV1` path, and the hardcoded demo numbers (`−4s 12d`, `31%`, `6.4 / 10`). These are prototype fixtures, not product requirements. The mobile app deliberately rejected them (`awwwards-loop/reports/iteration-02.md`).
4. **A requirement is recorded even if the reference implements it only visually** — parity scoring in doc 05 then separates UI from functional.

**Counts:** 118 requirements total · **97 in scope for mobile parity** ·
21 `N/A-MOBILE`.

---

## A · Bugün / Dashboard — REF-001..018

Reference: `DashboardPage.renderA()` (hybrid: editorial main + 320px rail).

| ID | Requirement | Reference evidence | Scope |
|---|---|---|---|
| REF-001 | Editorial hero with date eyebrow, serif headline, sub-line | `.atl-bugun-hero`, `dateLabel()` | in |
| REF-002 | Hero CTAs: open weekly report · enter focus · open recovery | `.atl-bugun-hero__ctas` | in |
| REF-003 | Hero names the next actionable task inline | `nextTaskTitle`, `.atl-bugun-hero__nexttask` | in |
| REF-004 | 4-card metric grid (sleep, focus, open tasks, recovery) | `.atl-metric-grid-hybrid` | in |
| REF-005 | Metric cards carry semantic tone (bad/warn/accent) | `.atl-metric__num--bad` etc. | in |
| REF-006 | Focus metric shows live session time when a timer runs | `state.pomoState.running` branch | in |
| REF-007 | "Masadakiler" task list, 2-line rows (title + meta) | `rowMasada()` | in |
| REF-008 | Task ordering: focused → scheduled → open → overdue → done | `activeTasks` bucket logic | in |
| REF-009 | Tab switch Masadakiler ⇄ Zaman çizelgesi | `data-dash-tab` | in |
| REF-010 | Time-ordered timeline view with per-row time column | `rowTimeline()`, `todayTimeline()` | in |
| REF-011 | Inline composer always visible in the task card | `renderInlineComposer()` | in |
| REF-012 | Composer: Enter creates · Cmd+Enter opens full modal · Esc clears | `composerInput` keydown | partial (Cmd+Enter `N/A-MOBILE`) |
| REF-013 | New task highlight animation (~1.4 s fade) | `.atl-trow.is-new` | in |
| REF-014 | "Bugün tamamlananlar" collapsible, auto-collapsed when >2 | `dashCompletedToggle` | in |
| REF-015 | "Sırada" compact horizontal strip, max 3 upcoming | `.atl-nextup` | in |
| REF-016 | Right rail: recovery card with 4 metric rows + drill-in | `.atl-rail-card`, `recovery[]` | in |
| REF-017 | Right rail: week-progress bars, 7 days, done/total | `weekProgress()` | in |
| REF-018 | Right rail: habits-this-week with trend arrows | `habitWeekSummary()` | in |

---

## B · Odak / Focus Mode — REF-019..044

Reference: `FocusMode` + `FocusStore`, a full-screen subsystem.

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-019 | Full-screen distraction-free shell | `.focus-mode-shell` | in |
| REF-020 | Mode tabs: pomodoro · short break · long break | `.fm-modes` | in |
| REF-021 | Circular progress ring with mm:ss centre | `.fm-ring`, `mmss()` | in |
| REF-022 | Start / pause / resume | `fmToggle` | in |
| REF-023 | Reset with confirmation when running | `FocusStore.reset` | in |
| REF-024 | Automatic phase transition + long-break interval | `FocusStore.complete` | in |
| REF-025 | Auto-start breaks / auto-start pomodoros | `autoStartBreaks/Pomodoros` | in |
| REF-026 | Task list inside focus mode | `.fm-tasks` | in |
| REF-027 | Select active task; timer gated on selection | `selectTask`, `canStart` | in |
| REF-028 | Add task with estimated pomodoro count | `.fm-add-form` | in |
| REF-029 | Complete task; optionally move to bottom | `toggleComplete`, `checkTasksToBottom` | in |
| REF-030 | Delete task, preserving past sessions | `deleteTask` | in |
| REF-031 | Per-task completed/estimated pomodoro counters | `.fm-task-pomos` | in |
| REF-032 | Live "today in focus" total | `todayMinutesLive()` | in |
| REF-033 | Session recording incl. interruptions | `recordSession` | in |
| REF-034 | Alarm sound on completion, volume-controlled | `playAlarm` | in |
| REF-035 | System notification on completion | `notify` | in |
| REF-036 | 8 preset background themes | `FOCUS_PRESETS` | in |
| REF-037 | Custom background upload | `fmThemeFile` | in |
| REF-038 | Automatic text contrast from image luminance | `computeImageLuminance`, `textMode` | in |
| REF-039 | Background blur / overlay / vignette / parallax controls | theme modal sliders | in |
| REF-040 | Settings modal, 8 tabbed sections | `SETTINGS_TABS` | in |
| REF-041 | Settings draft with dirty-state save/discard | `settingsDraft`, `settingsDirty` | in |
| REF-042 | Spotify widget: now-playing + transport | `renderSpotify` | in |
| REF-043 | Focus report: summary · detail · ranking tabs | `renderReportModal` | in |
| REF-044 | Report export CSV / JSON | `FocusReport.toCSV`, `download` | in |

---

## C · Görevler / Tasks — REF-045..056

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-045 | List view grouped Bugün / Bu hafta / Bir gün | `TasksPage.renderList` | in |
| REF-046 | Kanban board view, 4 status columns | `renderBoard`, `TASK_STATUSES` | in |
| REF-047 | Toggle list ⇄ board | `data-tasks-view` | in |
| REF-048 | Drag and drop between columns | `bindDragDrop` | in (gesture, not HTML5 DnD) |
| REF-049 | Status pill: done/focus/scheduled/overdue/waiting | `pillFor`, `statusOf` | in |
| REF-050 | Compact relative "when" column | `whenOf` | in |
| REF-051 | Task modal: title, description, priority, status, due, estimate, project, quadrant, tags, recurrence | `TasksPage.openModal` | in |
| REF-052 | Recurrence generates the next occurrence on completion | `Selectors.nextOccurrence` | in |
| REF-053 | Per-group quick-add row | `.atl-tquick` | in |
| REF-054 | Summary stats bar (today / week / overdue / someday) | `.atl-tstats` | in |
| REF-055 | Soft delete with undo toast | `softDelete` | in |
| REF-056 | Eisenhower 2×2 with drag between quadrants | `EisenhowerPage`, `QUADS` | in |

---

## D · Alışkanlıklar / Habits — REF-057..067

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-057 | Today's due-habit pill grid with one-tap toggle | `.atl-habits-grid` | in |
| REF-058 | Header count "today N / M" | `doneToday.length` | in |
| REF-059 | Habit row: name, target, frequency label | `.atl-hrow` | in |
| REF-060 | Last-6-day mini week dots incl. skip state | `miniWeek` | in |
| REF-061 | Current streak, highlighted when long | `habitStreak`, `.streak-big.high` | in |
| REF-062 | 90-day completion percentage | `rate90` | in |
| REF-063 | Expandable row → 365-day heatmap | `heatmap`, `.atl-heatmap` | in |
| REF-064 | Year stats: total completions + longest streak | `yearStats` | in |
| REF-065 | Frequency modes: daily · weekdays · weekend · w2 · w3 · w5 | `isHabitDue` | in |
| REF-066 | Habit CRUD modal (name, target, unit, step, frequency) | `HabitsPage.openModal` | in |
| REF-067 | Increment for measurable habits | `incToday` | in |

---

## E · Takvim / Calendar — REF-068..075

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-068 | Week view, 7 columns × hour grid | `.atl-cal-grid` | in |
| REF-069 | Positioned event blocks by start + duration | `atl-cal-event` top/height | in |
| REF-070 | Current-time indicator line | `.atl-cal-nowline` | in |
| REF-071 | All-day chip row | `.atl-cal-allday` | in |
| REF-072 | Event colour by category (work/ritual/health) | `tone` mapping | in |
| REF-073 | Week navigation prev / today / next | `data-cal-nav` | in |
| REF-074 | Tap event → open task modal | `.atl-cal-event[data-task]` | in |
| REF-075 | Footer legend + planned-vs-free hours | legend block | in |

---

## F · Telafi / Recovery — REF-076..081

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-076 | Recovery-debt hero with headline percentage | `RecoveryPage.render` | in |
| REF-077 | 4 metric rows with progress bar + target marker | `.atl-rec-row`, `.target` | in |
| REF-078 | 7-night sleep bar chart, debt nights highlighted | `sleepNights`, `.atl-rec-sleepchart` | in |
| REF-079 | Actionable callout ("one early night closes 40%") | `.atl-rec-callout` | in |
| REF-080 | Log last night's sleep | `recLogSleep` | in |
| REF-081 | Schedule a wind-down reminder | `recPlanWind` | in |

> **Note:** the reference's recovery numbers are hardcoded fixtures. The
> *capability* is the requirement; the values are not.

---

## G · Haftalık rapor / Weekly Review — REF-082..088

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-082 | 4-step wizard: kazanımlar → düşenler → ders → plan | `WeeklyReviewPage` | in |
| REF-083 | Step 1: wins list + add | `defaultWins` | in |
| REF-084 | Step 2: dropped items with a "why" field | `defaultDrops` | in |
| REF-085 | Step 3: free-text lesson | `defaultLesson` | in |
| REF-086 | Step 4: next-week commitments with primary flag | `defaultNext` | in |
| REF-087 | Step navigation + autosave indicator | `data-wr-step` | in |
| REF-088 | Weekly planner wizard (recap → top-3 → theme → confirm) | `WeeklyPlanner.open` | in |

---

## H · Listeler / List views — REF-089..096

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-089 | Gelen: unprocessed items (no project) | `ListGelenPage` | in |
| REF-090 | Gelen: inline capture footer | `.list-capture` | in |
| REF-091 | Gelen: "→ Bugün" quick action | `data-list-today` | in |
| REF-092 | Bu hafta: 7-day stack with per-day counts | `ListBuHaftaPage` | in |
| REF-093 | Bir gün: alphabetically grouped someday list | `ListBirGunPage` | in |
| REF-094 | Arşiv: completed items grouped by month | `ListArsivPage` | in |
| REF-095 | Editorial hero per list with live counts | `listHero` | in |
| REF-096 | Sidebar badge counts per list | `listBadge` | in |

---

## I · Projeler / Projects — REF-097..104

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-097 | Project detail page: hero, lede, goal | `.proj-hero` | in |
| REF-098 | 5-stat strip (progress, open, this week, age, deadline) | `.proj-stats` | in |
| REF-099 | "Next move" callout with start action | `.next-move` | in |
| REF-100 | Open / completed task sections | `ProjectDetailPage` | in |
| REF-101 | Linked notes sidebar | `linkedNotes` | in |
| REF-102 | Archive / delete with task detachment | `data-archive-proj` | in |
| REF-103 | New-project editorial flow with live preview | `NewProjectPage` | in |
| REF-104 | HSL colour wheel + gradient picker (2 stops, angle) | `.np-wheel`, `hslToHex` | in |

---

## J · Other pages — REF-105..114

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-105 | Pomodoro page with ring + session log | `PomodoroPage` | in |
| REF-106 | Deep-work session logging + today/week totals | `DeepWorkPage` | in |
| REF-107 | AI coach chat with habit-suggestion cards | `AICoachPage` | in |
| REF-108 | Goals: yearly / quarterly / monthly tree | `GoalsPage` | in |
| REF-109 | OKR: objectives + key results with progress | `OKRPage` | in |
| REF-110 | Life areas: 8-axis wheel + sliders | `LifeAreasPage`, `wheelSVG` | in |
| REF-111 | Journal: 4 daily prompts + past entries | `JournalPage` | in |
| REF-112 | Notes: grid, search, archive | `NotesPage` | in |
| REF-113 | Analytics: 4 trend charts + summary stats | `AnalyticsPage` | in |
| REF-114 | Settings: theme, accent, data export/import, API key | `SettingsPage` | in |

---

## K · Cross-cutting — REF-115..118 (+ `N/A-MOBILE`)

| ID | Requirement | Evidence | Scope |
|---|---|---|---|
| REF-115 | Command palette with sectioned results and suggestions | `QuickSearch` | in |
| REF-116 | Light / dark / system theme | `applyTheme` | in |
| REF-117 | 4 accent colours (clay/moss/slate/amber) | `html[data-accent]` | in |
| REF-118 | Toast with undo action | `toast()`, `softDelete` | in |

### Excluded as `N/A-MOBILE` (21)

Keyboard chords `g+d`/`g+t`/… · `Cmd+K` pill · `Cmd+N` · `?` shortcut help
(`ShortcutsHelp`) · Tab focus trap · 248px collapsible sidebar · sidebar section
toggles · mac traffic lights · 3-level breadcrumb · hover-reveal delete buttons ·
`title=` tooltips · HTML5 drag-and-drop mechanics · right-click affordances ·
window-resize breakpoints · `::-webkit-scrollbar` styling · text cursor states ·
`prefers-color-scheme` media query · desktop modal backdrop blur · `Esc`-to-close ·
browser `localStorage` persistence · `migrateV1` schema migration.

The *capabilities* behind several of these (search, quick-create, theme) are
captured separately as REF-115..117 — only the desktop *input mechanism* is out
of scope.

---

## Summary

| Area | Requirements | In scope |
|---|---|---|
| A Bugün | 18 | 18 |
| B Odak | 26 | 26 |
| C Görevler | 12 | 12 |
| D Alışkanlıklar | 11 | 11 |
| E Takvim | 8 | 8 |
| F Telafi | 6 | 6 |
| G Haftalık rapor | 7 | 7 |
| H Listeler | 8 | 8 |
| I Projeler | 8 | 8 |
| J Diğer sayfalar | 10 | 10 |
| K Cross-cutting | 4 | 4 |
| `N/A-MOBILE` | 21 | 0 |
| **Total** | **139 identified** | **97 scored** |

Parity scoring — UI · functional · data · backend · UX · test, computed
separately per requirement — is doc 05.
