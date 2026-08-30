/**
 * Recovery Engine V1 tests (Plan §9).  (Phase 1, CODER-B, task W4)
 *
 * Pure domain tests -- no I/O, no Supabase, no store.
 */
import {
  deficitFor,
  recoveryOptions,
  expirePlans,
  planFromRow,
  type RecoveryPlanV2,
} from '../../lib/recovery';
import type { RecoveryPlan } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// deficitFor -- plan worked example + binary/abstinence handling
// ---------------------------------------------------------------------------

describe('deficitFor -- plan worked example: target 10000, actual 8000 -> deficit 2000', () => {
  it('produces a numeric deficit of exactly 2000', () => {
    expect(deficitFor({ trackingType: 'numeric', target: 10000, value: 8000 })).toEqual({
      type: 'numeric',
      value: 2000,
    });
  });

  it('never goes negative when the target was exceeded', () => {
    expect(deficitFor({ trackingType: 'numeric', target: 10000, value: 12000 })).toEqual({
      type: 'numeric',
      value: 0,
    });
  });

  it('treats "duration" tracking the same way as "numeric"', () => {
    expect(deficitFor({ trackingType: 'duration', target: 30, value: 10 })).toEqual({
      type: 'numeric',
      value: 20,
    });
  });
});

describe('deficitFor -- binary/abstinence: the whole unit or nothing', () => {
  it('a boolean habit logged done has zero deficit', () => {
    expect(deficitFor({ trackingType: 'boolean', state: 'done' })).toEqual({ type: 'binary', value: 0 });
  });

  it('a boolean habit logged miss owes the whole unit', () => {
    expect(deficitFor({ trackingType: 'boolean', state: 'miss' })).toEqual({ type: 'binary', value: 1 });
  });

  it('a boolean habit logged skip also owes the whole unit', () => {
    expect(deficitFor({ trackingType: 'boolean', state: 'skip' })).toEqual({ type: 'binary', value: 1 });
  });

  it('an abstinence habit that stayed clean has zero deficit', () => {
    expect(deficitFor({ trackingType: 'abstinence', state: 'done' })).toEqual({ type: 'binary', value: 0 });
  });

  it('an abstinence habit with a slip owes the whole unit', () => {
    expect(deficitFor({ trackingType: 'abstinence', state: 'miss' })).toEqual({ type: 'binary', value: 1 });
  });

  it('fails closed: a missing/unknown state is treated as a miss, not silently complete', () => {
    expect(deficitFor({ trackingType: 'boolean' })).toEqual({ type: 'binary', value: 1 });
  });
});

// ---------------------------------------------------------------------------
// recoveryOptions -- the four strategies + the "2 güne böl" split rule
// ---------------------------------------------------------------------------

describe('recoveryOptions -- the four strategies, in the plan\'s order', () => {
  it('returns exactly: Bugün tamamla · Yarına aktar · 2 güne böl · Telafi etme', () => {
    const options = recoveryOptions({ type: 'numeric', value: 2000 }, { fromDate: '2026-08-04' });
    expect(options.map((o) => o.label)).toEqual(['Bugün tamamla', 'Yarına aktar', '2 güne böl', 'Telafi etme']);
  });

  it('"Bugün tamamla" schedules for the source day itself', () => {
    const [completeToday] = recoveryOptions({ type: 'numeric', value: 2000 }, { fromDate: '2026-08-04' });
    expect(completeToday.scheduled_for).toEqual(['2026-08-04']);
  });

  it('"Yarına aktar" schedules for the next day', () => {
    const [, pushTomorrow] = recoveryOptions({ type: 'numeric', value: 2000 }, { fromDate: '2026-08-04' });
    expect(pushTomorrow.scheduled_for).toEqual(['2026-08-05']);
  });

  it('"Telafi etme" schedules nothing', () => {
    const options = recoveryOptions({ type: 'numeric', value: 2000 }, { fromDate: '2026-08-04' });
    const skip = options.find((o) => o.strategy === 'skip')!;
    expect(skip.scheduled_for).toEqual([]);
    expect(skip.distributed_days).toBeNull();
  });
});

describe('recoveryOptions -- "2 güne böl" splits the plan\'s 2000 deficit into 1000 + 1000', () => {
  it('splits an even deficit exactly evenly', () => {
    const options = recoveryOptions({ type: 'numeric', value: 2000 }, { fromDate: '2026-08-04' });
    const split = options.find((o) => o.strategy === 'split_two_days')!;
    expect(split.distributed_days).toEqual([
      { date: '2026-08-05', value: 1000 },
      { date: '2026-08-06', value: 1000 },
    ]);
    expect(split.scheduled_for).toEqual(['2026-08-05', '2026-08-06']);
  });

  it('an odd deficit gives the larger half to the earlier day (2001 -> 1001 + 1000)', () => {
    const options = recoveryOptions({ type: 'numeric', value: 2001 }, { fromDate: '2026-08-04' });
    const split = options.find((o) => o.strategy === 'split_two_days')!;
    expect(split.distributed_days).toEqual([
      { date: '2026-08-05', value: 1001 },
      { date: '2026-08-06', value: 1000 },
    ]);
  });

  it('a binary deficit (1) degrades to a single day -- there is no such thing as half a completion', () => {
    const options = recoveryOptions({ type: 'binary', value: 1 }, { fromDate: '2026-08-04' });
    const split = options.find((o) => o.strategy === 'split_two_days')!;
    expect(split.distributed_days).toEqual([{ date: '2026-08-05', value: 1 }]);
  });

  it('a zero deficit has nothing to distribute', () => {
    const options = recoveryOptions({ type: 'numeric', value: 0 }, { fromDate: '2026-08-04' });
    const split = options.find((o) => o.strategy === 'split_two_days')!;
    expect(split.distributed_days).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// expirePlans
// ---------------------------------------------------------------------------

function v2Plan(overrides: Partial<RecoveryPlanV2> = {}): RecoveryPlanV2 {
  return {
    id: 'p1',
    user_id: 'u1',
    habit_id: 'h1',
    source_log_id: null,
    source_date: '2026-08-04',
    target_date: '2026-08-05',
    deficit_type: 'numeric',
    deficit_value: 2000,
    strategy: 'push_tomorrow',
    scheduled_for: ['2026-08-05'],
    distributed_days: null,
    note: null,
    reminder_time: null,
    status: 'planned',
    completed_at: null,
    created_at: '2026-08-04T10:00:00.000Z',
    ...overrides,
  };
}

describe('expirePlans -- a planned plan expires the day AFTER its last scheduled date', () => {
  it('is not yet expired on its scheduled day', () => {
    const plan = v2Plan({ scheduled_for: ['2026-08-05'] });
    expect(expirePlans([plan], '2026-08-05')).toEqual([]);
  });

  it('is not expired before its scheduled day', () => {
    const plan = v2Plan({ scheduled_for: ['2026-08-05'] });
    expect(expirePlans([plan], '2026-08-04')).toEqual([]);
  });

  it('is expired the day after its scheduled day', () => {
    const plan = v2Plan({ scheduled_for: ['2026-08-05'] });
    expect(expirePlans([plan], '2026-08-06')).toEqual([plan]);
  });

  it('a split plan expires only after the LATER of its two scheduled days', () => {
    const plan = v2Plan({ scheduled_for: ['2026-08-05', '2026-08-06'], strategy: 'split_two_days' });
    expect(expirePlans([plan], '2026-08-06')).toEqual([]); // still within the 2nd scheduled day
    expect(expirePlans([plan], '2026-08-07')).toEqual([plan]);
  });

  it('leaves completed/cancelled/already-expired plans alone', () => {
    const completed = v2Plan({ status: 'completed', scheduled_for: ['2026-08-01'] });
    const cancelled = v2Plan({ status: 'cancelled', scheduled_for: ['2026-08-01'] });
    expect(expirePlans([completed, cancelled], '2026-08-10')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// planFromRow -- what replaced the adapter
// ---------------------------------------------------------------------------

describe('planFromRow', () => {
  /**
   * There used to be a `toLegacyRecoveryPlan` / `fromLegacyRecoveryPlan` pair
   * here, translating `complete_today <-> full` and `skip <-> mini` in both
   * directions, plus tests asserting that five fields came back NULL because
   * "today's table cannot carry them".
   *
   * Both halves were wrong. The five columns had existed since migration
   * 20260825, so the adapter was discarding real data; and `mini` never meant
   * `skip` — it meant a reduced-scope same-day attempt, a size v2 has no word
   * for. The table now speaks the domain's vocabulary
   * (20260831_recovery_vocabulary) and a row IS a plan.
   *
   * All that is left to do is derive `scheduled_for`, which is not a column
   * because storing it would be a second copy of facts already in the row.
   */
  const row = (over: Partial<RecoveryPlan> = {}): RecoveryPlan => ({
    id: 'p1',
    user_id: 'u1',
    habit_id: 'h1',
    source_log_id: null,
    source_date: '2026-08-04',
    target_date: '2026-08-05',
    deficit_type: 'numeric',
    deficit_value: 2000,
    strategy: 'push_tomorrow',
    distributed_days: null,
    note: null,
    reminder_time: null,
    status: 'planned',
    completed_at: null,
    created_at: '2026-08-04T10:00:00.000Z',
    ...over,
  });

  it('carries every stored field through untouched', () => {
    const r = row();
    const plan = planFromRow(r);
    for (const key of Object.keys(r) as (keyof RecoveryPlan)[]) {
      expect(plan[key]).toEqual(r[key]);
    }
  });

  it('keeps the deficit, which the adapter used to null out', () => {
    const plan = planFromRow(row({ deficit_value: 2000, deficit_type: 'numeric', source_log_id: 'log-9' }));
    expect(plan.deficit_value).toBe(2000);
    expect(plan.deficit_type).toBe('numeric');
    expect(plan.source_log_id).toBe('log-9');
  });

  it('scheduled_for is the target date when the work is not split', () => {
    expect(planFromRow(row()).scheduled_for).toEqual(['2026-08-05']);
  });

  it('scheduled_for is every distributed day when it is', () => {
    const plan = planFromRow(row({
      strategy: 'split_two_days',
      distributed_days: [{ date: '2026-08-05', value: 1000 }, { date: '2026-08-06', value: 1000 }],
    }));
    expect(plan.scheduled_for).toEqual(['2026-08-05', '2026-08-06']);
  });

  it('an empty distribution falls back to the target date rather than to nothing', () => {
    // `[]` is what `recoveryOptions` returns for a zero deficit. A plan with
    // no scheduled day at all would be invisible to every "what is due"
    // query.
    const plan = planFromRow(row({ strategy: 'split_two_days', distributed_days: [] }));
    expect(plan.scheduled_for).toEqual(['2026-08-05']);
  });

  it('no strategy or status is renamed on the way through', () => {
    for (const strategy of ['complete_today', 'push_tomorrow', 'split_two_days', 'skip'] as const) {
      expect(planFromRow(row({ strategy })).strategy).toBe(strategy);
    }
    for (const status of ['planned', 'completed', 'expired', 'cancelled'] as const) {
      expect(planFromRow(row({ status, completed_at: status === 'completed' ? 'now' : null })).status).toBe(status);
    }
  });
});
