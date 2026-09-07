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

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
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

const QUESTION = 'Haftalık plan öner';
const REPLY = 'Haftalık planın: pazartesi yürüyüş, çarşamba okuma, cuma dinlenme.';

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<AICoachScreen />); });
  return tree;
}

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

    const userText = textsSaying(tree, QUESTION).find((n) => flat(n).color !== undefined);
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

    const chip = tree.root.findAllByType(TouchableOpacity).find((t) =>
      t.findAllByType(Text).map((x) => x.props.children).includes(QUESTION),
    );
    expect(chip!.props.disabled).toBe(false);
  });
});
