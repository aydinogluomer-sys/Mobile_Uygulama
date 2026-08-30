-- ============================================================
-- Child rows must point at a parent the caller owns.
--
-- The same defect `20260830_habit_logs_ownership_check.sql` closed on
-- `habit_logs`, found on two more tables by reading their policies:
--
--   recovery_plans  rp_insert / rp_update   WITH CHECK (auth.uid() = user_id)
--   key_results     kr_all_own (ALL)        WITH CHECK (auth.uid() = user_id)
--
-- Neither checks the FOREIGN KEY. So a user could create a recovery plan
-- pointing at another user's habit, or a key result attached to another
-- user's objective, as long as they put their OWN id in `user_id`.
--
-- SEVERITY: integrity, not disclosure — stated the same way as on
-- habit_logs. The created row belongs to the caller, so the other user never
-- sees it and their data is unchanged. What it allows is a user attaching
-- their own rows to parents they cannot read.
--
-- ── WHY THIS IS THE CONTROL, AND THE CLIENT CHECK IS NOT ────────────────
-- The repository layer briefly did this check in TypeScript before each
-- insert. That was removed: it costs a round trip on every write and stops
-- nobody, because anything bypassing the app calls PostgREST directly. A
-- constraint a client can skip is not a constraint. The check belongs here.
--
-- Scope: policy changes only. No table, column or row is touched. Reversible
-- by restoring the two `WITH CHECK (auth.uid() = user_id)` expressions quoted
-- above.
--
-- Pre-flight (verified before applying):
--   recovery_plans rows ... 0
--   key_results rows ...... 0
--   policies: recovery_plans 4 (one per command), key_results 1 (ALL)
-- ============================================================

-- ── recovery_plans: habit_id must belong to the caller ──────────────────
drop policy if exists "rp_insert" on public.recovery_plans;
create policy "rp_insert"
  on public.recovery_plans
  for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.habits h
      where h.id = recovery_plans.habit_id
        and h.user_id = (select auth.uid())
    )
  );

drop policy if exists "rp_update" on public.recovery_plans;
create policy "rp_update"
  on public.recovery_plans
  for update
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.habits h
      where h.id = recovery_plans.habit_id
        and h.user_id = (select auth.uid())
    )
  );

-- ── key_results: okr_id must belong to the caller ───────────────────────
-- This is a single ALL policy, so unlike habit_logs there is no second,
-- laxer policy to OR the tightened check back open.
drop policy if exists "kr_all_own" on public.key_results;
create policy "kr_all_own"
  on public.key_results
  for all
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.okrs o
      where o.id = key_results.okr_id
        and o.user_id = (select auth.uid())
    )
  );
