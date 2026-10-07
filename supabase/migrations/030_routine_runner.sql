-- Routine runner: templates, immutable template versions, and sessions.
-- (Implementation v3, R05.01 / R05.02 / R05.07)
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). Until this
-- runs the runner keeps templates and sessions on the device, per account
-- (store/routineRunnerStore.ts), and the built-in templates ship as data.
--
-- WHY NEW TABLES, NOT `routines` / `routine_items`
--
-- Those hold AI routine PROPOSALS -- a list of habits that was installed --
-- not something that runs step by step. Treating them as runner templates
-- would make every installed proposal a "routine" with no steps, durations
-- or order.
--
--   routine_templates          a named routine the user owns.
--   routine_template_versions  an IMMUTABLE copy of its steps. Editing a
--                              template inserts version N+1; old versions
--                              stay, so a past session reads against the
--                              steps it actually ran. No update policy.
--   routine_sessions           one run of one version: its own step snapshot
--                              (edits during a run change only the session),
--                              per-step marks, active time with pauses left
--                              out, start/end. Completing a step linked to a
--                              habit writes a habit_logs row through the
--                              existing path -- this table awards nothing.
--
-- Forward-only. Nothing here edits an earlier migration.

CREATE TABLE IF NOT EXISTS public.routine_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,
  CONSTRAINT routine_templates_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE TABLE IF NOT EXISTS public.routine_template_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id  uuid NOT NULL REFERENCES public.routine_templates(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  steps        jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routine_template_versions_positive CHECK (version >= 1),
  CONSTRAINT routine_template_versions_steps_array CHECK (jsonb_typeof(steps) = 'array'),
  CONSTRAINT routine_template_versions_unique UNIQUE (template_id, version)
);

CREATE TABLE IF NOT EXISTS public.routine_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id       uuid NULL REFERENCES public.routine_templates(id) ON DELETE SET NULL,
  template_version  integer NOT NULL,
  template_name     text NOT NULL,
  steps             jsonb NOT NULL,
  results           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL,
  active_ms         bigint NOT NULL DEFAULT 0,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz NULL,
  CONSTRAINT routine_sessions_status_check CHECK (status IN ('running', 'paused', 'finished')),
  CONSTRAINT routine_sessions_active_ms_check CHECK (active_ms >= 0),
  CONSTRAINT routine_sessions_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS routine_sessions_user_started_idx ON public.routine_sessions (user_id, started_at DESC);

ALTER TABLE public.routine_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_sessions          ENABLE ROW LEVEL SECURITY;

-- templates: owner only
DROP POLICY IF EXISTS routine_templates_own ON public.routine_templates;
CREATE POLICY routine_templates_own ON public.routine_templates
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- versions: read and insert only (immutable), and only under the owner's template
DROP POLICY IF EXISTS routine_template_versions_select_own ON public.routine_template_versions;
CREATE POLICY routine_template_versions_select_own ON public.routine_template_versions
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS routine_template_versions_insert_own ON public.routine_template_versions;
CREATE POLICY routine_template_versions_insert_own ON public.routine_template_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.routine_templates t WHERE t.id = template_id AND t.user_id = (SELECT auth.uid()))
  );

-- sessions: owner only; a template reference must be the owner's
DROP POLICY IF EXISTS routine_sessions_select_own ON public.routine_sessions;
CREATE POLICY routine_sessions_select_own ON public.routine_sessions
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS routine_sessions_write_own ON public.routine_sessions;
CREATE POLICY routine_sessions_write_own ON public.routine_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (template_id IS NULL OR EXISTS (SELECT 1 FROM public.routine_templates t WHERE t.id = template_id AND t.user_id = (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS routine_sessions_update_own ON public.routine_sessions;
CREATE POLICY routine_sessions_update_own ON public.routine_sessions
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
