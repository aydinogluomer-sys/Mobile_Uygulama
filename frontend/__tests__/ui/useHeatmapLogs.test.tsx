import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockHeatmapLogs = jest.fn();

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactActual.useEffect(effect, [effect]);
    },
  };
});

jest.mock('../../services/habitService', () => ({
  heatmapLogs: (...args: unknown[]) => mockHeatmapLogs(...args),
}));

import { useHeatmapLogs, type UseHeatmapLogs } from '../../hooks/useHeatmapLogs';

function Harness({
  weeks,
  asOf,
  onState,
}: {
  weeks?: number;
  asOf?: Date;
  onState: (s: UseHeatmapLogs) => void;
}) {
  const state = useHeatmapLogs({ weeks, asOf });
  onState(state);
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('hooks/useHeatmapLogs (F31 PRF-02)', () => {
  it('(+) transitions loading -> ready, computes since from asOf/weeks, and keeps only done|partial rows', async () => {
    let latest!: UseHeatmapLogs;
    mockHeatmapLogs.mockResolvedValueOnce({
      ok: true,
      data: [
        { completed_at: '2026-08-10', state: 'done' },
        { completed_at: '2026-08-11', state: 'partial' },
        { completed_at: '2026-08-12', state: 'miss' },
        { completed_at: '2026-08-13', state: 'skip' },
      ],
    });

    const asOf = new Date(2026, 7, 19); // 2026-08-19 local
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <Harness weeks={4} asOf={asOf} onState={(s) => { latest = s; }} />,
      );
    });
    expect(latest.status).toBe('loading');

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockHeatmapLogs).toHaveBeenCalledWith({ since: '2026-07-22' });
    expect(latest.status).toBe('ready');
    expect(latest.error).toBeNull();
    expect(latest.rows).toEqual([
      { completed_at: '2026-08-10', state: 'done' },
      { completed_at: '2026-08-11', state: 'partial' },
    ]);
    act(() => {
      r.unmount();
    });
  });

  it('(-) surfaces error state and recovers via reload()', async () => {
    let latest!: UseHeatmapLogs;
    mockHeatmapLogs
      .mockResolvedValueOnce({ ok: false, error: 'bağlantı hatası' })
      .mockResolvedValueOnce({
        ok: true,
        data: [{ completed_at: '2026-08-19', state: 'done' }],
      });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<Harness onState={(s) => { latest = s; }} />);
    });

    expect(latest.status).toBe('error');
    expect(latest.error).toBe('bağlantı hatası');

    await act(async () => {
      latest.reload();
    });

    expect(latest.status).toBe('ready');
    expect(latest.rows).toEqual([{ completed_at: '2026-08-19', state: 'done' }]);
    act(() => {
      r.unmount();
    });
  });

  it('(-) race guard: stale earlier request never overwrites newer response, and unmount writes no state', async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    mockHeatmapLogs.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const states: UseHeatmapLogs[] = [];
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Harness onState={(s) => states.push(s)} />);
    });

    // Trigger second overlapping request before first resolves
    act(() => {
      states[states.length - 1].reload();
    });
    expect(resolvers).toHaveLength(2);

    // Resolve SECOND (newer) request first
    await act(async () => {
      resolvers[1]({ ok: true, data: [{ completed_at: '2026-08-19', state: 'done' }] });
    });
    expect(states[states.length - 1].rows).toEqual([{ completed_at: '2026-08-19', state: 'done' }]);

    // Resolve FIRST (stale) request afterwards -> must NOT overwrite!
    await act(async () => {
      resolvers[0]({ ok: true, data: [{ completed_at: '2026-01-01', state: 'partial' }] });
    });
    expect(states[states.length - 1].rows).toEqual([{ completed_at: '2026-08-19', state: 'done' }]);

    // Unmount while a third request is in flight -> no post-unmount state update
    act(() => {
      states[states.length - 1].reload();
    });
    const countBeforeUnmount = states.length;
    act(() => {
      r.unmount();
    });
    await act(async () => {
      resolvers[2]({ ok: true, data: [] });
    });
    expect(states.length).toBe(countBeforeUnmount);
  });
});
