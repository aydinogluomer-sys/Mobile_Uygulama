-- The timezone a habit log was written in. (Implementation v3, R01.06)
--
-- STATUS: WRITTEN, NOT APPLIED. The canonical project is frozen pending the
-- owner's backup check (STATE.md db_state, stop points S1/S2). The client
-- captures the device's IANA zone with every log intent but sends it only
-- behind LOG_TIMEZONE_ENABLED = false (lib/featureGates.ts), so no write ever
-- names a column that does not exist yet. Turn the gate on AFTER this runs.
--
-- Why: `completed_at` is the LOCAL day the user meant (lib/date.ts contract);
-- without the zone it was written in, a log made while travelling cannot be
-- told apart from a clock or DST error. The column is a record, not a key:
-- nothing reads it to decide a day, so old rows (NULL) count exactly as before.
--
-- Additive and forward-only: one nullable column, no backfill, no default.
-- The table's existing owner-only RLS covers it; no policy change is needed.
-- Note: the live habit_logs shape is not fully in this repo (S12) -- run the
-- pre-check in docs/implementation-v3/SQL_FOR_OWNER.md first.

ALTER TABLE public.habit_logs
  ADD COLUMN IF NOT EXISTS tz text;

ALTER TABLE public.habit_logs
  DROP CONSTRAINT IF EXISTS habit_logs_tz_check;

ALTER TABLE public.habit_logs
  ADD CONSTRAINT habit_logs_tz_check CHECK (tz IS NULL OR char_length(tz) BETWEEN 1 AND 64);
