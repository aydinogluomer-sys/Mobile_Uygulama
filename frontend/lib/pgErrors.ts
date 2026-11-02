/**
 * Postgres / PostgREST error codes the client branches on. Pure, so tests and
 * services can share the exact rule without pulling in the Supabase client.
 */

/** A table that does not exist yet (its migration has not run): PostgREST PGRST205, Postgres 42P01. */
export const isMissingTable = (code?: string) => code === 'PGRST205' || code === '42P01';

// ---------------------------------------------------------------------------
// habit_logs refusals raised by fn_habit_log_guard() (migration 038, F03)
// ---------------------------------------------------------------------------

/** Message token raised by fn_habit_log_guard() (migration 038), SQLSTATE 22023. */
export const HABIT_LOG_DAY_OUT_OF_RANGE = 'habit_log_day_out_of_range';
/** Message token raised when a log's habit_id / user_id / completed_at is changed (migration 038), SQLSTATE 22023. */
export const HABIT_LOG_KEY_IMMUTABLE = 'habit_log_key_immutable';

/** Calm, non-blaming Turkish copy; shown by the store and by the coach card validation. */
export const LOGGABLE_DAY_MESSAGE = 'Bu gün için kayıt eklenemiyor. Bugünü ve son 14 günü işaretleyebilirsin.';
export const LOG_KEY_IMMUTABLE_MESSAGE = 'Bu kaydın günü değiştirilemez. Yeni bir gün için yeni kayıt ekleyebilirsin.';

/**
 * True for the server's day-window refusal. The token decides, not the code alone:
 * other `22023` errors exist and must keep their own message.
 */
export function isHabitLogDayOutOfRange(
  err: string | { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  if (typeof err === 'string') return err.includes(HABIT_LOG_DAY_OUT_OF_RANGE);
  return typeof err.message === 'string' && err.message.includes(HABIT_LOG_DAY_OUT_OF_RANGE);
}

/** Maps a raw server/PostgREST error string to user copy; unknown strings pass through unchanged. */
export function describeHabitLogError(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  if (raw.includes(HABIT_LOG_DAY_OUT_OF_RANGE)) return LOGGABLE_DAY_MESSAGE;
  if (raw.includes(HABIT_LOG_KEY_IMMUTABLE)) return LOG_KEY_IMMUTABLE_MESSAGE;
  return raw;
}
