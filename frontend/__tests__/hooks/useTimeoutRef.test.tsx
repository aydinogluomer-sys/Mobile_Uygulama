import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useTimeoutRef, type TimeoutRef } from '../../hooks/useTimeoutRef';

describe('useTimeoutRef (PRF-23)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mountProbe(onRef: (ref: TimeoutRef) => void) {
    function Probe({ tick }: { tick: number }) {
      const timer = useTimeoutRef();
      onRef(timer);
      return <>{tick}</>;
    }
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Probe tick={0} />);
    });
    return {
      rerender: (tick: number) =>
        act(() => {
          tree.update(<Probe tick={tick} />);
        }),
      unmount: () =>
        act(() => {
          tree.unmount();
        }),
    };
  }

  it('(+) calls callback after delay, keeps stable ref identity, and cancels prior timer on second set', () => {
    const seenRefs: TimeoutRef[] = [];
    const { rerender, unmount } = mountProbe((r) => seenRefs.push(r));
    rerender(1);
    expect(seenRefs[0]).toBe(seenRefs[1]);

    const first = jest.fn();
    const second = jest.fn();

    act(() => {
      seenRefs[0].set(first, 3200);
    });
    act(() => {
      jest.advanceTimersByTime(1500);
      seenRefs[0].set(second, 3200);
    });

    // At 3200ms total, first would have fired if not cancelled; second still has 1500ms left
    act(() => {
      jest.advanceTimersByTime(1800);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('(+) clear prevents a scheduled callback from firing', () => {
    let ref!: TimeoutRef;
    const { unmount } = mountProbe((r) => {
      ref = r;
    });
    const fn = jest.fn();

    act(() => {
      ref.set(fn, 500);
      ref.clear();
      jest.advanceTimersByTime(1000);
    });

    expect(fn).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    unmount();
  });

  it('(-) unmount cancels pending timer and leaves zero active timers', () => {
    let ref!: TimeoutRef;
    const { unmount } = mountProbe((r) => {
      ref = r;
    });
    const fn = jest.fn();

    act(() => {
      ref.set(fn, 3500);
    });
    expect(jest.getTimerCount()).toBe(1);

    unmount();
    expect(jest.getTimerCount()).toBe(0);

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(fn).not.toHaveBeenCalled();
  });
});
