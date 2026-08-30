/**
 * Quit-savings arithmetic.
 *
 * The formula moved off the FastAPI service, where it was:
 *
 *     days_since_quit = (datetime.utcnow() - habit["quit_date"]).days
 *     money_saved     = days_since_quit * habit["cost_per_day"]
 *
 * Python's `timedelta.days` floors toward negative infinity, so a quit date
 * in the future produced a negative day count, a negative money_saved, and a
 * "Tasarruf Raporu" telling the user they were down ₺140 for a quit that had
 * not started. Nothing between that endpoint and the UI clamped it.
 */
// The savings math is pure, but the service also re-exports the CRUD calls,
// so importing it would construct the Supabase client. The repository is
// mocked away to keep these tests about arithmetic.
jest.mock('../../repositories/badHabitRepository', () => ({
  fetchBadHabitsPage: jest.fn(),
  insertBadHabit: jest.fn(),
  updateBadHabit: jest.fn(),
  deleteBadHabit: jest.fn(),
}));

import { daysSinceQuit, savingsFor } from '../../services/badHabitService';

const at = (iso: string) => new Date(iso);

describe('daysSinceQuit', () => {
  it('counts whole elapsed days', () => {
    expect(daysSinceQuit('2026-08-01T00:00:00Z', at('2026-08-31T00:00:00Z'))).toBe(30);
  });

  it('floors a partial day rather than rounding up', () => {
    // The inputs are per-DAY rates. Crediting 23 hours as a day would price
    // something the user never said.
    expect(daysSinceQuit('2026-08-30T00:00:00Z', at('2026-08-30T23:00:00Z'))).toBe(0);
    expect(daysSinceQuit('2026-08-30T00:00:00Z', at('2026-08-31T01:00:00Z'))).toBe(1);
  });

  it('a FUTURE quit date is zero days, not negative (legacy bug)', () => {
    expect(daysSinceQuit('2026-09-30T00:00:00Z', at('2026-08-30T00:00:00Z'))).toBe(0);
  });

  it('the moment of quitting is zero, not one', () => {
    expect(daysSinceQuit('2026-08-30T12:00:00Z', at('2026-08-30T12:00:00Z'))).toBe(0);
  });

  it('an unparseable date is zero, never NaN', () => {
    for (const bad of ['', 'not a date', 'undefined']) {
      const d = daysSinceQuit(bad, at('2026-08-30T00:00:00Z'));
      expect(Number.isNaN(d)).toBe(false);
      expect(d).toBe(0);
    }
  });
});

describe('savingsFor', () => {
  const habit = (over: Partial<{ quit_date: string; cost_per_day: number; time_wasted_per_day: number }> = {}) => ({
    quit_date: '2026-08-01T00:00:00Z',
    cost_per_day: 50,
    time_wasted_per_day: 90,
    ...over,
  });

  it('prices the elapsed days', () => {
    const s = savingsFor(habit(), at('2026-08-31T00:00:00Z'));
    expect(s).toEqual({
      daysSinceQuit: 30,
      moneySaved: 1500,
      timeSavedMinutes: 2700,
      timeSavedHours: 45,
    });
  });

  it('never reports a negative saving for a future quit date', () => {
    const s = savingsFor(habit({ quit_date: '2026-12-01T00:00:00Z' }), at('2026-08-30T00:00:00Z'));
    expect(s.daysSinceQuit).toBe(0);
    expect(s.moneySaved).toBe(0);
    expect(s.timeSavedMinutes).toBe(0);
    expect(s.timeSavedHours).toBe(0);
  });

  it('handles a numeric column arriving as a string', () => {
    // PostgREST can return numeric(12,2) as "12.50". `'12.50' + 3` is
    // '12.503' in JS, so an un-coerced value would not just be wrong, it
    // would be wrong in a way that still renders.
    const s = savingsFor(
      { quit_date: '2026-08-01T00:00:00Z', cost_per_day: '12.50' as unknown as number, time_wasted_per_day: '30' as unknown as number },
      at('2026-08-11T00:00:00Z'),
    );
    expect(s.moneySaved).toBe(125);
    expect(s.timeSavedMinutes).toBe(300);
  });

  it('rounds money to two places and hours to one', () => {
    const s = savingsFor(habit({ cost_per_day: 3.333, time_wasted_per_day: 7 }), at('2026-08-04T00:00:00Z'));
    expect(s.moneySaved).toBe(10); // 3 x 3.333 = 9.999
    expect(s.timeSavedHours).toBe(0.4); // 21 minutes
  });

  it('zero rates give a day count and nothing else', () => {
    const s = savingsFor(habit({ cost_per_day: 0, time_wasted_per_day: 0 }), at('2026-08-31T00:00:00Z'));
    expect(s.daysSinceQuit).toBe(30);
    expect(s.moneySaved).toBe(0);
    expect(s.timeSavedHours).toBe(0);
  });

  it('savings never decrease as time passes', () => {
    const h = habit();
    const days = ['2026-08-02', '2026-08-10', '2026-09-01', '2027-01-01']
      .map((d) => savingsFor(h, at(`${d}T00:00:00Z`)).moneySaved);
    for (let i = 1; i < days.length; i++) expect(days[i]).toBeGreaterThan(days[i - 1]);
  });
});
