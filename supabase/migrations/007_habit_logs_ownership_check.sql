-- ============================================================
-- habit_logs: require that the habit being logged belongs to the caller.
--
-- FOUND LIVE (2026-08-30) with two disposable users through PostgREST:
--
--   user B: insert into habit_logs (habit_id = <A's habit>, user_id = B)
--        -> ACCEPTED
--
-- Every policy on the table checked only `user_id = auth.uid()`. Nothing
-- checked that `habit_id` belonged to the caller, so any authenticated user
-- could attach logs to another user's habit.
--
-- SEVERITY: this is an INTEGRITY gap, not a data leak. The row it creates is
-- owned by B, so A never sees it (A's SELECT policy is user-scoped) and A's
-- statistics are unaffected. What it allows is a user polluting their own
-- account — and the table — with logs pointing at habits they cannot read.
-- Recorded plainly rather than inflated: no cross-user disclosure was
-- possible through this.
--
-- ── WHY BOTH POLICIES HAVE TO CHANGE ───────────────────────────────────
-- Permissive policies are OR-ed. `habit_logs` carried FIVE policies:
--
--   Users can CRUD own habit logs   ALL      USING (auth.uid() = user_id)
--   Users can insert own logs       INSERT   WITH CHECK (user_id = auth.uid())
--   Users can view own logs         SELECT   USING (user_id = auth.uid())
--   Users can update own logs       UPDATE   USING (user_id = auth.uid())
--   Users can delete own logs       DELETE   USING (user_id = auth.uid())
--
-- Tightening only the INSERT policy would have changed nothing: the ALL
-- policy has no WITH CHECK, so Postgres uses its USING expression as the
-- insert check, and an OR with a laxer alternative is just the laxer rule.
-- The ALL policy is redundant with the four per-command ones anyway — they
-- cover SELECT/INSERT/UPDATE/DELETE with the identical expression — so it is
-- dropped rather than duplicated in tightened form.
--
-- Scope: policy changes only. No table, column or row is touched. Reversible
-- by recreating the two dropped policies (their definitions are quoted above
-- verbatim for exactly that reason).
--
-- Pre-flight verified immediately before applying:
--   habit_logs rows ............................ 13
--   policies on habit_logs ...................... 5
--   per-command policies present (SELECT/INSERT/UPDATE/DELETE) ... yes
-- ============================================================

-- 1. Remove the redundant blanket policy. Its behaviour is fully covered by
--    the four per-command policies; keeping it would OR the tightened check
--    back open.
drop policy if exists "Users can CRUD own habit logs" on public.habit_logs;

-- 2. Ownership of the habit is now part of the insert contract.
drop policy if exists "Users can insert own logs" on public.habit_logs;
create policy "Users can insert own logs"
  on public.habit_logs
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.habits h
      where h.id = habit_logs.habit_id
        and h.user_id = auth.uid()
    )
  );

-- 3. The same rule on UPDATE, so a row cannot be re-pointed at a foreign
--    habit after the fact. USING keeps deciding which rows are updatable;
--    WITH CHECK decides what they may become.
drop policy if exists "Users can update own logs" on public.habit_logs;
create policy "Users can update own logs"
  on public.habit_logs
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.habits h
      where h.id = habit_logs.habit_id
        and h.user_id = auth.uid()
    )
  );

comment on table public.habit_logs is
  'Per-day habit completion rows. RLS: owner-scoped on user_id, and INSERT/UPDATE '
  'additionally require that habit_id belongs to the caller — without that, a user '
  'could attach logs to another user''s habit (found live 2026-08-30).';
