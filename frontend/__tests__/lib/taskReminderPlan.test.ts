/**
 * F36 — Saf, saat dilimi-bağımsız `lib/taskReminderPlan.ts` ve `lib/notificationActions.ts`
 * birim testleri. Tüm 4 IANA bölgesinde deterministiktir.
 */
import {
  FOLLOW_UP_GAPS_MIN,
  FOLLOW_UP_SPAN_MIN,
  MAX_FOLLOW_UPS,
  MAX_STOPPED,
  followUpOffsetsMin,
  followUpStopKey,
  pruneStopped,
  rememberStopped,
} from '../../lib/notificationActions';
import type { BlockTask } from '../../lib/nextBlock';
import {
  DEFAULT_TIME_SUPPORT_SETTINGS,
  TIME_SUPPORT_COPY,
  TIME_SUPPORT_KIND,
  classifyTimeSupport,
  normaliseTimeSupport,
  planEveningClose,
  planFollowUps,
  planTaskReminders,
  reconcileTimeSupport,
  titleToken,
} from '../../lib/taskReminderPlan';

const BASE_SETTINGS = {
  quietStart: null as string | null,
  quietEnd: null as string | null,
  hideTitles: false,
};

const NIGHT_QUIET = {
  quietStart: '22:00',
  quietEnd: '07:00',
  hideTitles: false,
};

const makeTask = (over: Partial<BlockTask> = {}): BlockTask => ({
  id: 't1',
  title: 'Sunum hazırla',
  due_date: '2026-10-05',
  time_block_start: '15:00',
  time_block_end: null,
  completed: false,
  status: 'pending',
  priority: 'medium',
  ...over,
});

describe('F36 taskReminderPlan — defaults & normaliseTimeSupport', () => {
  it('(+) ships all three time-support features OFF by default (M8 guard)', () => {
    expect(DEFAULT_TIME_SUPPORT_SETTINGS).toEqual({
      taskLeadMin: 0,
      eveningClose: false,
      eveningTime: '21:00',
      followUp: false,
    });
  });

  it('(+) preserves valid choices and falls back cleanly on malformed inputs', () => {
    expect(
      normaliseTimeSupport({
        taskLeadMin: 30,
        eveningClose: true,
        eveningTime: '20:00',
        followUp: true,
      }),
    ).toEqual({
      taskLeadMin: 30,
      eveningClose: true,
      eveningTime: '20:00',
      followUp: true,
    });

    expect(normaliseTimeSupport(null)).toEqual(DEFAULT_TIME_SUPPORT_SETTINGS);
    expect(normaliseTimeSupport('x')).toEqual(DEFAULT_TIME_SUPPORT_SETTINGS);
    expect(normaliseTimeSupport([])).toEqual(DEFAULT_TIME_SUPPORT_SETTINGS);
    expect(normaliseTimeSupport({ taskLeadMin: 15 })).toMatchObject({ taskLeadMin: 0 });
    expect(normaliseTimeSupport({ eveningTime: '18:00' })).toMatchObject({ eveningTime: '21:00' });
    expect(normaliseTimeSupport({ followUp: 'yes', eveningClose: 1 })).toMatchObject({
      followUp: false,
      eveningClose: false,
    });
  });
});

describe('F36 taskReminderPlan — planTaskReminders', () => {
  const now = new Date(2026, 9, 5, 10, 0, 0, 0);

  it('(-) plans nothing when taskLeadMin is 0 or tasks are past/completed/cancelled/untimed', () => {
    expect(
      planTaskReminders({
        tasks: [makeTask()],
        settings: BASE_SETTINGS,
        support: { taskLeadMin: 0 },
        now,
      }),
    ).toEqual({ reminders: [], quieted: 0, dropped: 0 });

    const filtered = planTaskReminders({
      tasks: [
        makeTask({ id: 'past', time_block_start: '10:05' }), // 10:05 - 10m = 09:55 <= 10:00
        makeTask({ id: 'done', completed: true }),
        makeTask({ id: 'canc', status: 'cancelled' }),
        makeTask({ id: 'untimed', time_block_start: null }),
      ],
      settings: BASE_SETTINGS,
      support: { taskLeadMin: 10 },
      now,
    });
    expect(filtered).toEqual({ reminders: [], quieted: 0, dropped: 0 });
  });

  it('(+) schedules leadMin before start, drops quiet-hour hits without deferral (M2), and rotates key on title/hideTitles/instant change', () => {
    const p1 = planTaskReminders({
      tasks: [
        makeTask({ id: 'ok', title: 'Rapor A', time_block_start: '15:00' }),
        makeTask({ id: 'quiet-night', title: 'Gece işi', time_block_start: '22:05' }), // at 21:55 ok if lead 10; with lead 30 -> 21:35; use 22:30 -> 22:20 quiet!
      ],
      settings: NIGHT_QUIET,
      support: { taskLeadMin: 10 },
      now,
    });
    expect(p1.reminders).toHaveLength(2);

    const quietHit = planTaskReminders({
      tasks: [
        makeTask({ id: 'q1', time_block_start: '22:15' }), // 22:05 -> quiet
        makeTask({ id: 'q2', due_date: '2026-10-06', time_block_start: '07:05' }), // 06:55 -> quiet (NOT deferred to 07:00!)
      ],
      settings: NIGHT_QUIET,
      support: { taskLeadMin: 10 },
      now,
    });
    expect(quietHit.reminders).toEqual([]);
    expect(quietHit.quieted).toBe(2);

    // Title & hideTitles & instant key sensitivity
    const rA = planTaskReminders({
      tasks: [makeTask({ id: 't1', title: 'İlk Başlık', time_block_start: '15:00' })],
      settings: BASE_SETTINGS,
      support: { taskLeadMin: 10 },
      now,
    }).reminders[0];
    const rB = planTaskReminders({
      tasks: [makeTask({ id: 't1', title: 'Yeni Başlık', time_block_start: '15:00' })],
      settings: BASE_SETTINGS,
      support: { taskLeadMin: 10 },
      now,
    }).reminders[0];
    const rHidden = planTaskReminders({
      tasks: [makeTask({ id: 't1', title: 'Yeni Başlık', time_block_start: '15:00' })],
      settings: { ...BASE_SETTINGS, hideTitles: true },
      support: { taskLeadMin: 10 },
      now,
    }).reminders[0];

    expect(rA.at).toEqual(new Date(2026, 9, 5, 14, 50, 0, 0));
    expect(TIME_SUPPORT_COPY.taskBody(rA.leadMin, rA.startLabel)).toBe('10 dk sonra başlıyor (15:00).');
    expect(rA.key).not.toBe(rB.key);
    expect(rHidden.key.endsWith(':x')).toBe(true);
    expect(titleToken('İlk Başlık')).not.toBe(titleToken('Yeni Başlık'));
  });

  it('(+) enforces 3/day and 6 total pending caps and counts dropped', () => {
    const many: BlockTask[] = [
      ...['11:00', '12:00', '13:00', '14:00'].map((tm, i) =>
        makeTask({ id: `d0-${i}`, due_date: '2026-10-05', time_block_start: tm }),
      ),
      ...['11:00', '12:00', '13:00'].map((tm, i) =>
        makeTask({ id: `d1-${i}`, due_date: '2026-10-06', time_block_start: tm }),
      ),
      makeTask({ id: 'd2-0', due_date: '2026-10-07', time_block_start: '11:00' }),
    ];
    const res = planTaskReminders({
      tasks: many,
      settings: BASE_SETTINGS,
      support: { taskLeadMin: 10 },
      now,
    });
    expect(res.reminders).toHaveLength(6);
    expect(res.reminders.filter((r) => r.day === '2026-10-05')).toHaveLength(3);
    expect(res.dropped).toBe(2);
  });
});

describe('F36 taskReminderPlan — planEveningClose', () => {
  it('(+) respects eveningClose off, current time, closedToday (M4), and quiet hours', () => {
    expect(
      planEveningClose({
        settings: BASE_SETTINGS,
        support: { eveningClose: false, eveningTime: '21:00' },
        now: new Date(2026, 9, 5, 20, 0, 0, 0),
        closedToday: false,
      }),
    ).toEqual({ reminders: [], quieted: false });

    const before21 = planEveningClose({
      settings: BASE_SETTINGS,
      support: { eveningClose: true, eveningTime: '21:00' },
      now: new Date(2026, 9, 5, 20, 0, 0, 0),
      closedToday: false,
    });
    expect(before21.quieted).toBe(false);
    expect(before21.reminders.map((r) => r.day)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);

    const after21 = planEveningClose({
      settings: BASE_SETTINGS,
      support: { eveningClose: true, eveningTime: '21:00' },
      now: new Date(2026, 9, 5, 21, 30, 0, 0),
      closedToday: false,
    });
    expect(after21.reminders.map((r) => r.day)).toEqual(['2026-10-06', '2026-10-07']);

    // M4 guard: closedToday skips today ONLY, keeping tomorrow & day+2
    const closed = planEveningClose({
      settings: BASE_SETTINGS,
      support: { eveningClose: true, eveningTime: '21:00' },
      now: new Date(2026, 9, 5, 20, 0, 0, 0),
      closedToday: true,
    });
    expect(closed.reminders.map((r) => r.day)).toEqual(['2026-10-06', '2026-10-07']);

    const inQuiet = planEveningClose({
      settings: { quietStart: '20:00', quietEnd: '07:00' },
      support: { eveningClose: true, eveningTime: '21:00' },
      now: new Date(2026, 9, 5, 18, 0, 0, 0),
      closedToday: false,
    });
    expect(inQuiet).toEqual({ reminders: [], quieted: true });
  });
});

describe('F36 taskReminderPlan — planFollowUps & stopped helpers', () => {
  const primAt = (y: number, m: number, d: number, hh: number, mm: number, id = 'h1') => {
    const at = new Date(y, m, d, hh, mm, 0, 0);
    const day = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return {
      key: `h:${id}:${day}:${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}@${at.getTime()}`,
      habitId: id,
      day,
      at,
    };
  };

  it('(+) schedules at most 2 escalating follow-ups (+10m, +40m) and keeps survivors after primary fires (M3)', () => {
    expect(FOLLOW_UP_GAPS_MIN).toEqual([10, 30]);
    expect(MAX_FOLLOW_UPS).toBe(2);
    expect(FOLLOW_UP_SPAN_MIN).toBe(40);
    expect(followUpOffsetsMin()).toEqual([10, 40]);

    const p0900 = primAt(2026, 9, 5, 9, 0);

    const off = planFollowUps({
      primaries: [p0900],
      settings: BASE_SETTINGS,
      support: { followUp: false },
      now: new Date(2026, 9, 5, 9, 0, 0, 0),
      focus: { active: false, endsAt: null },
      stopped: new Set(),
    });
    expect(off.reminders).toEqual([]);

    const atNine = planFollowUps({
      primaries: [p0900],
      settings: BASE_SETTINGS,
      support: { followUp: true },
      now: new Date(2026, 9, 5, 9, 0, 0, 0),
      focus: { active: false, endsAt: null },
      stopped: new Set(),
    });
    expect(atNine.reminders).toHaveLength(2);
    expect(atNine.reminders.map((r) => [r.n, r.at])).toEqual([
      [1, new Date(2026, 9, 5, 9, 10, 0, 0)],
      [2, new Date(2026, 9, 5, 9, 40, 0, 0)],
    ]);

    const atNineFifteen = planFollowUps({
      primaries: [p0900],
      settings: BASE_SETTINGS,
      support: { followUp: true },
      now: new Date(2026, 9, 5, 9, 15, 0, 0),
      focus: { active: false, endsAt: null },
      stopped: new Set(),
    });
    expect(atNineFifteen.reminders.map((r) => r.n)).toEqual([2]);

    const atNineFortyFive = planFollowUps({
      primaries: [p0900],
      settings: BASE_SETTINGS,
      support: { followUp: true },
      now: new Date(2026, 9, 5, 9, 45, 0, 0),
      focus: { active: false, endsAt: null },
      stopped: new Set(),
    });
    expect(atNineFortyFive.reminders).toEqual([]);
  });

  it('(-) suppresses follow-ups during quiet hours, across midnight, in Focus (+5m grace / paused), when stopped, >24h out, and caps at 6', () => {
    // Quiet hours (21:55 -> +10=22:05, +40=22:35, both inside 22:00-07:00)
    expect(
      planFollowUps({
        primaries: [primAt(2026, 9, 5, 21, 55)],
        settings: NIGHT_QUIET,
        support: { followUp: true },
        now: new Date(2026, 9, 5, 21, 0, 0, 0),
        focus: { active: false, endsAt: null },
        stopped: new Set(),
      }).reminders,
    ).toEqual([]);

    // Midnight boundary (23:50 -> 00:00 and 00:30 next day)
    expect(
      planFollowUps({
        primaries: [primAt(2026, 9, 5, 23, 50)],
        settings: BASE_SETTINGS,
        support: { followUp: true },
        now: new Date(2026, 9, 5, 23, 0, 0, 0),
        focus: { active: false, endsAt: null },
        stopped: new Set(),
      }).reminders,
    ).toEqual([]);

    // Focus running until 09:20 (+5m grace = 09:25): 09:10 dropped, 09:40 kept
    const p0900 = primAt(2026, 9, 5, 9, 0);
    const focusRunning = planFollowUps({
      primaries: [p0900],
      settings: BASE_SETTINGS,
      support: { followUp: true },
      now: new Date(2026, 9, 5, 8, 55, 0, 0),
      focus: { active: true, endsAt: new Date(2026, 9, 5, 9, 20, 0, 0) },
      stopped: new Set(),
    });
    expect(focusRunning.reminders.map((r) => r.n)).toEqual([2]);

    // Focus paused (endsAt: null) -> both dropped
    expect(
      planFollowUps({
        primaries: [p0900],
        settings: BASE_SETTINGS,
        support: { followUp: true },
        now: new Date(2026, 9, 5, 8, 55, 0, 0),
        focus: { active: true, endsAt: null },
        stopped: new Set(),
      }).reminders,
    ).toEqual([]);

    // Stopped (snoozed)
    expect(
      planFollowUps({
        primaries: [p0900],
        settings: BASE_SETTINGS,
        support: { followUp: true },
        now: new Date(2026, 9, 5, 8, 55, 0, 0),
        focus: { active: false, endsAt: null },
        stopped: new Set([followUpStopKey('h1', '2026-10-05')]),
      }).reminders,
    ).toEqual([]);

    // >24h away primary skipped
    expect(
      planFollowUps({
        primaries: [primAt(2026, 9, 7, 10, 0)],
        settings: BASE_SETTINGS,
        support: { followUp: true },
        now: new Date(2026, 9, 5, 9, 0, 0, 0),
        focus: { active: false, endsAt: null },
        stopped: new Set(),
      }).reminders,
    ).toEqual([]);

    // Cap at 6 pending follow-ups across 4 primaries (8 candidates -> 6 kept, 2 dropped)
    const four = ['a', 'b', 'c', 'd'].map((id, i) => primAt(2026, 9, 5, 9 + i, 0, id));
    const capped = planFollowUps({
      primaries: four,
      settings: BASE_SETTINGS,
      support: { followUp: true },
      now: new Date(2026, 9, 5, 8, 0, 0, 0),
      focus: { active: false, endsAt: null },
      stopped: new Set(),
    });
    expect(capped.reminders).toHaveLength(6);
    expect(capped.dropped).toBe(2);

    // rememberStopped + pruneStopped
    let list: string[] = [];
    for (let i = 0; i < MAX_STOPPED + 5; i += 1) {
      list = rememberStopped(list, `h${i}|2026-10-05`);
    }
    expect(list).toHaveLength(MAX_STOPPED);
    expect(
      pruneStopped(
        ['h1|2026-10-05', 'h2|2026-10-03', 'h3|2026-10-02', 'broken', '|2026-10-05', 'h4|bad'],
        '2026-10-05',
      ),
    ).toEqual(['h1|2026-10-05', 'h2|2026-10-03']);
  });
});

describe('F36 taskReminderPlan — classifyTimeSupport & reconcileTimeSupport (M6)', () => {
  it('(+) classifies only F36 kinds with non-empty keys and NEVER cancels habit/snooze/recovery/reentry/foreign notifications', () => {
    expect(classifyTimeSupport({ kind: TIME_SUPPORT_KIND.task, key: 't:1' })).toEqual({ kind: 'task', key: 't:1' });
    expect(classifyTimeSupport({ kind: TIME_SUPPORT_KIND.evening, key: 'e:1' })).toEqual({ kind: 'evening', key: 'e:1' });
    expect(classifyTimeSupport({ kind: TIME_SUPPORT_KIND.followUp, key: 'f:1' })).toEqual({ kind: 'followUp', key: 'f:1' });

    for (const nonF36 of [
      { kind: 'habit', key: 'h:h1:2026-10-05:08:00@1000' },
      { kind: 'snooze', habitId: 'h1', day: '2026-10-05' },
      { kind: 'reentry' },
      { kind: 'focus-end' },
      { recoveryId: 'rec-1' },
      { habitId: 'legacy' },
      { kind: TIME_SUPPORT_KIND.task, key: '' },
      {},
      null,
      undefined,
    ]) {
      expect(classifyTimeSupport(nonF36 as Record<string, unknown> | null | undefined)).toBeNull();
    }

    const wantedEvening = planEveningClose({
      settings: BASE_SETTINGS,
      support: { eveningClose: true, eveningTime: '21:00' },
      now: new Date(2026, 9, 5, 20, 0, 0, 0),
      closedToday: false,
    }).reminders;

    const scheduled = [
      { identifier: 'keep-ev', data: { kind: TIME_SUPPORT_KIND.evening, key: wantedEvening[0].key } },
      { identifier: 'dup-ev', data: { kind: TIME_SUPPORT_KIND.evening, key: wantedEvening[0].key } },
      { identifier: 'stale-task', data: { kind: TIME_SUPPORT_KIND.task, key: 't:old:1:10:abc' } },
      { identifier: 'habit-1', data: { kind: 'habit', key: 'h:h1:2026-10-05:08:00@1000' } },
      { identifier: 'snooze-1', data: { kind: 'snooze', habitId: 'h1', day: '2026-10-05' } },
      { identifier: 'reentry-1', data: { kind: 'reentry' } },
      { identifier: 'recovery-1', data: { recoveryId: 'r1' } },
      { identifier: 'legacy-1', data: { habitId: 'h1' } },
      { identifier: 'null-1', data: null },
    ];

    const diff = reconcileTimeSupport(scheduled, [wantedEvening[0], wantedEvening[1]]);
    expect(diff.cancel.sort()).toEqual(['dup-ev', 'stale-task']);
    expect(diff.add.map((a) => a.key)).toEqual([wantedEvening[1].key]);

    // Rollback / all-off empty wanted cancels ONLY F36 items
    const wipe = reconcileTimeSupport(scheduled, []);
    expect(wipe.cancel.sort()).toEqual(['dup-ev', 'keep-ev', 'stale-task']);
    expect(wipe.add).toEqual([]);
  });
});
