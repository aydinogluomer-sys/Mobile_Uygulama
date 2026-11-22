import React from 'react';
import { AccessibilityInfo, AppState, Text, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { resetReducedMotionForTests, useReducedMotion } from '../../components/seasonalMotion/useReducedMotion';

function Probe({ id }: { id: string }) {
  const reduced = useReducedMotion();
  return <Text>{`${id}:${String(reduced)}`}</Text>;
}

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    walk((n as { children?: unknown }).children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

describe('F25 (DSA-11, PRF-21) — shared useReducedMotion external store', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    resetReducedMotionForTests();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('(+) shares a single listener across multiple subscribers, defaults unknown state to true, updates on reduceMotionChanged, and refreshes on AppState active', async () => {
    process.env.NODE_ENV = 'production';
    resetReducedMotionForTests();

    let resolveInitial!: (v: boolean) => void;
    const isReduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementationOnce(() => new Promise<boolean>((res) => { resolveInitial = res; }))
      .mockImplementation(async () => true);

    let motionHandler: ((v: boolean) => void) | null = null;
    const motionRemove = jest.fn();
    const addA11ySpy = jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockImplementation((_event, handler) => {
        motionHandler = handler as unknown as (v: boolean) => void;
        return { remove: motionRemove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
      });

    let appHandler: ((s: AppStateStatus) => void) | null = null;
    const appRemove = jest.fn();
    const addAppSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, handler) => {
        appHandler = handler as unknown as (s: AppStateStatus) => void;
        return { remove: appRemove } as unknown as ReturnType<typeof AppState.addEventListener>;
      });

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <>
          <Probe id="A" />
          <Probe id="B" />
        </>,
      );
    });

    // Single subscription despite 2 mounted consumers
    expect(addA11ySpy).toHaveBeenCalledTimes(1);
    expect(addAppSpy).toHaveBeenCalledTimes(1);
    // Unknown (unresolved promise) defaults to reduced=true (DSA-11: no flash of motion)
    expect(textOf(r)).toBe('A:true B:true');

    // Initial promise resolves to false -> both subscribers update
    await act(async () => {
      resolveInitial(false);
      await Promise.resolve();
    });
    expect(textOf(r)).toBe('A:false B:false');

    // OS event flips to true -> both subscribers update
    act(() => {
      motionHandler?.(true);
    });
    expect(textOf(r)).toBe('A:true B:true');

    // OS event flips back to false, then AppState 'active' re-queries (mock returns true)
    act(() => {
      motionHandler?.(false);
    });
    expect(textOf(r)).toBe('A:false B:false');

    const callsBeforeActive = isReduceMotionSpy.mock.calls.length;
    await act(async () => {
      appHandler?.('active');
      await Promise.resolve();
    });
    expect(isReduceMotionSpy.mock.calls.length).toBe(callsBeforeActive + 1);
    expect(textOf(r)).toBe('A:true B:true');

    // Unmounting all consumers removes subscriptions
    act(() => {
      r.unmount();
    });
    expect(motionRemove).toHaveBeenCalledTimes(1);
    expect(appRemove).toHaveBeenCalledTimes(1);
  });

  it('(+) initial render is true when isReduceMotionEnabled resolves true immediately', async () => {
    process.env.NODE_ENV = 'production';
    resetReducedMotionForTests();

    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: jest.fn(),
    } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({
      remove: jest.fn(),
    } as unknown as ReturnType<typeof AppState.addEventListener>);

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<Probe id="only" />);
      await Promise.resolve();
    });
    expect(textOf(r)).toBe('only:true');
    act(() => {
      r.unmount();
    });
  });

  it('(-) in NODE_ENV === "test", no native listeners are registered and reduced motion stays true', () => {
    process.env.NODE_ENV = 'test';
    resetReducedMotionForTests();

    const addA11ySpy = jest.spyOn(AccessibilityInfo, 'addEventListener');
    const addAppSpy = jest.spyOn(AppState, 'addEventListener');

    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Probe id="test" />);
    });
    expect(textOf(r)).toBe('test:true');
    expect(addA11ySpy).not.toHaveBeenCalled();
    expect(addAppSpy).not.toHaveBeenCalled();
    act(() => {
      r.unmount();
    });
  });
});
