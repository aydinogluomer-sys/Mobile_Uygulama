-- ============================================================
-- Bring the last two legacy-backend features onto Supabase.
--
-- Three shipping screens still called `frontend/utils/api.ts`, an axios
-- client pointed at the FastAPI service in `backend/server.py`:
--
--   settings.tsx            webhookAPI  (list / create / delete)
--   settings.tsx            exportAPI   (full JSON backup)
--   BadHabitsTracker.tsx    badHabitAPI (list / create / savings)
--
-- That service has NO authentication of any kind -- `grep -c` for Depends,
-- jwt, Authorization and verify_token over the whole file returns 0 -- and
-- every model on it is owned by the literal string "default":
--
--   backend/server.py:159   user_id: str = "default"  # For multi-user support later
--
-- So all users share one bucket. `GET /api/export` is the sharpest edge: it
-- reads every habits / tasks / completions / bad_habits / webhooks document
-- in the database with no filter at all and returns them to any caller. The
-- Excel and CSV variants do the same, and settings.tsx opens those two in the
-- system BROWSER, i.e. unauthenticated, from a URL any user of the app knows.
--
-- Export needs no table -- it is now assembled on the device from the
-- repositories, which are already owner-scoped. The other two features do,
-- and they get what the legacy service never had: an owner column, RLS, and
-- a foreign key to auth.users so deleting an account takes its rows.
--
-- Scope: two new tables. Nothing existing is read, altered or dropped, so
-- the migration is reversible with two `drop table` statements.
-- ============================================================

-- ── bad_habits ──────────────────────────────────────────────────────────
-- Distinct from a habit with behavior_type = 'negative': that tracks a
-- per-day count against a ceiling, this tracks time-since-quit and what
-- abstaining has saved. Both can be true of the same behaviour.
create table if not exists public.bad_habits (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 120),
  description         text check (description is null or length(description) <= 2000),
  quit_date           timestamptz not null default now(),
  -- Money and minutes per day. Negatives are not a meaningful saving and
  -- would invert the arithmetic, so they are refused here rather than
  -- clamped in one of the several places that render them.
  cost_per_day        numeric(12, 2) not null default 0 check (cost_per_day >= 0),
  time_wasted_per_day integer not null default 0 check (time_wasted_per_day >= 0),
  created_at          timestamptz not null default now()
);

create index if not exists bad_habits_user_created_idx
  on public.bad_habits (user_id, created_at desc, id desc);

alter table public.bad_habits enable row level security;

drop policy if exists "bad_habits_select_own" on public.bad_habits;
create policy "bad_habits_select_own" on public.bad_habits
  for select using ((select auth.uid()) = user_id);

drop policy if exists "bad_habits_insert_own" on public.bad_habits;
create policy "bad_habits_insert_own" on public.bad_habits
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "bad_habits_update_own" on public.bad_habits;
create policy "bad_habits_update_own" on public.bad_habits
  for update using ((select auth.uid()) = user_id)
              with check ((select auth.uid()) = user_id);

drop policy if exists "bad_habits_delete_own" on public.bad_habits;
create policy "bad_habits_delete_own" on public.bad_habits
  for delete using ((select auth.uid()) = user_id);

comment on table public.bad_habits is
  'Quit-tracking with a cost/time saving. Replaces the unauthenticated /api/bad-habits on the retired FastAPI service, which stored every user''s rows under user_id = "default".';

-- ── webhooks ────────────────────────────────────────────────────────────
-- Registration only. Delivery happens on the device, from
-- services/webhookService.ts, at the same two moments the legacy service
-- fired: a habit completion and a task completion, both app-initiated. No
-- trigger point is lost by moving the send client-side, and it keeps a
-- user-supplied URL from being fetched by our server, which is what makes
-- the legacy design an SSRF surface.
create table if not exists public.webhooks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- https only. The legacy endpoint took the string unchecked, so a typo or
  -- a copied http:// link shipped habit and task names in plaintext over
  -- whatever network the phone was on.
  url         text not null check (url ~* '^https://[^[:space:]]+$' and length(url) <= 2048),
  event_types text[] not null default array['habit_completed', 'task_completed']
                check (
                  array_length(event_types, 1) between 1 and 8
                  and event_types <@ array['habit_completed', 'task_completed']
                ),
  headers     jsonb,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists webhooks_user_enabled_idx
  on public.webhooks (user_id, created_at desc, id desc);

alter table public.webhooks enable row level security;

drop policy if exists "webhooks_select_own" on public.webhooks;
create policy "webhooks_select_own" on public.webhooks
  for select using ((select auth.uid()) = user_id);

drop policy if exists "webhooks_insert_own" on public.webhooks;
create policy "webhooks_insert_own" on public.webhooks
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "webhooks_update_own" on public.webhooks;
create policy "webhooks_update_own" on public.webhooks
  for update using ((select auth.uid()) = user_id)
              with check ((select auth.uid()) = user_id);

drop policy if exists "webhooks_delete_own" on public.webhooks;
create policy "webhooks_delete_own" on public.webhooks
  for delete using ((select auth.uid()) = user_id);

comment on table public.webhooks is
  'Outbound webhook registrations, owner-scoped. Delivery is client-side (services/webhookService.ts) so a user-supplied URL is never fetched by our infrastructure. Replaces /api/webhooks on the retired FastAPI service.';
