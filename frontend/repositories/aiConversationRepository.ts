/**
 * `ai_conversations` / `ai_messages` / `ai_conversation_actions` data access.
 *
 * AI Coach used to keep its messages in React state and nothing else, so
 * leaving the screen destroyed the conversation. The fix is not a cache: the
 * transcript lives in Supabase, and this file is the only place the app talks
 * to those tables — the screen never issues Supabase calls of its own, same as
 * every other feature here.
 *
 * Two things are deliberately NOT this file's job:
 *
 *   ownership   never passed in, never trusted from a caller. `currentUserId()`
 *               supplies it and RLS enforces it a second time, so a bug here
 *               cannot become a cross-user read.
 *   bounds      every list is paginated through `fetchPage`. A year-old
 *               conversation must not be loadable in one query, and the
 *               conversation list must not grow into a full-table scan.
 */
import type { V2ActionType } from '../lib/coachActionsV2';
import { supabase } from '../lib/supabase';
import {
  currentUserId, fetchPage, updateOwned, deleteOwned,
  type Cursor, type Page, type RepoResult,
} from './shared';

export type ConversationRow = {
  id: string;
  user_id: string;
  title: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  archived_at: string | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  request_id: string | null;
  created_at: string;
};

export type ActionRow = {
  id: string;
  conversation_id: string;
  assistant_message_id: string | null;
  user_id: string;
  /** R09.02 adds the second set (behind COACH_ACTIONS_V2_ENABLED; migration 032). */
  action_type: 'propose_habit' | 'propose_habit_plan' | 'log_habit' | V2ActionType;
  payload: unknown;
  status: 'pending' | 'confirmed' | 'cancelled';
  created_at: string;
  resolved_at: string | null;
};

const CONV_COLS = 'id,user_id,title,project_id,created_at,updated_at,last_message_at,archived_at';
const MSG_COLS = 'id,conversation_id,user_id,role,content,request_id,created_at';
const ACTION_COLS = 'id,conversation_id,assistant_message_id,user_id,action_type,payload,status,created_at,resolved_at';

/** Titles are metadata, not prose — bounded to match the DB CHECK. */
export const MAX_TITLE_LENGTH = 200;
/** One page of a conversation. Enough to fill a screen and scroll a little. */
export const MESSAGE_PAGE_SIZE = 40;

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function fetchConversationsPage(
  cursor?: Cursor | null,
  limit?: number,
  opts?: { projectId?: string | null },
): Promise<RepoResult<Page<ConversationRow>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return fetchPage<ConversationRow>({
    table: 'ai_conversations',
    columns: CONV_COLS,
    // Newest ACTIVITY first, not newest created: a thread you replied to this
    // morning belongs above one you started last week and abandoned.
    orderBy: 'last_message_at',
    userId: u.userId,
    cursor,
    limit,
    match: opts?.projectId === undefined ? undefined : { project_id: opts.projectId },
  });
}

export async function createConversation(input: {
  title: string;
  projectId?: string | null;
}): Promise<RepoResult<ConversationRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const title = input.title.trim().slice(0, MAX_TITLE_LENGTH);
  if (!title) return { ok: false, error: 'Sohbet başlığı boş olamaz.' };

  const { data, error } = await supabase
    .from('ai_conversations')
    // `user_id` from the session, never from the caller.
    .insert({ user_id: u.userId, title, project_id: input.projectId ?? null })
    .select(CONV_COLS)
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as ConversationRow };
}

export async function renameConversation(id: string, title: string): Promise<RepoResult<ConversationRow>> {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, error: 'Sohbet başlığı boş olamaz.' };
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<ConversationRow>({
    table: 'ai_conversations',
    columns: CONV_COLS,
    id,
    userId: u.userId,
    patch: { title: trimmed.slice(0, MAX_TITLE_LENGTH), updated_at: new Date().toISOString() },
  });
}

/**
 * File a conversation under one of the user's projects, or remove it from one.
 *
 * A foreign project id is refused by the RLS policy rather than by a check
 * here — that is the layer an attacker cannot skip. This function only has to
 * pass the value along honestly.
 */
export async function setConversationProject(
  id: string,
  projectId: string | null,
): Promise<RepoResult<ConversationRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<ConversationRow>({
    table: 'ai_conversations',
    columns: CONV_COLS,
    id,
    userId: u.userId,
    patch: { project_id: projectId, updated_at: new Date().toISOString() },
  });
}

export async function deleteConversation(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'ai_conversations', id, userId: u.userId });
}

export async function fetchConversation(id: string): Promise<RepoResult<ConversationRow | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('ai_conversations')
    .select(CONV_COLS)
    .eq('id', id)
    .eq('user_id', u.userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as ConversationRow) ?? null };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * One page of a conversation, newest first.
 *
 * The caller reverses for display. Paging from the newest end is what makes
 * "open a two-year-old thread" cheap: the first query returns the part the
 * user is actually looking at.
 */
export async function fetchMessagesPage(
  conversationId: string,
  before?: string | null,
  limit: number = MESSAGE_PAGE_SIZE,
): Promise<RepoResult<{ rows: MessageRow[]; hasMore: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const capped = Math.max(1, Math.min(limit, 100));
  let q = supabase
    .from('ai_messages')
    .select(MSG_COLS)
    .eq('conversation_id', conversationId)
    .eq('user_id', u.userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(capped + 1);

  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as MessageRow[];
  const hasMore = rows.length > capped;
  return { ok: true, data: { rows: hasMore ? rows.slice(0, capped) : rows, hasMore } };
}

export async function insertMessage(input: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  requestId?: string | null;
}): Promise<RepoResult<MessageRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const content = input.content.trim();
  if (!content) return { ok: false, error: 'Boş mesaj kaydedilemez.' };

  const { data, error } = await supabase
    .from('ai_messages')
    .insert({
      conversation_id: input.conversationId,
      user_id: u.userId,
      role: input.role,
      content: content.slice(0, 8000),
      request_id: input.requestId ?? null,
    })
    .select(MSG_COLS)
    .single();

  if (error) {
    // 23505 is the partial unique index on (conversation_id, request_id) for
    // assistant rows. It means this exact answer was already stored — a replay
    // after the app died between the provider answering and React rendering.
    // That is a SUCCESS for the caller, not a failure, so the stored row is
    // returned instead of an error.
    if (error.code === '23505' && input.role === 'assistant' && input.requestId) {
      const existing = await supabase
        .from('ai_messages')
        .select(MSG_COLS)
        .eq('conversation_id', input.conversationId)
        .eq('request_id', input.requestId)
        .eq('role', 'assistant')
        .maybeSingle();
      if (existing.data) return { ok: true, data: existing.data as MessageRow };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, data: data as MessageRow };
}

// ---------------------------------------------------------------------------
// Staged actions
// ---------------------------------------------------------------------------

/** The still-open proposal for this thread, if any. At most one is shown. */
export async function fetchPendingAction(conversationId: string): Promise<RepoResult<ActionRow | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('ai_conversation_actions')
    .select(ACTION_COLS)
    .eq('conversation_id', conversationId)
    .eq('user_id', u.userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as ActionRow) ?? null };
}

export async function insertAction(input: {
  conversationId: string;
  assistantMessageId?: string | null;
  actionType: ActionRow['action_type'];
  payload: unknown;
}): Promise<RepoResult<ActionRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('ai_conversation_actions')
    .insert({
      conversation_id: input.conversationId,
      assistant_message_id: input.assistantMessageId ?? null,
      user_id: u.userId,
      action_type: input.actionType,
      payload: input.payload as never,
    })
    .select(ACTION_COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as ActionRow };
}

/**
 * Replace a still-pending action's payload.
 *
 * The one thing that legitimately changes about a staged proposal before it is
 * resolved: the user answered a question about it ("hedef 20 dakika", "her
 * gün"). Persisting the answer is what stops the app asking again the next time
 * the conversation is opened.
 *
 * Scoped to `status = 'pending'` for the same reason `resolveAction` is: a
 * confirmed or cancelled action is finished, and finished proposals do not get
 * rewritten. The payload written here has already been through
 * `validateCoachActions`; it is stored exactly as untrusted as the model's own
 * and revalidated on the way back out.
 */
export async function updateActionPayload(
  id: string,
  payload: unknown,
): Promise<RepoResult<ActionRow | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('ai_conversation_actions')
    .update({ payload: payload as never })
    .eq('id', id)
    .eq('user_id', u.userId)
    .eq('status', 'pending')
    .select(ACTION_COLS)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as ActionRow) ?? null };
}

/**
 * Resolve a staged action.
 *
 * Scoped to `status = 'pending'` on purpose: this is the idempotency boundary
 * for confirmation. A second tap, a re-render or a resumed app finds the row
 * already resolved and changes nothing, so one staged proposal can be
 * confirmed exactly once.
 */
export async function resolveAction(
  id: string,
  status: 'confirmed' | 'cancelled',
): Promise<RepoResult<ActionRow | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('ai_conversation_actions')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', u.userId)
    .eq('status', 'pending')
    .select(ACTION_COLS)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as ActionRow) ?? null };
}
