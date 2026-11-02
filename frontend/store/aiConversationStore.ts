/**
 * AI Coach conversation threads — the screen's view of them.
 *
 * ## What this exists to fix
 *
 * The screen kept its messages in React state, so leaving AI Coach destroyed
 * the conversation. Supabase is now the source of truth. The ONLY thing kept
 * locally is which thread was last open — a navigation preference, not data.
 *
 * ## Where the rules are
 *
 * Not here. The ordering of a coach turn, the derived title and the
 * revalidation of a staged proposal all live in `services/aiCoachService.ts`,
 * because they are decisions rather than state. This store holds what the
 * screen renders and nothing else, which is why it imports a service and never
 * a repository (see `__tests__/repo/layerBoundary.test.ts`).
 *
 * ## Threads do not leak
 *
 * `messages` and `pendingAction` always belong to `activeId`. Switching
 * conversations replaces both in one `set`, so conversation A's staged habit
 * proposal can never be confirmed while looking at B.
 */
import { create } from 'zustand';
import { accountEpoch, registerAccountScoped, registerAccountStorage } from '../lib/accountScope';
import { currentUser } from '../lib/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  listThreads, findThread, openThread, olderMessages, renameThread,
  setThreadProject, resolveStagedAction, updateStagedAction, runCoachTurn,
  type ConversationRow, type MessageRow, type StagedAction, type CoachInvokeResult,
} from '../services/aiCoachService';
import type { CoachAction } from '../lib/coachActions';

/** Where the last-open thread id is remembered. Preference, never data. */
/**
 * F04 (STO-22): the last-open thread is remembered per user. The old, unscoped key
 * (the bare prefix) is never read: whose thread it named is unknown.
 */
const LAST_ACTIVE_KEY_PREFIX = 'aderyth.coach.lastConversationId';
export const lastActiveKey = (uid: string): string => `${LAST_ACTIVE_KEY_PREFIX}:${uid}`;

async function readLastActive(): Promise<string | null> {
  const uid = (await currentUser())?.id;
  if (!uid) return null;
  return AsyncStorage.getItem(lastActiveKey(uid));
}

function writeLastActive(id: string): void {
  void (async () => {
    const uid = (await currentUser())?.id;
    if (!uid) return;
    await AsyncStorage.setItem(lastActiveKey(uid), id);
  })().catch(() => {});
}

function forgetLastActive(): void {
  void (async () => {
    const uid = (await currentUser())?.id;
    if (!uid) return;
    await AsyncStorage.removeItem(lastActiveKey(uid));
  })().catch(() => {});
}

/**
 * F04 (STO-V02): every conversation-list request takes a number; only the newest one may write
 * the list. A reset (an account boundary, a new hydrate) bumps it, so the answer to a request the
 * previous account started is dropped instead of becoming the new account's list.
 */
let listSeq = 0;

export type CoachStoreMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

const toStoreMessage = (r: MessageRow): CoachStoreMessage => ({
  id: r.id, role: r.role, content: r.content, created_at: r.created_at,
});

type SendDeps = {
  /** Calls the coach edge function. Injected so tests never hit the network. */
  invoke: (body: Record<string, unknown>) => Promise<CoachInvokeResult>;
  requestId: string;
  onConversationCreated?: (row: ConversationRow) => void;
};

type AiConversationStore = {
  conversations: ConversationRow[];
  conversationsCursor: { key: string; id: string } | null;
  conversationsHasMore: boolean;
  loadingConversations: boolean;

  activeId: string | null;
  messages: CoachStoreMessage[];
  messagesHasMore: boolean;
  loadingMessages: boolean;

  pendingAction: StagedAction | null;

  sending: boolean;
  error: string | null;

  hydrate: () => Promise<void>;
  loadConversations: (opts?: { reset?: boolean }) => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  newChat: () => void;
  rename: (id: string, title: string) => Promise<boolean>;
  assignProject: (id: string, projectId: string | null) => Promise<boolean>;
  /**
   * `stale` means the turn finished after the user opened another thread. The
   * rows are written either way; it tells the caller not to DRAW anything --
   * including the failure, which belongs to the thread it happened in.
   */
  send: (text: string, deps: SendDeps) => Promise<{ ok: boolean; error?: string; stale?: boolean }>;
  resolvePending: (status: 'confirmed' | 'cancelled') => Promise<void>;
  /**
   * Persist an answer the user gave about the OPEN proposal.
   *
   * Deliberately does not touch `pendingAction`: the screen already shows the
   * answered proposal, and replacing the object here would re-run the effect
   * that stages it and preview the same thing twice. What this buys is the next
   * OPEN of the conversation, which reads the row fresh.
   */
  updatePendingPayload: (action: CoachAction) => Promise<void>;
  reset: () => void;
};

export const useAiConversationStore = create<AiConversationStore>((set, get) => ({
  conversations: [],
  conversationsCursor: null,
  conversationsHasMore: false,
  loadingConversations: false,

  activeId: null,
  messages: [],
  messagesHasMore: false,
  loadingMessages: false,

  pendingAction: null,
  sending: false,
  error: null,

  /**
   * Restore the thread the user was last in.
   *
   * This is the exact failure the owner hit: leaving AI Coach and coming back
   * must reopen the SAME conversation, not silently start a fresh one. If that
   * thread is gone (deleted elsewhere), fall back to the most recent one
   * rather than showing an error about something the user never did.
   */
  hydrate: async () => {
    const epoch = accountEpoch();
    await get().loadConversations({ reset: true });
    if (epoch !== accountEpoch()) return;
    let last: string | null = null;
    try { last = await readLastActive(); } catch { last = null; }
    if (epoch !== accountEpoch()) return;

    if (last) {
      const res = await findThread(last);
      if (epoch !== accountEpoch()) return;
      if (res.ok && res.data) { await get().openConversation(last); return; }
    }
    const first = get().conversations[0];
    if (first) await get().openConversation(first.id);
  },

  loadConversations: async (opts) => {
    const reset = opts?.reset ?? false;
    // STO-V02: a reset is never swallowed by a load already in flight (that one may belong to the
    // previous account); a plain "load more" still waits its turn.
    if (get().loadingConversations && !reset) return;
    const seq = ++listSeq;
    const epoch = accountEpoch();
    set({ loadingConversations: true });
    const res = await listThreads(reset ? null : get().conversationsCursor, 30);
    if (seq !== listSeq || epoch !== accountEpoch()) return; // a newer request owns the list now
    if (!res.ok) { set({ loadingConversations: false, error: res.error }); return; }
    set((s) => ({
      conversations: reset ? res.data.rows : [...s.conversations, ...res.data.rows],
      conversationsCursor: res.data.nextCursor ?? null,
      conversationsHasMore: res.data.hasMore,
      loadingConversations: false,
      error: null,
    }));
  },

  openConversation: async (id) => {
    // Swap EVERYTHING that belongs to a thread at once. A staged proposal from
    // the previous conversation must not survive this call.
    set({ activeId: id, messages: [], pendingAction: null, loadingMessages: true, messagesHasMore: false });
    writeLastActive(id);
    const epoch = accountEpoch();

    const res = await openThread(id);
    // another thread was opened meanwhile, or the account changed: this answer is not for the screen
    if (get().activeId !== id || epoch !== accountEpoch()) return;
    if (!res.ok) { set({ loadingMessages: false, error: res.error }); return; }

    set({
      messages: res.data.messages.map(toStoreMessage),
      messagesHasMore: res.data.hasMore,
      loadingMessages: false,
      pendingAction: res.data.staged,
      error: null,
    });
  },

  loadOlderMessages: async () => {
    const { activeId, messages, messagesHasMore, loadingMessages } = get();
    if (!activeId || !messagesHasMore || loadingMessages) return;
    const oldest = messages[0];
    if (!oldest) return;
    set({ loadingMessages: true });
    const res = await olderMessages(activeId, oldest.created_at);
    if (!res.ok) { set({ loadingMessages: false, error: res.error }); return; }
    set((s) => ({
      messages: [...res.data.messages.map(toStoreMessage), ...s.messages],
      messagesHasMore: res.data.hasMore,
      loadingMessages: false,
    }));
  },

  /** A blank slate. The row is created by the first message, not by this. */
  newChat: () => {
    set({ activeId: null, messages: [], pendingAction: null, messagesHasMore: false, error: null });
    forgetLastActive();
  },

  rename: async (id, title) => {
    const res = await renameThread(id, title);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? res.data : c)),
      error: null,
    }));
    return true;
  },

  assignProject: async (id, projectId) => {
    const res = await setThreadProject(id, projectId);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? res.data : c)),
      error: null,
    }));
    return true;
  },

  /**
   * Hand one turn to the service and render it as it lands.
   *
   * The progress hooks are why the user's own message appears immediately
   * instead of after the model answers: the service still decides the order in
   * which rows become durable, this store just draws each one the moment it
   * is.
   *
   * ## Nothing lands in the wrong thread
   *
   * A coach answer can take seconds, and the user is free to open another
   * conversation while it is in flight. Every screen update below is therefore
   * gated on the thread the turn STARTED in still being the open one. The row
   * is written to its own conversation either way -- it is durable, and it is
   * there when that thread is reopened -- but it must never be drawn into the
   * transcript of a different one.
   */
  send: async (text, deps) => {
    if (!text.trim() || get().sending) return { ok: false };
    set({ sending: true, error: null });

    const startedIn = get().activeId;
    let turnId = startedIn;
    const stillOpen = () => get().activeId === turnId;

    const res = await runCoachTurn({
      conversationId: startedIn,
      text,
      requestId: deps.requestId,
      invoke: deps.invoke,
      onConversationCreated: (row) => {
        // The thread is the user's either way, so it belongs in the list. It
        // only becomes the OPEN one if they have not moved somewhere else.
        const adopt = get().activeId === startedIn;
        if (adopt) turnId = row.id;
        set((s) => ({
          conversations: [row, ...s.conversations],
          activeId: adopt ? row.id : s.activeId,
        }));
        if (adopt) writeLastActive(row.id);
        deps.onConversationCreated?.(row);
      },
      onUserMessage: (row) => {
        if (!stillOpen()) return;
        set((s) => ({
          messages: s.messages.some((m) => m.id === row.id) ? s.messages : [...s.messages, toStoreMessage(row)],
        }));
      },
    });

    if (!res.ok) {
      set({ sending: false, error: res.error });
      return { ok: false, error: res.error, stale: !stillOpen() };
    }

    if (!stillOpen()) { set({ sending: false, error: null }); return { ok: true, stale: true }; }

    set((s) => ({
      // Only append if this answer is not already on screen (replay case).
      messages: s.messages.some((m) => m.id === res.data.assistant.id)
        ? s.messages
        : [...s.messages, toStoreMessage(res.data.assistant)],
      pendingAction: res.data.staged ?? s.pendingAction,
      sending: false,
      error: null,
    }));
    return { ok: true };
  },

  /**
   * Close a staged proposal.
   *
   * Cleared locally first so a second tap has nothing to act on, then resolved
   * in the database, where `status = 'pending'` is the real boundary.
   */
  updatePendingPayload: async (action) => {
    const current = get().pendingAction;
    if (!current) return;
    await updateStagedAction(current.row.id, action);
  },

  resolvePending: async (status) => {
    const current = get().pendingAction;
    if (!current) return;
    set({ pendingAction: null });
    await resolveStagedAction(current.row.id, status);
  },

  reset: () => {
    listSeq += 1;
    set({
      conversations: [], conversationsCursor: null, conversationsHasMore: false, loadingConversations: false,
      activeId: null, messages: [], messagesHasMore: false,
      pendingAction: null, sending: false, error: null,
    });
    // The last-open thread is NOT forgotten here: leaving the screen and coming back must reopen it.
    // It leaves with the account (the registry's transient key below) or with `newChat`.
  },
}));

// F04 (STO-22, STO-V02): the transcript belongs to the signed-in account; a list request in flight
// across the boundary is dropped, and the last-open thread of the account leaves with it.
registerAccountScoped({ name: 'aiConversation', store: useAiConversationStore, onReset: () => { listSeq += 1; } });
registerAccountStorage({ name: 'coach.lastConversation', transient: true, keysFor: (uid) => [lastActiveKey(uid)] });
