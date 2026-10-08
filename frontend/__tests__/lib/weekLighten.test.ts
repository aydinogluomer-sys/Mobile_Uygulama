/**
 * R09.04 — "'Bu hafta yorgunum' niyetini düzenlenebilir yük azaltma önerisine
 * dönüştür. Mevcut süre/bağımlılık/kapasiteyi kullan; aynı genel alt görev
 * listesini her niyete basma; hiçbir hedef kendiliğinden değiştirilmez."
 * The plan: the user's own load over the days left this week, heaviest first.
 */
import { LIGHTEN_SHARE, loadAfter, weekLightenPlan, type WeekLightenHabit } from '../../lib/weekLighten';
import { habitLoadPoints } from '../../lib/capacity';

// Thursday 8 October 2026: the week is Mon 5 .. Sun 11, four days left.
const THU = new Date(2026, 9, 8, 10);
const H = (id: string, name: string, difficulty: number, minutes: number, over: Partial<WeekLightenHabit> = {}): WeekLightenHabit => ({
  id, name, status: 'active', difficulty, estimated_minutes: minutes, frequency_config: { kind: 'daily' }, impact_level: null, ...over,
} as WeekLightenHabit);
const pts = (h: WeekLightenHabit, days: number) => Math.round(habitLoadPoints(h) * days * 10) / 10;

describe('the plan is built from the user\'s own load', () => {
  const run = H('h1', 'Koşu', 5, 90);
  const read = H('h2', 'Kitap', 3, 30);
  const water = H('h3', 'Su iç', 1, 5);

  it('rest of this week, each habit\'s capacity points × days left, heaviest first', () => {
    const p = weekLightenPlan([water, read, run], THU);
    expect([p.from, p.until]).toEqual(['2026-10-08', '2026-10-11']);
    expect(p.rows.map((r) => [r.name, r.daysLeft, r.points])).toEqual([
      ['Koşu', 4, pts(run, 4)], ['Kitap', 4, pts(read, 4)], ['Su iç', 4, pts(water, 4)],
    ]);
    expect(p.total).toBeCloseTo(pts(run, 4) + pts(read, 4) + pts(water, 4), 1);
  });

  it('suggests the heaviest until the load drops by the share -- no more', () => {
    const p = weekLightenPlan([water, read, run], THU);
    expect(p.rows.filter((r) => r.suggested).map((r) => r.name)).toEqual(['Koşu']);
    expect(p.total - loadAfter(p, new Set(['h1']))).toBeGreaterThanOrEqual(p.total * LIGHTEN_SHARE);
    // three equal habits: one third needs exactly one of them
    const eq = weekLightenPlan([H('a', 'A', 3, 30), H('b', 'B', 3, 30), H('c', 'C', 3, 30)], THU);
    expect(eq.rows.filter((r) => r.suggested)).toHaveLength(1);
    // two small ones and a mid one: the mid one is not enough alone, the next is added
    const mix = weekLightenPlan([H('m', 'Orta', 3, 30), H('x', 'Ufak1', 3, 25), H('y', 'Ufak2', 3, 25)], THU);
    const chosen = mix.rows.filter((r) => r.suggested);
    expect(chosen.length).toBeGreaterThanOrEqual(1);
    expect(mix.total - loadAfter(mix, new Set(chosen.map((r) => r.id)))).toBeGreaterThanOrEqual(mix.total * LIGHTEN_SHARE);
    expect(mix.total - loadAfter(mix, new Set(chosen.slice(0, -1).map((r) => r.id)))).toBeLessThan(mix.total * LIGHTEN_SHARE);
  });

  it('not one generic list: two users get their own heaviest habits', () => {
    const a = weekLightenPlan([H('1', 'Gitar', 5, 60), H('2', 'Su iç', 1, 5)], THU);
    const b = weekLightenPlan([H('3', 'Yürüyüş', 3, 45), H('4', 'Esneme', 1, 10)], THU);
    expect(a.rows.filter((r) => r.suggested).map((r) => r.name)).toEqual(['Gitar']);
    expect(b.rows.filter((r) => r.suggested).map((r) => r.name)).toEqual(['Yürüyüş']);
  });

  it('fewer days later in the week; Sunday is a one-day plan', () => {
    const sun = weekLightenPlan([run], new Date(2026, 9, 11, 9));
    expect([sun.from, sun.until, sun.rows[0].daysLeft]).toEqual(['2026-10-11', '2026-10-11', 1]);
    const mon = weekLightenPlan([run], new Date(2026, 9, 5, 9));
    expect(mon.rows[0].daysLeft).toBe(7);
  });
});

describe('what is left out', () => {
  it('inactive habits, habits outside their date range, habits already resting this week', () => {
    const p = weekLightenPlan([
      H('w', 'Bekleyen', 5, 90, { status: 'waiting' }),
      H('r', 'Bitti', 5, 90, { frequency_config: { kind: 'daily', range_end: '2026-10-07' } }),
      H('f', 'Cuma biter', 5, 90, { frequency_config: { kind: 'daily', range_end: '2026-10-09' } }),
      H('p', 'Molada', 5, 90, { pause_intervals: [{ id: 'x', habit_id: 'p', kind: 'pause', start_date: '2026-10-10', end_date: '2026-10-10' }] }),
      H('hol', 'Tatilde', 5, 90, { pause_intervals: [{ id: 'y', habit_id: null, kind: 'holiday', start_date: '2026-10-01', end_date: null }] }),
      H('o', 'Açık', 1, 10),
    ], THU);
    expect(p.rows.map((r) => [r.name, r.daysLeft])).toEqual([['Cuma biter', 2], ['Açık', 4]]);
  });
  it('nothing to lighten: an empty plan, nothing suggested', () => {
    expect(weekLightenPlan([], THU)).toMatchObject({ total: 0, rows: [] });
  });
});
