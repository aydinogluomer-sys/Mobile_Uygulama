-- Durable, threaded AI Coach conversations.
--
-- WHAT WAS WRONG
--
-- AI Coach kept its messages in React state and nothing else. Leaving the
-- screen destroyed the conversation -- which is exactly what the owner hit on
-- a real device: navigate away, come back, everything gone. AsyncStorage would
-- not have been an answer either; it survives navigation but not reinstall,
-- not a second device, and it cannot enforce ownership. The source of truth
-- has to be the database.
--
-- WHAT THIS ADDS
--
--   ai_conversations         one thread, optionally filed under an EXISTING
--                            project (no second project concept is created)
--   ai_messages              the durable transcript
--   ai_conversation_actions  validated, staged habit/plan/log proposals, so a
--                            preview survives navigation instead of being
--                            rebuilt by re-parsing the assistant's prose
--
-- THREE THINGS THIS FILE IS CAREFUL ABOUT
--
--   ownership   every policy derives the owner from auth.uid(). The client
--               never supplies user_id, and a conversation may only point at
--               a project the SAME user owns -- checked in the policy, because
--               a CHECK constraint cannot see another table.
--   isolation   messages are readable only through their own conversation and
--               only by its owner. Conversation A's rows must never be
--               reachable while building context for B.
--   idempotency one logical request produces at most ONE assistant row. That
--               is a partial unique index, not a client-side guard, because
--               the crash case this protects against is the client dying
--               between the provider answering and React rendering.
--
-- Forward-only. Nothing here edits an earlier migration.

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            text NOT NULL,
  -- Nullable on purpose: a conversation exists perfectly well without a
  -- project. ON DELETE SET NULL because losing the project must never take
  -- the conversation with it.
  project_id       uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz NULL,
  CONSTRAINT ai_conversations_title_len
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200)
);

-- The list query: this user's threads, newest activity first.
CREATE INDEX IF NOT EXISTS ai_conversations_user_recent_idx
  ON public.ai_conversations (user_id, last_message_at DESC);

-- The same list filtered to one project.
CREATE INDEX IF NOT EXISTS ai_conversations_user_project_recent_idx
  ON public.ai_conversations (user_id, project_id, last_message_at DESC)
  WHERE project_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  -- Denormalised from the conversation so every RLS policy and index on this
  -- table can be answered without a join. It is kept honest by the policies
  -- below, which require it to equal auth.uid().
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Deliberately only the two roles that are real conversation. Transient UI
  -- errors are not model turns and are not persisted as if they were.
  role             text NOT NULL,
  content          text NOT NULL,
  /** The coach request this row belongs to. Assistant rows are unique on it. */
  request_id       text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant')),
  CONSTRAINT ai_messages_content_len
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 8000),
  CONSTRAINT ai_messages_request_id_len
    CHECK (request_id IS NULL OR char_length(request_id) BETWEEN 8 AND 128)
);

-- Reading one thread in order, and paginating it.
CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
  ON public.ai_messages (conversation_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ai_messages_user_idx
  ON public.ai_messages (user_id);

-- One logical request, at most one assistant answer.
--
-- This is the crash boundary. If the provider answers and the app dies before
-- React renders, the retry replays the SAME request_id; without this index the
-- replay would insert a second assistant row and the user would see the answer
-- twice. Partial, because user rows legitimately share a request_id with the
-- assistant row they prompted.
CREATE UNIQUE INDEX IF NOT EXISTS ai_messages_assistant_request_uniq
  ON public.ai_messages (conversation_id, request_id)
  WHERE role = 'assistant' AND request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Staged actions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_conversation_actions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  assistant_message_id uuid NULL REFERENCES public.ai_messages(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type          text NOT NULL,
  -- The payload the CLIENT validator already accepted -- bounded, key-checked
  -- and stripped of anything resembling authority. Raw model output is never
  -- stored here, and this is revalidated on rehydrate before it can be
  -- confirmed, because a row written by an older build is still untrusted.
  payload              jsonb NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
  created_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz NULL,
  CONSTRAINT ai_actions_type_check
    CHECK (action_type IN ('propose_habit', 'propose_habit_plan', 'log_habit')),
  CONSTRAINT ai_actions_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  -- A resolved action records WHEN, and a pending one has not resolved. Keeps
  -- "confirmed but no timestamp" out of the table entirely.
  CONSTRAINT ai_actions_resolved_agrees_with_status
    CHECK ((status = 'pending' AND resolved_at IS NULL)
        OR (status <> 'pending' AND resolved_at IS NOT NULL))
);

-- Rehydrating one thread's still-open proposal.
CREATE INDEX IF NOT EXISTS ai_actions_conversation_pending_idx
  ON public.ai_conversation_actions (conversation_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ai_actions_user_idx
  ON public.ai_conversation_actions (user_id);

-- ---------------------------------------------------------------------------
-- last_message_at maintenance
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER on purpose. The user is updating their OWN conversation and
-- their own UPDATE policy already permits it, so there is no reason to add a
-- SECURITY DEFINER function -- and therefore no new mutable-search_path
-- surface for the linter to flag or an attacker to look at.
CREATE OR REPLACE FUNCTION public.ai_touch_conversation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.ai_conversations
     SET last_message_at = NEW.created_at,
         updated_at      = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_messages_touch_conversation ON public.ai_messages;
CREATE TRIGGER ai_messages_touch_conversation
  AFTER INSERT ON public.ai_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_touch_conversation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.ai_conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversation_actions ENABLE ROW LEVEL SECURITY;

-- Conversations -------------------------------------------------------------

DROP POLICY IF EXISTS ai_conversations_select_own ON public.ai_conversations;
CREATE POLICY ai_conversations_select_own ON public.ai_conversations
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- The project check is the reason this is a policy and not a CHECK constraint:
-- it has to look at another table. Supplying someone else's project UUID fails
-- here rather than quietly filing your conversation under their project.
DROP POLICY IF EXISTS ai_conversations_insert_own ON public.ai_conversations;
CREATE POLICY ai_conversations_insert_own ON public.ai_conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.projects p
         WHERE p.id = project_id AND p.user_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS ai_conversations_update_own ON public.ai_conversations;
CREATE POLICY ai_conversations_update_own ON public.ai_conversations
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      project_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.projects p
         WHERE p.id = project_id AND p.user_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS ai_conversations_delete_own ON public.ai_conversations;
CREATE POLICY ai_conversations_delete_own ON public.ai_conversations
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Messages ------------------------------------------------------------------
--
-- Both halves are required. `user_id = auth.uid()` alone would let someone
-- write a row carrying their own id into a conversation they do not own; the
-- EXISTS clause anchors the row to a thread they actually have.

DROP POLICY IF EXISTS ai_messages_select_own ON public.ai_messages;
CREATE POLICY ai_messages_select_own ON public.ai_messages
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS ai_messages_insert_own ON public.ai_messages;
CREATE POLICY ai_messages_insert_own ON public.ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.ai_conversations c
       WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS ai_messages_delete_own ON public.ai_messages;
CREATE POLICY ai_messages_delete_own ON public.ai_messages
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Deliberately no UPDATE policy: a transcript is a record of what was said.
-- Editing history would make "what did the model actually see" unanswerable.

-- Staged actions ------------------------------------------------------------

DROP POLICY IF EXISTS ai_actions_select_own ON public.ai_conversation_actions;
CREATE POLICY ai_actions_select_own ON public.ai_conversation_actions
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS ai_actions_insert_own ON public.ai_conversation_actions;
CREATE POLICY ai_actions_insert_own ON public.ai_conversation_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.ai_conversations c
       WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS ai_actions_update_own ON public.ai_conversation_actions;
CREATE POLICY ai_actions_update_own ON public.ai_conversation_actions
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS ai_actions_delete_own ON public.ai_conversation_actions;
CREATE POLICY ai_actions_delete_own ON public.ai_conversation_actions
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- `authenticated` only. `anon` is given nothing at all, which is stronger than
-- relying on RLS to return zero rows: an unauthenticated caller gets
-- "permission denied" at the table, exactly as `profiles` and `habits` already
-- behave in this project.

REVOKE ALL ON public.ai_conversations        FROM PUBLIC, anon;
REVOKE ALL ON public.ai_messages             FROM PUBLIC, anon;
REVOKE ALL ON public.ai_conversation_actions FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversations        TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.ai_messages             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversation_actions TO authenticated;

-- Explicit, because the schema's default privileges hand `authenticated`
-- UPDATE on a newly created table regardless of what the GRANT above lists.
-- RLS already refused it (ai_messages has no UPDATE policy on purpose -- a
-- transcript is a record of what was said), but leaving the grant in place
-- would have made the table look editable to anyone reading privileges.
REVOKE UPDATE ON public.ai_messages FROM authenticated;

GRANT ALL ON public.ai_conversations        TO service_role;
GRANT ALL ON public.ai_messages             TO service_role;
GRANT ALL ON public.ai_conversation_actions TO service_role;
