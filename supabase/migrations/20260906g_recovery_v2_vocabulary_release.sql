-- ============================================================
-- Recovery V2 vocabulary — the coordinated release migration.
--
-- ## What this closes
--
-- `20260831_recovery_vocabulary` narrowed `recovery_plans` to the v2 words and
-- was applied. `20260831_recovery_vocabulary_compat_rollback` then put the
-- legacy words back, because the client running against this database was
-- still `main`, which writes `full` / `done` / `skipped`. That rollback was
-- explicit about being temporary, and the pre-merge audit records the re-apply
-- as a RELEASE GATE (§0b), not a note.
--
-- This is that gate, discharged. It is a NEW forward migration rather than a
-- replay of `20260831_recovery_vocabulary`: the history stays readable as what
-- actually happened, and unlike the original this one carries the data
-- mapping, because a re-apply at release time cannot assume the table is still
-- empty.
--
-- ## Why the order below is the order
--
-- The legacy CHECK is dropped BEFORE the rows are mapped. That is not
-- housekeeping: `recovery_plans_strategy_check` currently accepts only
-- `full|half|mini|reschedule`, so an `UPDATE ... SET strategy =
-- 'complete_today'` against the live constraint fails on its first row. The
-- table is therefore relaxed, migrated, then re-constrained — and the final
-- CHECK is added only once every row already satisfies it, so the database is
-- never in a state where existing rows violate the constraint they live under.
--
-- ## The mapping (authoritative, and the same one the deleted adapter used)
--
--   strategy   full        -> complete_today
--              reschedule  -> push_tomorrow
--              half        -> split_two_days
--              mini        -> skip
--
--   status     done        -> completed
--              skipped     -> cancelled
--
-- `mini -> skip` is a re-interpretation rather than a rename — legacy `mini`
-- meant "a reduced-scope make-up, same day", which v2 has no word for. It is
-- the mapping the product has committed to; it is recorded here so the loss is
-- visible in history rather than discovered later.
--
-- ## `completed_at`, the one place the two vocabularies collide
--
-- `recovery_plans_completed_at_agrees_with_status` requires `completed_at` to
-- be set exactly when `status = 'completed'`. `main` never writes that column,
-- so a legacy `done` row has `completed_at IS NULL` — and mapping it straight
-- to `completed` would violate the constraint the moment it is re-checked.
--
-- So the mapping reconciles the pair rather than only the word:
--
--   done    -> completed  + completed_at := coalesce(completed_at, created_at)
--   skipped -> cancelled  + completed_at := null
--
-- `created_at` is used deliberately in place of a fabricated `now()`: it is a
-- real fact about that row and is honest about being an approximation, where
-- `now()` would assert the make-up happened at migration time. A `cancelled`
-- plan has no completion instant by definition, so the column is cleared.
--
-- ## Pre-flight, read from kbcuolhjjnmhjaarxxmu immediately before applying
--
--   recovery_plans rows ......... 0   (no legacy rows, no v2 rows, none unknown)
--   strategy CHECK .............. ('full','half','mini','reschedule')   [legacy]
--   status CHECK ................ ('planned','done','skipped','completed','expired','cancelled')
--   strategy DEFAULT ............ 'full'      <-- legacy, and fixed below
--   status DEFAULT .............. 'planned'   <-- valid under v2, left alone
--   triggers on recovery_plans .. none
--   DB functions naming recovery. none
--
-- The row count being zero is why this is safe to run now. The UPDATE
-- statements are still written and still correct: a migration that only works
-- on an empty table is not a migration, and rows could exist by the time this
-- runs anywhere else.
--
-- Historical migrations are untouched. This file supersedes the vocabulary
-- half of the rollback and nothing else.
-- ============================================================

-- ── 1. relax: the legacy CHECK would reject the mapping itself ────────────
alter table public.recovery_plans
  drop constraint if exists recovery_plans_strategy_check;
alter table public.recovery_plans
  drop constraint if exists recovery_plans_status_check;

-- ── 2. map every legacy row, exactly once ─────────────────────────────────
--
-- The WHERE clauses name only legacy values, so a row already speaking v2 is
-- not touched and cannot be double-mapped.
update public.recovery_plans
set strategy = case strategy
                 when 'full'       then 'complete_today'
                 when 'reschedule' then 'push_tomorrow'
                 when 'half'       then 'split_two_days'
                 when 'mini'       then 'skip'
               end
where strategy in ('full', 'reschedule', 'half', 'mini');

-- Status and `completed_at` move together; see the header.
update public.recovery_plans
set status       = 'completed',
    completed_at = coalesce(completed_at, created_at)
where status = 'done';

update public.recovery_plans
set status       = 'cancelled',
    completed_at = null
where status = 'skipped';

-- ── 3. the default was legacy too ─────────────────────────────────────────
--
-- Easy to miss because the client always sends `strategy` explicitly, so the
-- default is never exercised today. It would still be a legacy value sitting
-- in the schema that the new CHECK rejects — an INSERT omitting the column
-- would fail with a constraint violation rather than take the default.
-- `status`'s default is already 'planned', which is valid under v2, so it is
-- left alone rather than restated.
alter table public.recovery_plans
  alter column strategy set default 'complete_today';

-- ── 4. the final v2 contract ──────────────────────────────────────────────
alter table public.recovery_plans
  add constraint recovery_plans_strategy_check
  check (strategy = any (array['complete_today', 'push_tomorrow', 'split_two_days', 'skip']));

alter table public.recovery_plans
  add constraint recovery_plans_status_check
  check (status = any (array['planned', 'completed', 'expired', 'cancelled']));

-- ── 5. prove it, in the same transaction that did it ──────────────────────
--
-- If anything survived the mapping the migration aborts rather than reporting
-- success over a half-converted table.
do $$
declare bad_strategy int; bad_status int;
begin
  select count(*) into bad_strategy from public.recovery_plans
    where strategy not in ('complete_today', 'push_tomorrow', 'split_two_days', 'skip');
  select count(*) into bad_status from public.recovery_plans
    where status not in ('planned', 'completed', 'expired', 'cancelled');

  if bad_strategy > 0 or bad_status > 0 then
    raise exception
      'recovery v2 migration incomplete: % strategy and % status rows outside the v2 vocabulary',
      bad_strategy, bad_status;
  end if;
end $$;

comment on column public.recovery_plans.strategy is
  'v2 vocabulary only: complete_today | push_tomorrow | split_two_days | skip. '
  'The legacy full/half/mini/reschedule spellings were mapped and retired by '
  '20260906g as part of the coordinated v2 release; the temporary compatibility '
  'rollback in 20260831_recovery_vocabulary_compat_rollback is now discharged.';

comment on column public.recovery_plans.status is
  'v2 vocabulary only: planned | completed | expired | cancelled. The legacy '
  'done/skipped spellings were mapped by 20260906g (done -> completed, '
  'skipped -> cancelled), reconciling completed_at with '
  'recovery_plans_completed_at_agrees_with_status in the same statement.';
