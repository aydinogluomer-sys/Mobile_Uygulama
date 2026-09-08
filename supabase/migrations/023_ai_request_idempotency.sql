-- One idempotency key = one logical AI operation.
--
-- THE DEFECT THIS CLOSES
--
-- `spend_focus_points_v2` already made the CHARGE idempotent: a repeated
-- `request_id` returns `replayed = true` and writes no second ledger row. The
-- edge function read that flag, set `charged = false` so it would not refund a
-- charge it had not made -- and then carried straight on into
-- `new Anthropic(...)` and `client.messages.create(...)`.
--
-- So the money was idempotent and the WORK was not:
--
--     first call   -> 25 FP debited, one Anthropic call
--     same key     ->  0 FP debited, ANOTHER Anthropic call
--     same key x10 ->  0 FP debited, TEN Anthropic calls
--
-- Anthropic spend is billed to the project, not to the user, so a single
-- charged key could be replayed indefinitely to consume provider budget for
-- free. And because nothing bound the key to its input, the same key could be
-- re-sent with a DIFFERENT prompt: one 25 FP payment, unlimited distinct
-- answers.
--
-- The charge ledger cannot fix this on its own. It records that money moved;
-- it has no idea whether the provider was called, and it cannot return the
-- answer the user already paid for. That needs its own durable record.
--
-- WHAT IT ADDS
--
--   public.ai_requests  -- one row per (user, request_id)
--
-- The row is claimed BEFORE the provider is touched, carries the fingerprint
-- of the input that claimed it, and stores the successful payload. Every
-- later call with that key is answered from the row.
--
--   in_progress -> a claim exists; a concurrent caller must not call again
--   completed   -> the answer is here; return it, call nothing
--   failed      -> the attempt died and was refunded; the key is spent
--
-- Durable on purpose. An in-memory map would be empty after the process
-- death this protocol exists to survive, and invisible to the other Edge
-- Function instances serving the same account concurrently.
--
-- WHY A SEPARATE TABLE AND NOT MORE COLUMNS ON credit_transactions
--
-- That table is the money ledger: append-only, one row per movement, and a
-- refund is a SECOND row sharing the key's namespace (`<id>:refund`). An AI
-- payload is not a money movement, it is mutable while in flight, and there
-- is exactly one of it per key. Hanging it off the ledger would put a
-- rewritable blob on the one table whose value comes from never being
-- rewritten.
--
-- SCOPE: ADDITIVE ONLY, forward-only, idempotent.
--   * One new table, its RLS, and four SECURITY DEFINER transitions.
--   * `credit_transactions`, `user_subscriptions`, `spend_focus_points_v2`
--     and `refund_focus_points` are NOT touched. The charge invariants proven
--     earlier in this branch stand exactly as they were.
--   * No existing row anywhere is read or written by this migration.
--   * Edits no historical migration.
--
-- ROLLBACK (manual):
--   drop function if exists public.ai_request_release(text);
--   drop function if exists public.ai_request_fail(text, text);
--   drop function if exists public.ai_request_complete(text, jsonb);
--   drop function if exists public.ai_request_begin(text, text, text);
--   drop table if exists public.ai_requests;

create table if not exists public.ai_requests (
  user_id           uuid        not null references auth.users(id) on delete cascade,
  request_id        text        not null,
  mode              text        not null,
  input_fingerprint text        not null,
  status            text        not null default 'in_progress',
  response          jsonb,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, request_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_requests_status_check') then
    alter table public.ai_requests add constraint ai_requests_status_check
      check (status in ('in_progress', 'completed', 'failed'));
  end if;

  -- A `completed` row with no payload would be a replay that returns nothing:
  -- the caller paid, the provider ran, and the answer is gone. The constraint
  -- makes that state unrepresentable rather than merely unlikely.
  if not exists (select 1 from pg_constraint where conname = 'ai_requests_completed_has_response') then
    alter table public.ai_requests add constraint ai_requests_completed_has_response
      check (status <> 'completed' or response is not null);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ai_requests_mode_check') then
    alter table public.ai_requests add constraint ai_requests_mode_check
      check (mode in ('coach', 'routine', 'summarize', 'insights'));
  end if;
end $$;

-- For pruning old rows later; the table is append-mostly and never queried by
-- anything but its primary key.
create index if not exists ai_requests_created_idx on public.ai_requests (created_at);

alter table public.ai_requests enable row level security;

-- READ ONLY for the owner. Every state transition goes through the
-- SECURITY DEFINER functions below, the same shape `credit_transactions`
-- uses: a client that could INSERT here could seed a `completed` row with a
-- fabricated payload, or overwrite a real one.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ai_requests' and policyname = 'ai_requests_owner_select'
  ) then
    create policy ai_requests_owner_select on public.ai_requests
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- ── the claim ─────────────────────────────────────────────────────────────
--
-- `on conflict do nothing ... returning` is the whole concurrency story. Two
-- instances racing on the same key both attempt the insert; the second blocks
-- until the first commits, then returns no row and reads what the winner
-- wrote. Exactly one caller is ever told `claimed`, so exactly one caller
-- ever reaches the provider.
--
-- The fingerprint comparison comes FIRST, before status is considered: a key
-- pointed at different input is a misuse whatever state it is in, and must
-- never be answered with the previous input's result.
create or replace function public.ai_request_begin(
  p_request_id text,
  p_mode text,
  p_fingerprint text
)
returns table(outcome text, response jsonb, error text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  rec public.ai_requests;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_request_id is null or length(p_request_id) = 0 then
    raise exception 'request id required';
  end if;

  insert into public.ai_requests (user_id, request_id, mode, input_fingerprint, status)
    values (uid, p_request_id, p_mode, p_fingerprint, 'in_progress')
    on conflict (user_id, request_id) do nothing
    returning * into rec;

  if found then
    return query select 'claimed'::text, null::jsonb, null::text;
    return;
  end if;

  select * into rec from public.ai_requests
    where user_id = uid and request_id = p_request_id;

  if rec.mode is distinct from p_mode
     or rec.input_fingerprint is distinct from p_fingerprint then
    return query select 'mismatch'::text, null::jsonb, null::text;
    return;
  end if;

  if rec.status = 'completed' then
    return query select 'replay'::text, rec.response, null::text;
    return;
  end if;

  if rec.status = 'failed' then
    return query select 'consumed'::text, null::jsonb, rec.error;
    return;
  end if;

  return query select 'in_progress'::text, null::jsonb, null::text;
end;
$function$;

-- ── the answer ────────────────────────────────────────────────────────────
--
-- Only an `in_progress` row may complete, so a late duplicate cannot overwrite
-- a stored answer with a second one.
create or replace function public.ai_request_complete(
  p_request_id text,
  p_response jsonb
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_response is null then raise exception 'response required'; end if;

  update public.ai_requests
    set status = 'completed', response = p_response, error = null, updated_at = now()
    where user_id = uid and request_id = p_request_id and status = 'in_progress';
  get diagnostics n = row_count;
  return n = 1;
end;
$function$;

-- ── the failure ───────────────────────────────────────────────────────────
--
-- The attempt died after charging, so the caller has already been refunded.
-- The row stays as a record that this key is spent: re-running it would be a
-- second charge attempt against a key the ledger has already refunded, which
-- `spend_focus_points_v2` refuses anyway.
create or replace function public.ai_request_fail(
  p_request_id text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  update public.ai_requests
    set status = 'failed', error = p_error, updated_at = now()
    where user_id = uid and request_id = p_request_id and status = 'in_progress';
  get diagnostics n = row_count;
  return n = 1;
end;
$function$;

-- ── the un-claim ──────────────────────────────────────────────────────────
--
-- Nothing was charged and nothing was called -- the request never became a
-- transaction, so it should leave no trace and the key stays usable. Used
-- when the balance check refuses the spend, which happens AFTER the claim
-- precisely so that an out-of-credit user cannot be raced into a provider
-- call.
create or replace function public.ai_request_release(p_request_id text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  delete from public.ai_requests
    where user_id = uid and request_id = p_request_id and status = 'in_progress';
  get diagnostics n = row_count;
  return n = 1;
end;
$function$;

comment on table public.ai_requests is
  'One row per (user, request_id): the durable identity of a single logical AI '
  'operation. Claimed before the provider is called, fingerprinted against the '
  'input that claimed it, and holding the successful payload so a replay is '
  'answered from here instead of from Anthropic. Closes the defect where a '
  'charged idempotency key could be replayed for unlimited free provider calls, '
  'or re-pointed at a different prompt.';
