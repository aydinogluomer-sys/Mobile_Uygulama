# Core completion: R00–R11 (habit engine, capacity & recovery, local-first sync, reminders, routines & focus, design & accessibility, journal & moods, backup & restore, AI coach, quality acceptance)

Base `main` ← `feature/r01-period-status`. Every card is one commit that passed the full gate on its
own; the card-by-card evidence (file + test + commit) is `docs/implementation-v3/CORE_AUDIT.md`, and the
acceptance summary built only from it is `docs/implementation-v3/R10_ACCEPTANCE_REPORT.md`.

## Result

86 cards: **78 DONE**, 0 partial, 0 not started. **3 blocked on owner decisions** (S11 log undo, S7
SQLite, S13 voice step announcements). **5 N/R** (device / user measurements; none invented).
`CORE_IMPLEMENTATION: COMPLETE (3 owner-blocked)` · `CORE_QUALITY: NOT_MEASURED (automated evidence only)`
· `RELEASE_READINESS: DEFERRED` — `R11_CORE_CLOSURE.md`. The 9–9.5 target is a target, not yet shown.
No independent reviewer took part, so nothing here says "independent PASS".

## Gate (run twice, back to back, on the final commit)

- `npm run typecheck:ci` — 0 errors
- `npm run lint:ci` — 0 warnings
- `node run-tests.js` — 145/145
- `npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB` — **253 suites / 3404 tests**
- `git diff --check` — clean

Every behaviour change carries mutation evidence (byte-identical restore, sha256 checked). Each survivor
was killed by a new discriminating test or argued equivalent in its audit row. No test was weakened;
every retarget is justified in `STATE.md` ("CORE_AUDIT aşaması").

## Before merging — read this

**The database is frozen.** Nothing in this PR read or wrote Supabase. Eight migrations are **written
and NOT applied** (`supabase/migrations/README.md`), statically checked by `repo/migrationRlsGuard.test.ts`
(owner-only RLS, `authenticated` only, no GRANT / SECURITY DEFINER / `USING (true)`):

| Migration | For | Until applied | Gate after |
|---|---|---|---|
| `028_habit_pauses_and_goal_versions` | dated breaks, holiday mode, effective-dated goals | fail-open: behaviour as before | — |
| `029_habit_checklists` | habit checklists | editor says pending | — |
| `030_routine_runner` | runner templates / versions / sessions | on the device, per account | — |
| `031_moods_and_review_actions` | named moods, check-ins, review next action | on the device, per account | — |
| `032_coach_actions_v2` | second coach action set (CHECK) | behind the gate | ↓ |
| `033_habit_log_timezone` | `habit_logs.tz` | the zone is captured, not sent | `LOG_TIMEZONE_ENABLED` |
| `034_coach_reminder_action` | coach reminder-time action (CHECK, 9 types) | behind the gate | ↓ |
| `035_coach_lighten_week` | coach "lighten this week" (CHECK, 10 types) | behind the gate | `COACH_ACTIONS_V2_ENABLED` after 032+034+035 **and** the `generate-routine` deploy (S3) |

Order, verification queries, the S11 read-only queries and the KD-10/KD-11 counts:
`docs/implementation-v3/SQL_FOR_OWNER.md`. The client is fail-open **only on a missing table**
(PGRST205 / 42P01). The `generate-routine` edge function source changed and is **not deployed**.

All five existing gates stay `false`; the two new ones (`COACH_ACTIONS_V2_ENABLED`,
`LOG_TIMEZONE_ENABLED`) are `false`. Nothing deferred was turned on.

## What changed, by package

- **R01 — goals, schedules, logs.** Month days and yearly dates (short-month / leap-year policy);
  period status (an open period is not a failure); dated breaks and holidays separate from skips;
  effective-dated goal edits that never re-score the past; one local-day contract with the writing
  zone; 134 cross-consumer fixtures (Today, reminders, recovery, reports, capacity agree on 16 edge dates).
- **R02 — local-first sync.** Task outbox plus a core outbox for journal, notes, recovery plans and
  focus sessions: written on the device before the request, idempotent re-delivery (23505 = applied),
  versioned conflicts kept for the user to choose, per-account queues with a generation guard, local
  state and scheduled reminders cleared on sign-out.
- **R03 — capacity, small start, recovery.** One next actionable step; a lighter day the user chooses;
  a task's first step as its own focus session; why an activation was refused and what to do; make-up
  load preview; a one-directional progress model.
- **R04 — reminders.** Planned from the schedule (not a daily trigger), multiple times and day groups,
  quiet hours, notification actions acted on once, Android channel always created.
- **R05 — routines & focus.** Template / version / session runner; kill-proof timer; one duration
  contract; linked habits logged once and the report fed from the same summary; the runner reaches no
  provider or music module (test).
- **R06 — simplicity & accessibility.** Design system with token parity; one dominant action; shared
  form feedback; measured contrast (`textFaint` raised to AA); privacy cover; nine screen states.
- **R07 — journal, moods, analysis.** Search (Turkish folding) and calendar; amount/duration reports
  from period status; mood–habit relation with stated minimums and no causal claim; accessible chart text.
- **R08 — backup & restore.** 31 collections, manifest with relations and snapshot window, keyset
  reads to 20.000 rows, dry run, resumable restore job (same file = same job, nothing twice), authority
  never restored, 10 restore drills (5.200-row full loss reconciles counts and hashes).
- **R09 — in-app AI.** Seven gated actions (schedule, break, move task, small step, lighter today,
  reminder time, lighter week from the user's own load); an ambiguous name asks which one; every write
  re-checks its target; journal context is the user's choice and the model's numbers are labelled as
  commentary; a lost answer never costs twice; a pack is never shown as an AI answer; 100 tool-call
  scenarios scored on tool / arguments / side effect separately (model half N/R).
- **R10 — quality acceptance.** Single-effect table (three double effects found and fixed); no raw
  console writes anywhere outside the scrubbing funnel; Turkish decimals, `tr-TR` dates, Monday weeks;
  10.000-row paging; static RLS guard; this report.
- **R11 — evaluation.** CP/CE weights frozen before results (tested against the plan); two user rounds
  planned (execution N/R); closure in three separate results.

## Not in this PR (owner decisions)

S1 database restore · S2 applying 028–035 · S3 edge deploy · S4 KD-10/11 backfill · S5
`bypassPermissions` · S6 Habitify/Daylio sample · S7 `expo-sqlite` · S8 device evidence · S9 push/PR/merge
· S11 log undo · S12 schema not reproducible from the repo (incl. the FK-less `review_next_actions.task_id`)
· S13 voice announcements — note: `expo-speech` is already a dependency (`c14627d`), so this needs only
the owner's yes, not a new build · S14 `expo-document-picker` (paste works).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
