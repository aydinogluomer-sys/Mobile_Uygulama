-- `user_onboarding.status` gains 'installing'.
--
-- WHY
--
-- Installing the first-run plan is two writes against two tables: the habits
-- go into `habits`, then the flow is marked finished in `user_onboarding`.
-- The client cannot make those atomic, so there is a window in which the
-- habits exist and nothing records that they do.
--
-- Before this migration that window was unrecoverable. If the completion
-- write failed, the store cleared the in-memory plan and every retry answered
-- "Kurulacak alışkanlık yok." — and after a process restart there was no
-- server-side trace at all that an install had ever been attempted. The
-- account was left with habits, no completed onboarding, and no way back.
--
-- `installing` is the durable claim that closes it. The order becomes:
--
--   1. write status = 'installing'      <- durable, and BEFORE any habit exists
--   2. insert the habits
--   3. write status = 'completed'
--
-- A failure at (1) means nothing was installed: retry from scratch is safe.
-- A failure at (2) means nothing was installed either, and the client returns
-- the row to 'pending'. A failure at (3) leaves `installing` on the server,
-- which is what a later session reads to know an install already happened.
--
-- Recovery is not a guess. On seeing `installing`, the client counts the
-- account's habits: zero means there is provably nothing to duplicate and the
-- whole install may re-run; more than zero means the insert landed and ONLY
-- the completion write is retried. No habit names are matched.
--
-- SCOPE: ADDITIVE ONLY, forward-only, idempotent.
--   * Widens one CHECK to accept one more value. No value is removed, so no
--     existing row can become invalid.
--   * No data rewrite, no column drop, no table touched but this one.
--   * Does NOT touch recovery_plans, auth configuration, SMTP or templates.
--
-- ROLLBACK (manual, and only safe once no row holds the new value):
--   alter table public.user_onboarding drop constraint user_onboarding_status_check;
--   alter table public.user_onboarding add constraint user_onboarding_status_check
--     check (status in ('pending', 'completed', 'skipped', 'legacy'));

alter table public.user_onboarding
  drop constraint if exists user_onboarding_status_check;

alter table public.user_onboarding
  add constraint user_onboarding_status_check
  check (status in ('pending', 'installing', 'completed', 'skipped', 'legacy'));

-- `completed_at` still agrees with `status`: 'installing' is not 'completed',
-- so it carries no timestamp. Restated here rather than assumed, because the
-- two constraints are the pair that keeps a half-finished install from
-- looking finished.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_onboarding_completed_at_agrees_with_status'
  ) then
    alter table public.user_onboarding
      add constraint user_onboarding_completed_at_agrees_with_status
      check (
        (status = 'completed' and completed_at is not null)
        or (status <> 'completed' and completed_at is null)
      );
  end if;
end $$;

comment on column public.user_onboarding.status is
  'pending (new, unfinished) | installing (habits are being written; a durable '
  'claim that survives process death) | completed | skipped | legacy '
  '(predates the feature). See 20260906b for the install recovery protocol.';
