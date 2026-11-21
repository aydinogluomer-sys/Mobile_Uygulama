import React from 'react';
import { TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockListBadHabits = jest.fn();
jest.mock('../../services/badHabitService', () => ({
  listBadHabits: (...args: unknown[]) => mockListBadHabits(...args),
  createBadHabit: jest.fn(),
  savingsFor: jest.fn(() => ({ daysSinceQuit: 5, moneySaved: 100, timeSavedHours: 2 })),
}));

const mockHaptic = {
  success: jest.fn(() => {
    if (mockHaptic.success.mock.calls.length > 25) {
      throw new Error('GAP1-01 runaway urge counter loop (>25 ticks at 0s)');
    }
  }),
  medium: jest.fn(),
  light: jest.fn(),
  select: jest.fn(),
  warning: jest.fn(),
};
jest.mock('../../lib/haptics', () => ({
  haptic: {
    success: (...args: unknown[]) => mockHaptic.success(...args),
    medium: (...args: unknown[]) => mockHaptic.medium(...args),
    light: (...args: unknown[]) => mockHaptic.light(...args),
    select: (...args: unknown[]) => mockHaptic.select(...args),
    warning: (...args: unknown[]) => mockHaptic.warning(...args),
  },
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'u1@aderyth.app' })),
}));

import BadHabitsTracker, { urgeStorageKey } from '../../components/BadHabitsTracker';

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

describe('badHabitsUrgeShield — GAP1-01 single-count at 0s without runaway loop', () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockListBadHabits.mockResolvedValue({ ok: true, data: { rows: [], nextCursor: null, hasMore: false } });
  });

  afterEach(async () => {
    await act(async () => {
      while (mounted.length > 0) mounted.pop()!.unmount();
    });
    jest.useRealTimers();
  });

  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function advanceSeconds(seconds: number) {
    for (let i = 0; i < seconds; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    await flushMicrotasks();
  }

  it('counts exactly +1 at 60s, stays motionless for 10 extra seconds at 0, and counts +1 again on a second full session', async () => {
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<BadHabitsTracker visible={true} onClose={jest.fn()} />);
    });
    mounted.push(r);
    await flushMicrotasks();

    const openBtn = r.root
      .findAllByType(TouchableOpacity)
      .find((b) => String(b.props.accessibilityLabel ?? '').includes('60 saniye dürtü kalkanını başlat'))!;

    await act(async () => {
      openBtn.props.onPress();
    });

    await advanceSeconds(60);

    expect(mockHaptic.success).toHaveBeenCalledTimes(1);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(setItemSpy).toHaveBeenCalledWith(urgeStorageKey('u1'), '1');
    expect(textOf(r)).toContain('Toplam 1 kez');

    // Waiting 10 more seconds at 0 must NOT re-trigger the counter, haptic, or storage write
    await advanceSeconds(10);
    expect(mockHaptic.success).toHaveBeenCalledTimes(1);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(textOf(r)).toContain('Toplam 1 kez');

    // Close and reopen for a second full 60s wait -> +1 more (total 2)
    const closeBtn = r.root.findAllByType(TouchableOpacity).find((b) => b.props.accessibilityLabel === 'Kalkanı kapat')!;
    await act(async () => {
      closeBtn.props.onPress();
    });
    await act(async () => {
      openBtn.props.onPress();
    });
    await advanceSeconds(60);

    expect(mockHaptic.success).toHaveBeenCalledTimes(2);
    expect(setItemSpy).toHaveBeenLastCalledWith(urgeStorageKey('u1'), '2');
    expect(textOf(r)).toContain('Toplam 2 kez');
    setItemSpy.mockRestore();
  });

  it('does NOT increment the counter if closed at 59 seconds (negative case)', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<BadHabitsTracker visible={true} onClose={jest.fn()} />);
    });
    mounted.push(r);
    await flushMicrotasks();

    const openBtn = r.root
      .findAllByType(TouchableOpacity)
      .find((b) => String(b.props.accessibilityLabel ?? '').includes('60 saniye dürtü kalkanını başlat'))!;
    await act(async () => {
      openBtn.props.onPress();
    });

    await advanceSeconds(59);
    const closeBtn = r.root.findAllByType(TouchableOpacity).find((b) => b.props.accessibilityLabel === 'Kalkanı kapat')!;
    await act(async () => {
      closeBtn.props.onPress();
    });
    await advanceSeconds(5);

    expect(mockHaptic.success).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(urgeStorageKey('u1'))).toBeNull();
    expect(textOf(r)).not.toContain('dürtü savuşturuldu');
  });
});
