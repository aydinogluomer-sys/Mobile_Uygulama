# Core completion: F01–F08 (habit engine, capacity & recovery, local-first sync, routines & focus, reminders, journal & moods, export check & merge, AI coach)

Base `main` ← `feature/r01-period-status`. 21 commits on top of `f6721bf`, one per card/phase; each commit passed the full gate on its own.

## Gate (run twice, back to back, on the final commit)

- `npm run typecheck:ci` — 0 errors
- `npm run lint:ci` — 0 warnings
- `node run-tests.js` — 145/145
- `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` — 195 suites / 2894 tests (was 146 / 2444)
- `git diff --check` — clean

Every behaviour change carries mutation evidence (byte-identical restore, sha256 checked): ≈175 mutants across the plan, 0 surviving. No existing test was weakened; the five that were retargeted say why in `docs/implementation-v3/STATE.md`.

## Before merging — read this

**The database is frozen.** Nothing in this PR touched Supabase. Five migrations are **written and NOT applied** (`supabase/migrations/README.md` marks them):

| Migration | For | Until it is applied |
|---|---|---|
| `028_habit_pauses_and_goal_versions` | dated breaks, holiday mode, effective-dated goals | sheets say "sunucu güncellemesi bekleniyor"; behaviour unchanged |
| `029_habit_checklists` | habit checklists | editor says pending; no habit has a checklist |
| `030_routine_runner` | runner templates / sessions | runner works on the device, per account |
| `031_moods_and_review_actions` | named moods, check-ins, review actions | on the device, per account |
| `032_coach_actions_v2` | second coach action set | behind `COACH_ACTIONS_V2_ENABLED = false` |

The client is fail-open **only on a missing table** (PGRST205 / 42P01); any other read error is an error.

The `generate-routine` edge function source changed (new tool schema + prompt rules) and is **not deployed**. Turn-on order for the coach set: apply 032 → deploy the function → flip the gate.

## What changed, by phase

### F01 — schedule engine
- A measurable make-up asks for the amount instead of writing "done" with no value (KD-12).
- An active habit outside its date range carries no load in any activation gate (KD-08).
- An installed habit's schedule can be edited with the creation form's own controls (KD-09).
- A count habit already met this period steps aside on Today (R01.06-b).
- Log undo is **blocked** (S11): deleting a log does not reverse its XP, and the trigger is not in the repository.

### F02 — capacity, recovery, checklists
- "Bugün daha az yapabilirim": the user sets chosen habits aside for today (skip — no goal changes).
- Recovery planning previews the target day's load.
- Start small: a task's first concrete step as its own focus session; it never completes the task.
- Skip / break / holiday are separate models; schedule and goal edits take effect from a date and never re-score the past.
- Habit checklists: required/optional steps and a per-day instance driving the day's log.

### F03 — local-first sync
- A durable per-account outbox (idempotent operation ids, collapsing, tombstones, dependencies, in-flight marking, auth pause, backoff, conflicts surfaced). Today's tasks work offline and survive an app kill.
- Fixtures: 100 offline actions + kill + network return, five re-deliveries = one row, lost responses, two devices, delete vs late edit, account switch, expired session. One fixture caught a flush that outlived a sign-out writing account A's task into account B; fixed in the runner and the repository.
- SQLite is **not** added (S7).

### F04 — reminders (widgets / Live Activities stay deferred)
- The per-habit DAILY trigger is gone. Reminders are planned from the schedule (breaks, holidays, met periods, logged days, waiting habits, quiet hours, day groups) as one-off triggers and reconciled on launch/foreground/changes.
- Up to four times a day, day groups, quiet hours, hidden lock-screen titles, the real permission state.
- Notification buttons: complete, enter amount (measurable habits are never logged done from a notification), snooze 10 min, skip today — each response acted on once.
- The Android channel is created regardless of the permission path.

### F05 — routines & focus
- Focus timer counts running segments only, keeps the session's start across resumes, uses configured lengths, survives an app kill, and cannot record a session twice (KD-03).
- One duration contract for pomodoro and deep work; typed durations are validated, not clamped.
- A step-by-step routine runner: templates with immutable versions, session snapshots, in-session edits that never touch the template unless applied, user-only completion, linked habits logged once.
- Routine packs install with their unit, goal, schedule and icon.

### F06 — journal & moods
- Tags, light formatting, habit links, an offline draft per day; a failed save is no longer shown as saved.
- Named moods with a stable identity, several check-ins a day, snapshots so a rename never rewrites history.
- A mood–habit card with stated minimums and no causal claim.
- The weekly review's "next week" can become a real task or a habit edit, shown again next week.

### F07 — export check & merge
- Export format 3 with a manifest; a pasted export is verified and dry-run before anything is written; the merge only adds missing rows. Habit logs (server XP), focus sessions and webhooks are never restored; authority fields are never taken from a file. This is a **partial merge, not a restore**, and the screen says so.
- Mapped CSV import for tasks and journal entries.

### F08 — AI coach
- Second action set (schedule edit, dated break, move task, small step, lighter today), behind its gate.
- Every coach write re-checks its target against the version it was staged with.

## Not in this PR (owner decisions)

S1 database restore · S2 applying migrations 028–032 · S3 edge deploy · S4 KD-10/11 backfill · S5 `bypassPermissions` · S6 Habitify/Daylio sample · S7 `expo-sqlite` · S8 device evidence (R02.08, R04.05, R05.08, R11 are N/R) · S11 log undo · S12 schema not reproducible from the repo · S13 `expo-speech` · S14 `expo-document-picker` · the skip-cap question.

Full acceptance table: `docs/implementation-v3/R10_ACCEPTANCE_REPORT.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
