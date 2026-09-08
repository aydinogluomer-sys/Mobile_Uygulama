/**
 * The coach may suggest. It may not decide, and it may not write.
 *
 * These tests treat the model's structured output as hostile input, because
 * that is what it is: a remote system producing JSON that, if believed, would
 * end in the user's habit rows. The rules being enforced:
 *
 *   - an unknown, malformed, oversized or prototype-poisoning action is
 *     DISCARDED, never coerced into something writable;
 *   - a bad action never costs the user the reply they paid 5 FP for, so
 *     validation returns rather than throws;
 *   - the model may not supply authority -- ownership, price, XP, a table
 *     name -- only content;
 *   - a date is resolved in the device's LOCAL calendar, because UTC
 *     arithmetic logs the wrong day for anyone east of UTC in the evening;
 *   - two plausible habits is a question, not a coin flip.
 */
import {
  validateCoachActions,
  resolveCoachDate,
  resolveHabitQuery,
  coachActionToRoutineProposal,
  MAX_COACH_ACTIONS,
  MAX_PLAN_HABITS,
} from '../../lib/coachActions';
import { validateRoutineProposal } from '../../lib/routineProposal';
import type { Habit } from '../../lib/supabase';

const habit = (name: string, over: Partial<Habit> = {}): Habit =>
  ({ id: name, name, status: 'active', tracking_type: 'numeric', unit: 'dakika', daily_goal: 20, ...over } as unknown as Habit);

const okHabit = { name: 'Kitap Oku', tracking_type: 'numeric', difficulty: 3, estimated_minutes: 20 };

describe('validateCoachActions — the normal case', () => {
  it('no actions is the normal case, not an error', () => {
    // Most coach turns are conversation. "Motivasyonum düşük" must not
    // produce a habit proposal.
    expect(validateCoachActions(undefined)).toEqual({ actions: [], rejected: [] });
    expect(validateCoachActions(null)).toEqual({ actions: [], rejected: [] });
    expect(validateCoachActions([])).toEqual({ actions: [], rejected: [] });
  });

  it('accepts a single habit proposal', () => {
    const r = validateCoachActions([{ type: 'propose_habit', habit: okHabit }]);
    expect(r.rejected).toEqual([]);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ type: 'propose_habit', habit: { name: 'Kitap Oku' } });
  });

  it('accepts a plan', () => {
    const r = validateCoachActions([
      { type: 'propose_habit_plan', title: 'Kısa Haftalık Plan', goal: 'Başlangıç', habits: [okHabit, { ...okHabit, name: 'Yürü' }] },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.actions[0]).toMatchObject({ type: 'propose_habit_plan', habits: [{ name: 'Kitap Oku' }, { name: 'Yürü' }] });
  });

  it('accepts a log by state and by value', () => {
    const byState = validateCoachActions([
      { type: 'log_habit', habit_query: 'kitap', date: 'today', completion: { kind: 'state', state: 'done' } },
    ]);
    expect(byState.actions).toHaveLength(1);

    const byValue = validateCoachActions([
      { type: 'log_habit', habit_query: 'kitap', date: 'today', completion: { kind: 'value', value: 10, unit: 'dakika' } },
    ]);
    expect(byValue.actions[0]).toMatchObject({ completion: { kind: 'value', value: 10, unit: 'dakika' } });
  });
});

describe('validateCoachActions — hostile input is discarded, not coerced', () => {
  const bad: [string, unknown][] = [
    ['unknown action type', { type: 'delete_everything', habit: okHabit }],
    ['no type', { habit: okHabit }],
    ['not an object', 'propose_habit'],
    ['null entry', null],
    ['extra top-level key', { type: 'propose_habit', habit: okHabit, sql: 'drop table habits' }],
    ['extra habit key', { type: 'propose_habit', habit: { ...okHabit, frequency_config: {} } }],
    ['bad tracking type', { type: 'propose_habit', habit: { ...okHabit, tracking_type: 'duration' } }],
    ['bad difficulty', { type: 'propose_habit', habit: { ...okHabit, difficulty: 4 } }],
    ['negative minutes', { type: 'propose_habit', habit: { ...okHabit, estimated_minutes: -1 } }],
    ['absurd minutes', { type: 'propose_habit', habit: { ...okHabit, estimated_minutes: 10 ** 6 } }],
    ['empty name', { type: 'propose_habit', habit: { ...okHabit, name: '   ' } }],
    ['oversized name', { type: 'propose_habit', habit: { ...okHabit, name: 'x'.repeat(500) } }],
    ['empty plan', { type: 'propose_habit_plan', title: 'T', goal: '', habits: [] }],
    ['oversized plan', { type: 'propose_habit_plan', title: 'T', goal: '', habits: Array(MAX_PLAN_HABITS + 1).fill(okHabit) }],
    ['plan with one bad habit', { type: 'propose_habit_plan', title: 'T', goal: '', habits: [okHabit, { name: 'x' }] }],
    ['log without query', { type: 'log_habit', date: 'today', completion: { kind: 'state', state: 'done' } }],
    ['log with bad state', { type: 'log_habit', habit_query: 'k', date: 'today', completion: { kind: 'state', state: 'exploded' } }],
    ['log with bad date', { type: 'log_habit', habit_query: 'k', date: 'sometime', completion: { kind: 'state', state: 'done' } }],
    ['log with NaN value', { type: 'log_habit', habit_query: 'k', date: 'today', completion: { kind: 'value', value: NaN } }],
    ['log with absurd value', { type: 'log_habit', habit_query: 'k', date: 'today', completion: { kind: 'value', value: 1e9 } }],
    ['completion with unknown kind', { type: 'log_habit', habit_query: 'k', date: 'today', completion: { kind: 'magic' } }],
  ];

  it.each(bad)('rejects %s', (_label, payload) => {
    const r = validateCoachActions([payload]);
    expect(r.actions).toEqual([]);
    expect(r.rejected).toHaveLength(1);
  });

  it('rejects prototype-pollution keys', () => {
    // JSON.parse creates __proto__ as an ordinary own property rather than
    // invoking the accessor, so this has to be checked rather than assumed.
    const poisoned = JSON.parse('{"type":"propose_habit","habit":{"name":"x","tracking_type":"binary","difficulty":1,"estimated_minutes":5,"__proto__":{"admin":true}}}');
    expect(validateCoachActions([poisoned]).actions).toEqual([]);

    const topLevel = JSON.parse('{"__proto__":{"x":1},"type":"propose_habit"}');
    expect(validateCoachActions([topLevel]).actions).toEqual([]);
  });

  it.each([
    'user_id', 'userId', 'habit_id', 'habitId', 'id', 'xp', 'cost', 'price', 'balance', 'table', 'rpc',
  ])('rejects an action that supplies authority via %s', (key) => {
    // Ownership, price and XP are the app's and the server's. A model that
    // names them is not proposing content.
    const r = validateCoachActions([{ type: 'propose_habit', habit: okHabit, [key]: 'anything' }]);
    expect(r.actions).toEqual([]);
  });

  it('a bad action never throws, so the paid reply survives it', () => {
    for (const payload of [Symbol('x') as unknown, () => {}, 0, false, [[[[]]]]]) {
      expect(() => validateCoachActions([payload])).not.toThrow();
    }
    expect(() => validateCoachActions('not an array')).not.toThrow();
    expect(validateCoachActions('not an array').actions).toEqual([]);
  });

  it('caps how many actions one turn may stage', () => {
    const many = Array(MAX_COACH_ACTIONS + 3).fill({ type: 'propose_habit', habit: okHabit });
    const r = validateCoachActions(many);
    expect(r.actions).toHaveLength(MAX_COACH_ACTIONS);
    expect(r.rejected.some((x) => /too many/.test(x.reason))).toBe(true);
  });

  it('one bad action does not discard a good one', () => {
    const r = validateCoachActions([{ type: 'nope' }, { type: 'propose_habit', habit: okHabit }]);
    expect(r.actions).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
  });
});

describe('resolveCoachDate — local calendar, never UTC', () => {
  // 23:30 local on the 7th. A UTC-based implementation would call this the
  // 8th for anyone far enough east, and log the habit on the wrong day.
  const lateEvening = new Date(2026, 8, 7, 23, 30, 0);

  it('defaults to today', () => {
    expect(resolveCoachDate(undefined, lateEvening)).toBe('2026-09-07');
    expect(resolveCoachDate('today', lateEvening)).toBe('2026-09-07');
    expect(resolveCoachDate('bugün', lateEvening)).toBe('2026-09-07');
  });

  it('understands yesterday', () => {
    expect(resolveCoachDate('yesterday', lateEvening)).toBe('2026-09-06');
    expect(resolveCoachDate('dün', lateEvening)).toBe('2026-09-06');
  });

  it('accepts an explicit local date', () => {
    expect(resolveCoachDate('2026-09-01', lateEvening)).toBe('2026-09-01');
  });

  it('refuses a date that does not exist', () => {
    // Date() would happily roll this into March.
    expect(resolveCoachDate('2026-02-31', lateEvening)).toBeNull();
  });

  it('refuses anything it does not understand rather than guessing', () => {
    for (const s of ['last tuesday', 'geçen hafta', '07/09/2026', '', 42, {}]) {
      expect(resolveCoachDate(s, lateEvening)).toBeNull();
    }
  });
});

describe('resolveHabitQuery — never guesses between two real habits', () => {
  const habits = [habit('Kitap Oku'), habit('Yürüyüş'), habit('Kitap Özeti')];

  it('resolves an exact name', () => {
    const r = resolveHabitQuery('Kitap Oku', habits);
    expect(r.kind).toBe('exact');
  });

  it('is case- and Turkish-diacritic-insensitive', () => {
    expect(resolveHabitQuery('yürüyüş', habits).kind).toBe('exact');
    expect(resolveHabitQuery('YURUYUS', habits).kind).toBe('exact');
  });

  it('asks when two habits plausibly match', () => {
    // "kitap" matches both Kitap Oku and Kitap Özeti. Picking one silently
    // writes to a habit the user did not mean.
    const r = resolveHabitQuery('kitap', habits);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates).toHaveLength(2);
  });

  it('reports no match rather than inventing one', () => {
    expect(resolveHabitQuery('gitar', habits).kind).toBe('none');
    expect(resolveHabitQuery('   ', habits).kind).toBe('none');
  });

  it('prefers active habits', () => {
    const withArchived = [habit('Kitap Oku'), habit('Kitap Oku', { status: 'archived' })];
    const r = resolveHabitQuery('Kitap Oku', withArchived as Habit[]);
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.habit.status).toBe('active');
  });
});

describe('one pipeline, not two', () => {
  it('a coach habit proposal validates as a routine proposal', () => {
    // The whole reason coach habits speak the routine vocabulary: capacity
    // evaluation, tracking-type rules and the install path stay in one place.
    const r = validateCoachActions([{ type: 'propose_habit', habit: okHabit }]);
    const proposal = coachActionToRoutineProposal(r.actions[0]);
    expect(proposal).not.toBeNull();
    const validated = validateRoutineProposal(proposal);
    expect(validated.ok).toBe(true);
  });

  it('a coach plan validates as a routine proposal', () => {
    const r = validateCoachActions([
      { type: 'propose_habit_plan', title: 'Plan', goal: 'Hedef', habits: [okHabit, { ...okHabit, name: 'Yürü' }] },
    ]);
    const validated = validateRoutineProposal(coachActionToRoutineProposal(r.actions[0]));
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.proposal.habits).toHaveLength(2);
  });

  it('a log action is not a routine proposal', () => {
    const r = validateCoachActions([
      { type: 'log_habit', habit_query: 'k', date: 'today', completion: { kind: 'state', state: 'done' } },
    ]);
    expect(coachActionToRoutineProposal(r.actions[0])).toBeNull();
  });
});
