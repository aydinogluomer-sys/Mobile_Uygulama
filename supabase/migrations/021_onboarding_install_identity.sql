-- A durable identity for one onboarding install.
--
-- THE DEFECT THIS CLOSES
--
-- Recovery from an interrupted install asked "does this account have any
-- habits?" and read a non-zero answer as "the install landed". That is true
-- for a first-run user, whose account starts empty, and FALSE for an existing
-- user who reopened onboarding from Settings -> Kişiselleştirme:
--
--   user already has 8 habits
--   opens personalization, a new plan is generated
--   status = 'installing' is persisted
--   the process dies BEFORE the new habits are inserted
--   on restart the 8 OLD habits are counted as evidence
--   completion is written, and the personalized plan is never installed
--
-- The count of an account's habits says nothing about whether one particular
-- install landed. Only an identity attached to the rows that install produced
-- can answer that, so this migration adds one.
--
-- WHAT IT ADDS
--
--   habits.install_id                       which install produced this row
--   user_onboarding.install_id              the install currently claimed
--   user_onboarding.install_expected_habits how many rows it should produce
--
-- Recovery then asks a question that can only be answered by this install:
--
--   0 matching rows              -> the insert never landed; re-run is safe
--   exactly `expected` rows      -> it landed; only the completion may retry
--   anything in between          -> partial; an explicit state, never a guess
--
-- NULLABLE ON PURPOSE. Every habit created by hand, by a Routine Pack or by
-- the AI builder keeps `install_id = null` and is invisible to this query, so
-- an existing account's habits can never again be mistaken for the current
-- install.
--
-- IDEMPOTENCY. The unique index makes a re-run of the SAME install id a
-- conflict rather than a duplicate — a second safety net under the client
-- guard, for the case where an insert commits and its response is lost. Name
-- appears there as part of a uniqueness key WITHIN one install batch; it is
-- not, and must not become, the recovery signal.
--
-- SCOPE: ADDITIVE ONLY, forward-only, idempotent.
--   * Two nullable columns and two indexes. No column is dropped or narrowed.
--   * No existing row changes: every current habit keeps `install_id = null`.
--   * `habits` RLS and its owner policy are untouched; ownership is enforced
--     by the same policy that already governs the table, and every query
--     added for this feature filters on `user_id` explicitly as well.
--   * Does NOT touch recovery_plans, auth config, SMTP or email templates,
--     and edits no historical migration.
--
-- ROLLBACK (manual):
--   drop index if exists habits_install_id_name_uniq;
--   drop index if exists habits_user_install_idx;
--   alter table public.habits drop column if exists install_id;
--   alter table public.user_onboarding drop column if exists install_id;
--   alter table public.user_onboarding drop column if exists install_expected_habits;

-- ── A. The identity on the rows an install produces ─────────────────────────
alter table public.habits
  add column if not exists install_id uuid null;

comment on column public.habits.install_id is
  'The onboarding install that created this row, or NULL for every habit made '
  'by hand, by a Routine Pack or by the AI builder. Recovery counts rows by '
  '(user_id, install_id) -- never by how many habits the account has, which '
  'is not evidence about any particular install.';

-- The recovery lookup, and nothing else, uses this shape.
create index if not exists habits_user_install_idx
  on public.habits (user_id, install_id)
  where install_id is not null;

-- Idempotency: the same install cannot write the same habit twice.
create unique index if not exists habits_install_id_name_uniq
  on public.habits (user_id, install_id, name)
  where install_id is not null;

-- ── B. The claim ────────────────────────────────────────────────────────────
alter table public.user_onboarding
  add column if not exists install_id uuid null;

alter table public.user_onboarding
  add column if not exists install_expected_habits integer null;

comment on column public.user_onboarding.install_id is
  'The install claimed by status = ''installing'', written BEFORE any habit '
  'exists. Kept after completion as an audit trail of which rows the plan '
  'produced.';

comment on column public.user_onboarding.install_expected_habits is
  'How many habits the claimed install should produce. Recovery compares the '
  'actual matching row count against it, so a partial insert is detectable '
  'rather than being rounded up to "landed".';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_onboarding_install_expected_nonneg'
  ) then
    alter table public.user_onboarding
      add constraint user_onboarding_install_expected_nonneg
      check (install_expected_habits is null or install_expected_habits >= 0);
  end if;
end $$;
