/**
 * R01.02-e — the habit form can express every canonical shape, and nothing
 * without a target can leave it.
 *
 * The form's step-3 handlers are thin wrappers over `lib/frequencyForm.ts`
 * (pinned by `__tests__/repo/habitFormFrequency.test.ts`), so the state space
 * of the form IS the state space of these transitions. A1/A2/A8 are therefore
 * checked over EVERY state reachable from the default form -- a breadth-first
 * search to depth 3 over every UI action, plus 400 deterministic random walks
 * of 40 actions -- not over hand-picked examples.
 */
import type { FrequencyConfig, Habit } from '../../lib/supabase';
import {
  setFrequencyKind, setWeeklyMode, weeklyModeOf, toggleWeekday, togglePartOfDay, setFrequencyCount,
  setIntervalDays, setRangeStart, setRangeEnd, isFrequencyComplete, frequencySummary, rangeSummary,
  DEFAULT_WEEKLY_COUNT, DEFAULT_MONTHLY_COUNT, countCeiling,
} from '../../lib/frequencyForm';
import { validateFrequencyConfig, MAX_WEEKLY_COUNT, MAX_MONTHLY_COUNT } from '../../lib/routineProposal';
import { scheduleKind, isEligibleOn } from '../../lib/habitSchedule';
import { addDaysLocal, parseLocalDate, ymd } from '../../lib/date';
import { computeWillpowerCost } from '../../lib/triage';
import { legacyRun, a7Paths, type LegacyAction } from '../helpers/legacyFrequencyForm';

const DEFAULT: FrequencyConfig = { kind: 'daily' }; // HabitOnboarding DEFAULT_FORM.frequency_config
const TODAY = '2026-08-03';
const plus = (from: string, n: number) => ymd(addDaysLocal(parseLocalDate(from)!, n));

/** Every action the step-3 UI can fire, as the component fires it. */
type Act = (fc: FrequencyConfig) => FrequencyConfig;
const ACTIONS: [string, Act][] = [
  ['kind:daily', (f) => setFrequencyKind(f, 'daily')],
  ['kind:weekly', (f) => setFrequencyKind(f, 'weekly')],
  ['kind:monthly', (f) => setFrequencyKind(f, 'monthly')],
  ['mode:days', (f) => setWeeklyMode(f, 'days')],
  ['mode:count', (f) => setWeeklyMode(f, 'count')],
  ...[0, 1, 2, 3, 4, 5, 6].map((i) => [`day:${i}`, (f: FrequencyConfig) => toggleWeekday(f, i)] as [string, Act]),
  ['count:-', (f) => setFrequencyCount(f, (f.count ?? 1) - 1)],
  ['count:+', (f) => setFrequencyCount(f, (f.count ?? 1) + 1)],
  ...[null, 2, 3, 7].map((n) => [`interval:${n}`, (f: FrequencyConfig) => setIntervalDays(f, n)] as [string, Act]),
  // the free-text interval box: parseInt of whatever is typed
  ...['1', '0', '12', '365', '400', 'abc', '-4'].map((t) => [`intervalText:${t}`, (f: FrequencyConfig) => setIntervalDays(f, parseInt(t, 10))] as [string, Act]),
  ...[null, 7, 30].map((n) => [`start:${n}`, (f: FrequencyConfig) => setRangeStart(f, n === null ? null : plus(TODAY, n))] as [string, Act]),
  ...[null, 7, 30, 90].map((n) => [`end:${n}`, (f: FrequencyConfig) => setRangeEnd(f, n === null ? null : plus(f.range_start ?? TODAY, n - 1))] as [string, Act]),
  ...(['morning', 'afternoon', 'evening'] as const).map((p) => [`part:${p}`, (f: FrequencyConfig) => togglePartOfDay(f, p)] as [string, Act]),
];

function reachable(): FrequencyConfig[] {
  const seen = new Map<string, FrequencyConfig>([[JSON.stringify(DEFAULT), DEFAULT]]);
  let frontier = [DEFAULT];
  for (let depth = 0; depth < 3; depth++) {
    const next: FrequencyConfig[] = [];
    for (const fc of frontier) for (const [, act] of ACTIONS) {
      const r = act(fc);
      const k = JSON.stringify(r);
      if (!seen.has(k)) { seen.set(k, r); next.push(r); }
    }
    frontier = next;
  }
  let seed = 20260803;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let w = 0; w < 400; w++) {
    let fc = DEFAULT;
    for (let s = 0; s < 40; s++) {
      fc = ACTIONS[Math.floor(rnd() * ACTIONS.length)][1](fc);
      seen.set(JSON.stringify(fc), fc);
    }
  }
  return [...seen.values()];
}

const STATES = reachable();
const habitOf = (fc: FrequencyConfig): Habit =>
  ({ id: 'h', frequency_config: fc, created_at: `${TODAY}T09:00:00`, end_condition: null, status: 'active' } as unknown as Habit);

describe('state space', () => {
  it('the search actually explores (not a vacuous pass)', () => {
    expect(STATES.length).toBeGreaterThan(1000);
    const kinds = new Set(STATES.map((s) => scheduleKind(habitOf(s)).kind));
    expect([...kinds].sort()).toEqual(['daily', 'every_n_days', 'monthly_count', 'weekly_count', 'weekly_days']);
  });
});

describe('A1 / A8 — nothing without a target leaves the form; everything that leaves passes the validator', () => {
  const complete = STATES.filter(isFrequencyComplete);

  it('every complete state: one of the five shapes, count > 0 in count modes, eligible on at least one day', () => {
    expect(complete.length).toBeGreaterThan(500);
    for (const fc of complete) {
      const h = habitOf(fc);
      const sk = scheduleKind(h);
      if (sk.kind === 'weekly_count' || sk.kind === 'monthly_count') expect(sk.count).toBeGreaterThan(0);
      if (sk.kind === 'weekly_days') expect(sk.days.length).toBeGreaterThan(0);
      const start = parseLocalDate(fc.range_start ?? TODAY)!;
      expect(Array.from({ length: 400 }, (_, i) => addDaysLocal(start, i)).some((d) => isEligibleOn(h, d))).toBe(true);
    }
  });

  it('A8 — every complete state is accepted by validateFrequencyConfig unchanged (same shape as the AI Coach path)', () => {
    for (const fc of complete) {
      const r = validateFrequencyConfig(fc, 'frequency_config');
      expect(r.errors).toEqual([]);
      // the validator sorts `days`; everything else must come back as written
      const norm = (x: FrequencyConfig) => ({ ...x, ...(x.days ? { days: [...x.days].sort((a, b) => a - b) } : {}) });
      expect(r.frequency).toEqual(norm(fc));
    }
  });

  it('the ONLY incomplete reachable state is weekly "belirli günler" with no day picked yet (blocked by canProceed)', () => {
    const incomplete = STATES.filter((s) => !isFrequencyComplete(s));
    expect(incomplete.length).toBeGreaterThan(0);
    for (const fc of incomplete) expect(fc).toMatchObject({ kind: 'weekly', days: [] });
  });

  it('NEGATIVE — no reachable state has a count of 0 or below (red if a target-less count can be produced)', () => {
    for (const fc of STATES) if (fc.count !== undefined) expect(fc.count).toBeGreaterThanOrEqual(1);
    expect(isFrequencyComplete({ kind: 'monthly' })).toBe(false);
    expect(isFrequencyComplete({ kind: 'weekly', count: 0 } as FrequencyConfig)).toBe(false);
    expect(isFrequencyComplete({ kind: 'weekly' })).toBe(false);
  });

  it('pressing "Devam" on untouched defaults always yields a target', () => {
    expect(isFrequencyComplete(DEFAULT)).toBe(true);
    expect(isFrequencyComplete(setFrequencyKind(DEFAULT, 'weekly'))).toBe(true);
    expect(isFrequencyComplete(setFrequencyKind(DEFAULT, 'monthly'))).toBe(true);
  });
});

describe('A2 — weekly is days XOR count', () => {
  it('NEGATIVE — no reachable state has days and count together (red if both)', () => {
    for (const fc of STATES) expect(fc.days !== undefined && fc.count !== undefined).toBe(false);
  });

  it('switching sub-mode clears the other field; defaults: count 3, days none picked', () => {
    const w = setFrequencyKind(DEFAULT, 'weekly');
    expect(w).toEqual({ kind: 'weekly', count: DEFAULT_WEEKLY_COUNT });
    expect(weeklyModeOf(w)).toBe('count');
    const d = setWeeklyMode(w, 'days');
    expect(d).toEqual({ kind: 'weekly', days: [] });
    expect(setWeeklyMode(toggleWeekday(d, 2), 'count')).toEqual({ kind: 'weekly', count: DEFAULT_WEEKLY_COUNT });
  });

  it('a count cannot be written while in days mode', () => {
    const d = toggleWeekday(setWeeklyMode(setFrequencyKind(DEFAULT, 'weekly'), 'days'), 0);
    expect(setFrequencyCount(d, 5)).toBe(d);
  });
});

describe('A3 — monthly is a count 1..31', () => {
  it('default 1; the stepper stays within 1..31 (the validator\'s own ceiling)', () => {
    let m = setFrequencyKind(DEFAULT, 'monthly');
    expect(m).toEqual({ kind: 'monthly', count: DEFAULT_MONTHLY_COUNT });
    m = setFrequencyCount(m, 0);
    expect(m.count).toBe(1);
    for (let i = 0; i < 40; i++) m = setFrequencyCount(m, (m.count ?? 1) + 1);
    expect(m.count).toBe(MAX_MONTHLY_COUNT);
    expect(countCeiling('monthly')).toBe(MAX_MONTHLY_COUNT);
    expect(countCeiling('weekly')).toBe(MAX_WEEKLY_COUNT);
    expect(setFrequencyCount(m, Number.NaN)).toBe(m);
  });
});

describe('A4 — daily + interval 2..365; 1 is plain daily', () => {
  it('presets and typed values', () => {
    expect(setIntervalDays(DEFAULT, 3)).toEqual({ kind: 'daily', interval_days: 3 });
    expect(setIntervalDays(DEFAULT, 365)).toEqual({ kind: 'daily', interval_days: 365 });
    expect(setIntervalDays(DEFAULT, 400)).toEqual({ kind: 'daily', interval_days: 365 });
  });

  it('1, 0, nothing, garbage REMOVE the field -- never written as 1 (red if it is)', () => {
    const three = setIntervalDays(DEFAULT, 3);
    for (const n of [1, 0, -4, null, Number.NaN]) {
      const r = setIntervalDays(three, n);
      expect(r).toEqual({ kind: 'daily' });
      expect(r).not.toHaveProperty('interval_days');
    }
  });

  it('interval only on daily', () => {
    const w = setFrequencyKind(DEFAULT, 'weekly');
    expect(setIntervalDays(w, 3)).toBe(w);
  });
});

describe('A5 — the date envelope', () => {
  it('combines with every shape and may be one-sided', () => {
    const shapes = [DEFAULT, setIntervalDays(DEFAULT, 3), setFrequencyKind(DEFAULT, 'weekly'),
      toggleWeekday(setWeeklyMode(setFrequencyKind(DEFAULT, 'weekly'), 'days'), 1), setFrequencyKind(DEFAULT, 'monthly')];
    for (const s of shapes) {
      const onlyStart = setRangeStart(s, '2026-08-10');
      const onlyEnd = setRangeEnd(s, '2026-08-20');
      const both = setRangeEnd(onlyStart, '2026-08-20');
      for (const fc of [onlyStart, onlyEnd, both]) {
        expect(isFrequencyComplete(fc)).toBe(isFrequencyComplete(s));
        expect(scheduleKind(habitOf(fc)).kind).toBe(scheduleKind(habitOf(s)).kind);
      }
      expect(both).toMatchObject({ range_start: '2026-08-10', range_end: '2026-08-20' });
    }
  });

  it('NEGATIVE — start > end cannot be produced (red if it can)', () => {
    for (const fc of STATES) if (fc.range_start && fc.range_end) expect(fc.range_start <= fc.range_end).toBe(true);
    const e = setRangeEnd(DEFAULT, '2026-08-05');
    expect(setRangeStart(e, '2026-08-20')).toEqual({ kind: 'daily', range_start: '2026-08-20' }); // end dropped, not inverted
    const s = setRangeStart(DEFAULT, '2026-08-20');
    expect(setRangeEnd(s, '2026-08-05')).toBe(s);                                                // refused
    expect(setRangeStart(DEFAULT, '2026-02-30')).toBe(DEFAULT);                                    // not a day
  });
});

describe('A6 — kind switches: valid, envelope and part_of_day kept, shape fields cleared', () => {
  const KINDS = ['daily', 'weekly', 'monthly'] as const;
  const ENV = { range_start: '2026-08-10', range_end: '2026-08-30', part_of_day: ['morning' as const, 'evening' as const] };
  const fromStates: FrequencyConfig[] = [
    { kind: 'daily', ...ENV },
    { kind: 'daily', interval_days: 3, ...ENV },
    { kind: 'weekly', count: 5, ...ENV },
    { kind: 'weekly', days: [0, 2, 4], ...ENV },
    { kind: 'weekly', days: [], ...ENV },
    { kind: 'monthly', count: 12, ...ENV },
  ];

  for (const from of fromStates) for (const to of KINDS) {
    it(`${JSON.stringify({ kind: from.kind, days: from.days, count: from.count, interval_days: from.interval_days })} -> ${to}`, () => {
      const r = setFrequencyKind(from, to);
      expect(r.kind).toBe(to);
      if (from.kind === to) { expect(r).toBe(from); return; }   // re-selecting changes nothing
      expect(isFrequencyComplete(r)).toBe(true);
      // NEGATIVE: the envelope and time of day survive (red if wiped, as the old { kind } reset did)
      expect(r).toMatchObject(ENV);
      // shape fields of the old shape are gone
      if (to !== 'weekly' || from.kind !== 'weekly') expect(r).not.toHaveProperty('days');
      if (to === 'daily') { expect(r).not.toHaveProperty('count'); }
      if (to !== 'daily') expect(r).not.toHaveProperty('interval_days');
    });
  }

  it('the old reset is what this replaces: it wiped the envelope', () => {
    expect(legacyRun([{ t: 'part', p: 'morning' }, { t: 'kind', kind: 'weekly' }])).toEqual({ kind: 'weekly' });
    expect(setFrequencyKind(togglePartOfDay(DEFAULT, 'morning'), 'weekly')).toEqual({ kind: 'weekly', count: 3, part_of_day: ['morning'] });
  });
});

describe('A7 — "Günlük" and "Haftalık + belirli günler" produce exactly what the old form produced', () => {
  const run = (actions: LegacyAction[]): FrequencyConfig => {
    let fc = DEFAULT;
    for (const a of actions) {
      if (a.t === 'kind') {
        fc = setFrequencyKind(fc, a.kind);
        // the new UI needs one extra tap to reach the day picker
        if (a.kind === 'weekly') fc = setWeeklyMode(fc, 'days');
      } else if (a.t === 'day') fc = toggleWeekday(fc, a.i);
      else fc = togglePartOfDay(fc, a.p);
    }
    return fc;
  };
  const paths = a7Paths();

  it('the corpus is non-trivial and covers both paths', () => {
    expect(paths.length).toBeGreaterThan(200);
    expect(paths.some((p) => legacyRun(p.actions).kind === 'daily')).toBe(true);
    expect(paths.some((p) => legacyRun(p.actions).kind === 'weekly')).toBe(true);
  });

  // ONE deliberate, named difference: the old form left `part_of_day: []` after
  // a time of day was picked and un-picked, which validateFrequencyConfig
  // refuses (A8). The new toggle removes the key instead. Every other path --
  // and every byte of these, apart from that key -- is identical.
  const dropEmptyParts = (fc: FrequencyConfig) => {
    if (fc.part_of_day && fc.part_of_day.length === 0) {
      const { part_of_day: _p, ...rest } = fc;
      return rest;
    }
    return fc;
  };

  it('NEGATIVE — byte-identical JSON for every path (red if any output changes)', () => {
    const diffs = paths.filter((p) => JSON.stringify(run(p.actions)) !== JSON.stringify(dropEmptyParts(legacyRun(p.actions))));
    expect(diffs.map((d) => d.name)).toEqual([]);
  });

  it('the named difference is real and bounded: only empty part_of_day, and the old output was invalid', () => {
    const affected = paths.filter((p) => JSON.stringify(run(p.actions)) !== JSON.stringify(legacyRun(p.actions)));
    expect(affected.length).toBeGreaterThan(0);
    for (const p of affected) {
      const old = legacyRun(p.actions);
      expect(old.part_of_day).toEqual([]);
      expect(validateFrequencyConfig(old, 'f').frequency).toBeNull();          // old: refused
      expect(validateFrequencyConfig(run(p.actions), 'f').frequency).not.toBeNull(); // new: accepted
    }
    // reported in STATE.md with this count
    expect(affected.length).toBe(paths.filter((p) => legacyRun(p.actions).part_of_day?.length === 0).length);
  });
});

describe('Adım 5 — the schedule as a sentence', () => {
  it('all five shapes and the envelope', () => {
    expect(frequencySummary({ kind: 'daily' })).toBe('Her gün');
    expect(frequencySummary({ kind: 'daily', interval_days: 3 })).toBe('3 günde bir');
    expect(frequencySummary({ kind: 'weekly', days: [4, 0, 2] })).toBe('Haftada 3 gün · Pzt, Çar, Cum');
    expect(frequencySummary({ kind: 'weekly', count: 3 })).toBe('Haftada 3 kez');
    expect(frequencySummary({ kind: 'monthly', count: 10 })).toBe('Ayda 10 kez');
    expect(frequencySummary({ kind: 'weekly', count: 3, range_start: '2026-08-05', range_end: '2026-08-20' }))
      .toBe('Haftada 3 kez · 5–20 Ağustos arası');
    expect(rangeSummary({ kind: 'daily', range_start: '2026-07-28', range_end: '2026-08-05' })).toBe('28 Temmuz – 5 Ağustos arası');
    expect(rangeSummary({ kind: 'daily', range_start: '2026-12-20', range_end: '2027-01-10' })).toBe('20 Aralık 2026 – 10 Ocak 2027 arası');
    expect(rangeSummary({ kind: 'daily', range_start: '2026-08-05' })).toBe('5 Ağustos itibarıyla');
    expect(rangeSummary({ kind: 'daily', range_end: '2026-08-20' })).toBe('20 Ağustos tarihine kadar');
    expect(rangeSummary({ kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-05' })).toBe('yalnız 5 Ağustos');
  });

  it('a target-less config says so instead of pretending', () => {
    expect(frequencySummary({ kind: 'monthly' })).toBe('Hedef yok');
    expect(frequencySummary({ kind: 'weekly', days: [] })).toBe('Gün seçilmedi');
  });
});

describe('A10 — the cost the form shows reflects the interval', () => {
  const formLike = (frequency_config: FrequencyConfig) => ({
    difficulty: 3, impact_level: 'medium' as const, behavior_type: 'positive' as const,
    tracking_type: 'boolean' as const, estimated_minutes: 0,
    frequency_config: frequency_config as never,
  });

  it('every 3 days costs less than daily, at the form\'s defaults and at difficulty 5', () => {
    expect(computeWillpowerCost(formLike(setIntervalDays(DEFAULT, 3)))).toBeLessThan(computeWillpowerCost(formLike(DEFAULT)));
    expect(computeWillpowerCost({ ...formLike(setIntervalDays(DEFAULT, 3)), difficulty: 5 }))
      .toBeLessThan(computeWillpowerCost({ ...formLike(DEFAULT), difficulty: 5 }));
  });
});
