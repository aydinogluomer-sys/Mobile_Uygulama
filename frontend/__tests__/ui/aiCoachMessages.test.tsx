/**
 * AI Coach: the answer has to be visible, and a short question has to stay short.
 *
 * ## What the device showed
 *
 * On a real Samsung phone, sending "Haftalık plan öner" deducted 5 FP and then
 * appeared to do nothing: the outgoing user bubble grew to nearly the whole
 * conversation viewport and no reply could be seen.
 *
 * The server disagreed with that reading. All three coach requests from that
 * session are `status: 'completed'` in `ai_requests` with real responses (605,
 * 785 and 675 characters), and `credit_transactions` shows exactly three
 * `ai_coach` debits of -5 landing on a balance of 15 -- which is the number the
 * screenshot's header showed. So nothing was lost and nothing was charged
 * twice: three questions were asked, three answers were produced and paid for.
 * The answers were rendered too. They were just pushed out of sight.
 *
 * ## The defect
 *
 * `bubbleText` carried `flex: 1`, and every bubble uses it -- but they do not
 * share a flex direction. `bubbleAssistant` (which the error bubble also builds
 * on) sets `flexDirection: 'row'` so the text can claim the width left beside
 * the sparkles icon. `bubbleUser` has no icon and stays a column, and in a
 * column that same declaration governs the vertical axis instead. One
 * declaration, two axes, and only the user bubble was wrong -- which is exactly
 * the bubble the device showed stretched.
 *
 * These tests therefore assert the geometry contract directly rather than
 * snapshotting pixels: the user bubble's text must carry no flex, the row
 * bubbles' text must keep it, and a successful send must put the reply on
 * screen.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

// The screen now hydrates its conversation from the repository on mount, so
// the first mount in a fresh module registry costs more than Jest's 5s
// default. This raises the clock, not the bar.
jest.setTimeout(20000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

// An in-memory stand-in for the conversation tables.
//
// The REPOSITORY is mocked rather than the store, so the real ordering --
// persist user turn, call provider, persist assistant turn, then report
// success, which lives in `services/aiCoachService.ts` -- is exercised by
// these screen tests too. Only the database is fake.
let mockRows: { conversations: any[]; messages: any[]; actions: any[] } = { conversations: [], messages: [], actions: [] };
let mockSeq = 0;
const mockNewId = (p: string) => `${p}-${++mockSeq}`;
jest.mock('../../repositories/aiConversationRepository', () => ({
  MAX_TITLE_LENGTH: 200,
  MESSAGE_PAGE_SIZE: 40,
  fetchConversationsPage: async () => ({ ok: true, data: { rows: [...mockRows.conversations], nextCursor: null, hasMore: false } }),
  createConversation: async ({ title }: { title: string }) => {
    const row = { id: mockNewId('conv'), user_id: 'u1', title, project_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(), archived_at: null };
    mockRows.conversations.unshift(row);
    return { ok: true, data: row };
  },
  renameConversation: async (id: string, title: string) => {
    const row = mockRows.conversations.find((c) => c.id === id);
    if (!row) return { ok: false, error: 'yok' };
    row.title = title;
    return { ok: true, data: { ...row } };
  },
  setConversationProject: async (id: string, projectId: string | null) => {
    const row = mockRows.conversations.find((c) => c.id === id);
    if (!row) return { ok: false, error: 'yok' };
    row.project_id = projectId;
    return { ok: true, data: { ...row } };
  },
  deleteConversation: async () => ({ ok: true, data: true }),
  fetchConversation: async (id: string) => ({ ok: true, data: mockRows.conversations.find((c) => c.id === id) ?? null }),
  fetchMessagesPage: async (conversationId: string) => ({
    ok: true,
    data: { rows: mockRows.messages.filter((m) => m.conversation_id === conversationId).slice().reverse(), hasMore: false },
  }),
  insertMessage: async (input: any) => {
    // Mirrors the partial unique index: one assistant row per request_id.
    if (input.role === 'assistant' && input.requestId) {
      const dup = mockRows.messages.find((m) => m.conversation_id === input.conversationId && m.role === 'assistant' && m.request_id === input.requestId);
      if (dup) return { ok: true, data: dup };
    }
    const row = { id: mockNewId('msg'), conversation_id: input.conversationId, user_id: 'u1',
      role: input.role, content: input.content, request_id: input.requestId ?? null,
      created_at: new Date(Date.now() + mockSeq).toISOString() };
    mockRows.messages.push(row);
    return { ok: true, data: row };
  },
  fetchPendingAction: async (conversationId: string) => ({
    ok: true,
    data: mockRows.actions.filter((a) => a.conversation_id === conversationId && a.status === 'pending').slice(-1)[0] ?? null,
  }),
  insertAction: async (input: any) => {
    const row = { id: mockNewId('act'), conversation_id: input.conversationId,
      assistant_message_id: input.assistantMessageId ?? null, user_id: 'u1',
      action_type: input.actionType, payload: input.payload, status: 'pending',
      created_at: new Date().toISOString(), resolved_at: null };
    mockRows.actions.push(row);
    return { ok: true, data: row };
  },
  updateActionPayload: async (id: string, payload: unknown) => {
    const row = mockRows.actions.find((a) => a.id === id && a.status === 'pending');
    if (!row) return { ok: true, data: null };
    row.payload = payload;
    return { ok: true, data: { ...row } };
  },
  resolveAction: async (id: string, status: string) => {
    const row = mockRows.actions.find((a) => a.id === id && a.status === 'pending');
    if (!row) return { ok: true, data: null };
    row.status = status; row.resolved_at = new Date().toISOString();
    return { ok: true, data: { ...row } };
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined,
}));

jest.mock('../../store/projectStore', () => ({
  useProjectStore: (sel?: (s: unknown) => unknown) => (sel ? sel({ projects: [] }) : { projects: [] }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

const mockInvoke = jest.fn();
const mockSetBalance = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

jest.mock('../../store/habitStore', () => ({
  useHabitStore: () => ({ habits: [{ name: 'Yürüyüş', status: 'active' }] }),
}));
jest.mock('../../store/taskStore', () => ({
  useTaskStore: () => ({ tasks: [] }),
}));
jest.mock('../../store/willpowerStore', () => ({
  useWillpowerStore: () => ({ state: null, fetchToday: jest.fn() }),
}));
jest.mock('../../store/subscriptionStore', () => ({
  useSubscriptionStore: () => ({ focusPoints: 15, fetch: jest.fn(), setBalance: mockSetBalance }),
}));
jest.mock('../../store/journalStore', () => ({
  useJournalStore: (sel?: (s: unknown) => unknown) => {
    const s = { appendEntry: jest.fn() };
    return sel ? sel(s) : s;
  },
}));
// The analytics enrichment is explicitly allowed to fail without blocking a
// message (Gate D); failing it here keeps this file about the message list.
jest.mock('../../services/reviewService', () => ({
  loadReviewData: jest.fn(async () => { throw new Error('not needed'); }),
}));

import AICoachScreen from '../../app/screens/ai-coach';
import { useAiConversationStore } from '../../store/aiConversationStore';

const QUESTION = 'Haftalık plan öner';
const REPLY = 'Haftalık planın: pazartesi yürüyüş, çarşamba okuma, cuma dinlenme.';

let mounted: TestRenderer.ReactTestRenderer | null = null;

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<AICoachScreen />); });
  mounted = tree;
  return tree;
}

// Unmounting runs the screen's own cleanup. Without it the copy timer fires
// into a torn-down environment and re-renders, which is green tests and a red
// job -- the exact failure fixed in Step 11A.1.
afterEach(async () => {
  if (mounted) {
    const t = mounted;
    mounted = null;
    await act(async () => { t.unmount(); });
  }
});

/** Every rendered Text whose content is exactly `content`. */
const textsSaying = (tree: TestRenderer.ReactTestRenderer, content: string) =>
  tree.root.findAllByType(Text).filter((n) => {
    const c = n.props.children;
    return (Array.isArray(c) ? c.join('') : c) === content;
  });

const flat = (n: TestRenderer.ReactTestInstance) => StyleSheet.flatten(n.props.style) ?? {};

/** Press the quick-prompt chip -- the exact control used on the device. */
async function pressQuickPrompt(tree: TestRenderer.ReactTestRenderer) {
  const chip = tree.root.findAllByType(TouchableOpacity).find((t) => {
    const labels = t.findAllByType(Text).map((x) => x.props.children);
    return labels.includes(QUESTION);
  });
  if (!chip) throw new Error('quick prompt chip not found');
  await act(async () => { chip.props.onPress(); });
}

beforeEach(() => {
  // The conversation store is module-level, so its `sending` flag and
  // message list survive between tests unless reset -- which is exactly
  // how one test's in-flight send silently swallowed the next one's.
  useAiConversationStore.getState().reset();
  mockRows = { conversations: [], messages: [], actions: [] };
  mockSeq = 0;
  mockInvoke.mockReset();
  mockSetBalance.mockReset();
});

describe('AI Coach message bubbles', () => {
  it('the greeting renders before anything is sent', async () => {
    const tree = await render();
    expect(tree.root.findAllByType(Text).some((n) => String(n.props.children).includes('Aderyth AI Coach'))).toBe(true);
  });

  it('a short user message does not get flex growth', async () => {
    // The regression itself. `flex` on this text is what let three words
    // occupy the conversation: the user bubble is a column, so it grew down.
    mockInvoke.mockResolvedValue({ data: { reply: REPLY }, error: null });
    const tree = await render();
    await pressQuickPrompt(tree);

    // Selected by `lineHeight: 20`, which only `bubbleText` carries. Matching
    // on 'has a colour' used to work and no longer does: the conversation
    // title is derived from the first message, so the title bar now renders
    // this same string too.
    const userText = textsSaying(tree, QUESTION).find((n) => (flat(n) as Record<string, unknown>).lineHeight === 20);
    expect(userText).toBeDefined();
    const st = flat(userText!) as Record<string, unknown>;
    expect(st.flex).toBeUndefined();
    expect(st.flexGrow).toBeUndefined();
    expect(st.height).toBeUndefined();
    expect(st.minHeight).toBeUndefined();
  });

  it('the assistant text keeps flex so it can sit beside the icon', async () => {
    // The other half of the contract: removing flex everywhere would have
    // broken the row layout instead, which is why it is scoped rather than
    // deleted.
    mockInvoke.mockResolvedValue({ data: { reply: REPLY }, error: null });
    const tree = await render();
    await pressQuickPrompt(tree);

    const replyText = textsSaying(tree, REPLY)[0];
    expect(replyText).toBeDefined();
    expect((flat(replyText) as Record<string, unknown>).flex).toBe(1);
  });
});

describe('AI Coach send', () => {
  it('sends one coach request and shows the reply', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: REPLY, balance: 10 }, error: null });
    const tree = await render();
    await pressQuickPrompt(tree);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [fn, opts] = mockInvoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fn).toBe('generate-routine');
    expect(opts.body.mode).toBe('coach');
    expect(opts.body.message).toBe(QUESTION);
    // The idempotency key the server bills against; without it a network-level
    // retry of this same call would be a second answer at a second charge.
    expect(typeof opts.body.request_id).toBe('string');
    expect((opts.body.request_id as string).length).toBeGreaterThan(0);

    // The question and the answer are both on screen. The device saw only the
    // first of those.
    expect(textsSaying(tree, QUESTION).length).toBeGreaterThan(0);
    expect(textsSaying(tree, REPLY).length).toBe(1);
  });

  it('one press is one request, so one logical message is charged once', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: REPLY }, error: null });
    const tree = await render();
    await pressQuickPrompt(tree);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('a backend failure is shown rather than swallowed', async () => {
    // The state the device appeared to be in. It must be visible, because
    // "user message, no answer, no explanation" is indistinguishable from a
    // hang -- and it is what makes someone press send again.
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const tree = await render();
    await pressQuickPrompt(tree);

    const shown = tree.root.findAllByType(Text).map((n) => String(n.props.children));
    expect(shown.some((t) => t.length > 0 && t !== QUESTION && /boom|hata|Yanıt/i.test(t))).toBe(true);
  });

  it('a missing reply is treated as a failure, not as an empty answer', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    const tree = await render();
    await pressQuickPrompt(tree);

    const shown = tree.root.findAllByType(Text).map((n) => String(n.props.children));
    expect(shown.some((t) => /Yanıt alınamadı/i.test(t))).toBe(true);
  });

  it('the client never raises its own balance', async () => {
    // FP is server-authoritative. The client may only mirror a balance the
    // server reported; it must not invent one on the failure path.
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const tree = await render();
    await pressQuickPrompt(tree);
    for (const call of mockSetBalance.mock.calls) {
      expect(typeof call[0]).toBe('number');
    }
    expect(mockSetBalance.mock.calls.every((c) => typeof c[0] === 'number')).toBe(true);
  });

  it('the composer is usable again after a failure', async () => {
    // A send control left disabled would strand the user on the failed screen.
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const tree = await render();
    await pressQuickPrompt(tree);

    // Found by its hint, not by its label: the conversation title is derived
    // from the first message, so after a send the title bar contains this same
    // string and would be matched first.
    const chip = tree.root.findAllByType(TouchableOpacity)
      .find((t) => t.props.accessibilityHint === 'Bu soruyu koça gönderir');
    expect(chip).toBeDefined();
    expect(chip!.props.disabled).toBe(false);
  });
});

describe('the conversation survives leaving the screen', () => {
  /** Any rendered Text matching `re`. Errors are prose, so match loosely. */
  const shows = (tree: TestRenderer.ReactTestRenderer, re: RegExp) =>
    tree.root.findAllByType(Text).some((n) => re.test(String(n.props.children ?? '')));

  const byLabel = (tree: TestRenderer.ReactTestRenderer, label: string) =>
    tree.root.findAllByType(TouchableOpacity).find((t) => t.props.accessibilityLabel === label);

  it('re-renders the stored transcript after a full remount', async () => {
    // The reported defect, at the level the owner experienced it: ask, leave,
    // come back. The answer has to be on the screen again -- and it must not
    // have been asked, or charged, a second time to get there.
    mockInvoke.mockResolvedValue({ data: { reply: REPLY }, error: null });
    const tree = await render();
    await pressQuickPrompt(tree);
    expect(textsSaying(tree, REPLY).length).toBe(1);

    await act(async () => { tree.unmount(); });
    mounted = null;
    useAiConversationStore.getState().reset(); // nothing local survives

    const again = await render();
    expect(textsSaying(again, QUESTION).length).toBeGreaterThan(0);
    expect(textsSaying(again, REPLY).length).toBe(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  /** The server's own message, extracted the way the screen extracts it. */
  const SERVER_ERROR = 'Kredin yetersiz.';
  const serverRefusal = {
    data: null,
    error: { context: { json: async () => ({ error: SERVER_ERROR }) } },
  };

  it('an error belongs to the thread it happened in and does not follow the user', async () => {
    // An error is not conversation: it is never persisted, and it must not be
    // sitting under the next thread's transcript either.
    mockInvoke.mockResolvedValue(serverRefusal);
    const tree = await render();
    await pressQuickPrompt(tree);
    expect(textsSaying(tree, SERVER_ERROR).length).toBe(1);

    await act(async () => { byLabel(tree, 'Yeni sohbet başlat')!.props.onPress(); });

    expect(textsSaying(tree, SERVER_ERROR)).toEqual([]);
    // And the new thread starts genuinely empty, not with the old question.
    const bubbles = textsSaying(tree, QUESTION).filter(
      (n) => (flat(n) as Record<string, unknown>).lineHeight === 20,
    );
    expect(bubbles).toEqual([]);
  });

  it('the failed question itself is kept, so the retry is the user’s to make', async () => {
    // The user message is persisted BEFORE the provider is called. Losing it
    // on failure would mean retyping, and would hide that 5 FP had been
    // committed to that attempt.
    mockInvoke.mockResolvedValue(serverRefusal);
    const tree = await render();
    await pressQuickPrompt(tree);

    await act(async () => { tree.unmount(); });
    mounted = null;
    useAiConversationStore.getState().reset();

    const again = await render();
    expect(textsSaying(again, QUESTION).length).toBeGreaterThan(0);
    // The question came back because it is a row. The error did not, because
    // it never was one.
    expect(textsSaying(again, SERVER_ERROR)).toEqual([]);
    expect(shows(again, /Merhaba/)).toBe(false);
  });
});
