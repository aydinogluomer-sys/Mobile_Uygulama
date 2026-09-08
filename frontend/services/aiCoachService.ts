/**
 * The AI Coach conversation domain.
 *
 * ## Why this domain has a service at all
 *
 * The layering contract in `__tests__/repo/layerBoundary.test.ts` says a store
 * gets a service when its domain has ORCHESTRATION — more than one write that
 * must agree, an ordering rule, a cross-aggregate check, or a derived value
 * the caller must not supply. A coach turn has all four:
 *
 *   ordering        the user message is durable before the provider is called,
 *                   and the answer is durable BEFORE anyone calls the turn a
 *                   success;
 *   writes agreeing a turn writes the conversation (created on first message),
 *                   two message rows and, sometimes, a staged action row;
 *   cross-aggregate opening a thread reads its messages and its still-open
 *                   proposal together, because a proposal that belongs to
 *                   another thread must never be confirmable in this one;
 *   derived value   the thread's title comes from its first message. The
 *                   screen does not get to supply it, and no second paid model
 *                   call is made to invent one.
 *
 * The thin reads below (`listThreads`, `olderMessages`, `renameThread`, …)
 * pass through to the repository with little of their own to say. They are
 * here anyway, because the alternative is a store that reaches straight to the
 * repository "just for the easy calls" — which is precisely the hole the
 * layering contract exists to close. One façade, one boundary.
 *
 * ## What this file will not do
 *
 * It never writes a habit, a log or a task. A model proposal is validated and
 * STAGED; turning a staged proposal into real rows is a confirmed user action
 * that goes through the ordinary habit/log services, exactly as if the user
 * had typed it in themselves.
 */
import {
  fetchConversationsPage, createConversation, renameConversation,
  setConversationProject, deleteConversation, fetchConversation,
  fetchMessagesPage, insertMessage, fetchPendingAction, insertAction,
  resolveAction, updateActionPayload, MAX_TITLE_LENGTH, MESSAGE_PAGE_SIZE,
  type ConversationRow, type MessageRow, type ActionRow,
} from '../repositories/aiConversationRepository';
import { validateCoachActions, type CoachAction } from '../lib/coachActions';
import type { Cursor, Page, RepoResult } from '../repositories/shared';

export { MAX_TITLE_LENGTH, MESSAGE_PAGE_SIZE };
export type { ConversationRow, MessageRow, ActionRow };

/** A model proposal that has been persisted and is awaiting the user's word. */
export type StagedAction = { row: ActionRow; action: CoachAction };

/** What the coach edge function answers with. Shape only — never trusted. */
export type CoachInvokeResult = {
  reply?: string;
  actions?: unknown;
  balance?: number;
  error?: string;
};

/**
 * A first message becomes the title, shortened at a word boundary.
 *
 * This is the derived value the caller must not supply: two screens naming
 * threads two different ways is how "Yeni Sohbet (3)" happens.
 */
export function titleFromMessage(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return 'Yeni Sohbet';
  if (flat.length <= 60) return flat.slice(0, MAX_TITLE_LENGTH);
  const cut = flat.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 24 ? cut.slice(0, lastSpace) : cut) + '…';
}

// ---------------------------------------------------------------------------
// Reading threads
// ---------------------------------------------------------------------------

export function listThreads(
  cursor?: Cursor | null,
  limit?: number,
): Promise<RepoResult<Page<ConversationRow>>> {
  return fetchConversationsPage(cursor, limit);
}

export function findThread(id: string): Promise<RepoResult<ConversationRow | null>> {
  return fetchConversation(id);
}

/**
 * Everything that belongs to one thread, read together.
 *
 * The staged proposal is REVALIDATED here rather than trusted because it came
 * out of the database: a row written by an older build, or by a model that has
 * since been given new tricks, is still untrusted input. A payload that no
 * longer validates is simply not offered — it must never become a card the
 * user can confirm.
 *
 * Messages come back oldest-first for display; the repository pages from the
 * newest end because that is the part of a two-year-old thread anyone reads.
 */
export async function openThread(
  conversationId: string,
): Promise<RepoResult<{ messages: MessageRow[]; hasMore: boolean; staged: StagedAction | null }>> {
  const page = await fetchMessagesPage(conversationId, null, MESSAGE_PAGE_SIZE);
  if (!page.ok) return page;

  const pending = await fetchPendingAction(conversationId);
  let staged: StagedAction | null = null;
  if (pending.ok && pending.data) {
    const v = validateCoachActions([pending.data.payload]);
    if (v.actions[0]) staged = { row: pending.data, action: v.actions[0] };
  }

  return {
    ok: true,
    data: { messages: page.data.rows.slice().reverse(), hasMore: page.data.hasMore, staged },
  };
}

/** The page before `before`, oldest-first, ready to prepend. */
export async function olderMessages(
  conversationId: string,
  before: string,
): Promise<RepoResult<{ messages: MessageRow[]; hasMore: boolean }>> {
  const page = await fetchMessagesPage(conversationId, before, MESSAGE_PAGE_SIZE);
  if (!page.ok) return page;
  return { ok: true, data: { messages: page.data.rows.slice().reverse(), hasMore: page.data.hasMore } };
}

// ---------------------------------------------------------------------------
// Managing threads
// ---------------------------------------------------------------------------

export function renameThread(id: string, title: string): Promise<RepoResult<ConversationRow>> {
  return renameConversation(id, title);
}

/**
 * File a thread under one of the user's EXISTING projects, or unfile it.
 *
 * There is no second project concept here. `projectId` is passed through
 * honestly and a foreign id is refused by the row-level policy — the layer a
 * client cannot skip — not by a check in the app that an attacker could.
 */
export function setThreadProject(id: string, projectId: string | null): Promise<RepoResult<ConversationRow>> {
  return setConversationProject(id, projectId);
}

export function deleteThread(id: string): Promise<RepoResult<true>> {
  return deleteConversation(id);
}

/**
 * Close a staged proposal.
 *
 * The repository scopes the update to `status = 'pending'`, which is the
 * idempotency boundary: a second tap, a re-render or a resumed app finds the
 * row already resolved and changes nothing.
 */
export function resolveStagedAction(
  id: string,
  status: 'confirmed' | 'cancelled',
): Promise<RepoResult<ActionRow | null>> {
  return resolveAction(id, status);
}

/**
 * Record an answer to a question the app asked about a staged proposal.
 *
 * "Hedef 20 dakika" is a decision the user made, and a decision that only
 * exists in component state is one they have to make again after navigating
 * away -- which is the same class of defect durable conversations exist to
 * fix. The payload is revalidated on the way back out, exactly as if the model
 * had produced it.
 */
export function updateStagedAction(id: string, payload: unknown): Promise<RepoResult<ActionRow | null>> {
  return updateActionPayload(id, payload);
}

// ---------------------------------------------------------------------------
// One coach turn
// ---------------------------------------------------------------------------

export type CoachTurnInput = {
  /** `null` starts a new thread; the first message names it. */
  conversationId: string | null;
  text: string;
  /** One key per attempt, so a retry replays the first charge. */
  requestId: string;
  invoke: (body: Record<string, unknown>) => Promise<CoachInvokeResult>;
  /** Progress hooks so the screen can render the turn as it happens. */
  onConversationCreated?: (row: ConversationRow) => void;
  onUserMessage?: (row: MessageRow) => void;
};

export type CoachTurn = {
  conversationId: string;
  assistant: MessageRow;
  staged: StagedAction | null;
};

/**
 * The ordering rule this service exists for.
 *
 *   1 ensure a thread exists   2 persist the user message
 *   3 call the provider        4 persist the answer
 *   5 stage any proposal       6 only now report success
 *
 * Step 4 before step 6 is the whole point. The case it is built for is not a
 * network error, it is the app being killed in the half second between the
 * provider answering and React rendering: that answer cost the user 5 FP, so
 * it has to exist in the database rather than only in a component that is
 * about to be torn down.
 *
 * On failure nothing is fabricated. The user message stays as sent and the
 * same `request_id` can be retried without paying twice.
 */
export async function runCoachTurn(input: CoachTurnInput): Promise<RepoResult<CoachTurn>> {
  const msg = input.text.trim();
  if (!msg) return { ok: false, error: 'Boş mesaj gönderilemez.' };

  let conversationId = input.conversationId;
  if (!conversationId) {
    const created = await createConversation({ title: titleFromMessage(msg) });
    if (!created.ok) return created;
    conversationId = created.data.id;
    input.onConversationCreated?.(created.data);
  }

  const userRow = await insertMessage({
    conversationId, role: 'user', content: msg, requestId: input.requestId,
  });
  if (!userRow.ok) return userRow;
  input.onUserMessage?.(userRow.data);

  // The provider is the one step that can THROW rather than return a result:
  // it is a network call behind a deadline. Turning that into the same
  // `{ ok: false }` every other step returns is what keeps the caller from
  // being left mid-turn with its "sending" flag stuck on.
  let data: CoachInvokeResult;
  try {
    data = await input.invoke({
      conversation_id: conversationId, message: msg, request_id: input.requestId,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Bir hata oluştu' };
  }
  if (data.error) return { ok: false, error: data.error };
  const reply = data.reply;
  if (!reply) return { ok: false, error: 'Yanıt alınamadı, tekrar deneyin.' };

  // Durable BEFORE the caller may call this a success. A replay of the same
  // request_id returns the stored row rather than inserting a second one.
  const assistantRow = await insertMessage({
    conversationId, role: 'assistant', content: reply, requestId: input.requestId,
  });
  if (!assistantRow.ok) return assistantRow;

  // Validated from scratch no matter what the server already did, and a
  // rejected suggestion is simply dropped: the answer above was paid for and
  // a bad proposal must not take it away.
  const parsed = validateCoachActions(data.actions).actions[0];
  let staged: StagedAction | null = null;
  if (parsed) {
    // A new proposal SUPERSEDES the old one. Without this, a proposal the user
    // scrolled past stays `pending` for ever and comes back as a live card the
    // next time the thread is opened -- because the newest row is by then
    // resolved, so the pending lookup finds the stale one underneath it.
    const previous = await fetchPendingAction(conversationId);
    if (previous.ok && previous.data) await resolveAction(previous.data.id, 'cancelled');

    const row = await insertAction({
      conversationId,
      assistantMessageId: assistantRow.data.id,
      actionType: parsed.type,
      payload: parsed,
    });
    // A proposal that fails to persist is not offered. It must never become a
    // confirmable card that cannot then be resolved.
    if (row.ok) staged = { row: row.data, action: parsed };
  }

  return { ok: true, data: { conversationId, assistant: assistantRow.data, staged } };
}
