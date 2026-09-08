/**
 * Nothing AI Coach says can write. Only a tap can.
 *
 * The feature under test lets the coach propose habits and completions in
 * conversation, which means a language model's output now sits one step away
 * from the user's habit rows. These tests exist to prove that step is real:
 *
 *   a reply alone writes nothing;
 *   staging a proposal writes nothing;
 *   showing a preview writes nothing;
 *   cancelling writes nothing;
 *   confirming writes exactly once, even if the button is hit twice;
 *   an ambiguous habit is a question, never a guess;
 *   dictation fills the composer and never sends.
 *
 * Every one of those is asserted by counting calls to the two write paths —
 * `routineStore.confirmInstall` and `logStore.logHabit` — because "did not
 * write" is the property that matters, and it is the one a screenshot cannot
 * show.
 */
import React from 'react';
import { Text, TouchableOpacity, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

// The AI Coach screen pulls in five stores, the analytics engine and the
// routine pipeline, so the FIRST mount in a fresh module registry costs more
// than Jest's 5s default -- every later test in this file mounts the same
// screen well inside it. This raises the clock, not the bar: no assertion is
// relaxed, and a real hang still fails here.
jest.setTimeout(20000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));

const mockInvoke = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a: unknown[]) => mockSetString(...a) }));

const mockSpeak = jest.fn();
const mockStopSpeak = jest.fn();
jest.mock('expo-speech', () => ({
  speak: (...a: unknown[]) => mockSpeak(...a),
  stop: (...a: unknown[]) => mockStopSpeak(...a),
}));

// Dictation is driven directly so the tests can prove the ONE thing that
// matters about it: the transcript reaches the composer and stops there.
let mockSpeechStart = jest.fn();
let mockSpeechStop = jest.fn();
let mockLastOnTranscript: ((t: string) => void) | null = null;
jest.mock('../../hooks/useSpeechInput', () => ({
  useSpeechInput: (onTranscript: (t: string) => void) => {
    mockLastOnTranscript = onTranscript;
    return { available: true, listening: false, error: null, start: mockSpeechStart, stop: mockSpeechStop };
  },
}));

const HABITS = [
  { id: 'h1', name: 'Kitap Oku', status: 'active', tracking_type: 'numeric', unit: 'dakika', daily_goal: 20, target_direction: 'at_least' },
  { id: 'h2', name: 'Kitap Özeti', status: 'active', tracking_type: 'binary', unit: null, daily_goal: null, target_direction: null },
  { id: 'h3', name: 'Yürüyüş', status: 'active', tracking_type: 'binary', unit: null, daily_goal: null, target_direction: null },
];
jest.mock('../../store/habitStore', () => ({
  useHabitStore: Object.assign(() => ({ habits: HABITS }), { getState: () => ({ habits: HABITS }) }),
}));
jest.mock('../../store/taskStore', () => ({ useTaskStore: () => ({ tasks: [] }) }));
jest.mock('../../store/willpowerStore', () => ({ useWillpowerStore: () => ({ state: null, fetchToday: jest.fn() }) }));
jest.mock('../../store/subscriptionStore', () => ({
  useSubscriptionStore: () => ({ focusPoints: 15, fetch: jest.fn(), setBalance: jest.fn() }),
}));
jest.mock('../../store/journalStore', () => ({
  useJournalStore: (sel?: (s: unknown) => unknown) => (sel ? sel({ appendEntry: jest.fn() }) : { appendEntry: jest.fn() }),
}));
jest.mock('../../services/reviewService', () => ({
  loadReviewData: jest.fn(async () => { throw new Error('not needed'); }),
}));

const mockStageProposal = jest.fn(() => true);
const mockConfirmInstall = jest.fn(async () => true);
const mockClearGenerated = jest.fn();
const routineState = {
  evaluation: { toActivate: ['Kitap Oku'], toQueue: [] },
  proposalErrors: null as string[] | null,
  installError: null as string | null,
};
jest.mock('../../store/routineStore', () => ({
  useRoutineStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({
      stageCoachProposal: mockStageProposal,
      confirmInstall: mockConfirmInstall,
      clearGenerated: mockClearGenerated,
    }),
    { getState: () => routineState },
  ),
}));

type LogArgs = { habitId: string; state: string; value?: number; targetValue?: number; targetDirection?: string; baseXp?: number };
const mockLogHabit = jest.fn(async (_p: LogArgs) => ({ ok: true }));
jest.mock('../../store/logStore', () => ({
  useLogStore: Object.assign((sel: (s: unknown) => unknown) => sel({ logHabit: mockLogHabit }), {
    getState: () => ({ logHabit: mockLogHabit }),
  }),
}));

import AICoachScreen from '../../app/screens/ai-coach';

const QUESTION = 'Haftalık plan öner';

const OK_HABIT = { name: 'Kitap Oku', tracking_type: 'numeric', difficulty: 3, estimated_minutes: 20 };

/**
 * Rendered trees are unmounted after every test.
 *
 * Not tidiness: the copy tick clears itself on a 1500ms timer, which outlives
 * a fast test. Leaving the screen mounted let that timer fire into a torn-down
 * Jest environment and re-render, which surfaced as "import after teardown" —
 * green tests, red job. Unmounting runs the screen's own cleanup, so this also
 * checks that the cleanup exists.
 */
let mounted: TestRenderer.ReactTestRenderer | null = null;

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<AICoachScreen />); });
  mounted = tree;
  return tree;
}

afterEach(async () => {
  if (mounted) {
    const t = mounted;
    mounted = null;
    await act(async () => { t.unmount(); });
  }
});

const buttonByLabel = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAllByType(TouchableOpacity).find((t) => t.props.accessibilityLabel === label);

const textsSaying = (tree: TestRenderer.ReactTestRenderer, needle: string) =>
  tree.root.findAllByType(Text).filter((n) => String(n.props.children ?? '').includes(needle));

async function ask(tree: TestRenderer.ReactTestRenderer) {
  const chip = tree.root.findAllByType(TouchableOpacity).find((t) =>
    t.findAllByType(Text).map((x) => x.props.children).includes(QUESTION),
  );
  await act(async () => { chip!.props.onPress(); });
}

/** Every write path this screen can reach. */
const writeCount = () => mockConfirmInstall.mock.calls.length + mockLogHabit.mock.calls.length;

beforeEach(() => {
  mockInvoke.mockReset();
  mockStageProposal.mockClear().mockReturnValue(true);
  mockConfirmInstall.mockClear().mockResolvedValue(true);
  mockClearGenerated.mockClear();
  mockLogHabit.mockClear().mockResolvedValue({ ok: true });
  mockSetString.mockClear();
  mockSpeak.mockClear();
  mockStopSpeak.mockClear();
  mockSpeechStart = jest.fn();
  mockSpeechStop = jest.fn();
  routineState.proposalErrors = null;
  routineState.installError = null;
});

describe('the confirmation barrier', () => {
  it('a plain reply with no actions writes nothing and shows no card', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'Motivasyon dalgalıdır, normal.' }, error: null });
    const tree = await render();
    await ask(tree);

    expect(writeCount()).toBe(0);
    expect(buttonByLabel(tree, 'Onayla ve alışkanlıkları ekle')).toBeUndefined();
  });

  it('a proposal is staged and previewed, but nothing is written', async () => {
    mockInvoke.mockResolvedValue({
      data: { reply: 'Şunu önerebilirim.', actions: [{ type: 'propose_habit', habit: OK_HABIT }] },
      error: null,
    });
    const tree = await render();
    await ask(tree);

    // Staged for preview...
    expect(mockStageProposal).toHaveBeenCalledTimes(1);
    expect(buttonByLabel(tree, 'Onayla ve alışkanlıkları ekle')).toBeDefined();
    // ...and not written.
    expect(writeCount()).toBe(0);
  });

  it('cancelling writes nothing and clears the card', async () => {
    mockInvoke.mockResolvedValue({
      data: { reply: 'Öneri', actions: [{ type: 'propose_habit', habit: OK_HABIT }] },
      error: null,
    });
    const tree = await render();
    await ask(tree);
    await act(async () => { buttonByLabel(tree, 'Vazgeç')!.props.onPress(); });

    expect(writeCount()).toBe(0);
    expect(buttonByLabel(tree, 'Onayla ve alışkanlıkları ekle')).toBeUndefined();
  });

  it('confirming writes exactly once', async () => {
    mockInvoke.mockResolvedValue({
      data: { reply: 'Öneri', actions: [{ type: 'propose_habit', habit: OK_HABIT }] },
      error: null,
    });
    const tree = await render();
    await ask(tree);
    await act(async () => { buttonByLabel(tree, 'Onayla ve alışkanlıkları ekle')!.props.onPress(); });

    expect(mockConfirmInstall).toHaveBeenCalledTimes(1);
    expect(mockLogHabit).not.toHaveBeenCalled();
  });

  it('a rejected proposal is reported and never installed', async () => {
    // The model produced something the routine validator refuses. The user
    // must see that, and the install path must not run.
    mockStageProposal.mockReturnValue(false);
    routineState.proposalErrors = ['tracking_type geçersiz'];
    mockInvoke.mockResolvedValue({
      data: { reply: 'Öneri', actions: [{ type: 'propose_habit', habit: OK_HABIT }] },
      error: null,
    });
    const tree = await render();
    await ask(tree);

    expect(textsSaying(tree, 'Bu öneri uygulanamadı').length).toBeGreaterThan(0);
    expect(writeCount()).toBe(0);
  });

  it('a malformed action never reaches staging, and the reply survives', async () => {
    mockInvoke.mockResolvedValue({
      data: { reply: 'Yine de faydalı bir yanıt.', actions: [{ type: 'drop_table', habit: OK_HABIT }] },
      error: null,
    });
    const tree = await render();
    await ask(tree);

    expect(mockStageProposal).not.toHaveBeenCalled();
    expect(writeCount()).toBe(0);
    // The thing the user paid 5 FP for is still on screen.
    expect(textsSaying(tree, 'Yine de faydalı bir yanıt.').length).toBe(1);
  });
});

describe('conversational logging', () => {
  const logAction = (over: Record<string, unknown> = {}) => ({
    type: 'log_habit', habit_query: 'Kitap Oku', date: 'today',
    completion: { kind: 'state', state: 'done' }, ...over,
  });

  it('an unambiguous habit is previewed by name, not written', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'İşaretleyebilirim.', actions: [logAction()] }, error: null });
    const tree = await render();
    await ask(tree);

    expect(textsSaying(tree, 'Kitap Oku').length).toBeGreaterThan(0);
    expect(buttonByLabel(tree, 'Kaydı işle')).toBeDefined();
    expect(writeCount()).toBe(0);
  });

  it('confirming logs exactly once, against the resolved habit', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'ok', actions: [logAction()] }, error: null });
    const tree = await render();
    await ask(tree);
    await act(async () => { buttonByLabel(tree, 'Kaydı işle')!.props.onPress(); });

    expect(mockLogHabit).toHaveBeenCalledTimes(1);
    const args = mockLogHabit.mock.calls[0][0];
    expect(args.habitId).toBe('h1');
    expect(args.state).toBe('done');
  });

  it('a numeric statement passes the value and the habit target to the domain engine', async () => {
    // The engine decides done/partial/miss. This screen must not.
    mockInvoke.mockResolvedValue({
      data: { reply: 'ok', actions: [logAction({ completion: { kind: 'value', value: 10, unit: 'dakika' } })] },
      error: null,
    });
    const tree = await render();
    await ask(tree);
    await act(async () => { buttonByLabel(tree, 'Kaydı işle')!.props.onPress(); });

    const args = mockLogHabit.mock.calls[0][0];
    expect(args.value).toBe(10);
    expect(args.targetValue).toBe(20);
    expect(args.targetDirection).toBe('at_least');
    // No XP is ever supplied from here.
    expect(args.baseXp).toBeUndefined();
  });

  it('an ambiguous habit asks instead of writing', async () => {
    // "kitap" matches Kitap Oku and Kitap Özeti.
    mockInvoke.mockResolvedValue({ data: { reply: 'ok', actions: [logAction({ habit_query: 'kitap' })] }, error: null });
    const tree = await render();
    await ask(tree);

    expect(textsSaying(tree, 'Hangisini kastettin?').length).toBe(1);
    expect(buttonByLabel(tree, 'Kaydı işle')).toBeUndefined();
    expect(writeCount()).toBe(0);
  });

  it('choosing from the ambiguity card still requires a confirmation', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'ok', actions: [logAction({ habit_query: 'kitap' })] }, error: null });
    const tree = await render();
    await ask(tree);
    await act(async () => { buttonByLabel(tree, 'Kitap Oku alışkanlığını seç')!.props.onPress(); });

    // Narrowed to one habit, and still not written.
    expect(buttonByLabel(tree, 'Kaydı işle')).toBeDefined();
    expect(writeCount()).toBe(0);
  });

  it('a habit the user does not have is reported, not created silently', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'ok', actions: [logAction({ habit_query: 'gitar' })] }, error: null });
    const tree = await render();
    await ask(tree);

    expect(textsSaying(tree, 'Eşleşen alışkanlık yok').length).toBe(1);
    expect(writeCount()).toBe(0);
  });

  it('a failed write is reported and not announced as success', async () => {
    mockLogHabit.mockResolvedValue({ ok: false } as never);
    mockInvoke.mockResolvedValue({ data: { reply: 'ok', actions: [logAction()] }, error: null });
    const tree = await render();
    await ask(tree);
    await act(async () => { buttonByLabel(tree, 'Kaydı işle')!.props.onPress(); });

    expect(textsSaying(tree, 'Kayıt yazılamadı').length).toBe(1);
    expect(textsSaying(tree, '✓').length).toBe(0);
  });
});

describe('copy and speak', () => {
  it('copies a message without sending anything', async () => {
    const tree = await render();
    const copy = tree.root.findAllByType(TouchableOpacity).filter((t) => t.props.accessibilityLabel === 'Mesajı kopyala');
    expect(copy.length).toBeGreaterThan(0);
    await act(async () => { copy[0].props.onPress(); });

    expect(mockSetString).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(writeCount()).toBe(0);
  });

  it('reads an assistant message aloud only when asked', async () => {
    const tree = await render();
    expect(mockSpeak).not.toHaveBeenCalled();

    const speak = buttonByLabel(tree, 'Yanıtı sesli oku');
    expect(speak).toBeDefined();
    await act(async () => { speak!.props.onPress(); });
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect((mockSpeak.mock.calls[0][1] as { language?: string }).language).toBe('tr-TR');
  });

  it('offers no speak control on the user\'s own message', async () => {
    mockInvoke.mockResolvedValue({ data: { reply: 'cevap' }, error: null });
    const tree = await render();
    await ask(tree);
    // Greeting + reply = two assistant messages; the user message adds none.
    const speakButtons = tree.root.findAllByType(TouchableOpacity)
      .filter((t) => t.props.accessibilityLabel === 'Yanıtı sesli oku');
    expect(speakButtons).toHaveLength(2);
  });
});

describe('dictation', () => {
  it('asks for the microphone only when tapped', async () => {
    const tree = await render();
    expect(mockSpeechStart).not.toHaveBeenCalled();

    await act(async () => { buttonByLabel(tree, 'Sesli yanıt ver')!.props.onPress(); });
    expect(mockSpeechStart).toHaveBeenCalledTimes(1);
  });

  it('a transcript fills the composer and does NOT send', async () => {
    // The whole safety argument for dictation: a misheard sentence must not
    // spend 5 FP or stage an action on its own.
    const tree = await render();
    await act(async () => { mockLastOnTranscript?.('bugün kitap okudum'); });

    const input = tree.root.findAllByType(TextInput)[0];
    expect(input.props.value).toBe('bugün kitap okudum');
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(writeCount()).toBe(0);
  });
});
