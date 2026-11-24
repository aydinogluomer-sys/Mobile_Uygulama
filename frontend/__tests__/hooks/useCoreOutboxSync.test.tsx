import { act, renderHook } from '@testing-library/react-native';
import {
  emptyOutbox,
  enqueue,
  MAX_ATTEMPTS,
  settle,
  type OutboxState,
  type OutboxSummary,
} from '../../lib/outbox';
import { useCoreOutboxSync } from '../../hooks/useCoreOutboxSync';

type OutboxListener = (state: OutboxState | null) => void;

const mockSync = jest.fn<OutboxSummary, []>();
const mockEnsure = jest.fn<Promise<OutboxState | null>, []>();
const mockUnsubscribe = jest.fn<void, []>();
const mockSubscribe = jest.fn<() => void, [OutboxListener]>();

jest.mock('../../services/coreOutbox', () => ({
  coreOutbox: {
    sync: () => mockSync(),
    ensure: () => mockEnsure(),
    subscribe: (fn: OutboxListener) => mockSubscribe(fn),
  },
}));

describe('useCoreOutboxSync', () => {
  let listeners: Set<OutboxListener>;

  beforeEach(() => {
    listeners = new Set();
    mockSync.mockReset().mockReturnValue({
      pending: 0,
      dead: 0,
      conflict: 0,
      authBlocked: false,
    });
    mockEnsure.mockReset().mockResolvedValue(null);
    mockUnsubscribe.mockReset();
    mockSubscribe.mockReset().mockImplementation((fn: OutboxListener) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
        mockUnsubscribe();
      };
    });
  });

  it('(+) returns initial coreOutbox.sync() summary synchronously and refreshes after coreOutbox.ensure() resolves', async () => {
    const initialSummary: OutboxSummary = {
      pending: 1,
      dead: 0,
      conflict: 0,
      authBlocked: false,
    };
    const hydratedSummary: OutboxSummary = {
      pending: 3,
      dead: 1,
      conflict: 0,
      authBlocked: false,
    };

    let resolveEnsure!: (state: OutboxState | null) => void;
    const ensurePromise = new Promise<OutboxState | null>((resolve) => {
      resolveEnsure = resolve;
    });

    mockSync.mockReturnValueOnce(initialSummary).mockReturnValue(hydratedSummary);
    mockEnsure.mockReturnValueOnce(ensurePromise);

    const { result } = renderHook(() => useCoreOutboxSync());

    expect(result.current).toEqual(initialSummary);
    expect(mockEnsure).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveEnsure(null);
      await ensurePromise;
    });

    expect(result.current).toEqual(hydratedSummary);
  });

  it('(+) updates summary when subscriber receives a new OutboxState and resets to zeros on null', async () => {
    const { result } = renderHook(() => useCoreOutboxSync());

    await act(async () => {
      await Promise.resolve();
    });

    let box = emptyOutbox('u-1');
    const enq1 = enqueue(
      box,
      { operationId: 'op-pending', entity: 'note', entityId: 'n-1', kind: 'create', payload: { title: 'A' } },
      'u-1',
      1_000,
    );
    if (!enq1.ok) throw new Error('enqueue 1 failed');
    box = enq1.state;

    const enq2 = enqueue(
      box,
      { operationId: 'op-conflict', entity: 'journal_entry', entityId: '2026-11-24', kind: 'update', payload: { content: 'B' } },
      'u-1',
      1_001,
    );
    if (!enq2.ok) throw new Error('enqueue 2 failed');
    box = settle(enq2.state, 'op-conflict', { kind: 'conflict', error: 'Çakışma' }, 1_002);

    const enq3 = enqueue(
      box,
      { operationId: 'op-dead', entity: 'goal', entityId: 'g-1', kind: 'create', payload: { title: 'C' } },
      'u-1',
      1_003,
    );
    if (!enq3.ok) throw new Error('enqueue 3 failed');
    box = enq3.state;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      box = settle(box, 'op-dead', { kind: 'rejected', error: 'Reddedildi' }, 2_000 + i);
    }
    box = settle(box, 'op-pending', { kind: 'auth' }, 3_000);

    act(() => {
      for (const fn of listeners) fn(box);
    });

    expect(result.current).toEqual({
      pending: 1,
      dead: 1,
      conflict: 1,
      authBlocked: true,
    });

    act(() => {
      for (const fn of listeners) fn(null);
    });

    expect(result.current).toEqual({
      pending: 0,
      dead: 0,
      conflict: 0,
      authBlocked: false,
    });
  });

  it('(+) unsubscribes from coreOutbox on unmount', async () => {
    const { unmount } = renderHook(() => useCoreOutboxSync());

    await act(async () => {
      await Promise.resolve();
    });

    expect(listeners.size).toBe(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
