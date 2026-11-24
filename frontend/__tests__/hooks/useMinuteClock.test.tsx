import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useMinuteClock } from '../../hooks/useMinuteClock';

describe('useMinuteClock', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null = null;
  let removeSubscription: jest.Mock<void, []>;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    jest.setSystemTime(new Date('2026-11-24T10:15:20.000Z'));
    appStateListener = null;
    removeSubscription = jest.fn<void, []>();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateListener = handler as (state: AppStateStatus) => void;
      return { remove: removeSubscription } as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('(-) schedules no timeout or AppState listener when active=false', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const { result } = renderHook(() => useMinuteClock(false));
    const initial = result.current;

    expect(initial.toISOString()).toBe('2026-11-24T10:15:20.000Z');
    expect(AppState.addEventListener).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(5 * 60_000);
    });

    expect(result.current).toBe(initial);
  });

  it('(+) preserves Date reference within the same minute and updates across minute boundaries via chained timeouts', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useMinuteClock(active),
      { initialProps: { active: false } },
    );
    const initial = result.current;

    // Move 25s forward within the SAME minute (10:15:20 -> 10:15:45) and activate
    jest.setSystemTime(new Date('2026-11-24T10:15:45.000Z'));
    rerender({ active: true });

    // Same minute floor -> reference is preserved; timeout scheduled for 15_050ms (to 10:16:00.050Z)
    expect(result.current).toBe(initial);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 15_050);

    // 1ms before scheduled boundary -> still unchanged
    act(() => {
      jest.advanceTimersByTime(15_049);
    });
    expect(result.current).toBe(initial);

    // Cross boundary -> updates Date to 10:16:00.050Z and schedules next 60_000ms timeout
    act(() => {
      jest.advanceTimersByTime(1);
    });
    const firstTick = result.current;
    expect(firstTick).not.toBe(initial);
    expect(firstTick.toISOString()).toBe('2026-11-24T10:16:00.050Z');
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 60_000);

    // Next full minute -> updates to 10:17:00.050Z
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe('2026-11-24T10:17:00.050Z');
  });

  it('(+) refreshes immediately when AppState emits "active" and ignores background transitions', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const { result } = renderHook(() => useMinuteClock(true));
    const initial = result.current;

    expect(appStateListener).not.toBeNull();

    // Background transition after wall-clock jump does not update state
    jest.setSystemTime(new Date('2026-11-24T10:42:10.000Z'));
    act(() => {
      appStateListener?.('background');
    });
    expect(result.current).toBe(initial);

    // Returning to active refreshes immediately and reschedules timer
    act(() => {
      appStateListener?.('active');
    });
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(result.current.toISOString()).toBe('2026-11-24T10:42:10.000Z');
  });

  it('(+) clears pending timeout and removes AppState listener on unmount', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const { unmount } = renderHook(() => useMinuteClock(true));

    expect(removeSubscription).not.toHaveBeenCalled();

    unmount();

    expect(removeSubscription).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
