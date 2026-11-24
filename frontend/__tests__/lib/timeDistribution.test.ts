import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildTimeDistribution,
  habitDurationMinutes,
  TIME_LABELS,
  timeA11yLabel,
  timeCaption,
} from '../../lib/timeDistribution';

describe('lib/timeDistribution — pure duration aggregation & largest-remainder shares', () => {
  it('(+) computes exact 100% largest-remainder shares, selects top bucket, and breaks ties in focus -> routine -> habit order', () => {
    const dist = buildTimeDistribution({
      focusMinutes: 120,
      routineMinutes: 45,
      habitMinutes: 30,
    });
    expect(dist.total).toBe(195);
    expect(dist.top).toBe('focus');
    expect(dist.unknown).toEqual([]);
    expect(dist.segments.map((s) => s.key)).toEqual(['focus', 'routine', 'habit']);
    expect(dist.segments.reduce((sum, s) => sum + s.share, 0)).toBe(100);
    expect(dist.segments.map((s) => s.share)).toEqual([62, 23, 15]);

    const threeWayTie = buildTimeDistribution({
      focusMinutes: 10,
      routineMinutes: 10,
      habitMinutes: 10,
    });
    expect(threeWayTie.top).toBe('focus');
    expect(threeWayTie.segments.reduce((sum, s) => sum + s.share, 0)).toBe(100);
    expect(threeWayTie.segments.map((s) => s.share)).toEqual([34, 33, 33]);

    const routineHabitTie = buildTimeDistribution({
      focusMinutes: 0,
      routineMinutes: 25,
      habitMinutes: 25,
    });
    expect(routineHabitTie.top).toBe('routine');
    expect(routineHabitTie.segments.map((s) => s.key)).toEqual(['routine', 'habit']);
  });

  it('(+) habitDurationMinutes parses dk/DAKİKA/Saat/empty units via Turkish locale and counts done + partial logs', () => {
    const habits = [
      { id: 'h-dk', tracking_type: 'duration' as const, unit: 'dk' },
      { id: 'h-tr-upper', tracking_type: 'duration' as const, unit: 'DAKİKA' },
      { id: 'h-hour', tracking_type: 'duration' as const, unit: 'Saat' },
      { id: 'h-empty', tracking_type: 'duration' as const, unit: '' },
      { id: 'h-bool', tracking_type: 'boolean' as const, unit: 'km' }, // non-duration ignored completely
    ];
    const logs = [
      { habit_id: 'h-dk', completed_at: '2026-10-05', state: 'done', value: 20 },
      { habit_id: 'h-tr-upper', completed_at: '2026-10-06', state: 'partial', value: 15 },
      { habit_id: 'h-hour', completed_at: '2026-10-07', state: 'done', value: 1.5 }, // 90 min
      { habit_id: 'h-empty', completed_at: '2026-10-07', state: 'done', value: 10 },
      { habit_id: 'h-bool', completed_at: '2026-10-07', state: 'done', value: 99 },
    ];
    const res = habitDurationMinutes(habits, logs, { start: '2026-10-05', end: '2026-10-08' });
    expect(res).toEqual({ minutes: 135, excluded: 0 });
  });

  it('(+) formats timeCaption and timeA11yLabel for both week labels', () => {
    const dist = buildTimeDistribution({
      focusMinutes: 120,
      routineMinutes: 45,
      habitMinutes: 0,
    });
    expect(timeCaption(dist, 'Bu hafta')).toBe('Bu hafta zamanın en çok buraya aktı.');
    expect(timeCaption(dist, 'O hafta')).toBe('O hafta zamanın en çok buraya aktı.');
    expect(timeA11yLabel(dist, 'Bu hafta')).toBe(
      'Bu hafta zamanın en çok odağa aktı: 120 dakika. Odak 120 dakika, Rutinler 45 dakika.',
    );
    expect(TIME_LABELS).toEqual({
      focus: 'Odak',
      routine: 'Rutinler',
      habit: 'Süre tipli alışkanlıklar',
    });
  });

  it('(-) all-zero sources yield empty segments and neutral caption without "en çok buraya aktı"', () => {
    const empty = buildTimeDistribution({ focusMinutes: 0, routineMinutes: 0, habitMinutes: 0 });
    expect(empty.segments).toEqual([]);
    expect(empty.top).toBeNull();
    expect(empty.total).toBe(0);
    const cap = timeCaption(empty, 'Bu hafta');
    expect(cap).toBe('Bu hafta henüz süre kaydı yok.');
    expect(cap).not.toContain('en çok buraya aktı');
  });

  it('(-) null source goes to unknown and NEVER fabricates a 0 segment', () => {
    const dist = buildTimeDistribution({
      focusMinutes: null,
      routineMinutes: 30,
      habitMinutes: null,
    });
    expect(dist.unknown).toEqual(['focus', 'habit']);
    expect(dist.segments).toHaveLength(1);
    expect(dist.segments[0]).toEqual({
      key: 'routine',
      label: 'Rutinler',
      minutes: 30,
      share: 100,
    });

    const allUnknown = buildTimeDistribution({
      focusMinutes: null,
      routineMinutes: null,
      habitMinutes: null,
    });
    expect(allUnknown.segments).toEqual([]);
    expect(allUnknown.unknown).toEqual(['focus', 'routine', 'habit']);
  });

  it('(-) excludes unknown unit ("km"), skips miss/skip logs, skips future completed_at > end, and treats negative/NaN as 0', () => {
    const habits = [
      { id: 'h-km', tracking_type: 'duration' as const, unit: 'km' },
      { id: 'h-min', tracking_type: 'duration' as const, unit: 'dk' },
    ];
    const logs = [
      { habit_id: 'h-km', completed_at: '2026-10-05', state: 'done', value: 5 },
      { habit_id: 'h-km', completed_at: '2026-10-06', state: 'done', value: 8 },
      { habit_id: 'h-min', completed_at: '2026-10-05', state: 'miss', value: 40 },
      { habit_id: 'h-min', completed_at: '2026-10-06', state: 'skip', value: 40 },
      { habit_id: 'h-min', completed_at: '2026-10-09', state: 'done', value: 50 }, // after range.end (future!)
      { habit_id: 'h-min', completed_at: '2026-10-04', state: 'done', value: 50 }, // before range.start
      { habit_id: 'h-min', completed_at: '2026-10-07', state: 'done', value: -15 },
      { habit_id: 'h-min', completed_at: '2026-10-07', state: 'done', value: Number.NaN },
      { habit_id: 'h-min', completed_at: '2026-10-08', state: 'done', value: 25 },
    ];
    const res = habitDurationMinutes(habits, logs, { start: '2026-10-05', end: '2026-10-08' });
    expect(res).toEqual({ minutes: 25, excluded: 1 });

    const negDist = buildTimeDistribution({
      focusMinutes: -20,
      routineMinutes: Number.NaN,
      habitMinutes: 25,
      excludedHabits: res.excluded,
    });
    expect(negDist.total).toBe(25);
    expect(negDist.segments).toHaveLength(1);
    expect(negDist.excludedHabits).toBe(1);
  });

  it('(-) source text contains zero judgmental/target/comparison words (verimsiz, hedef, geçen hafta)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'timeDistribution.ts'), 'utf8').toLocaleLowerCase('tr-TR');
    expect(src).not.toContain('verimsiz');
    expect(src).not.toContain('hedef');
    expect(src).not.toContain('geçen hafta');
  });
});
