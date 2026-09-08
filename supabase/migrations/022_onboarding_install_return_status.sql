-- Where an install must put the user back if it fails.
--
-- THE DEFECT THIS CLOSES
--
-- Onboarding is not only a first run. An existing user opens it deliberately
-- from Settings -> Kişiselleştirme, and their lifecycle status at that moment
-- is already `completed`, `legacy` or `skipped`. `saveProgress` was careful to
-- preserve those. The install was not:
--
--     completed  ->  installing  ->  habit insert fails  ->  pending
--
-- `pending` is the one status that means "this user owes us a first run", so a
-- transient failure — a dropped connection while installing three habits —
-- converted a settled account into a mandatory first-run account. On the next
-- launch the router sent them into onboarding and would not let them out.
--
-- The install claim overwrites `status`, so the value it overwrote has to be
-- kept somewhere, and it has to be kept DURABLY: the recovery protocol added
-- in 20260906c explicitly survives process death, and a rollback that reads a
-- variable in a dead process's memory is not a rollback.
--
-- WHAT IT ADDS
--
--   user_onboarding.install_return_status
--
-- Written in the SAME upsert as the claim, so a claim can never exist without
-- the status it displaced. Restored verbatim if the habit insert fails.
-- Cleared on successful completion, where the lifecycle legitimately ends at
-- `completed` regardless of where it began.
--
-- CONSTRAINED to the four NON-install statuses. `installing` is excluded on
-- purpose: it is the value being displaced, never a place to return to, and
-- storing it would let a failed retry restore the user into the very state the
-- rollback exists to leave.
--
-- SCOPE: ADDITIVE ONLY, forward-only, idempotent.
--   * One nullable column and one CHECK. Nothing dropped, nothing narrowed.
--   * No existing row changes: every current row keeps NULL here, which reads
--     as "no install in flight" — true for all of them.
--   * Install-id recovery semantics from 20260906c are untouched: the identity
--     is still (user_id, install_id), unrelated habits still never count, a
--     partial install is still explicit.
--   * Does NOT touch recovery_plans, auth config, SMTP or email templates, and
--     edits no historical migration.
--
-- ROLLBACK (manual):
--   alter table public.user_onboarding drop column if exists install_return_status;

alter table public.user_onboarding
  add column if not exists install_return_status text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_onboarding_install_return_status_check'
  ) then
    alter table public.user_onboarding
      add constraint user_onboarding_install_return_status_check
      check (
        install_return_status is null
        or install_return_status in ('pending', 'completed', 'skipped', 'legacy')
      );
  end if;
end $$;

comment on column public.user_onboarding.install_return_status is
  'The lifecycle status that existed before `status` was set to ''installing'', '
  'written in the same upsert as the claim and restored verbatim if the habit '
  'insert fails. Without it a failed personalization demoted a completed, '
  'legacy or skipped account to ''pending'' -- i.e. back into mandatory '
  'first-run onboarding. NULL means no install is in flight. ''installing'' is '
  'not an accepted value: it is the status being displaced, never a '
  'destination.';
