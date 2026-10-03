/**
 * Habit form → `frequency_config`, as pure transitions (R01.02-e).
 *
 * The form (`components/HabitOnboarding.tsx`, step 3) used to express two of
 * the scheduler's five shapes. "Haftalık" with no day picked and "Aylık" both
 * produced a count-mode config with `count` 0 -- a habit with NO target: due on
 * no day, in no report, visible on Today only through its fail-open. Every
 * transition below returns a config the scheduler can honour, or -- for the one
 * state that needs a user choice ("belirli günler" with nothing picked yet) --
 * one that `isFrequencyComplete` rejects, which the form uses to block "Devam".
 *
 * Every config this module produces stays inside `validateFrequencyConfig`'s
 * rules (`lib/routineProposal.ts`), so a habit made in the form and one
 * proposed by the AI Coach are the same shape. The bounds are imported from
 * there, never restated.
 */
import type { FrequencyConfig } from './supabase';
import {
  MAX_WEEKLY_COUNT, MAX_MONTHLY_COUNT, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS, validateFrequencyConfig,
} from './routineProposal';
import { scheduleKind } from './habitSchedule';
import { parseLocalDate } from './date';

/**
 * Defaults a kind switch lands on, so pressing "Devam" without touching
 * anything still yields a habit with a target:
 *   weekly  3 a week -- the commonest stated weekly goal ("haftada 3 spor"),
 *           and it leaves room both up and down within 1-7.
 *   monthly 1 a month -- the smallest real target; "Aylık" says nothing about
 *           how often, so the form commits the user to the least it can.
 */
export const DEFAULT_WEEKLY_COUNT = 3;
export const DEFAULT_MONTHLY_COUNT = 1;
/** Ready-made "every N days" choices; any 2-365 may also be typed. */
export const INTERVAL_PRESETS = [2, 3, 7] as const;

export type WeeklyMode = 'days' | 'count';

/** Shape-independent fields: the envelope and the time of day. */
function keepEnvelope(fc: FrequencyConfig): Partial<FrequencyConfig> {
  const out: Partial<FrequencyConfig> = {};
  if (fc.part_of_day !== undefined) out.part_of_day = fc.part_of_day;
  if (fc.range_start !== undefined) out.range_start = fc.range_start;
  if (fc.range_end !== undefined) out.range_end = fc.range_end;
  return out;
}

/**
 * Kind switch. Shape-specific fields (`days`, `count`, `interval_days`) belong
 * to the OLD shape and are dropped; carrying "Pzt/Çar/Cum" into "Aylık" would be
 * a schedule the user did not pick. The date envelope and `part_of_day` are not
 * part of any shape (R01.02-d1) and are kept -- the old `{ kind }` reset wiped
 * them silently. Re-selecting the current kind changes nothing.
 */
export function setFrequencyKind(fc: FrequencyConfig, kind: FrequencyConfig['kind']): FrequencyConfig {
  if (fc.kind === kind) return fc;
  const base = { ...keepEnvelope(fc) };
  if (kind === 'weekly') return { kind, count: DEFAULT_WEEKLY_COUNT, ...base };
  if (kind === 'monthly') return { kind, count: DEFAULT_MONTHLY_COUNT, ...base };
  return { kind: 'daily', ...base };
}

/** Which weekly sub-mode a config is in. `days` present (even empty) = days. */
export function weeklyModeOf(fc: FrequencyConfig): WeeklyMode {
  return fc.days !== undefined ? 'days' : 'count';
}

/**
 * Weekly sub-mode switch: specific days XOR N a week, never both --
 * `scheduleKind` reads `days` first and would silently ignore a `count` left
 * beside it. Entering "days" starts with no day picked (the old form's state
 * after "Haftalık"), so the day path below is byte-for-byte the old one;
 * `isFrequencyComplete` blocks "Devam" until a day is chosen.
 */
export function setWeeklyMode(fc: FrequencyConfig, mode: WeeklyMode): FrequencyConfig {
  if (fc.kind !== 'weekly' || weeklyModeOf(fc) === mode) return fc;
  const { days: _d, count: _c, ...rest } = fc;
  return mode === 'days' ? { ...rest, days: [] } : { ...rest, count: DEFAULT_WEEKLY_COUNT };
}

/**
 * Day toggle -- the old form's rule verbatim (append on add, filter on remove),
 * and only in weekly "belirli günler" mode: on daily `days` is refused by the
 * validator, and in count mode it would sit beside `count` (A2). The UI only
 * shows the picker in days mode; this makes that a property of the data too.
 */
export function toggleWeekday(fc: FrequencyConfig, dayIdx: number): FrequencyConfig {
  if (fc.kind !== 'weekly' || weeklyModeOf(fc) !== 'days') return fc;
  const days = fc.days ?? [];
  const next = days.includes(dayIdx) ? days.filter((d) => d !== dayIdx) : [...days, dayIdx];
  return { ...fc, days: next };
}

/**
 * Time-of-day toggle -- the old form's rule, with ONE deliberate difference:
 * deselecting the last part REMOVES the key instead of leaving
 * `part_of_day: []`. The old form wrote the empty array, which
 * `validateFrequencyConfig` refuses ("expected 1-3 entries") -- a config the AI
 * Coach path would reject. Found by R01.02-e's state-space test.
 */
export function togglePartOfDay(fc: FrequencyConfig, part: NonNullable<FrequencyConfig['part_of_day']>[number]): FrequencyConfig {
  const parts = fc.part_of_day ?? [];
  const next = parts.includes(part) ? parts.filter((p) => p !== part) : [...parts, part];
  if (next.length === 0) {
    const { part_of_day: _p, ...rest } = fc;
    return rest as FrequencyConfig;
  }
  return { ...fc, part_of_day: next };
}

/** Upper bound of `count` for a kind, from the validator's own constants. */
export function countCeiling(kind: FrequencyConfig['kind']): number {
  return kind === 'monthly' ? MAX_MONTHLY_COUNT : MAX_WEEKLY_COUNT;
}

/**
 * Set "N a week / a month". Clamped to 1..ceiling -- a stepper cannot leave
 * the range, so clamping here only guards a typed value; a non-number leaves
 * the config as it was (never writes 0, never writes NaN).
 */
export function setFrequencyCount(fc: FrequencyConfig, n: number): FrequencyConfig {
  if (fc.kind === 'daily' || (fc.kind === 'weekly' && weeklyModeOf(fc) === 'days')) return fc;
  if (!Number.isFinite(n)) return fc;
  const c = Math.min(Math.max(Math.round(n), 1), countCeiling(fc.kind));
  return { ...fc, count: c };
}

/**
 * "Every N days" (daily only). N <= 1, or anything that is not a number,
 * REMOVES the field: "every 1 day" is plain daily, and the validator refuses
 * `interval_days: 1` rather than coercing it, so the form must not write it.
 * Above 365 is clamped to the validator's ceiling.
 */
export function setIntervalDays(fc: FrequencyConfig, n: number | null): FrequencyConfig {
  if (fc.kind !== 'daily') return fc;
  const { interval_days: _i, ...rest } = fc;
  if (n === null || !Number.isFinite(n) || Math.round(n) < MIN_INTERVAL_DAYS) return rest as FrequencyConfig;
  return { ...rest, interval_days: Math.min(Math.round(n), MAX_INTERVAL_DAYS) };
}

/**
 * Date envelope. Either end may be absent (one-sided ranges are valid). A start
 * after the current end clears the end rather than writing start > end; an end
 * before the current start is refused (config unchanged). `null` removes a side.
 */
export function setRangeStart(fc: FrequencyConfig, ymdOrNull: string | null): FrequencyConfig {
  const { range_start: _s, ...rest } = fc;
  if (ymdOrNull === null) return rest as FrequencyConfig;
  if (!parseLocalDate(ymdOrNull)) return fc;
  if (rest.range_end !== undefined && ymdOrNull > rest.range_end) {
    const { range_end: _e, ...noEnd } = rest;
    return { ...noEnd, range_start: ymdOrNull } as FrequencyConfig;
  }
  return { ...rest, range_start: ymdOrNull } as FrequencyConfig;
}

export function setRangeEnd(fc: FrequencyConfig, ymdOrNull: string | null): FrequencyConfig {
  const { range_end: _e, ...rest } = fc;
  if (ymdOrNull === null) return rest as FrequencyConfig;
  if (!parseLocalDate(ymdOrNull)) return fc;
  if (rest.range_start !== undefined && ymdOrNull < rest.range_start) return fc;
  return { ...rest, range_end: ymdOrNull } as FrequencyConfig;
}

/**
 * Can this config leave the form? The validator must accept it AND it must
 * carry a target: count modes need count > 0 and weekly days at least one day
 * (the validator alone accepts `{ kind: 'monthly' }`, a target-less shape).
 */
export function isFrequencyComplete(fc: FrequencyConfig): boolean {
  if (validateFrequencyConfig(fc, 'frequency_config').frequency === null) return false;
  const sk = scheduleKind({ frequency_config: fc } as Parameters<typeof scheduleKind>[0]);
  if (sk.kind === 'weekly_count' || sk.kind === 'monthly_count') return sk.count > 0;
  if (sk.kind === 'weekly_days') return sk.days.length > 0;
  return true;
}

const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function dayMonth(ymd: string): { d: number; m: string; y: number } | null {
  const dt = parseLocalDate(ymd);
  return dt ? { d: dt.getDate(), m: MONTHS_TR[dt.getMonth()], y: dt.getFullYear() } : null;
}

/** "5–20 Ağustos arası", "28 Temmuz – 5 Ağustos arası", one-sided forms; '' with no range. */
export function rangeSummary(fc: FrequencyConfig): string {
  const s = fc.range_start ? dayMonth(fc.range_start) : null;
  const e = fc.range_end ? dayMonth(fc.range_end) : null;
  if (s && e) {
    if (s.y !== e.y) return `${s.d} ${s.m} ${s.y} – ${e.d} ${e.m} ${e.y} arası`;
    if (s.m === e.m) return s.d === e.d ? `yalnız ${s.d} ${s.m}` : `${s.d}–${e.d} ${s.m} arası`;
    return `${s.d} ${s.m} – ${e.d} ${e.m} arası`;
  }
  if (s) return `${s.d} ${s.m} itibarıyla`;
  if (e) return `${e.d} ${e.m} tarihine kadar`;
  return '';
}

/**
 * The schedule as a sentence, from the SAME classification the scheduler uses
 * (`scheduleKind`), so the label cannot claim a shape the engine does not read.
 */
export function frequencySummary(fc: FrequencyConfig): string {
  // `scheduleKind` reads an EMPTY days list as weekly_count 0; in the form that
  // state means "pick a day", so it is named before classification.
  if (fc.kind === 'weekly' && fc.days !== undefined && fc.days.length === 0) return 'Gün seçilmedi';
  const sk = scheduleKind({ frequency_config: fc } as Parameters<typeof scheduleKind>[0]);
  let shape: string;
  switch (sk.kind) {
    case 'daily': shape = 'Her gün'; break;
    case 'every_n_days': shape = `${sk.intervalDays} günde bir`; break;
    case 'weekly_days': {
      const names = [...sk.days].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d] ?? '?');
      shape = names.length === 7 ? 'Her gün (haftanın 7 günü)' : names.length > 0 ? `Haftada ${names.length} gün · ${names.join(', ')}` : 'Gün seçilmedi';
      break;
    }
    case 'weekly_count': shape = sk.count > 0 ? `Haftada ${sk.count} kez` : 'Hedef yok'; break;
    case 'monthly_count': shape = sk.count > 0 ? `Ayda ${sk.count} kez` : 'Hedef yok'; break;
  }
  const r = rangeSummary(fc);
  return r ? `${shape} · ${r}` : shape;
}
