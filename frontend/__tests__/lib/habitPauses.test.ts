/**
 * R01.05 — the pure time-off and goal-version model.
 */
import {
  intervalCovers, isPausedOn, pausedDaysIn, pausedTarget, validatePause, endPauseOn,
  habitOn, versionSegments, versionRowsForEdit, attachTimeOff, stripTimeOff, changesGoal,
  intervalsForHabit, activePauseOn, EXCUSE_EFFECTS, type PauseInterval, type GoalVersion,
} from '../../lib/habitPauses';
import { ymd } from '../../lib/date';

const d = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
const P = (start: string, end: string | null, habit_id: string | null = 'h1', id = `${start}`): PauseInterval =>
  ({ id, habit_id, kind: habit_id ? 'pause' : 'holiday', start_date: start, end_date: end });

describe('intervals', () => {
  it('covers inclusive bounds; open end runs forever', () => {
    expect(intervalCovers(P('2026-10-05', '2026-10-07'), '2026-10-05')).toBe(true);
    expect(intervalCovers(P('2026-10-05', '2026-10-07'), '2026-10-07')).toBe(true);
    expect(intervalCovers(P('2026-10-05', '2026-10-07'), '2026-10-08')).toBe(false);
    expect(intervalCovers(P('2026-10-05', '2026-10-07'), '2026-10-04')).toBe(false);
    expect(intervalCovers(P('2026-10-05', null), '2030-01-01')).toBe(true);
  });

  it('a habit with no intervals is never paused', () => {
    expect(isPausedOn({}, d('2026-10-05'))).toBe(false);
    expect(isPausedOn({ pause_intervals: [] }, d('2026-10-05'))).toBe(false);
  });

  it('counts paused days in a span', () => {
    const h = { pause_intervals: [P('2026-10-06', '2026-10-08')] };
    expect(pausedDaysIn(h, d('2026-10-05'), d('2026-10-11'))).toBe(3);
  });

  it('a habit gets its own pauses and every holiday, nobody else\'s', () => {
    const all = [P('2026-10-01', null, 'h1', 'a'), P('2026-10-01', null, 'h2', 'b'), P('2026-12-20', '2026-12-31', null, 'c')];
    expect(intervalsForHabit('h1', all).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('activePauseOn finds the covering interval', () => {
    const h = { pause_intervals: [P('2026-10-06', '2026-10-08', 'h1', 'x')] };
    expect(activePauseOn(h, d('2026-10-07'))?.id).toBe('x');
    expect(activePauseOn(h, d('2026-10-09'))).toBeNull();
  });
});

describe('pausedTarget — a period target shrinks with the days it loses', () => {
  it('3 a week with 4 of 7 days paused asks for 2', () => {
    expect(pausedTarget(3, 7, 4)).toBe(2);
  });
  it('rounds up while any day is left; all paused = 0', () => {
    expect(pausedTarget(3, 7, 6)).toBe(1);
    expect(pausedTarget(3, 7, 7)).toBe(0);
  });
  it('no pause = the target unchanged; no target = 0', () => {
    expect(pausedTarget(3, 7, 0)).toBe(3);
    expect(pausedTarget(0, 7, 2)).toBe(0);
  });
});

describe('validatePause', () => {
  const today = '2026-10-07';
  it('a pause from today or later, ending on/after its start', () => {
    expect(validatePause({ kind: 'pause', start_date: today, end_date: null }, today, [])).toEqual({ ok: true });
    expect(validatePause({ kind: 'pause', start_date: '2026-10-08', end_date: '2026-10-14' }, today, [])).toEqual({ ok: true });
  });
  it('never rewrites a day that already happened', () => {
    const r = validatePause({ kind: 'pause', start_date: '2026-10-06', end_date: null }, today, []);
    expect(r.ok).toBe(false);
  });
  it('end before start, malformed dates are refused', () => {
    expect(validatePause({ kind: 'pause', start_date: '2026-10-09', end_date: '2026-10-08' }, today, []).ok).toBe(false);
    expect(validatePause({ kind: 'pause', start_date: '7.10.2026', end_date: null }, today, []).ok).toBe(false);
  });
  it('no overlap with another of the same kind', () => {
    const existing = [P('2026-10-10', '2026-10-20')];
    expect(validatePause({ kind: 'pause', start_date: '2026-10-15', end_date: null }, today, existing).ok).toBe(false);
    expect(validatePause({ kind: 'pause', start_date: '2026-10-21', end_date: null }, today, existing).ok).toBe(true);
    expect(validatePause({ kind: 'pause', start_date: today, end_date: '2026-10-09' }, today, existing).ok).toBe(true);
  });
});

describe('endPauseOn', () => {
  it('a running pause ends yesterday', () => {
    expect(endPauseOn(P('2026-10-01', null), '2026-10-07')).toEqual({ action: 'update', end_date: '2026-10-06' });
  });
  it('a pause that has not covered a day yet is removed', () => {
    expect(endPauseOn(P('2026-10-07', null), '2026-10-07')).toEqual({ action: 'delete' });
    expect(endPauseOn(P('2026-10-10', '2026-10-12'), '2026-10-07')).toEqual({ action: 'delete' });
  });
});

describe('goal versions', () => {
  const base = { id: 'h1', created_at: '2026-09-01T08:00:00Z', frequency_config: { kind: 'daily' } as any, daily_goal: null, target_direction: null };
  const V = (from: string, fc: any): GoalVersion => ({ habit_id: 'h1', effective_from: from, frequency_config: fc, daily_goal: null, target_direction: null });
  const MON = { kind: 'weekly' as const, days: [0] };

  it('no versions: the habit itself, same object', () => {
    expect(habitOn(base, d('2026-10-07'))).toBe(base);
  });

  it('each day reads the version in force on it', () => {
    const h = { ...base, frequency_config: MON, goal_versions: [V('2026-09-01', { kind: 'daily' }), V('2026-10-05', MON)] };
    expect(habitOn(h, d('2026-10-04')).frequency_config).toEqual({ kind: 'daily' });
    expect(habitOn(h, d('2026-10-05')).frequency_config).toEqual(MON);
    expect(habitOn(h, d('2026-10-30')).frequency_config).toEqual(MON);
  });

  it('versionSegments cuts a range at each effective date inside it', () => {
    const h = { ...base, goal_versions: [V('2026-09-01', { kind: 'daily' }), V('2026-10-05', MON)] };
    const segs = versionSegments(h, d('2026-10-01'), d('2026-10-10')).map((s) => [ymd(s.from), ymd(s.to)]);
    expect(segs).toEqual([['2026-10-01', '2026-10-04'], ['2026-10-05', '2026-10-10']]);
    expect(versionSegments(base, d('2026-10-01'), d('2026-10-10'))).toHaveLength(1);
  });

  it('the first edit writes a baseline for the old config, then the new one from today', () => {
    const rows = versionRowsForEdit(base, { frequency_config: MON, daily_goal: null, target_direction: null }, '2026-10-07');
    expect(rows.map((r) => [r.effective_from, r.frequency_config])).toEqual([['2026-09-01', { kind: 'daily' }], ['2026-10-07', MON]]);
  });

  it('later edits write only the new row; a habit created today needs no baseline', () => {
    const versioned = { ...base, goal_versions: [V('2026-09-01', { kind: 'daily' })] };
    expect(versionRowsForEdit(versioned, { frequency_config: MON, daily_goal: null, target_direction: null }, '2026-10-07')).toHaveLength(1);
    const fresh = { ...base, created_at: '2026-10-07T09:00:00' };
    expect(versionRowsForEdit(fresh, { frequency_config: MON, daily_goal: null, target_direction: null }, '2026-10-07')).toHaveLength(1);
  });

  it('changesGoal only for the versioned fields', () => {
    expect(changesGoal({ frequency_config: MON })).toBe(true);
    expect(changesGoal({ daily_goal: 3 })).toBe(true);
    expect(changesGoal({})).toBe(false);
    expect(changesGoal({ name: 'x' } as any)).toBe(false);
  });
});

describe('in-memory fields', () => {
  it('attach puts pauses and versions on the right habits, leaves others bare', () => {
    const out = attachTimeOff(
      [{ id: 'h1' }, { id: 'h2' }],
      [P('2026-10-01', null, 'h1', 'a')],
      [{ habit_id: 'h1', effective_from: '2026-10-01', frequency_config: { kind: 'daily' } as any, daily_goal: null, target_direction: null }],
    );
    expect(out[0].pause_intervals).toHaveLength(1);
    expect(out[0].goal_versions).toHaveLength(1);
    expect('pause_intervals' in out[1]).toBe(false);
    expect('goal_versions' in out[1]).toBe(false);
  });

  it('strip removes them, and only them', () => {
    expect(stripTimeOff({ name: 'x', pause_intervals: [], goal_versions: [] })).toEqual({ name: 'x' });
  });
});

describe('what each one does — one source for the copy', () => {
  it('skip, pause and holiday each state target, rate, streak and reminders', () => {
    for (const k of ['skip', 'pause', 'holiday'] as const) {
      const fx = EXCUSE_EFFECTS[k];
      expect(fx.title.length).toBeGreaterThan(2);
      for (const f of [fx.span, fx.target, fx.rate, fx.streak, fx.reminders]) expect(f.length).toBeGreaterThan(10);
    }
    expect(EXCUSE_EFFECTS.pause.title).toBe('Ara ver');
  });
});
