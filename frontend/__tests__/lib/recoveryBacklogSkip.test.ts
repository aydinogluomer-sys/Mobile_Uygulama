/**
 * F13 — Recovery backlog skip exclusion and progressive 7-item cap (DOM-08, DOM-16).
 */
import type { Habit } from '../../lib/supabase';
import { addDaysLocal, parseLocalDate, ymd } from '../../lib/date';
import {
  BACKLOG_PAGE_SIZE,
  capBacklog,
  consecutiveMissedDue,
  recoveryBacklog,
  type BacklogEntry,
} from '../../lib/recoveryBacklog';

function makeHabit(id = 'rb1', over: Partial<Habit> = {}): Habit {
  return {
    id,
    user_id: 'u1',
    name: `Habit ${id}`,
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    willpower_cost: 3,
    status: 'active',
    impact_level: null,
    urgency: null,
    difficulty: 3,
    estimated_minutes: 15,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-07-01T08:00:00',
    ...over,
  } as Habit;
}

describe('F13 DOM-08 — skippedSet is excluded from recoveryBacklog and transparent in consecutiveMissedDue', () => {
  const today = parseLocalDate('2026-08-10')!; // yesterday = 08-09
  const h = makeHabit('rb1');

  it('a scheduled day in skippedSet does NOT enter recoveryBacklog, whereas an explicit miss does', () => {
    const skipped = new Set(['rb1|2026-08-09', 'rb1|2026-08-08']);
    const entriesWithSkip = recoveryBacklog({
      habits: [h],
      today,
      doneSet: new Set(),
      partialSet: new Set(),
      missedSet: new Set(),
      skippedSet: skipped,
      lookback: 2,
    });
    expect(entriesWithSkip).toEqual([]);

    // NEGATIVE: same days in missedSet instead of skippedSet DO enter the backlog
    const entriesWithMiss = recoveryBacklog({
      habits: [h],
      today,
      doneSet: new Set(),
      partialSet: new Set(),
      missedSet: new Set(['rb1|2026-08-09', 'rb1|2026-08-08']),
      skippedSet: new Set(),
      lookback: 2,
    });
    expect(entriesWithMiss).toHaveLength(2);
  });

  it('consecutiveMissedDue returns 0 for two consecutive skips + done before, and 2 for [unlogged, skip, skip, unlogged]', () => {
    // 08-09 skip, 08-08 skip, 08-07 done -> 0 consecutive missed
    const twoSkips = consecutiveMissedDue(h, {
      today,
      doneSet: new Set(['rb1|2026-08-07']),
      partialSet: new Set(),
      skippedSet: new Set(['rb1|2026-08-09', 'rb1|2026-08-08']),
      lookback: 5,
    });
    expect(twoSkips).toBe(0);

    // 08-09 unlogged (1), 08-08 skip (transparent), 08-07 skip (transparent), 08-06 unlogged (2), 08-05 done (stops)
    const bridged = consecutiveMissedDue(h, {
      today,
      doneSet: new Set(['rb1|2026-08-05']),
      partialSet: new Set(),
      skippedSet: new Set(['rb1|2026-08-08', 'rb1|2026-08-07']),
      lookback: 6,
    });
    expect(bridged).toBe(2);
  });
});

describe('F13 DOM-16 — capBacklog limits visible backlog entries progressively by 7', () => {
  const h = makeHabit('cap');
  const entries112: BacklogEntry[] = Array.from({ length: 112 }, (_, i) => ({
    habit: h,
    date: ymd(addDaysLocal(parseLocalDate('2026-10-31')!, -i)),
    kind: 'missed',
  }));

  it('BACKLOG_PAGE_SIZE is 7; 112 entries -> 7 shown + 105 hidden, then 14 shown + 98 hidden; 3 entries -> 0 hidden', () => {
    expect(BACKLOG_PAGE_SIZE).toBe(7);

    const p1 = capBacklog(entries112);
    expect(p1.shown).toHaveLength(7);
    expect(p1.hidden).toBe(105);
    expect(p1.shown[0].date).toBe('2026-10-31');

    const p2 = capBacklog(entries112, 14);
    expect(p2.shown).toHaveLength(14);
    expect(p2.hidden).toBe(98);

    const small = capBacklog(entries112.slice(0, 3), 7);
    expect(small.shown).toHaveLength(3);
    expect(small.hidden).toBe(0);
  });

  it('NEGATIVE / edge — empty list and visible <= 0 never produce negative hidden counts', () => {
    expect(capBacklog([], 7)).toEqual({ shown: [], hidden: 0 });
    expect(capBacklog(entries112.slice(0, 5), 0)).toEqual({ shown: [], hidden: 5 });
    expect(capBacklog(entries112.slice(0, 5), -3)).toEqual({ shown: [], hidden: 5 });
  });
});
