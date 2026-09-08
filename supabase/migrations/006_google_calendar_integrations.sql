-- ============================================================
-- google_calendar_integrations — the table the Google Calendar feature has
-- always assumed and never had.
--
-- P0-3 in docs/FINAL_GAP_AUDIT_V2.md. `frontend/store/googleCalendarStore.ts`
-- calls a `google-auth` edge function with four actions; that function existed
-- only under `backend/supabase/functions/` (never canonical, never deployed),
-- and the table it writes to did not exist on the live project at all:
--
--   information_schema.tables where table_name = 'google_calendar_integrations'
--     -> 0 rows (verified 2026-08-30, before this migration)
--
-- So every Google Calendar action in the shipped app resolved to a 404 while
-- the UI presented the integration as available.
--
-- Scope: ADDITIVE ONLY.
--   * Creates one new table. Touches no existing table, column or row.
--   * No DROP, no destructive ALTER, no backfill, no data migration.
--   * Idempotent — safe to run more than once.
--
-- Pre-flight verified immediately before applying:
--   * google_calendar_integrations already present ... 0 (absent)
--   * public tables ............................... 49
--
-- ── WHY THERE ARE NO CLIENT POLICIES ────────────────────────────────────
-- RLS is enabled and DELIBERATELY has zero policies, which denies every
-- client — authenticated ones included — outright. This is the same
-- server-only fail-closed design `spotify_accounts` already uses on this
-- project (also 0 policies, verified), and it is correct rather than an
-- oversight: this table holds a Google OAuth `refresh_token`, which is a
-- long-lived credential for the user's calendar.
--
-- An owner-scoped `auth.uid() = user_id` policy would look tidier and would
-- make that refresh token readable by anything holding the user's JWT — a
-- compromised session would leak durable calendar access rather than an
-- hour-long one. The tokens are reached only by the `google-auth` edge
-- function through the service role, after it has verified the caller's
-- identity itself. Do not "fix" the policy count here.
-- ============================================================

create table if not exists public.google_calendar_integrations (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_token  text        not null,
  -- Google omits refresh_token on re-consent unless prompt=consent is sent.
  -- Default '' rather than NULL so the column's NOT NULL contract holds for a
  -- re-link that legitimately returns no new refresh token.
  refresh_token text        not null default '',
  expires_at    timestamptz,
  scope         text,
  token_type    text,
  calendar_id   text,
  calendar_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.google_calendar_integrations enable row level security;

comment on table public.google_calendar_integrations is
  'Google Calendar OAuth tokens. SERVER-ONLY / FAIL-CLOSED: RLS enabled with '
  'zero policies by design, so no client can read or write it. Reached only by '
  'the google-auth edge function via the service role, after it verifies the '
  'caller. Same model as spotify_accounts. Adding a client policy here would '
  'expose a long-lived refresh token to any holder of the user''s JWT.';
