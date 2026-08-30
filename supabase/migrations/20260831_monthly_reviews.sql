-- ============================================================
-- Monthly reviews belong to the account, not to the handset.
--
-- Weekly reviews have lived in `weekly_reviews` — owner column, RLS, keyed on
-- `(user_id, week_key)` — since Phase 1. The monthly review, which asks the
-- same kind of question and gets longer answers, was never moved:
--
--     app/screens/monthly-review.tsx:32
--     const REFLECT_KEY = (monthKey) => `monthly_review_${monthKey}`;
--     await AsyncStorage.setItem(REFLECT_KEY(monthKey), JSON.stringify({ answers, savedAt }));
--
-- Three consequences, in descending order of how bad they are:
--
--  1. The key has no account in it. On a shared device the next person to
--     sign in opens Monthly Review and reads the previous account's written
--     reflections — the same defect already fixed on the sync queue and the
--     Notion session, but on the most personal text in the app.
--  2. It is one device. A user who reviews on a phone and reads on a tablet
--     sees an empty form, and a reinstall loses every month ever written.
--  3. Nothing else can read it. The archive entry the screen also writes is a
--     rendered copy, so the answers themselves are not recoverable from it.
--
-- ── Why jsonb and not three columns ────────────────────────────────────
--
-- `weekly_reviews` spells its three answers as `wins`, `challenges`,
-- `next_week`. That is why adding a weekly question needs a migration. The
-- monthly screen already holds its answers as `Record<string, string>` keyed
-- by question id, so a jsonb object is what the code actually has; a fourth
-- question becomes a code change instead of a schema change.
--
-- The CHECKs are the price of that freedom: it must be an object, its values
-- must be strings, and the whole thing is size-capped. Without them "free
-- shape" means "any shape", and a client bug could store an array or a
-- megabyte of text.
--
-- Scope: one new table. Nothing existing is read or altered.
-- ============================================================

-- A CHECK may not contain a subquery, but it may CALL a function that does.
-- (The first draft of this migration inlined `not exists (select ...)` and
-- Postgres refused it: 0A000 cannot use subquery in check constraint.) The
-- rule stays in the database either way, which is the point -- a shape rule
-- enforced only in the repository is one PostgREST call away from being
-- skipped.
create or replace function public.jsonb_is_string_map(v jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  select jsonb_typeof(v) = 'object'
     and not exists (
       select 1 from jsonb_each(v) as e
       where jsonb_typeof(e.value) <> 'string'
     );
$$;

comment on function public.jsonb_is_string_map(jsonb) is
  'True when the value is a JSON object whose every value is a string. Used by monthly_reviews.answers so "free shape" does not mean "any shape".';

create table if not exists public.monthly_reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- 'YYYY-MM'. Constrained because it is half of the identity of the row: a
  -- client that wrote '2026-8' and '2026-08' would silently keep two reviews
  -- for the same month and show whichever it happened to read.
  month_key  text not null check (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  answers    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month_key)
);

-- Every value a string, and the document bounded. `pg_column_size` is on the
-- compressed datum, so the uncompressed text length is the honest measure of
-- what a user could paste in.
alter table public.monthly_reviews
  drop constraint if exists monthly_reviews_answers_shape;
alter table public.monthly_reviews
  add constraint monthly_reviews_answers_shape check (
    public.jsonb_is_string_map(answers) and length(answers::text) <= 20000
  );

create index if not exists monthly_reviews_user_month_idx
  on public.monthly_reviews (user_id, month_key desc);

alter table public.monthly_reviews enable row level security;

drop policy if exists "monthly_reviews_select_own" on public.monthly_reviews;
create policy "monthly_reviews_select_own" on public.monthly_reviews
  for select using ((select auth.uid()) = user_id);

drop policy if exists "monthly_reviews_insert_own" on public.monthly_reviews;
create policy "monthly_reviews_insert_own" on public.monthly_reviews
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "monthly_reviews_update_own" on public.monthly_reviews;
create policy "monthly_reviews_update_own" on public.monthly_reviews
  for update using ((select auth.uid()) = user_id)
              with check ((select auth.uid()) = user_id);

drop policy if exists "monthly_reviews_delete_own" on public.monthly_reviews;
create policy "monthly_reviews_delete_own" on public.monthly_reviews
  for delete using ((select auth.uid()) = user_id);

comment on table public.monthly_reviews is
  'One reflection per user per month. Source of truth; AsyncStorage keeps only a per-account draft of the month being edited. Replaces the device-local, account-unscoped `monthly_review_<key>` AsyncStorage entry.';
