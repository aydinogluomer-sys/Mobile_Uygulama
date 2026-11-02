/**
 * AI Coach threads: durable, separate, and nobody else's.
 *
 * ## The defect these exist for
 *
 * On a real device the owner opened AI Coach, had a conversation, navigated to
 * another tab and came back — to an empty screen. The transcript had only ever
 * been React state, so leaving the screen destroyed it. Nothing had failed and
 * nothing was logged; the data had simply never existed anywhere.
 *
 * So the assertions below are not about rendering. They are about what is
 * still true after the component that drew it is gone:
 *
 *   §70 durability   a turn survives a full teardown of the store, and the
 *                    thread the user was last in is the one that reopens;
 *   §71 management   threads are created, named, renamed and filed under an
 *                    EXISTING project — never a second project concept;
 *   §72 isolation    thread A's messages and thread A's staged proposal are
 *                    unreachable from thread B, and another user's threads are
 *                    unreachable from either.
 *
 * ## What is faked and what is not
 *
 * Only the database. `mockDb` below is an in-memory stand-in for
 * `ai_conversations` / `ai_messages` / `ai_conversation_actions` that enforces
 * the two things the real tables enforce and that these tests are about: rows
 * are scoped to `mockDb.user`, and one assistant row exists per
 * `(conversation_id, request_id)`. Everything above it — the repository's
 * callers, `services/aiCoachService.ts`, and the store — is the real code.
 *
 * Cross-user isolation is ALSO proven live against Postgres RLS; this file
 * proves the app layer never even asks for the wrong rows, which is a
 * different claim and worth making separately.
 */
import { useAiConversationStore, lastActiveKey } from '../../store/aiConversationStore';
import { endAccountScope, resetAccountMemory } from '../../lib/accountScope';

// ---------------------------------------------------------------------------
// The fake database
// ---------------------------------------------------------------------------

type Conv = {
  id: string; user_id: string; title: string; project_id: string | null;
  created_at: string; updated_at: string; last_message_at: string; archived_at: string | null;
};
type Msg = {
  id: string; conversation_id: string; user_id: string; role: 'user' | 'assistant';
  content: string; request_id: string | null; created_at: string;
};
type Act = {
  id: string; conversation_id: string; assistant_message_id: string | null; user_id: string;
  action_type: string; payload: unknown; status: 'pending' | 'confirmed' | 'cancelled';
  created_at: string; resolved_at: string | null;
};

const mockDb: { user: string; conversations: Conv[]; messages: Msg[]; actions: Act[]; seq: number } = {
  user: 'user-A', conversations: [], messages: [], actions: [], seq: 0,
};
const mockId = (p: string) => `${p}-${++mockDb.seq}`;
/** F04: how often a thread was looked up, and a gate that can hold the list request at the "network". */
const mockRepoCalls = { findThread: 0 };
const mockGate = { listThreads: null as Promise<void> | null };
/** Monotonic, so ordering by `created_at` is deterministic under a fast clock. */
const mockNow = () => new Date(Date.UTC(2026, 0, 1) + mockDb.seq * 1000).toISOString();
/** The user's own projects. A project id outside this set is another user's. */
const mockOwnProjects = new Set(['proj-A1', 'proj-A2']);

jest.mock('../../repositories/aiConversationRepository', () => ({
  MAX_TITLE_LENGTH: 200,
  MESSAGE_PAGE_SIZE: 40,

  fetchConversationsPage: async (cursor: unknown, limit?: number) => {
    // the rows of the caller at the time of the request, even if the answer is held back
    const rows = mockDb.conversations
      .filter((c) => c.user_id === mockDb.user)
      .slice()
      .sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
    if (mockGate.listThreads) await mockGate.listThreads;
    const capped = limit ?? 30;
    return { ok: true, data: { rows: rows.slice(0, capped), nextCursor: null, hasMore: rows.length > capped } };
  },

  createConversation: async ({ title, projectId }: { title: string; projectId?: string | null }) => {
    const t = title.trim();
    if (!t) return { ok: false, error: 'Sohbet başlığı boş olamaz.' };
    mockDb.seq++;
    const row: Conv = {
      id: mockId('conv'), user_id: mockDb.user, title: t, project_id: projectId ?? null,
      created_at: mockNow(), updated_at: mockNow(), last_message_at: mockNow(), archived_at: null,
    };
    mockDb.conversations.push(row);
    return { ok: true, data: { ...row } };
  },

  renameConversation: async (id: string, title: string) => {
    const t = title.trim();
    if (!t) return { ok: false, error: 'Sohbet başlığı boş olamaz.' };
    const row = mockDb.conversations.find((c) => c.id === id && c.user_id === mockDb.user);
    // No row matched the owner filter -- the same nothing RLS returns.
    if (!row) return { ok: false, error: 'Kayıt bulunamadı veya erişim yok.' };
    row.title = t.slice(0, 200);
    row.updated_at = mockNow();
    return { ok: true, data: { ...row } };
  },

  setConversationProject: async (id: string, projectId: string | null) => {
    const row = mockDb.conversations.find((c) => c.id === id && c.user_id === mockDb.user);
    if (!row) return { ok: false, error: 'Kayıt bulunamadı veya erişim yok.' };
    // The real refusal is the RLS WITH CHECK clause, which requires the
    // project to be one of the caller's. A foreign uuid is rejected there, not
    // by a check the client could be patched to skip.
    if (projectId !== null && !mockOwnProjects.has(projectId)) {
      return { ok: false, error: 'new row violates row-level security policy' };
    }
    row.project_id = projectId;
    row.updated_at = mockNow();
    return { ok: true, data: { ...row } };
  },

  deleteConversation: async (id: string) => {
    const before = mockDb.conversations.length;
    mockDb.conversations = mockDb.conversations.filter((c) => !(c.id === id && c.user_id === mockDb.user));
    return before === mockDb.conversations.length
      ? { ok: false, error: 'Kayıt bulunamadı veya erişim yok.' }
      : { ok: true, data: true };
  },

  fetchConversation: async (id: string) => ({
    ok: ++mockRepoCalls.findThread > 0,
    data: mockDb.conversations.find((c) => c.id === id && c.user_id === mockDb.user) ?? null,
  }),

  fetchMessagesPage: async (conversationId: string, before: string | null, limit: number) => {
    const rows = mockDb.messages
      .filter((m) => m.conversation_id === conversationId && m.user_id === mockDb.user)
      .filter((m) => (before ? m.created_at < before : true))
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const hasMore = rows.length > limit;
    return { ok: true, data: { rows: hasMore ? rows.slice(0, limit) : rows, hasMore } };
  },

  insertMessage: async (input: { conversationId: string; role: 'user' | 'assistant'; content: string; requestId?: string | null }) => {
    const content = input.content.trim();
    if (!content) return { ok: false, error: 'Boş mesaj kaydedilemez.' };
    if (input.role === 'assistant' && input.requestId) {
      // The partial unique index on (conversation_id, request_id).
      const dup = mockDb.messages.find(
        (m) => m.conversation_id === input.conversationId && m.role === 'assistant' && m.request_id === input.requestId,
      );
      if (dup) return { ok: true, data: { ...dup } };
    }
    mockDb.seq++;
    const row: Msg = {
      id: mockId('msg'), conversation_id: input.conversationId, user_id: mockDb.user,
      role: input.role, content, request_id: input.requestId ?? null, created_at: mockNow(),
    };
    mockDb.messages.push(row);
    const conv = mockDb.conversations.find((c) => c.id === input.conversationId);
    if (conv) conv.last_message_at = row.created_at; // the ai_touch_conversation trigger
    return { ok: true, data: { ...row } };
  },

  fetchPendingAction: async (conversationId: string) => ({
    ok: true,
    data: mockDb.actions
      .filter((a) => a.conversation_id === conversationId && a.user_id === mockDb.user && a.status === 'pending')
      .slice(-1)[0] ?? null,
  }),

  insertAction: async (input: { conversationId: string; assistantMessageId?: string | null; actionType: string; payload: unknown }) => {
    mockDb.seq++;
    const row: Act = {
      id: mockId('act'), conversation_id: input.conversationId,
      assistant_message_id: input.assistantMessageId ?? null, user_id: mockDb.user,
      action_type: input.actionType, payload: input.payload, status: 'pending',
      created_at: mockNow(), resolved_at: null,
    };
    mockDb.actions.push(row);
    return { ok: true, data: { ...row } };
  },

  updateActionPayload: async (id: string, payload: unknown) => {
    const row = mockDb.actions.find((a) => a.id === id && a.user_id === mockDb.user && a.status === 'pending');
    if (!row) return { ok: true, data: null };
    row.payload = payload;
    return { ok: true, data: { ...row } };
  },

  resolveAction: async (id: string, status: 'confirmed' | 'cancelled') => {
    const row = mockDb.actions.find((a) => a.id === id && a.user_id === mockDb.user && a.status === 'pending');
    if (!row) return { ok: true, data: null };
    row.status = status;
    row.resolved_at = mockNow();
    return { ok: true, data: { ...row } };
  },
}));

/** Local storage, by key. The last-open thread id is the only local state there is (F04: per user). */
const mockKv = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => mockKv.get(k) ?? null,
  setItem: async (k: string, v: string) => { mockKv.set(k, v); },
  removeItem: async (k: string) => { mockKv.delete(k); },
  multiRemove: async (keys: string[]) => { keys.forEach((k) => mockKv.delete(k)); },
}));
// F04: the signed-in user is whoever the fake database says is calling.
jest.mock('../../lib/session', () => ({ currentUser: async () => ({ id: mockDb.user, email: null }) }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const store = () => useAiConversationStore.getState();

/** A provider that answers with whatever it is told to, and records the call. */
function replyWith(reply: string, actions?: unknown) {
  const calls: Record<string, unknown>[] = [];
  const invoke = async (body: Record<string, unknown>) => {
    calls.push(body);
    return { reply, actions };
  };
  return { invoke, calls };
}

let requestSeq = 0;
const nextRequestId = () => `req-${++requestSeq}-aaaaaaaa`;

async function send(text: string, reply: string, actions?: unknown) {
  const { invoke, calls } = replyWith(reply, actions);
  const res = await store().send(text, { invoke, requestId: nextRequestId() });
  return { res, calls };
}

/** Everything the store holds is dropped — the same as leaving the screen. */
async function remount() {
  store().reset();
  await store().hydrate();
}

const contents = () => store().messages.map((m) => m.content);

beforeEach(() => {
  mockDb.user = 'user-A';
  mockDb.conversations = [];
  mockDb.messages = [];
  mockDb.actions = [];
  mockDb.seq = 0;
  mockKv.clear();
  mockGate.listThreads = null;
  requestSeq = 0;
  store().reset();
});

// ---------------------------------------------------------------------------
// §70 Durability
// ---------------------------------------------------------------------------

describe('a conversation survives leaving the screen', () => {
  it('the transcript is still there after the store is torn down and rebuilt', async () => {
    await send('Sabah rutini öner', 'İşte üç adım.');
    expect(contents()).toEqual(['Sabah rutini öner', 'İşte üç adım.']);

    await remount();

    // This is the reported defect, inverted into an assertion.
    expect(contents()).toEqual(['Sabah rutini öner', 'İşte üç adım.']);
  });

  it('reopens the thread the user was last in, not the newest one', async () => {
    await send('A konusu', 'A yanıtı');
    const a = store().activeId;
    store().newChat();
    await send('B konusu', 'B yanıtı');
    const b = store().activeId;

    await store().openConversation(a!); // user goes back to A, then leaves
    await remount();

    expect(store().activeId).toBe(a);
    expect(store().activeId).not.toBe(b);
    expect(contents()).toEqual(['A konusu', 'A yanıtı']);
  });

  it('falls back to the most recent thread when the last-open one is gone', async () => {
    await send('A konusu', 'A yanıtı');
    store().newChat();
    await send('B konusu', 'B yanıtı');
    const b = store().activeId;

    // Deleted from another device: the id in AsyncStorage now points nowhere.
    mockKv.set(lastActiveKey('user-A'), 'conv-does-not-exist');
    await remount();

    expect(store().activeId).toBe(b);
    expect(store().error).toBeNull();
  });

  it('an answer already stored is not stored twice when the same attempt replays', async () => {
    const requestId = nextRequestId();
    const first = replyWith('Tek yanıt');
    await store().send('Aynı soru', { invoke: first.invoke, requestId });
    const second = replyWith('Tek yanıt');
    await store().send('Aynı soru', { invoke: second.invoke, requestId });

    const assistants = mockDb.messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(contents().filter((c) => c === 'Tek yanıt')).toHaveLength(1);
  });

  it('a provider failure leaves the question stored and fabricates no answer', async () => {
    const res = await store().send('Cevapsız soru', {
      invoke: async () => { throw new Error('network down'); },
      requestId: nextRequestId(),
    });

    expect(res.ok).toBe(false);
    expect(mockDb.messages.map((m) => m.role)).toEqual(['user']);
    await remount();
    expect(contents()).toEqual(['Cevapsız soru']);
  });

  it('an old thread opens one page at a time', async () => {
    await send('İlk mesaj', 'İlk yanıt');
    const id = store().activeId!;
    // 100 more turns arrive over time. Opening must not read them all.
    for (let i = 0; i < 50; i++) {
      mockDb.seq++;
      mockDb.messages.push({
        id: `old-${i}`, conversation_id: id, user_id: 'user-A', role: i % 2 ? 'assistant' : 'user',
        content: `eski-${i}`, request_id: null, created_at: mockNow(),
      });
    }

    await store().openConversation(id);
    expect(store().messages).toHaveLength(40);
    expect(store().messagesHasMore).toBe(true);

    await store().loadOlderMessages();
    expect(store().messages.length).toBeGreaterThan(40);
    // Older messages are PREPENDED, so the transcript still reads forwards.
    expect(store().messages[0].content).toBe('İlk mesaj');
  });
});

// ---------------------------------------------------------------------------
// §71 Managing threads
// ---------------------------------------------------------------------------

describe('threads are created, named and filed', () => {
  it('New Chat starts a distinct thread and leaves the first one intact', async () => {
    await send('Birinci konu', 'Birinci yanıt');
    const a = store().activeId;

    store().newChat();
    expect(store().messages).toEqual([]);
    expect(store().activeId).toBeNull();

    await send('İkinci konu', 'İkinci yanıt');
    const b = store().activeId;

    expect(b).not.toBe(a);
    expect(mockDb.conversations).toHaveLength(2);
    expect(mockDb.messages.filter((m) => m.conversation_id === a)).toHaveLength(2);
    expect(mockDb.messages.filter((m) => m.conversation_id === b)).toHaveLength(2);
  });

  it('the first message names the thread, without a second paid call', async () => {
    const { calls } = await send('Uykuya geçişimi nasıl kolaylaştırırım', 'Şunları dene.');
    expect(mockDb.conversations[0].title).toBe('Uykuya geçişimi nasıl kolaylaştırırım');
    // One provider call for the turn. Naming is derived, not requested.
    expect(calls).toHaveLength(1);
  });

  it('a long first message is cut at a word boundary, not mid-word', async () => {
    await send(
      'Sabahları erken kalkmak istiyorum ama gece geç yatıyorum ve bu yüzden gün boyu yorgun hissediyorum',
      'Anladım.',
    );
    const title = mockDb.conversations[0].title;
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it('a rename persists across leaving the screen', async () => {
    await send('Konu', 'Yanıt');
    const id = store().activeId!;

    expect(await store().rename(id, 'Uyku düzeni')).toBe(true);
    await remount();

    expect(store().conversations.find((c) => c.id === id)?.title).toBe('Uyku düzeni');
  });

  it('an empty rename is refused and changes nothing', async () => {
    await send('Konu', 'Yanıt');
    const id = store().activeId!;

    expect(await store().rename(id, '   ')).toBe(false);
    expect(mockDb.conversations.find((c) => c.id === id)?.title).toBe('Konu');
    expect(store().error).toBeTruthy();
  });

  it('a thread is filed under an existing project, and unfiled again', async () => {
    await send('Konu', 'Yanıt');
    const id = store().activeId!;

    expect(await store().assignProject(id, 'proj-A1')).toBe(true);
    expect(mockDb.conversations.find((c) => c.id === id)?.project_id).toBe('proj-A1');
    await remount();
    expect(store().conversations.find((c) => c.id === id)?.project_id).toBe('proj-A1');

    expect(await store().assignProject(id, null)).toBe(true);
    expect(mockDb.conversations.find((c) => c.id === id)?.project_id).toBeNull();
  });

  it('a project belonging to someone else is refused', async () => {
    await send('Konu', 'Yanıt');
    const id = store().activeId!;

    expect(await store().assignProject(id, 'proj-SOMEONE-ELSE')).toBe(false);
    expect(mockDb.conversations.find((c) => c.id === id)?.project_id).toBeNull();
    expect(store().error).toMatch(/row-level security/);
  });

  it('the list is ordered by last activity, not by creation', async () => {
    await send('Eski konu', 'Yanıt');
    const a = store().activeId!;
    store().newChat();
    await send('Yeni konu', 'Yanıt');

    await store().openConversation(a);
    await send('Eski konuya dönüş', 'Yanıt');

    await store().loadConversations({ reset: true });
    expect(store().conversations[0].id).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// §72 Isolation
// ---------------------------------------------------------------------------

const A_ONLY = 'A_ONLY_SECRET_PHRASE';
const B_ONLY = 'B_ONLY_SECRET_PHRASE';

describe('one thread never leaks into another', () => {
  it('switching threads replaces the transcript rather than appending to it', async () => {
    await send(A_ONLY, 'A yanıtı');
    const a = store().activeId!;
    store().newChat();
    await send(B_ONLY, 'B yanıtı');
    const b = store().activeId!;

    expect(contents().join(' ')).not.toContain(A_ONLY);

    await store().openConversation(a);
    expect(contents()).toEqual([A_ONLY, 'A yanıtı']);
    expect(contents().join(' ')).not.toContain(B_ONLY);

    await store().openConversation(b);
    expect(contents()).toEqual([B_ONLY, 'B yanıtı']);
    expect(contents().join(' ')).not.toContain(A_ONLY);
  });

  it('every provider call names the thread it belongs to', async () => {
    const a1 = await send(A_ONLY, 'A yanıtı');
    const a = store().activeId!;
    store().newChat();
    const b1 = await send(B_ONLY, 'B yanıtı');
    const b = store().activeId!;

    expect(a1.calls[0].conversation_id).toBe(a);
    expect(b1.calls[0].conversation_id).toBe(b);
    // The server loads history BY conversation_id, so this field is what keeps
    // the model's context bounded to one thread.
    expect(b1.calls[0].conversation_id).not.toBe(a1.calls[0].conversation_id);
  });

  it('a staged proposal cannot be confirmed from the other thread', async () => {
    await send(A_ONLY, 'Şunu ekleyelim.', [
      { type: 'propose_habit', habit: { name: 'Sabah yürüyüşü', tracking_type: 'binary', difficulty: 1, estimated_minutes: 15 } },
    ]);
    const a = store().activeId!;
    expect(store().pendingAction).not.toBeNull();
    const stagedId = store().pendingAction!.row.id;

    store().newChat();
    await send(B_ONLY, 'Başka bir konu.');

    // B shows nothing to confirm, and confirming in B resolves nothing.
    expect(store().pendingAction).toBeNull();
    await store().resolvePending('confirmed');
    expect(mockDb.actions.find((x) => x.id === stagedId)?.status).toBe('pending');

    // A still has it, and only A can close it.
    await store().openConversation(a);
    expect(store().pendingAction?.row.id).toBe(stagedId);
    await store().resolvePending('confirmed');
    expect(mockDb.actions.find((x) => x.id === stagedId)?.status).toBe('confirmed');
  });

  it('a new proposal supersedes the one the user scrolled past', async () => {
    // Two proposals in one thread. The first was never answered; leaving it
    // `pending` would make it reappear as a live card once the second is
    // resolved -- a suggestion the user has long since moved past.
    await send('Konu', 'Şunu ekleyelim.', [
      { type: 'propose_habit', habit: { name: 'İlk öneri', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 } },
    ]);
    const id = store().activeId!;
    const first = store().pendingAction!.row.id;

    await send('Peki ya bu?', 'O zaman şunu.', [
      { type: 'propose_habit', habit: { name: 'İkinci öneri', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 } },
    ]);
    const second = store().pendingAction!.row.id;
    expect(second).not.toBe(first);
    expect(mockDb.actions.find((a) => a.id === first)?.status).toBe('cancelled');

    // Resolve the live one, then reopen: nothing is offered again.
    await store().resolvePending('confirmed');
    await store().openConversation(id);
    expect(store().pendingAction).toBeNull();
  });

  it('an answer with no proposal leaves the open one alone', async () => {
    // The follow-up question case: "ekleyelim mi?" then "ne kadar sürer?".
    // The proposal is still live and must not be cancelled by a plain reply.
    await send('Konu', 'Şunu ekleyelim.', [
      { type: 'propose_habit', habit: { name: 'Öneri', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 } },
    ]);
    const staged = store().pendingAction!.row.id;

    await send('Ne kadar sürer?', 'Yaklaşık beş dakika.');

    expect(store().pendingAction?.row.id).toBe(staged);
    expect(mockDb.actions.find((a) => a.id === staged)?.status).toBe('pending');
  });

  it('a staged PLAN survives leaving the screen, and its status decides what comes back', async () => {
    // §24 for the plan path specifically: the durable row is what makes a
    // multi-habit preview resumable rather than something the user has to ask
    // for again (and pay for again).
    const plan = {
      type: 'propose_habit_plan',
      title: 'Kısa Haftalık Plan',
      goal: 'Düzenli başlangıç',
      habits: [
        { name: 'Kitap Oku', tracking_type: 'numeric', difficulty: 3, estimated_minutes: 20,
          unit: 'dakika', daily_goal: 20, target_direction: 'at_least', frequency_config: { kind: 'daily' } },
        { name: 'Yürüyüş', tracking_type: 'binary', difficulty: 1, estimated_minutes: 30,
          frequency_config: { kind: 'weekly', days: [0, 2, 4] } },
      ],
    };
    await send('Bana kısa bir haftalık plan öner', 'İşte plan.', [plan]);
    const id = store().activeId!;
    const stagedId = store().pendingAction!.row.id;

    await remount();
    // Still there, and still the whole plan -- both habits with their targets.
    const back = store().pendingAction;
    expect(back?.row.id).toBe(stagedId);
    expect(back?.action).toEqual(plan);

    await store().resolvePending('cancelled');
    await remount();
    expect(store().pendingAction).toBeNull();
    expect(mockDb.actions.find((a) => a.id === stagedId)?.status).toBe('cancelled');
    expect(store().activeId).toBe(id);
  });

  it('an answered question is not asked again after leaving the screen', async () => {
    // The clarification the user gave ("hedef 20 dakika") is a decision. A
    // decision that lives only in component state is one they have to make
    // again -- the same class of defect durable conversations exist to fix.
    const bare = { name: 'Kitap Oku', tracking_type: 'numeric', difficulty: 3, estimated_minutes: 20 };
    await send('Kitap okuma alışkanlığı ekle', 'Ekleyebilirim.', [{ type: 'propose_habit', habit: bare }]);
    expect(store().pendingAction!.action).toEqual({ type: 'propose_habit', habit: bare });

    const answered = {
      type: 'propose_habit',
      habit: { ...bare, unit: 'dakika', daily_goal: 20, target_direction: 'at_least', frequency_config: { kind: 'daily' } },
    };
    await store().updatePendingPayload(answered as never);

    await remount();
    expect(store().pendingAction?.action).toEqual(answered);
  });

  it('a resolved proposal never comes back as pending', async () => {
    await send('Konu', 'Şunu ekleyelim.', [
      { type: 'propose_habit', habit: { name: 'Su iç', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2 } },
    ]);
    const id = store().activeId!;
    await store().resolvePending('cancelled');

    await store().openConversation(id);
    expect(store().pendingAction).toBeNull();
  });

  it('an answer that arrives after the user moved on lands in its own thread only', async () => {
    // A coach turn takes seconds. Nothing stops the user opening another
    // conversation while it is in flight, and when the answer comes back it
    // must not be drawn into the thread they are now reading.
    await send(A_ONLY, 'A yanıtı');
    const a = store().activeId!;
    store().newChat();
    await send(B_ONLY, 'B yanıtı');
    const b = store().activeId!;

    const res = await store().send('B içinde sorulan geç soru', {
      requestId: nextRequestId(),
      // The user switches to A while the provider is still thinking.
      invoke: async () => { await store().openConversation(a); return { reply: 'B için gelen geç yanıt' }; },
    });
    expect(res.ok).toBe(true);
    // The caller is told not to draw it -- the rows are written regardless.
    expect(res.stale).toBe(true);

    // A shows A, unchanged.
    expect(contents()).toEqual([A_ONLY, 'A yanıtı']);

    // And the answer is durable in B, where it was asked.
    await store().openConversation(b);
    expect(contents()).toEqual([B_ONLY, 'B yanıtı', 'B içinde sorulan geç soru', 'B için gelen geç yanıt']);
    expect(store().sending).toBe(false);
  });

  it('another user sees none of these threads', async () => {
    await send(A_ONLY, 'A yanıtı');
    expect(mockDb.conversations).toHaveLength(1);

    mockDb.user = 'user-B';
    await remount();

    expect(store().conversations).toEqual([]);
    expect(store().messages).toEqual([]);
    expect(store().activeId).toBeNull();
  });

  it("another user cannot rename or refile a thread they do not own", async () => {
    await send(A_ONLY, 'A yanıtı');
    const id = store().activeId!;

    mockDb.user = 'user-B';
    expect(await store().rename(id, 'ele geçirildi')).toBe(false);
    expect(await store().assignProject(id, 'proj-A1')).toBe(false);

    mockDb.user = 'user-A';
    const row = mockDb.conversations.find((c) => c.id === id)!;
    expect(row.title).toBe(A_ONLY);
    expect(row.project_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F04 (STO-22, STO-V02) — the last-open thread and the list belong to one account
// ---------------------------------------------------------------------------

describe('F04 — account boundary', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("A's last-open thread is stored under A and is not read for B", async () => {
    await send(A_ONLY, 'A yanıtı');
    const aThread = store().activeId!;
    await flush();
    expect(mockKv.get(lastActiveKey('user-A'))).toBe(aThread);

    resetAccountMemory('signed_out');
    mockDb.user = 'user-B';
    const finds = mockRepoCalls.findThread;
    await store().hydrate();
    expect(store().activeId).toBeNull(); // B has no thread; A's id was never looked up
    expect(mockRepoCalls.findThread).toBe(finds);
  });

  it("the account boundary removes the account's last-open key; reset() alone keeps it", async () => {
    await send(A_ONLY, 'A yanıtı');
    await flush();
    store().reset();
    await flush();
    expect(mockKv.has(lastActiveKey('user-A'))).toBe(true); // leaving the screen is not leaving the account
    await endAccountScope('signed_out', 'user-A');
    expect(mockKv.has(lastActiveKey('user-A'))).toBe(false);
  });

  it('no key: findThread is not called (and with a key it is: the counter is live)', async () => {
    const finds = mockRepoCalls.findThread;
    await store().hydrate();
    expect(mockRepoCalls.findThread).toBe(finds);
    mockKv.set(lastActiveKey('user-A'), 'conv-anything');
    await store().hydrate();
    expect(mockRepoCalls.findThread).toBe(finds + 1);
  });

  it('STO-V02, same account: a reset while a "load more" is in flight runs, and the older answer is dropped', async () => {
    await send(A_ONLY, 'A yanıtı');
    let release!: () => void;
    mockGate.listThreads = new Promise<void>((r) => { release = r; });
    const older = store().loadConversations();          // a page request, held
    await flush();
    expect(store().loadingConversations).toBe(true);

    mockGate.listThreads = null;
    // a thread written on another device: only a real reload can show it
    mockDb.conversations.push({
      id: 'conv-elsewhere', user_id: 'user-A', title: 'Başka cihaz', project_id: null,
      created_at: '2027-01-01T00:00:00.000Z', updated_at: '2027-01-01T00:00:00.000Z',
      last_message_at: '2027-01-01T00:00:00.000Z', archived_at: null,
    } as never);
    await store().loadConversations({ reset: true });    // must not be skipped
    expect(store().conversations.map((c) => c.title)).toEqual(expect.arrayContaining(['Başka cihaz']));
    expect(store().loadingConversations).toBe(false);

    release();
    await older;
    expect(store().conversations.map((c) => c.title)).toEqual(expect.arrayContaining(['Başka cihaz']));
    expect(store().loadingConversations).toBe(false);
  });

  it('STO-V02: a reset request is not swallowed by a load in flight, and the late answer is dropped', async () => {
    await send(A_ONLY, 'A yanıtı');
    let release!: () => void;
    mockGate.listThreads = new Promise<void>((r) => { release = r; });
    const stale = store().loadConversations();          // A's request, held at the "network"
    await flush();
    expect(store().loadingConversations).toBe(true);

    resetAccountMemory('signed_out');
    mockDb.user = 'user-B';
    mockGate.listThreads = null;
    await store().loadConversations({ reset: true });    // B's request is not skipped
    expect(store().conversations).toEqual([]);
    expect(store().loadingConversations).toBe(false);

    release();
    await stale;                                         // A's answer arrives late
    expect(store().conversations).toEqual([]);           // and is not written into B's list
    expect(store().loadingConversations).toBe(false);
  });
});
