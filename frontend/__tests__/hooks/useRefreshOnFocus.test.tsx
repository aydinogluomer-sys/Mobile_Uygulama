import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockFocusRegistry: Set<() => void> = new Set();

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require('react') as typeof import('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactActual.useEffect(() => {
        const trigger = () => {
          effect();
        };
        mockFocusRegistry.add(trigger);
        trigger();
        return () => {
          mockFocusRegistry.delete(trigger);
        };
      }, [effect]);
    },
  };
});

import { useRefreshOnFocus, type RefreshOnFocusOptions } from '../../hooks/useRefreshOnFocus';

function refocus() {
  act(() => {
    for (const fn of [...mockFocusRegistry]) fn();
  });
}

function Probe({ refetch, opts }: { refetch: () => void | Promise<void>; opts?: RefreshOnFocusOptions }) {
  useRefreshOnFocus(refetch, opts);
  return null;
}

describe('useRefreshOnFocus', () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];
  let now = 1_000_000;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    mockFocusRegistry.clear();
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    act(() => {
      while (mounted.length > 0) mounted.pop()!.unmount();
    });
    nowSpy.mockRestore();
  });

  function mount(el: React.ReactElement) {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(el);
    });
    mounted.push(r);
    return r;
  }

  it('skips the initial mount focus, skips a refocus at 29s, and refreshes at 31s', () => {
    const refetch = jest.fn();
    mount(<Probe refetch={refetch} />);
    expect(refetch).not.toHaveBeenCalled();

    now += 29_000;
    refocus();
    expect(refetch).not.toHaveBeenCalled();

    now += 2_000; // 31s since mount
    refocus();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('calls the latest refetch closure when props update between renders', () => {
    const first = jest.fn();
    const second = jest.fn();
    const r = mount(<Probe refetch={first} />);

    act(() => {
      r.update(<Probe refetch={second} />);
    });

    now += 31_000;
    refocus();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected promise from refetch without crashing', async () => {
    const failing = jest.fn(() => Promise.reject(new Error('offline')));
    mount(<Probe refetch={failing} />);

    now += 31_000;
    expect(() => refocus()).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('runs on initial focus when skipFirstFocus is false, and honours custom minIntervalMs', () => {
    const refetch = jest.fn();
    mount(<Probe refetch={refetch} opts={{ skipFirstFocus: false, minIntervalMs: 5_000 }} />);
    expect(refetch).toHaveBeenCalledTimes(1);

    now += 4_000;
    refocus();
    expect(refetch).toHaveBeenCalledTimes(1);

    now += 2_000; // 6s since initial run
    refocus();
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
