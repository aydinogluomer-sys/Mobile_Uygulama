import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: null })),
}));

jest.mock('../../store/habitStore', () => {
  const state = { habits: [], fetchHabits: jest.fn(), addHabit: jest.fn() };
  const useHabitStore = (sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state;
  useHabitStore.getState = () => state;
  return { useHabitStore };
});

jest.mock('../../store/taskStore', () => {
  const state = { tasks: [] };
  const useTaskStore = (sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state;
  useTaskStore.getState = () => state;
  return { useTaskStore };
});

jest.mock('../../store/focusStore', () => {
  const state = { sessionsCompleted: 1, status: 'idle', startSmallStep: jest.fn() };
  const useFocusStore = (sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state;
  useFocusStore.getState = () => state;
  return { useFocusStore };
});

import {
  useFocusFlowFeed,
  type UseFocusFlowFeedResult,
} from '../../hooks/useFocusFlowFeed';
import { resetAccountMemory } from '../../lib/accountScope';
import { todayLocal } from '../../lib/date';
import { pickDailySparkItem } from '../../lib/focusFlowCatalog';
import {
  isLowEnergyOn,
  lowEnergyKey,
  useLowEnergyStore,
} from '../../store/lowEnergyStore';

describe('lowEnergyStore & FocusFlow ranking integration (GEM-07)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 1, 19, 0, 0));
    resetAccountMemory('signed_out');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('(+) stamps today when turned on and propagates lowEnergy=true into useFocusFlowFeed ranking', async () => {
    expect(lowEnergyKey('u1')).toBe('aderyth.lowEnergy.v1.u1');
    useLowEnergyStore.getState().set(true, '2026-11-01');
    expect(useLowEnergyStore.getState()).toMatchObject({
      on: true,
      day: '2026-11-01',
    });
    expect(isLowEnergyOn(useLowEnergyStore.getState(), '2026-11-01')).toBe(true);

    const spark = pickDailySparkItem({
      hour: 19,
      overdueCount: 0,
      lowEnergy: true,
      activeHabitCount: 3,
      focusSessionsToday: 1,
    });
    expect(spark.item.id).toBe('video-ali-5min-rule');

    let latest!: UseFocusFlowFeedResult;
    function FeedProbe() {
      latest = useFocusFlowFeed({ initialItemId: null, initialCategory: 'for_you' });
      return null;
    }

    useLowEnergyStore.getState().set(false);
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(React.createElement(FeedProbe));
      await Promise.resolve();
    });
    expect(latest.lowEnergy).toBe(false);
    const baselineFirstId =
      latest.entries[0]?.entryKind === 'item' ? latest.entries[0].item.id : null;

    await act(async () => {
      useLowEnergyStore.getState().set(true, todayLocal());
      await Promise.resolve();
    });

    expect(latest.lowEnergy).toBe(true);
    const firstItem = latest.entries[0];
    expect(firstItem?.entryKind).toBe('item');
    if (firstItem?.entryKind === 'item') {
      expect(['video-ali-5min-rule', 'inflow-task-paralysis']).toContain(
        firstItem.item.id,
      );
      expect(firstItem.item.id).not.toBe(baselineFirstId);
    }

    await act(async () => {
      tree.unmount();
    });
  });

  it('(-) expires automatically on the next calendar day, clears day on set(false), and resets on account boundary', () => {
    useLowEnergyStore.getState().set(true, '2026-11-01');
    expect(isLowEnergyOn(useLowEnergyStore.getState(), '2026-11-02')).toBe(false);

    useLowEnergyStore.getState().set(false);
    expect(useLowEnergyStore.getState()).toMatchObject({ on: false, day: null });
    expect(isLowEnergyOn(useLowEnergyStore.getState(), '2026-11-01')).toBe(false);

    useLowEnergyStore.getState().set(true, '2026-11-01');
    resetAccountMemory('signed_out');
    expect(useLowEnergyStore.getState()).toMatchObject({ on: false, day: null });
  });
});
