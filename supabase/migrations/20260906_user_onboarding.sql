-- First-run onboarding preferences.
--
-- WHY A NEW TABLE RATHER THAN COLUMNS ON `profiles`
--
-- `profiles` is the gamification/identity row: level, total_xp,
-- current_level_xp, willpower_rank, coins, skill_points, purged_xp. Those are
-- SERVER-OWNED -- a trigger writes them and
-- `frontend/__tests__/repo/xpIsEarned.test.ts` fails any client update that
-- names one. Onboarding answers are the opposite: client-owned, client-edited,
-- and unrelated to scoring. Putting them in the same row would mean the one
-- table the client must never write freely is also the table it writes on
-- every preference change, and the gate protecting it would have to learn a
-- column allowlist instead of a table rule.
--
-- So: one row per user, its own lifecycle (`status`, `onboarding_version`,
-- `completed_at`), its own RLS.
--
-- THE LEGACY BACKFILL, AND WHY IT IS THE POINT OF THIS MIGRATION
--
-- The client treats "no row" as `pending` and routes such a user into
-- onboarding. Without a backfill, every EXISTING account would become pending
-- the moment this ships and would be blocked behind a first-run flow they
-- never asked for. Section D therefore writes a `legacy` row for every user
-- that exists at migration time; `legacy` reads as "does not need first-run
-- onboarding" and keeps their access exactly as it is today. They can still
-- open personalization deliberately from Settings.
--
-- The backfill is `on conflict do nothing`, so re-running adds nothing and
-- overwrites nobody's real answers.
--
-- SCOPE: ADDITIVE ONLY, forward-only, idempotent.
--   * No DROP, no destructive ALTER, no data rewrite.
--   * Touches nothing outside `public.user_onboarding`.
--   * Does NOT touch recovery_plans, auth configuration, SMTP or email
--     templates.
--
-- ROLLBACK (manual, for a reviewer):
--   drop table if exists public.user_onboarding;

-- ── A. Table ────────────────────────────────────────────────────────────────
create table if not exists public.user_onboarding (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  -- Bumped when the QUESTIONS change, so a later version can tell "answered
  -- the old form" from "never answered".
  onboarding_version  integer     not null default 1,
  goals               text[]      not null default '{}',
  primary_barrier     text        null,
  pace                text        null,
  preferred_dayparts  text[]      not null default '{}',
  -- Tri-state on purpose. NULL = not asked yet; true/false = the user's
  -- INTENT. This is not the OS permission grant, which lives with the OS and
  -- can be revoked without the user ever changing their mind here.
  reminder_intent     boolean     null,
  status              text        not null default 'pending',
  completed_at        timestamptz null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.user_onboarding is
  'First-run onboarding answers, one row per user. status: pending (new user, '
  'not finished) | completed (finished the flow) | skipped (chose to skip) | '
  'legacy (existed before the feature shipped; not required to onboard). '
  'reminder_intent is the USER''S WISH, not the OS notification permission.';

comment on column public.user_onboarding.reminder_intent is
  'User intent only. Never treat true as "notifications are working" -- the OS '
  'permission is a separate fact and may be denied or revoked.';

-- ── B. Value constraints ────────────────────────────────────────────────────
--
-- Written as `do` blocks because `alter table ... add constraint` has no
-- `if not exists`, and this file must be safe to run more than once.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_status_check') then
    alter table public.user_onboarding add constraint user_onboarding_status_check
      check (status in ('pending', 'completed', 'skipped', 'legacy'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_pace_check') then
    alter table public.user_onboarding add constraint user_onboarding_pace_check
      check (pace is null or pace in ('gentle', 'balanced', 'intensive'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_barrier_check') then
    alter table public.user_onboarding add constraint user_onboarding_barrier_check
      check (primary_barrier is null or primary_barrier in (
        'getting_started', 'consistency', 'forgetting', 'motivation',
        'oversized_goals', 'lack_of_time', 'unsure_where_to_start'
      ));
  end if;

  -- Array membership, not just type. Without this a client could store an
  -- arbitrary string in `goals` and the plan engine would silently match
  -- nothing for that user.
  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_goals_check') then
    alter table public.user_onboarding add constraint user_onboarding_goals_check
      -- The parentheses around the length test are load-bearing: `and` binds
      -- tighter than `or`, so without them this reads as
      -- `(membership and length is null) or (length <= 3)` and a two-element
      -- array containing an invalid goal satisfies the right-hand side.
      check (
        goals <@ array[
          'health_energy', 'focus_productivity', 'sleep', 'learning',
          'mental_wellbeing', 'daily_order', 'finance', 'other'
        ]::text[]
        and (array_length(goals, 1) is null or array_length(goals, 1) <= 3)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_dayparts_check') then
    alter table public.user_onboarding add constraint user_onboarding_dayparts_check
      check (preferred_dayparts <@ array['morning', 'daytime', 'evening', 'bedtime']::text[]);
  end if;

  -- Mirrors `recovery_plans_completed_at_agrees_with_status`: a completed row
  -- without a timestamp, or a timestamp on a row that is not completed, is a
  -- state nothing should be able to write.
  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_completed_at_agrees_with_status') then
    alter table public.user_onboarding add constraint user_onboarding_completed_at_agrees_with_status
      check (
        (status = 'completed' and completed_at is not null)
        or (status <> 'completed' and completed_at is null)
      );
  end if;
end $$;

-- ── C. RLS ──────────────────────────────────────────────────────────────────
alter table public.user_onboarding enable row level security;

drop policy if exists "user_onboarding_owner" on public.user_onboarding;
create policy "user_onboarding_owner" on public.user_onboarding
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- `with check` as well as `using`: without it a user could UPDATE their own
-- row and move `user_id` to somebody else's id, handing them a row they did
-- not write. Same reasoning as the child-row ownership migration.

grant select, insert, update, delete on public.user_onboarding to authenticated;

-- ── D. Legacy backfill ──────────────────────────────────────────────────────
--
-- Everyone who already has an account is marked `legacy`, so shipping this
-- feature does not put an existing user behind a first-run flow. New accounts
-- get no row and the client reads that as `pending`.
insert into public.user_onboarding (user_id, status, onboarding_version)
select u.id, 'legacy', 1
from auth.users u
on conflict (user_id) do nothing;

-- ── E. updated_at ───────────────────────────────────────────────────────────
create or replace function public.touch_user_onboarding_updated_at()
returns trigger
language plpgsql
-- Empty search_path: this function is reached by a trigger on a fixed table
-- and resolves no unqualified names, so pinning it costs nothing and keeps it
-- out of the `function_search_path_mutable` advisor list.
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_user_onboarding_updated_at on public.user_onboarding;
create trigger trg_user_onboarding_updated_at
  before update on public.user_onboarding
  for each row execute function public.touch_user_onboarding_updated_at();
