/**
 * F15 (DOM-12): single-source resolver and install-time stamper for a habit's
 * local creation calendar day (`frequency_config.created_day`).
 *
 * Why this exists:
 * `habits.created_at` is a UTC instant (`timestamptz`). Deriving the creation day
 * with `ymd(new Date(habit.created_at))` or `ymdFromIso(habit.created_at)` re-interprets
 * that instant in the device's CURRENT time zone on every read: a habit created at
 * 2026-08-01 02:00 Europe/Istanbul (`2026-07-31T23:00:00Z`) shifts its anchor to
 * `2026-07-31` when the user travels to America/New_York, shifting every `every_n_days`
 * occurrence by a day and breaking active streaks.
 *
 * Repository habit inserts stamp `created_day` with `todayLocal()` at creation time.
 * Legacy rows without a valid `created_day` fall back to `ymdFromIso(created_at)`.
 *
 * Dependency note: imports ONLY `./date` so pure planning modules (`starterPlan.ts` ->
 * `capacity.ts`) never pull in `lib/supabase.ts` at runtime.
 */
import { parseLocalDate, ymdFromIso, type Ymd } from './date';

/** frequency_config içindeki anahtar adı; şekle ait değildir. */
export const CREATED_DAY_KEY = 'created_day' as const;

/** Geçerli, gerçek bir YYYY-MM-DD ise damga; aksi halde null. */
export function readCreatedDayStamp(
  config: { created_day?: unknown } | null | undefined,
): Ymd | null {
  if (!config || typeof config !== 'object') return null;
  const raw = config.created_day;
  if (typeof raw !== 'string') return null;
  return parseLocalDate(raw) !== null ? raw : null;
}

/**
 * Önce damga, yoksa created_at'in CİHAZ yerel günü (eski satırlar: bugünkü davranış),
 * ikisi de yoksa null.
 */
export function habitCreatedDay(habit: {
  created_at?: string | null;
  frequency_config?: { created_day?: unknown } | null;
}): Ymd | null {
  const stamped = readCreatedDayStamp(habit.frequency_config);
  if (stamped !== null) return stamped;
  if (!habit.created_at) return null;
  const derived = ymdFromIso(habit.created_at);
  return derived !== '' ? derived : null;
}

/** Üzerine yazar; girdiyi değiştirmez. Çağıran bugünü verir (todayLocal()). */
export function stampCreatedDay<T extends object>(
  config: T,
  today: Ymd,
): T & { created_day: Ymd } {
  return { ...config, created_day: today };
}
