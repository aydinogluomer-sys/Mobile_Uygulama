/**
 * "Her gün 20 dakika kitap oku" has to survive the whole way to a row.
 *
 * ## The defect these exist for
 *
 * The proposal schema used to carry four fields: name, tracking_type,
 * difficulty, estimated_minutes. So the sentence above became a numeric habit
 * with `estimated_minutes: 20` and nothing else — no target, no unit, no
 * schedule. On a real device that failed in a way nobody could see until they
 * tried to use it:
 *
 *   daily_goal missing   "bugün 10 dakika okudum" had no target to be PARTIAL
 *                        of, so ten minutes counted as a completed day;
 *   unit missing         the number measured nothing;
 *   frequency missing    every habit installed as daily whatever was asked.
 *
 * `estimated_minutes` is what a habit COSTS. `daily_goal` is what counts as
 * having done it. They are different facts and the schema now says so.
 *
 * These tests run the real validators and the real install-row builder, so
 * what they assert is what reaches Supabase.
 */
// `buildInstallRows` is pure, but its module imports the habit repository,
// which constructs a live Supabase client at import time. Only the transport
// is stubbed; the row builder under test is the real one.
jest.mock('../../repositories/habitRepository', () => ({
  insertRoutineHabits: jest.fn(async () => ({ ok: true, data: [] })),
}));
jest.mock('../../repositories/routineRepository', () => ({
  fetchRoutines: jest.fn(async () => ({ ok: true, data: [] })),
}));

import { validateRoutineProposal, validateFrequencyConfig } from '../../lib/routineProposal';
import { validateCoachActions, coachActionToRoutineProposal } from '../../lib/coachActions';
import { firstMissingSemantic } from '../../lib/coachClarify';
import { canonicalUnit, sameUnit } from '../../lib/units';
import { buildInstallRows } from '../../services/routineService';

const READING = {
  name: 'Kitap Oku',
  tracking_type: 'numeric',
  difficulty: 3,
  estimated_minutes: 20,
  unit: 'dakika',
  daily_goal: 20,
  target_direction: 'at_least',
  frequency_config: { kind: 'daily' },
};

const proposalOf = (habit: Record<string, unknown>) => ({
  title: 'Test', goal: 'Test hedefi', habits: [habit],
});

// ---------------------------------------------------------------------------
// The required example, end to end
// ---------------------------------------------------------------------------

describe('“Her gün 20 dakika kitap okuma alışkanlığı eklemek istiyorum”', () => {
  it('validates with the target, the unit, the direction and the schedule intact', () => {
    const res = validateRoutineProposal(proposalOf(READING));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.habits[0]).toEqual({
      name: 'Kitap Oku',
      tracking_type: 'numeric',
      difficulty: 3,
      estimated_minutes: 20,
      unit: 'dakika',
      daily_goal: 20,
      target_direction: 'at_least',
      frequency_config: { kind: 'daily' },
    });
  });

  it('survives the coach action validator too', () => {
    const { actions, rejected } = validateCoachActions([{ type: 'propose_habit', habit: READING }]);
    expect(rejected).toEqual([]);
    expect(actions[0]).toEqual({ type: 'propose_habit', habit: READING });
  });

  it('reaches the install row as daily_goal, not as an estimate', () => {
    // §23: the row that actually lands in `habits`.
    const res = validateRoutineProposal(proposalOf(READING));
    if (!res.ok) throw new Error('fixture should validate');
    const [row] = buildInstallRows(res.proposal.habits, ['Kitap Oku']);

    expect(row.daily_goal).toBe(20);
    expect(row.unit).toBe('dakika');
    expect(row.target_direction).toBe('at_least');
    expect(row.frequency_config).toEqual({ kind: 'daily' });
    expect(row.tracking_type).toBe('numeric');
    // The effort estimate is still its own field, and still not the target.
    expect(row.estimated_minutes).toBe(20);
    expect(row.status).toBe('active');
  });

  it('a weekly habit is priced as weekly, not as daily', () => {
    // `willpower_cost` is derived from the schedule. Before the schema carried
    // one, three-days-a-week cost the same as every day.
    const weekly = { ...READING, frequency_config: { kind: 'weekly', days: [0, 2, 4] } };
    const res = validateRoutineProposal(proposalOf(weekly));
    if (!res.ok) throw new Error('weekly fixture should validate');
    const [row] = buildInstallRows(res.proposal.habits, ['Kitap Oku']);
    const [daily] = buildInstallRows(
      [{ ...res.proposal.habits[0], frequency_config: { kind: 'daily' } }],
      ['Kitap Oku'],
    );
    expect(row.willpower_cost).toBeLessThan(daily.willpower_cost);
  });
});

// ---------------------------------------------------------------------------
// Half a measurement is not a measurement
// ---------------------------------------------------------------------------

describe('a target and its unit travel together', () => {
  it('a daily_goal with no unit is refused', () => {
    const { unit: _u, ...noUnit } = READING;
    const res = validateRoutineProposal(proposalOf(noUnit));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => /target needs to be a target OF something/.test(e.message))).toBe(true);
  });

  it('a unit with no daily_goal is refused', () => {
    const { daily_goal: _g, ...noGoal } = READING;
    const res = validateRoutineProposal(proposalOf(noGoal));
    expect(res.ok).toBe(false);
  });

  it('a binary habit may not carry a target', () => {
    // Nothing measures it, so the number would sit in the row implying a
    // target the engine can never judge against.
    const res = validateRoutineProposal(proposalOf({ ...READING, tracking_type: 'binary' }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => /only meaningful on a numeric habit/.test(e.message))).toBe(true);
  });

  it('the coach validator drops the whole habit rather than half of it', () => {
    const { unit: _u, ...noUnit } = READING;
    const { actions, rejected } = validateCoachActions([{ type: 'propose_habit', habit: noUnit }]);
    expect(actions).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it('a habit with neither is fine — that is a question, not an error', () => {
    const { unit: _u, daily_goal: _g, target_direction: _d, ...bare } = READING;
    expect(validateRoutineProposal(proposalOf(bare)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

describe('frequency_config is validated against the app’s real schedule schema', () => {
  const ok = (raw: unknown) => validateFrequencyConfig(raw, 'f').frequency;

  it('accepts the three kinds', () => {
    expect(ok({ kind: 'daily' })).toEqual({ kind: 'daily' });
    expect(ok({ kind: 'weekly', days: [0, 2, 4] })).toEqual({ kind: 'weekly', days: [0, 2, 4] });
    expect(ok({ kind: 'monthly', count: 2 })).toEqual({ kind: 'monthly', count: 2 });
  });

  it('weekdays are Monday=0 … Sunday=6 and bounded to that range', () => {
    expect(ok({ kind: 'weekly', days: [6] })).toEqual({ kind: 'weekly', days: [6] });
    expect(ok({ kind: 'weekly', days: [7] })).toBeNull();
    expect(ok({ kind: 'weekly', days: [-1] })).toBeNull();
    expect(ok({ kind: 'weekly', days: [1.5] })).toBeNull();
  });

  it('sorts days so two spellings of the same week are one config', () => {
    expect(ok({ kind: 'weekly', days: [4, 0, 2] })).toEqual({ kind: 'weekly', days: [0, 2, 4] });
  });

  it('refuses a duplicated weekday', () => {
    expect(ok({ kind: 'weekly', days: [1, 1] })).toBeNull();
  });

  it('refuses days on a non-weekly schedule', () => {
    expect(ok({ kind: 'daily', days: [0] })).toBeNull();
    expect(ok({ kind: 'monthly', days: [0] })).toBeNull();
  });

  it('refuses a weekly schedule that pins to nothing', () => {
    // `isDueOn` returns false every day for weekly-with-neither, so the habit
    // would never be due and never missed. An invisible habit.
    expect(ok({ kind: 'weekly' })).toBeNull();
  });

  it('bounds count by its own kind', () => {
    expect(ok({ kind: 'weekly', count: 7 })).toEqual({ kind: 'weekly', count: 7 });
    expect(ok({ kind: 'weekly', count: 8 })).toBeNull();
    expect(ok({ kind: 'monthly', count: 31 })).toEqual({ kind: 'monthly', count: 31 });
    expect(ok({ kind: 'monthly', count: 32 })).toBeNull();
    expect(ok({ kind: 'daily', count: 3 })).toBeNull();
  });

  // R01.02-d — this test was "refuses schedule fields the scheduler does not
  // read", reasoning that `isDueOn` ignores interval_days and the date range, so
  // accepting them would install a config that reads right and behaves as plain
  // daily. That reason is gone: every day-lane consumer asks `isEligibleOn`
  // (R01.02-c) and the range is a lifetime envelope (R01.02-d1). The test is
  // turned to the ACCEPT side and widened; what it really protected -- nothing
  // the scheduler cannot honour slips through, and no unknown field passes
  // silently -- is kept below as explicit refusals.
  it('accepts the schedule fields the scheduler now reads, unchanged', () => {
    expect(ok({ kind: 'daily', interval_days: 3 })).toEqual({ kind: 'daily', interval_days: 3 });
    expect(ok({ kind: 'daily', range_start: '2026-01-01' })).toEqual({ kind: 'daily', range_start: '2026-01-01' });
    expect(ok({ kind: 'daily', range_end: '2026-01-31' })).toEqual({ kind: 'daily', range_end: '2026-01-31' });
    expect(ok({ kind: 'daily', interval_days: 365, range_start: '2026-08-11', range_end: '2026-08-20' }))
      .toEqual({ kind: 'daily', interval_days: 365, range_start: '2026-08-11', range_end: '2026-08-20' });
    // the range is an envelope: it combines with every kind
    expect(ok({ kind: 'weekly', count: 3, range_start: '2026-08-05', range_end: '2026-08-20' }))
      .toEqual({ kind: 'weekly', count: 3, range_start: '2026-08-05', range_end: '2026-08-20' });
    expect(ok({ kind: 'weekly', days: [4, 0, 2], range_start: '2026-08-05' }))
      .toEqual({ kind: 'weekly', days: [0, 2, 4], range_start: '2026-08-05' });
    expect(ok({ kind: 'monthly', count: 10, range_end: '2026-12-31' }))
      .toEqual({ kind: 'monthly', count: 10, range_end: '2026-12-31' });
    // a one-day range is a valid range
    expect(ok({ kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-05' })).not.toBeNull();
  });

  it('refuses an interval the schedule cannot mean -- never coerces it to daily', () => {
    expect(ok({ kind: 'weekly', count: 3, interval_days: 3 })).toBeNull();   // only with daily
    expect(ok({ kind: 'monthly', count: 3, interval_days: 3 })).toBeNull();
    expect(ok({ kind: 'daily', interval_days: 1 })).toBeNull();               // NEGATIVE: not silently plain daily
    expect(ok({ kind: 'daily', interval_days: 0 })).toBeNull();
    expect(ok({ kind: 'daily', interval_days: -3 })).toBeNull();
    expect(ok({ kind: 'daily', interval_days: 3.5 })).toBeNull();
    expect(ok({ kind: 'daily', interval_days: 366 })).toBeNull();
    expect(ok({ kind: 'daily', interval_days: '3' })).toBeNull();
    expect(ok({ kind: 'daily', interval_days: null })).toBeNull();
  });

  it('refuses a range that is not a real, ordered pair of calendar days', () => {
    expect(ok({ kind: 'daily', range_start: '2026-08-20', range_end: '2026-08-05' })).toBeNull(); // NEGATIVE: start > end
    expect(ok({ kind: 'daily', range_start: '2026-02-30' })).toBeNull();
    expect(ok({ kind: 'daily', range_end: '5 Ağustos' })).toBeNull();
    expect(ok({ kind: 'daily', range_start: '' })).toBeNull();
    expect(ok({ kind: 'daily', range_start: 20260805 })).toBeNull();
    expect(ok({ kind: 'daily', range_start: '2026-8-5' })).toBeNull();
    expect(ok({ kind: 'daily', range_end: null })).toBeNull();
  });

  it('still refuses a field nobody defined', () => {
    // NEGATIVE: an unknown key must never pass silently.
    expect(ok({ kind: 'daily', foo: 1 })).toBeNull();
    expect(ok({ kind: 'daily', interval_days: 3, intervalDays: 3 })).toBeNull();
    expect(ok({ kind: 'daily', range: ['2026-08-05', '2026-08-20'] })).toBeNull();
  });

  it('refuses an unknown kind rather than defaulting to daily', () => {
    expect(ok({ kind: 'fortnightly' })).toBeNull();
    expect(ok({})).toBeNull();
    expect(ok('daily')).toBeNull();
  });

  it('refuses a prototype-pollution probe', () => {
    expect(ok(JSON.parse('{"kind":"daily","__proto__":{"x":1}}'))).toBeNull();
  });

  it('validates part_of_day against the three real parts', () => {
    expect(ok({ kind: 'daily', part_of_day: ['morning'] })).toEqual({ kind: 'daily', part_of_day: ['morning'] });
    expect(ok({ kind: 'daily', part_of_day: ['midnight'] })).toBeNull();
    expect(ok({ kind: 'daily', part_of_day: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// What is still missing
// ---------------------------------------------------------------------------

describe('the app asks for what the model did not say', () => {
  const bare = { name: 'Kitap Oku', tracking_type: 'numeric' as const, difficulty: 3 as const, estimated_minutes: 20 };

  it('a numeric habit with no target is an unanswered question', () => {
    expect(firstMissingSemantic([bare])).toEqual({ index: 0, missing: 'goal' });
  });

  it('a habit with no schedule is asked about too', () => {
    expect(firstMissingSemantic([{ ...bare, unit: 'dakika', daily_goal: 20 }]))
      .toEqual({ index: 0, missing: 'frequency' });
  });

  it('a binary habit is asked nothing about targets', () => {
    expect(firstMissingSemantic([{ ...bare, tracking_type: 'binary', frequency_config: { kind: 'daily' } }]))
      .toBeNull();
  });

  it('a complete habit is asked nothing at all', () => {
    expect(firstMissingSemantic([READING as never])).toBeNull();
  });

  it('asks about one habit fully before moving to the next', () => {
    const complete = { ...bare, unit: 'dakika', daily_goal: 20, frequency_config: { kind: 'daily' as const } };
    expect(firstMissingSemantic([complete, bare])).toEqual({ index: 1, missing: 'goal' });
  });
});

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

describe('unit comparison is an alias table, not a guess', () => {
  it('the same unit spelled differently is the same unit', () => {
    expect(sameUnit('dk', 'dakika')).toBe(true);
    expect(sameUnit('DAKİKA', 'dakika')).toBe(true);
    expect(sameUnit('min', 'dakika')).toBe(true);
    expect(sameUnit('sayfa', 'Sayfa')).toBe(true);
  });

  it('different units are different, and stay a question', () => {
    expect(sameUnit('dakika', 'sayfa')).toBe(false);
    expect(sameUnit('bardak', 'litre')).toBe(false);
    // Related but NOT the same: converting is exactly what this refuses.
    expect(sameUnit('saat', 'dakika')).toBe(false);
    expect(sameUnit('km', 'metre')).toBe(false);
  });

  it('a missing unit on either side is not a disagreement', () => {
    expect(sameUnit(null, 'dakika')).toBe(true);
    expect(sameUnit('dakika', null)).toBe(true);
    expect(sameUnit(undefined, undefined)).toBe(true);
  });

  it('an unknown unit is comparable to itself and nothing else', () => {
    expect(sameUnit('şınav', 'şınav')).toBe(true);
    expect(sameUnit('şınav', 'dakika')).toBe(false);
  });

  it('canonicalises to the first spelling in each group', () => {
    expect(canonicalUnit('dk')).toBe('dakika');
    expect(canonicalUnit('reps')).toBe('adet');
  });
});

// ---------------------------------------------------------------------------
// The bridge into the routine pipeline
// ---------------------------------------------------------------------------

describe('a coach habit crosses into the routine pipeline whole', () => {
  it('carries every semantic field through the conversion', () => {
    const { actions } = validateCoachActions([{ type: 'propose_habit', habit: READING }]);
    const proposal = coachActionToRoutineProposal(actions[0]);
    expect(proposal?.habits[0]).toMatchObject({
      unit: 'dakika', daily_goal: 20, target_direction: 'at_least', frequency_config: { kind: 'daily' },
    });
    // And the routine validator accepts what the coach validator produced.
    expect(validateRoutineProposal(proposal).ok).toBe(true);
  });

  it('a plan carries them for every habit', () => {
    const walk = {
      name: 'Yürüyüş', tracking_type: 'numeric', difficulty: 1, estimated_minutes: 30,
      unit: 'dakika', daily_goal: 30, target_direction: 'at_least',
      frequency_config: { kind: 'weekly', days: [0, 2, 4] },
    };
    const { actions, rejected } = validateCoachActions([{
      type: 'propose_habit_plan', title: 'Kısa Plan', goal: 'Düzenli başlangıç', habits: [READING, walk],
    }]);
    expect(rejected).toEqual([]);
    const proposal = coachActionToRoutineProposal(actions[0]);
    expect(proposal?.habits).toHaveLength(2);
    expect(proposal?.habits[1]).toMatchObject({ daily_goal: 30, frequency_config: { kind: 'weekly', days: [0, 2, 4] } });
    expect(validateRoutineProposal(proposal).ok).toBe(true);
  });

  it('still refuses authority fields alongside the new ones', () => {
    // Inside the habit, the habit reader refuses it and the whole action goes;
    // at the top level, the action reader names it. Two layers, one outcome.
    const inHabit = validateCoachActions([
      { type: 'propose_habit', habit: { ...READING, habit_id: 'h1' } },
    ]);
    expect(inHabit.actions).toEqual([]);
    expect(inHabit.rejected[0].reason).toBe('invalid habit');

    const atTop = validateCoachActions([
      { type: 'propose_habit', habit: READING, xp: 500 },
    ]);
    expect(atTop.actions).toEqual([]);
    expect(atTop.rejected[0].reason).toMatch(/authority/);
  });

  it('a schedule the scheduler cannot honour takes the habit with it', () => {
    const { actions, rejected } = validateCoachActions([
      { type: 'propose_habit', habit: { ...READING, frequency_config: { kind: 'weekly' } } },
    ]);
    expect(actions).toEqual([]);
    expect(rejected).toHaveLength(1);
  });
});
