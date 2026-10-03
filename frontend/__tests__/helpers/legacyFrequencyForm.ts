/**
 * R01.02-e A7 — the habit form's step-3 frequency logic as it was at HEAD
 * `6895c44` (components/HabitOnboarding.tsx lines 345-361), BEFORE this card.
 *
 * It was three inline closures over component state, so it could not be called
 * from a test. The bodies below are those closures with only the
 * `setForm({ ...form, frequency_config: X })` wrapper replaced by `return X`
 * and `freq` passed in -- every expression that builds the config is verbatim.
 * (Checked against `git show 6895c44:frontend/components/HabitOnboarding.tsx`
 * when this file was written.)
 */
import type { FrequencyConfig } from '../../lib/supabase';

export type LegacyAction =
  | { t: 'kind'; kind: FrequencyConfig['kind'] }
  | { t: 'day'; i: number }
  | { t: 'part'; p: 'morning' | 'afternoon' | 'evening' };

export const LEGACY_DEFAULT: FrequencyConfig = { kind: 'daily' };

export function legacySetKind(_freq: FrequencyConfig, kind: FrequencyConfig['kind']): FrequencyConfig {
  return { kind };
}

export function legacyToggleDay(freq: FrequencyConfig, dayIdx: number): FrequencyConfig {
  const days = freq.days ?? [];
  const next = days.includes(dayIdx) ? days.filter((d) => d !== dayIdx) : [...days, dayIdx];
  return { ...freq, days: next };
}

export function legacyTogglePartOfDay(freq: FrequencyConfig, part: string): FrequencyConfig {
  const parts = freq.part_of_day ?? [];
  const next = parts.includes(part as any)
    ? parts.filter((p) => p !== part)
    : [...parts, part as any];
  return { ...freq, part_of_day: next };
}

export function legacyRun(actions: LegacyAction[]): FrequencyConfig {
  let fc = LEGACY_DEFAULT;
  for (const a of actions) {
    if (a.t === 'kind') fc = legacySetKind(fc, a.kind);
    else if (a.t === 'day') fc = legacyToggleDay(fc, a.i);
    else fc = legacyTogglePartOfDay(fc, a.p);
  }
  return fc;
}

/**
 * The A7 corpus: every "Günlük" and "Haftalık + belirli günler" path in which
 * kind switches come BEFORE any time-of-day toggle. (A kind switch AFTER a
 * time-of-day toggle is exactly what the old form got wrong -- it wiped
 * `part_of_day` -- and is A6's subject, not a preserved behaviour.)
 * Deterministic: no randomness.
 */
export function a7Paths(): { name: string; actions: LegacyAction[] }[] {
  const PARTS = ['morning', 'afternoon', 'evening'] as const;
  const partSeqs: LegacyAction[][] = [[]];
  for (const a of PARTS) {
    partSeqs.push([{ t: 'part', p: a }]);
    for (const b of PARTS) {
      partSeqs.push([{ t: 'part', p: a }, { t: 'part', p: b }]);
      for (const c of PARTS) partSeqs.push([{ t: 'part', p: a }, { t: 'part', p: b }, { t: 'part', p: c }]);
    }
  }
  const out: { name: string; actions: LegacyAction[] }[] = [];
  // Günlük
  const dailyPrefixes: LegacyAction[][] = [
    [], [{ t: 'kind', kind: 'daily' }],
    [{ t: 'kind', kind: 'weekly' }, { t: 'kind', kind: 'daily' }],
    [{ t: 'kind', kind: 'monthly' }, { t: 'kind', kind: 'daily' }],
  ];
  dailyPrefixes.forEach((pre, i) => partSeqs.forEach((ps, j) => out.push({ name: `daily#${i}.${j}`, actions: [...pre, ...ps] })));
  // Haftalık + belirli günler (final day set non-empty)
  const weeklyPrefixes: LegacyAction[][] = [
    [{ t: 'kind', kind: 'weekly' }],
    [{ t: 'kind', kind: 'daily' }, { t: 'kind', kind: 'weekly' }],
    [{ t: 'kind', kind: 'monthly' }, { t: 'kind', kind: 'weekly' }],
  ];
  const daySeqs: number[][] = [
    [0], [6], [0, 2, 4], [4, 0, 2], [1, 3], [0, 1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1, 0],
    [0, 2, 0, 4], [3, 3, 5], [2, 4, 2, 6, 4], [1, 1, 1], [5, 0, 5, 0, 3],
  ];
  weeklyPrefixes.forEach((pre, i) => daySeqs.forEach((ds, j) => [0, 1, 4, 13].forEach((pk) => {
    const days = ds.map((d) => ({ t: 'day', i: d }) as LegacyAction);
    const parts = partSeqs[pk];
    // interleave: days, then parts, then (for some) one more day pair that cancels
    const actions: LegacyAction[] = [...pre, ...days.slice(0, 1), ...parts, ...days.slice(1)];
    out.push({ name: `weekly-days#${i}.${j}.${pk}`, actions });
  })));
  return out.filter((p) => {
    const fc = legacyRun(p.actions);
    return fc.kind === 'daily' || (fc.days !== undefined && fc.days.length > 0);
  });
}
