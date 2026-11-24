import { act, renderHook } from '@testing-library/react-native';
import { NO_ANSWER_NOTE } from '../../lib/aiAttempt';
import type { Habit } from '../../lib/supabase';
import type { InvokeStreamOptions, InvokeStreamResult } from '../../services/aiStreamService';
import {
  useCoachSend,
  type CoachMessage,
  type UseCoachSendArgs,
} from '../../hooks/useCoachSend';

const mockInvokeFunctions = jest.fn();
const mockInvokeAiWithStream = jest.fn<Promise<InvokeStreamResult>, [InvokeStreamOptions]>();
const mockNewRequestId = jest.fn<string, []>();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvokeFunctions(...args),
    },
  },
}));

jest.mock('../../services/aiStreamService', () => ({
  invokeAiWithStream: (opts: InvokeStreamOptions) => mockInvokeAiWithStream(opts),
}));

jest.mock('../../services/focusPointService', () => ({
  newRequestId: () => mockNewRequestId(),
}));

function makeHabit(id: string, name: string, status: Habit['status'] = 'active'): Habit {
  return {
    id,
    user_id: 'u-1',
    name,
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    willpower_cost: 2,
    status,
    impact_level: null,
    urgency: null,
    difficulty: 2,
    estimated_minutes: 10,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-11-01T00:00:00.000Z',
  };
}

function makeArgs(overrides: Partial<UseCoachSendArgs> = {}): {
  args: UseCoachSendArgs;
  setInput: jest.Mock<void, [string]>;
  setBalance: jest.Mock<void, [number]>;
  pushTransient: jest.Mock<void, [CoachMessage]>;
  sendToStore: jest.Mock<
    ReturnType<UseCoachSendArgs['sendToStore']>,
    Parameters<UseCoachSendArgs['sendToStore']>
  >;
} {
  const setInput = jest.fn<void, [string]>();
  const setBalance = jest.fn<void, [number]>();
  const pushTransient = jest.fn<void, [CoachMessage]>();
  const sendToStore: jest.Mock<
    ReturnType<UseCoachSendArgs['sendToStore']>,
    Parameters<UseCoachSendArgs['sendToStore']>
  > = jest.fn(async (_text, opts) => {
    await opts.invoke({ prompt: _text });
    return { ok: true };
  });

  const args: UseCoachSendArgs = {
    activeId: 'conv-1',
    input: '',
    setInput,
    hasConversation: true,
    habits: [makeHabit('h-1', 'Kitap oku', 'active'), makeHabit('h-2', 'Eski', 'paused')],
    tasks: [{ completed: false }, { completed: true }],
    wp: { used: 3, daily_budget: 12, active_count: 1, focus_capacity: 3 },
    analyticsHabits: null,
    analyticsSummary: { streak: '5g' },
    sendToStore,
    setBalance,
    pushTransient,
    ...overrides,
  };

  return { args, setInput, setBalance, pushTransient, sendToStore };
}

describe('useCoachSend', () => {
  let reqSeq = 0;

  beforeEach(() => {
    reqSeq = 0;
    mockInvokeFunctions.mockReset();
    mockInvokeAiWithStream.mockReset();
    mockNewRequestId.mockReset().mockImplementation(() => `req-${++reqSeq}`);
  });

  it('(-) ignores empty or whitespace-only messages without mutating loading or calling sendToStore', async () => {
    const { args, setInput, sendToStore, pushTransient } = makeArgs({ input: '   \t\n  ' });
    const { result } = renderHook((props: UseCoachSendArgs) => useCoachSend(props), {
      initialProps: args,
    });

    await act(async () => {
      await result.current.send();
      await result.current.send('    ');
    });

    expect(sendToStore).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();
    expect(pushTransient).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('(+) sends trimmed message with requestId, streams partial reply via onReplyText, updates balance, and resets loading', async () => {
    let capturedOpts: InvokeStreamOptions | undefined;
    let resolveStream!: (res: InvokeStreamResult) => void;

    mockInvokeAiWithStream.mockImplementation((opts) => {
      capturedOpts = opts;
      return new Promise<InvokeStreamResult>((resolve) => {
        resolveStream = resolve;
      });
    });

    const { args, setInput, setBalance, pushTransient, sendToStore } = makeArgs({
      activeId: 'conv-stream',
      input: '  Sabah planımı kur  ',
    });

    const { result } = renderHook((props: UseCoachSendArgs) => useCoachSend(props), {
      initialProps: args,
    });

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.send();
    });

    expect(setInput).toHaveBeenCalledWith('');
    expect(result.current.loading).toBe(true);
    expect(sendToStore).toHaveBeenCalledTimes(1);
    expect(sendToStore).toHaveBeenCalledWith(
      'Sabah planımı kur',
      expect.objectContaining({ requestId: 'req-1' }),
    );
    expect(capturedOpts?.body).toMatchObject({
      prompt: 'Sabah planımı kur',
      mode: 'coach',
      context: {
        activeHabits: ['Kitap oku'],
        pendingTaskCount: 1,
        habitCount: 2,
        willpower: { used: 3, daily_budget: 12, active_count: 1, focus_capacity: 3 },
        analytics: { streak: '5g' },
      },
    });

    act(() => {
      capturedOpts?.onReplyText?.('İlk cümle');
    });
    expect(result.current.streamingReply).toBe('İlk cümle');

    act(() => {
      capturedOpts?.onReplyText?.('İlk cümle ve devamı');
    });
    expect(result.current.streamingReply).toBe('İlk cümle ve devamı');

    await act(async () => {
      resolveStream({
        data: { reply: 'İlk cümle ve devamı', balance: 42 },
        error: null,
        transport: 'stream',
      });
      await sendPromise;
    });

    expect(setBalance).toHaveBeenCalledWith(42);
    expect(result.current.loading).toBe(false);
    expect(result.current.streamingReply).toBe('');
    expect(result.current.insufficientCredits).toBe(false);
    expect(pushTransient).not.toHaveBeenCalled();
  });

  it('(-) sets insufficientCredits=true, updates balance, and pushes transient error when INSUFFICIENT_CREDITS is returned', async () => {
    const creditErr = Object.assign(new Error('HTTP 402'), {
      name: 'FunctionsHttpError',
      context: {
        json: async () => ({
          error: 'Yetersiz odak puanı',
          code: 'INSUFFICIENT_CREDITS',
          balance: 0,
        }),
      },
    });
    mockInvokeAiWithStream.mockResolvedValueOnce({
      data: null,
      error: creditErr,
      transport: 'stream',
    });

    const { args, setBalance, pushTransient } = makeArgs({ activeId: 'conv-credits' });
    const { result } = renderHook((props: UseCoachSendArgs) => useCoachSend(props), {
      initialProps: args,
    });

    await act(async () => {
      await result.current.send('Bütçemi kontrol et');
    });

    expect(result.current.insufficientCredits).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(setBalance).toHaveBeenCalledWith(0);
    expect(pushTransient).toHaveBeenCalledTimes(1);
    expect(pushTransient).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'error', content: 'Yetersiz odak puanı' }),
    );
  });

  it('(+) preserves requestId across lost answer and onConversationCreated rebind until answered', async () => {
    const noAnswerErr = Object.assign(new Error('stream dropped'), {
      name: 'FunctionsFetchError',
    });
    mockInvokeAiWithStream
      .mockResolvedValueOnce({ data: null, error: noAnswerErr, transport: 'stream' })
      .mockResolvedValueOnce({ data: { reply: 'Tamamlandı', balance: 9 }, error: null, transport: 'stream' });

    const { args, sendToStore, pushTransient } = makeArgs({ activeId: null });
    sendToStore.mockImplementation(async (text, opts) => {
      opts.onConversationCreated?.({
        id: 'conv-new-1',
        user_id: 'u-1',
        title: text,
        project_id: null,
        created_at: '2026-11-24T10:00:00.000Z',
        updated_at: '2026-11-24T10:00:00.000Z',
        last_message_at: '2026-11-24T10:00:00.000Z',
        archived_at: null,
      });
      await opts.invoke({ prompt: text });
      return { ok: true };
    });

    const { result, rerender } = renderHook((props: UseCoachSendArgs) => useCoachSend(props), {
      initialProps: args,
    });

    await act(async () => {
      await result.current.send('İlk mesajım');
    });

    expect(pushTransient).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'error', content: NO_ANSWER_NOTE }),
    );
    const firstRequestId = sendToStore.mock.calls[0]?.[1].requestId;
    expect(firstRequestId).toBe('req-1');

    rerender({ ...args, activeId: 'conv-new-1' });

    await act(async () => {
      await result.current.send('İlk mesajım');
    });

    const retryRequestId = sendToStore.mock.calls[1]?.[1].requestId;
    expect(retryRequestId).toBe('req-1');
  });

  it('(-) summarize rejects short transcripts (< 10 chars) and !hasConversation without invoking edge function', async () => {
    const { args: noConvArgs } = makeArgs({ hasConversation: false });
    const { result: noConvHook } = renderHook((props: UseCoachSendArgs) => useCoachSend(props), {
      initialProps: noConvArgs,
    });

    let outNoConv: Awaited<ReturnType<typeof noConvHook.current.summarize>> | undefined;
    await act(async () => {
      outNoConv = await noConvHook.current.summarize('Bu oldukça uzun bir konuşma metnidir.');
    });
    expect(outNoConv).toEqual({ ok: false });
    expect(mockInvokeFunctions).not.toHaveBeenCalled();

    const { args: convArgs } = makeArgs({ hasConversation: true });
    const { result: convHook } = renderHook((props: UseCoachSendArgs) => useCoachSend(props), {
      initialProps: convArgs,
    });

    let outShort: Awaited<ReturnType<typeof convHook.current.summarize>> | undefined;
    await act(async () => {
      outShort = await convHook.current.summarize('   kısa   ');
    });
    expect(outShort).toEqual({ ok: false });
    expect(mockInvokeFunctions).not.toHaveBeenCalled();
  });

  it('(+) summarize returns { ok: true, summary } on valid invoke response and updates balance', async () => {
    mockInvokeFunctions.mockResolvedValueOnce({
      data: { summary: 'Bugün odak ve okuma hedefleri netleştirildi.', balance: 28 },
      error: null,
    });

    const { args, setBalance, pushTransient } = makeArgs({ hasConversation: true });
    const { result } = renderHook((props: UseCoachSendArgs) => useCoachSend(props), {
      initialProps: args,
    });

    const transcript = 'Kullanıcı: Sabah odaklanmakta zorlandım. Koç: İlk 5 dakikayı sadeleştir.';
    let summaryRes: Awaited<ReturnType<typeof result.current.summarize>> | undefined;
    await act(async () => {
      summaryRes = await result.current.summarize(transcript);
    });

    expect(summaryRes).toEqual({
      ok: true,
      summary: 'Bugün odak ve okuma hedefleri netleştirildi.',
    });
    expect(mockInvokeFunctions).toHaveBeenCalledWith(
      'generate-routine',
      expect.objectContaining({
        body: {
          mode: 'summarize',
          transcript,
          request_id: 'req-1',
        },
      }),
    );
    expect(setBalance).toHaveBeenCalledWith(28);
    expect(result.current.summarizing).toBe(false);
    expect(pushTransient).not.toHaveBeenCalled();
  });
});
