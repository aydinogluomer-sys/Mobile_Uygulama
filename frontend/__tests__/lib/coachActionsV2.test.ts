/**
 * R09.02 / R09.03 — the second coach action set, behind its gate, and the
 * entity check before any write.
 */
import { validateCoachActions } from '../../lib/coachActions';
import {
  V2_ACTION_TYPES, readActionV2, resolveTaskQuery, habitFingerprint, taskFingerprint, staleness,
} from '../../lib/coachActionsV2';
import { COACH_ACTIONS_V2_ENABLED } from '../../lib/featureGates';
import type { Habit } from '../../lib/supabase';

const NOW = new Date(2026, 9, 7, 10);
const TODAY = '2026-10-07';

describe('the gate', () => {
  it('is off, and off means these types are refused like any unknown type', () => {
    expect(COACH_ACTIONS_V2_ENABLED).toBe(false);
    const r = validateCoachActions([{ type: 'move_task', task_query: 'Rapor', date: 'today' }]);
    expect(r.actions).toEqual([]);
    expect(r.rejected[0].reason).toBe('unknown action type');
  });
  it('on, a valid action passes; authority keys are still refused first', () => {
    expect(validateCoachActions([{ type: 'move_task', task_query: 'Rapor', date: '2026-10-09' }], { v2: true }).actions)
      .toEqual([{ type: 'move_task', task_query: 'Rapor', date: '2026-10-09' }]);
    expect(validateCoachActions([{ type: 'move_task', task_query: 'Rapor', date: 'today', id: 'x' }], { v2: true }).rejected[0].reason)
      .toMatch(/authority/);
  });
});

describe('each action', () => {
  const ok = (raw: Record<string, unknown>) => readActionV2(raw, TODAY, NOW);
  it('edit_habit_schedule validates the schedule with the routine validator', () => {
    expect(ok({ type: 'edit_habit_schedule', habit_query: 'Yürüyüş', frequency_config: { kind: 'weekly', count: 3 } })).toMatchObject({ frequency_config: { kind: 'weekly', count: 3 } });
    expect(typeof ok({ type: 'edit_habit_schedule', habit_query: 'Yürüyüş', frequency_config: { kind: 'yearly' } })).toBe('string');
  });
  it('pause_habit never starts in the past and ends after it starts', () => {
    expect(ok({ type: 'pause_habit', habit_query: 'Spor', from: '2026-10-12', until: '2026-10-18' })).toMatchObject({ from: '2026-10-12', until: '2026-10-18' });
    expect(ok({ type: 'pause_habit', habit_query: 'Spor', from: 'today' })).toMatchObject({ from: TODAY, until: null });
    expect(ok({ type: 'pause_habit', habit_query: 'Spor', from: 'yesterday' })).toMatch(/past/);
    expect(ok({ type: 'pause_habit', habit_query: 'Spor', from: '2026-10-12', until: '2026-10-10' })).toMatch(/until before from/);
  });
  it('suggest_small_step: a named step of 1..60 minutes', () => {
    expect(ok({ type: 'suggest_small_step', task_query: 'Tez', step: 'Başlığı yaz', minutes: 5 })).toMatchObject({ minutes: 5 });
    expect(typeof ok({ type: 'suggest_small_step', task_query: 'Tez', step: '', minutes: 5 })).toBe('string');
    expect(typeof ok({ type: 'suggest_small_step', task_query: 'Tez', step: 'x', minutes: 90 })).toBe('string');
  });
  it('lighten_today: 1..10 names, de-duplicated', () => {
    expect(ok({ type: 'lighten_today', habit_queries: ['Spor', 'Spor', 'Okuma'] })).toEqual({ type: 'lighten_today', habit_queries: ['Spor', 'Okuma'] });
    expect(typeof ok({ type: 'lighten_today', habit_queries: [] })).toBe('string');
  });
  it('unexpected keys are refused', () => {
    expect(ok({ type: 'move_task', task_query: 'a', date: 'today', extra: 1 })).toMatch(/unexpected key/);
  });
});

describe('resolving a task', () => {
  const T = (id: string, title: string, over = {}) => ({ id, title, completed: false, status: 'pending', ...over });
  it('exact first, then a unique match; never guesses between two; done tasks are not targets', () => {
    const ts = [T('1', 'Rapor yaz'), T('2', 'Rapor oku'), T('3', 'Sunum'), T('4', 'Sunum hazırla', { completed: true })];
    expect(resolveTaskQuery('sunum', ts)).toMatchObject({ kind: 'one', task: { id: '3' } });
    expect(resolveTaskQuery('rapor', ts).kind).toBe('ambiguous');
    expect(resolveTaskQuery('rapor oku', ts)).toMatchObject({ kind: 'one', task: { id: '2' } });
    expect(resolveTaskQuery('hazırla', ts).kind).toBe('none');
  });
});

describe('R09.03 — fingerprints', () => {
  const h = { tracking_type: 'numeric', daily_goal: 20, target_direction: 'at_least', unit: 'dk', status: 'active', frequency_config: { kind: 'daily' }, behavior_type: 'positive' } as Habit;
  it('a change to anything the write depends on makes it stale; gone is gone', () => {
    const fp = habitFingerprint(h);
    expect(staleness(fp, { ...h }, habitFingerprint)).toBe('same');
    expect(staleness(fp, { ...h, daily_goal: 30 }, habitFingerprint)).toBe('changed');
    expect(staleness(fp, { ...h, status: 'archived' }, habitFingerprint)).toBe('changed');
    expect(staleness(fp, { ...h, frequency_config: { kind: 'weekly', count: 3 } } as Habit, habitFingerprint)).toBe('changed');
    expect(staleness(fp, undefined, habitFingerprint)).toBe('gone');
  });
  it('tasks too: a moved, completed or edited task is stale', () => {
    const t = { id: '1', title: 'A', completed: false, status: 'pending', due_date: '2026-10-08', updated_at: 'v1' };
    const fp = taskFingerprint(t);
    expect(staleness(fp, { ...t, updated_at: 'v2' }, taskFingerprint)).toBe('changed');
    expect(staleness(fp, { ...t, completed: true }, taskFingerprint)).toBe('changed');
    expect(staleness(fp, t, taskFingerprint)).toBe('same');
  });
  it('the list is the five types', () => {
    expect([...V2_ACTION_TYPES]).toEqual(['edit_habit_schedule', 'pause_habit', 'move_task', 'suggest_small_step', 'lighten_today']);
  });
});
