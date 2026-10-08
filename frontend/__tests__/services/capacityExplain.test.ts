/**
 * R03.04 — "Bekleyen alışkanlığın neden beklediğini ve nasıl aktive edileceğini
 * göster; kullanıcı açıkça öneriyi geçersiz kılabilir." + "Kapasite/kuyruğu R01
 * dönem motoruyla bağla."
 */
jest.mock('../../lib/supabase', () => ({ supabase: {} }));

import { evaluateActivation, explainActivation } from '../../services/capacityService';
import type { WillpowerStateRow } from '../../repositories/willpowerRepository';
import type { Habit } from '../../lib/supabase';

const wp = (over: Partial<WillpowerStateRow> = {}): WillpowerStateRow => ({
  user_id: 'u1', state_date: '2026-10-08', daily_budget: 30, used: 0, focus_capacity: 3, active_count: 0, ...over,
});
const heavy = (id: string, extra: Partial<Habit> = {}) => ({
  id, difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, impact_level: 'critical', status: 'active', ...extra,
}) as unknown as Habit;
const ASOF = new Date(2026, 9, 8, 12);
// each heavy habit is 18 load points: four of them (72) + one more (18) crosses the 85 ceiling
const crowd = [heavy('a'), heavy('b'), heavy('c'), heavy('d')];

describe('why it waits, and how to start it', () => {
  it('over the load suggestion: the numbers, the way out, and an override offered', () => {
    const e = explainActivation({ state: wp(), stale: false, cost: 3, capacityInput: { habit: heavy('new'), activeHabits: crowd, asOf: ASOF } });
    expect(e.verdict).toEqual({ allowed: false, reason: 'over_capacity' });
    expect(e.canOverride).toBe(true);
    expect(e.why).toBe(`Bugünkü yük ${e.currentLoad}/100; bu alışkanlık +${e.incoming} ekler, önerilen sınır 85.`);
    expect([e.currentLoad, e.incoming]).toEqual([72, 18]);
    expect(e.how).toMatch(/beklemeye al/);
    expect(e.how).toMatch(/yine de etkinleştir/);
  });

  it('over the day budget: a hard limit -- no override, and the numbers say why', () => {
    const e = explainActivation({ state: wp({ used: 28 }), stale: false, cost: 5, capacityInput: { habit: heavy('new'), activeHabits: [], asOf: ASOF } });
    expect(e.verdict).toEqual({ allowed: false, reason: 'over_budget' });
    expect(e.canOverride).toBe(false);
    expect(e.why).toBe('Bugünkü irade bütçesi yetmiyor: 28 + 5 > 30.');
  });

  it('unknown or stale data: never overridable', () => {
    expect(explainActivation({ state: null, stale: false, cost: 1 }).canOverride).toBe(false);
    expect(explainActivation({ state: wp(), stale: true, cost: 1 }).verdict).toEqual({ allowed: false, reason: 'stale' });
  });

  it('fits: says so', () => {
    const e = explainActivation({ state: wp(), stale: false, cost: 1, capacityInput: { habit: heavy('new', { difficulty: 1, estimated_minutes: 5, impact_level: 'low' } as never), activeHabits: [], asOf: ASOF } });
    expect(e.verdict.allowed).toBe(true);
    expect(e.why).toMatch(/taşıyabilir/);
  });

  it('legacy fixed-slot fallback (list still loading) explains the slot count', () => {
    const e = explainActivation({ state: wp({ active_count: 3 }), stale: false, cost: 1 });
    expect(e.why).toBe('Aktif alışkanlık sınırı dolu (3/3).');
  });
});

describe('the override is explicit and bounded', () => {
  it('overrides the load suggestion', () => {
    expect(evaluateActivation({ state: wp(), stale: false, cost: 3, capacityInput: { habit: heavy('new'), activeHabits: crowd, asOf: ASOF }, override: true })).toEqual({ allowed: true });
  });
  it('does not override the day budget, nor missing/stale data', () => {
    expect(evaluateActivation({ state: wp({ used: 29 }), stale: false, cost: 5, override: true })).toEqual({ allowed: false, reason: 'over_budget' });
    expect(evaluateActivation({ state: null, stale: false, cost: 1, override: true })).toEqual({ allowed: false, reason: 'no_state' });
    expect(evaluateActivation({ state: wp(), stale: true, cost: 1, override: true })).toEqual({ allowed: false, reason: 'stale' });
  });
});

describe('R01 link: a habit on a dated break carries no load today', () => {
  it('the same crowd on a break today no longer blocks activation', () => {
    const onBreak = crowd.map((h) => ({ ...h, pause_intervals: [{ start_date: '2026-10-07', end_date: '2026-10-10' }] }));
    const blocked = evaluateActivation({ state: wp(), stale: false, cost: 3, capacityInput: { habit: heavy('new'), activeHabits: crowd, asOf: ASOF } });
    const free = evaluateActivation({ state: wp(), stale: false, cost: 3, capacityInput: { habit: heavy('new'), activeHabits: onBreak as never, asOf: ASOF } });
    expect(blocked.allowed).toBe(false);
    expect(free.allowed).toBe(true);
  });
  it('the break ending yesterday counts again', () => {
    const ended = crowd.map((h) => ({ ...h, pause_intervals: [{ start_date: '2026-10-01', end_date: '2026-10-07' }] }));
    expect(evaluateActivation({ state: wp(), stale: false, cost: 3, capacityInput: { habit: heavy('new'), activeHabits: ended as never, asOf: ASOF } }).allowed).toBe(false);
  });
});

describe('the activation service honours the override end to end', () => {
  it('refused without it, activated with it (load suggestion only)', async () => {
    jest.resetModules();
    jest.doMock('../../repositories/habitRepository', () => ({
      ...jest.requireActual('../../repositories/habitRepository'),
      updateHabit: jest.fn(async (id: string) => ({ ok: true, data: { id, status: 'active' } })),
    }));
    jest.doMock('../../repositories/willpowerRepository', () => ({
      ...jest.requireActual('../../repositories/willpowerRepository'),
      updateWillpowerState: jest.fn(async () => ({ ok: true, data: null })),
    }));
    const { activateHabit } = jest.requireActual('../../services/habitService') as typeof import('../../services/habitService');
    const base = { habit: heavy('new'), cost: 3, willpower: { state: wp(), stale: false }, activeHabits: crowd, useCapacityRule: true };
    expect(await activateHabit(base)).toEqual({ ok: false, verdict: { allowed: false, reason: 'over_capacity' } });
    expect((await activateHabit({ ...base, override: true })).ok).toBe(true);
  });
});
