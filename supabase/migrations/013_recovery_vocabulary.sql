-- ============================================================
-- One recovery vocabulary, and stop dropping five columns on every save.
--
-- ── The adapter, and why it existed ────────────────────────────────────
--
-- `lib/recovery.ts` carries `strategyToLegacy` / `strategyFromLegacy` and
-- `statusToLegacy` / `statusFromLegacy`, translating between the domain's v2
-- vocabulary and what the table would accept:
--
--   complete_today <-> full        planned   <-> planned
--   push_tomorrow  <-> reschedule  completed <-> done
--   split_two_days <-> half        cancelled <-> skipped
--   skip           <-> mini        expired   -> skipped   (LOSSY)
--
-- The strategy pairing is a bijection but `skip <-> mini` is a
-- re-interpretation: legacy `mini` meant "a reduced-scope make-up, same day",
-- which v2 has no word for. `expired -> skipped` is outright lossy — "the
-- user declined" and "the window closed on its own" are different facts and
-- both come back as `cancelled`.
--
-- ── What is actually stale ─────────────────────────────────────────────
--
-- `status` was already widened (migration 20260825) and the CHECK accepts all
-- six spellings today. Only `strategy` was left behind.
--
-- And the adapter's other half is worse than stale. `toLegacyRecoveryPlan`
-- drops five fields with this reason:
--
--     "there is no column to put them in until the authored migration is
--      reviewed and applied"
--
-- That migration WAS applied. `source_log_id`, `deficit_type`,
-- `deficit_value`, `distributed_days` and `completed_at` are all columns on
-- `recovery_plans` right now. So every recovery plan the app saves silently
-- discards how much was owed, how it was to be split across days, which log
-- it came from, and when it was finished — the numbers `recovery.deficitFor`
-- exists to compute. A plan cannot be reconstructed from what is stored.
--
-- ── Straight to v2, not a transition window ────────────────────────────
--
-- `recovery_plans` holds ZERO rows, so there is nothing to backfill and no
-- risk of orphaning data. The app is pre-release — registration is still
-- externally blocked — so no build in anyone's hands writes the legacy
-- spellings. Accepting both vocabularies "for safety" would preserve exactly
-- the ambiguity this migration exists to remove.
--
-- Reversible by restoring the two CHECK expressions quoted below.
--
-- Pre-flight (verified before applying):
--   recovery_plans rows ......... 0
--   strategy CHECK .............. ('full','half','mini','reschedule')
--   status CHECK ................ ('planned','done','skipped','completed','expired','cancelled')
--   columns present ............. source_log_id, deficit_type, deficit_value,
--                                 distributed_days, completed_at
-- ============================================================

-- ── strategy: the v2 words, and only those ─────────────────────────────
alter table public.recovery_plans
  drop constraint if exists recovery_plans_strategy_check;
alter table public.recovery_plans
  add constraint recovery_plans_strategy_check
  check (strategy = any (array['complete_today', 'push_tomorrow', 'split_two_days', 'skip']));

-- ── status: drop the legacy spellings the widening left behind ─────────
-- Keeping `done` and `skipped` alongside `completed` and `cancelled` means
-- two ways to write the same fact, and every reader has to know both.
alter table public.recovery_plans
  drop constraint if exists recovery_plans_status_check;
alter table public.recovery_plans
  add constraint recovery_plans_status_check
  check (status = any (array['planned', 'completed', 'expired', 'cancelled']));

-- The default was written in the legacy vocabulary too.
alter table public.recovery_plans
  alter column status set default 'planned';

-- ── the five carried fields get their shape enforced ───────────────────
-- They were never written, so nothing has ever validated them.

alter table public.recovery_plans
  drop constraint if exists recovery_plans_distributed_days_shape;
alter table public.recovery_plans
  add constraint recovery_plans_distributed_days_shape check (
    distributed_days is null or jsonb_typeof(distributed_days) = 'array'
  );

alter table public.recovery_plans
  drop constraint if exists recovery_plans_deficit_value_nonneg;
alter table public.recovery_plans
  add constraint recovery_plans_deficit_value_nonneg check (
    deficit_value is null or deficit_value >= 0
  );

-- `completed_at` only means something once the plan is completed, and a
-- completed plan without one cannot be placed in time.
alter table public.recovery_plans
  drop constraint if exists recovery_plans_completed_at_agrees_with_status;
alter table public.recovery_plans
  add constraint recovery_plans_completed_at_agrees_with_status check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  );

comment on column public.recovery_plans.strategy is
  'v2 vocabulary only: complete_today | push_tomorrow | split_two_days | skip. The legacy full/half/mini/reschedule spellings and the adapter that translated them were removed in 20260831.';
comment on column public.recovery_plans.deficit_value is
  'How much was owed, from lib/recovery.deficitFor. Was silently dropped on every save until 20260831.';
