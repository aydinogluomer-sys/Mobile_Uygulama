import {
  FOCUS_FLOW_ITEMS,
  buildFeedEntries,
  findAtomicHabitById,
  pickDailySparkItem,
  rankFocusFlowForUser,
} from '../../lib/focusFlowCatalog';

describe('focusFlowCatalog', () => {
  it('contains a zero-noise hybrid catalog of verified videos and Inflow interactive micro-lessons', () => {
    expect(FOCUS_FLOW_ITEMS.length).toBeGreaterThanOrEqual(12);
    const videos = FOCUS_FLOW_ITEMS.filter((i) => i.kind === 'video');
    const interactive = FOCUS_FLOW_ITEMS.filter((i) => i.kind === 'inflow_interactive');
    expect(videos.length).toBeGreaterThanOrEqual(6);
    expect(interactive.length).toBeGreaterThanOrEqual(5);

    for (const item of FOCUS_FLOW_ITEMS) {
      expect(item.keyTakeaways.length).toBeGreaterThanOrEqual(3);
      expect(item.kineticSlides.length).toBeGreaterThanOrEqual(3);
      if (item.kind === 'video') {
        expect(item.videoSource?.videoId).toMatch(/^[a-zA-Z0-9_-]{11}$/);
      }
      if (item.cta.actionType === 'add_atomic_habit') {
        expect(findAtomicHabitById(item.cta.atomicHabitId)).toBeDefined();
      }
    }
  });

  it('picks a state-aware Daily Spark hook based on overdue tasks, low energy, or time of day', () => {
    const overdueSpark = pickDailySparkItem({
      hour: 14,
      overdueCount: 3,
      lowEnergy: false,
      activeHabitCount: 4,
      focusSessionsToday: 1,
    });
    expect(overdueSpark.item.id).toBe('inflow-task-paralysis');

    const morningSpark = pickDailySparkItem({
      hour: 8,
      overdueCount: 0,
      lowEnergy: false,
      activeHabitCount: 2,
      focusSessionsToday: 0,
    });
    expect(morningSpark.item.id).toBe('video-huberman-sunlight');

    const nightSpark = pickDailySparkItem({
      hour: 22,
      overdueCount: 0,
      lowEnergy: false,
      activeHabitCount: 2,
      focusSessionsToday: 2,
    });
    expect(nightSpark.item.id).toBe('inflow-evening-zeigarnik');
  });

  it('pins startItemId first in rankFocusFlowForUser', () => {
    const ranked = rankFocusFlowForUser({
      hour: 15,
      overdueCount: 0,
      lowEnergy: false,
      activeHabitCount: 3,
      focusSessionsToday: 1,
      startItemId: 'video-james-clear-2min',
    });
    expect(ranked[0]?.id).toBe('video-james-clear-2min');
    expect(ranked.length).toBe(FOCUS_FLOW_ITEMS.length);
  });

  it('inserts an Anti-Doomscroll checkpoint after every 5 items', () => {
    const entries = buildFeedEntries(FOCUS_FLOW_ITEMS, 5);
    expect(entries[5]?.entryKind).toBe('checkpoint');
    if (entries[5]?.entryKind === 'checkpoint') {
      expect(entries[5].watchedCount).toBe(5);
    }
    expect(entries[11]?.entryKind).toBe('checkpoint');
    if (entries[11]?.entryKind === 'checkpoint') {
      expect(entries[11].watchedCount).toBe(10);
    }
  });
});

