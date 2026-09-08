-- The AI operation ledger belongs to the server, and a claim must expire.
--
-- ═══ DEFECT 1: the transition functions were callable by any signed-in user
--
-- 20260906e created four SECURITY DEFINER functions in `public` and never
-- revoked EXECUTE. Postgres grants EXECUTE to PUBLIC by default, and Supabase's
-- `anon` and `authenticated` roles inherit it. RLS on `ai_requests` did not
-- help: a SECURITY DEFINER function runs as its owner, so it bypasses exactly
-- the policy that was supposed to be the protection.
--
-- Proven against this project with an ordinary account holding nothing but the
-- publishable key and its own JWT -- i.e. what ships inside the mobile app:
--
--   rpc ai_request_begin    -> {"outcome":"claimed"}
--   rpc ai_request_complete -> true          (payload written by the caller)
--   POST generate-routine   -> 200 {"name":"SAHTE RUTIN", ..., "replayed":true}
--   focus points charged    -> 0
--   ledger rows written     -> 0
--
-- Free operation of the paid AI product, and attacker-authored content
-- delivered through the client's proposal gate as if the model had produced it.
--
-- The same review found the money functions open in the same way, which is the
-- same hole wearing the other sign:
--
--   * `refund_focus_points` -- a user could take a successful routine and then
--     refund their own charge. Free AI, again.
--   * `spend_focus_points_v2` -- the replay branch matches on `request_id` and
--     never re-checks the amount, so a caller could pre-charge themselves 5 FP
--     on a key and then spend it on a 25 FP routine.
--
-- FIX: none of these are the client's to call. EXECUTE is revoked from PUBLIC,
-- `anon` and `authenticated`, and granted only to `service_role`. Since
-- `service_role` has no `auth.uid()`, the caller's identity becomes an explicit
-- argument -- supplied by the Edge Function from the JWT it has already
-- verified, and unreachable by a client that cannot execute the function at
-- all. `get_or_init_subscription` is deliberately left alone: it is a read/init
-- the app legitimately calls for its own row.
--
-- Every function here is additionally hardened with `search_path = ''` and
-- fully-qualified objects, so nothing resolves through a caller-controlled
-- schema.
--
-- ═══ DEFECT 2: an interrupted request stayed `in_progress` forever
--
-- claim -> spend -> provider -> store is four steps and not one transaction,
-- and process death is not catchable. `ai_request_begin` treated any existing
-- `in_progress` row as REQUEST_IN_PROGRESS with no expiry, so a crash left the
-- key permanently unusable -- and, if it died after the charge, left the user
-- 25 FP poorer with nothing to show.
--
-- FIX: every claim carries a LEASE. Once it expires the row is reclaimable, and
-- reclaiming it refunds whatever that key charged and marks it `failed`.
--
--   crash after claim, before spend    -> reclaimed; refund is a no-op because
--                                         no ledger row exists; no provider call
--   crash after spend, before provider -> reclaimed; refunded exactly once
--   crash after provider, before store -> reclaimed; refunded exactly once
--   crash after store                  -> row is `completed`; replay returns it
--
-- The third case is deliberately NOT retried. From the row alone it is
-- indistinguishable from the second, and guessing wrong means calling a paid
-- provider a second time for one payment. Refund-and-fail is the deterministic
-- choice: the user is made whole and the operation is closed.
--
-- LEASE = 5 minutes. The client's own deadline is 20 s (`EDGE_TIMEOUT_MS`), the
-- slowest real provider call measured on this project was 5.4 s, and the
-- platform caps a function request well below five minutes. So a lease can only
-- expire on a request that is genuinely gone, never on one still working.
--
-- RACE SAFETY: the reclaim is a conditional UPDATE guarded by
-- `status = 'in_progress' AND lease_expires_at < now()`, over rows taken with
-- `FOR UPDATE SKIP LOCKED`. Only one reconciler can win a given row, and the
-- refund it then performs is itself idempotent (it refuses when a `:refund` row
-- already exists). Two independent guards against a double credit.
--
-- SCOPE: forward-only. Adds one column, one index, and replaces function
-- signatures. `credit_transactions` and `user_subscriptions` keep their shape,
-- their data and their RLS. Edits no historical migration.

-- ── the lease ──────────────────────────────────────────────────────────────
alter table public.ai_requests
  add column if not exists lease_expires_at timestamptz not null
    default (now() + interval '5 minutes');

comment on column public.ai_requests.lease_expires_at is
  'When this claim stops protecting the key. Past it the row may be reclaimed '
  'by ai_request_reconcile_stale, which refunds whatever the key charged and '
  'marks it failed. Five minutes: far beyond the 20s client deadline and the '
  'platform request cap, so an active request can never be reclaimed.';

create index if not exists ai_requests_stale_idx
  on public.ai_requests (user_id, lease_expires_at)
  where status = 'in_progress';

-- ── the old, client-callable signatures go ────────────────────────────────
--
-- Dropped rather than left in place: a signature that derives identity from
-- `auth.uid()` cannot be called by `service_role`, and leaving it behind would
-- leave the exploit reachable.
drop function if exists public.ai_request_begin(text, text, text);
drop function if exists public.ai_request_complete(text, jsonb);
drop function if exists public.ai_request_fail(text, text);
drop function if exists public.ai_request_release(text);
drop function if exists public.spend_focus_points_v2(integer, text, text);
drop function if exists public.refund_focus_points(text, text);

-- ── subscription init, for a caller that has no auth.uid() ────────────────
--
-- A twin of `get_or_init_subscription()` taking the user explicitly. The
-- original is untouched and stays available to the app for its own row.
create or replace function public.get_or_init_subscription_for(p_user_id uuid)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = ''
as $function$
declare sub public.user_subscriptions;
begin
  if p_user_id is null then raise exception 'user id required'; end if;

  select * into sub from public.user_subscriptions where user_id = p_user_id;
  if not found then
    insert into public.user_subscriptions(user_id) values (p_user_id) returning * into sub;
  end if;

  if sub.tier <> 'free' and sub.sub_period_end is not null and sub.sub_period_end <= pg_catalog.now() then
    update public.user_subscriptions
      set tier = 'free', billing_period = null, status = 'expired',
          monthly_grant = 30, updated_at = pg_catalog.now()
      where user_id = p_user_id returning * into sub;
  end if;

  if sub.credits_period_end <= pg_catalog.now() then
    update public.user_subscriptions
      set focus_points = monthly_grant,
          credits_period_end = pg_catalog.now() + interval '1 month',
          updated_at = pg_catalog.now()
      where user_id = p_user_id returning * into sub;
    insert into public.credit_transactions(user_id, delta, reason, balance_after)
      values (p_user_id, sub.monthly_grant, 'monthly_renewal', sub.focus_points);
  end if;

  return sub;
end;
$function$;

-- ── the charge ────────────────────────────────────────────────────────────
--
-- Identical logic to the version it replaces, with the identity supplied
-- rather than read from the session.
create or replace function public.spend_focus_points_v2(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_request_id text
)
returns table(ok boolean, balance integer, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cur   int;
  prior public.credit_transactions;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  if p_amount <= 0 then raise exception 'invalid amount'; end if;

  perform public.get_or_init_subscription_for(p_user_id);

  select focus_points into cur
    from public.user_subscriptions where user_id = p_user_id for update;

  if p_request_id is not null then
    select * into prior from public.credit_transactions
      where user_id = p_user_id and request_id = p_request_id and delta < 0
      limit 1;
    if found then
      if exists (
        select 1 from public.credit_transactions
        where user_id = p_user_id and request_id = p_request_id || ':refund'
      ) then
        return query select false, cur, false;
        return;
      end if;
      return query select true, cur, true;
      return;
    end if;
  end if;

  if cur < p_amount then
    return query select false, cur, false;
    return;
  end if;

  update public.user_subscriptions
    set focus_points = focus_points - p_amount, updated_at = pg_catalog.now()
    where user_id = p_user_id
    returning focus_points into cur;

  insert into public.credit_transactions(user_id, delta, reason, balance_after, request_id)
    values (p_user_id, -p_amount, coalesce(p_reason, 'spend'), cur, p_request_id);

  return query select true, cur, false;
end;
$function$;

-- ── the refund ────────────────────────────────────────────────────────────
--
-- `already = true` on a second call is what makes reconciliation safe to run
-- twice: the credit happens once no matter how many reclaimers try.
create or replace function public.refund_focus_points(
  p_user_id uuid,
  p_request_id text,
  p_reason text
)
returns table(ok boolean, balance integer, already boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  spend public.credit_transactions;
  cur   int;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  if p_request_id is null then raise exception 'request id required'; end if;

  select focus_points into cur
    from public.user_subscriptions where user_id = p_user_id for update;

  select * into spend from public.credit_transactions
    where user_id = p_user_id and request_id = p_request_id and delta < 0
    limit 1;
  if not found then
    -- Nothing was ever charged on this key. A reconciler reaching this is the
    -- "crashed before the spend" case, and it is a no-op by design.
    return query select false, cur, false;
    return;
  end if;

  if exists (
    select 1 from public.credit_transactions
    where user_id = p_user_id and request_id = p_request_id || ':refund'
  ) then
    return query select true, cur, true;
    return;
  end if;

  update public.user_subscriptions
    set focus_points = focus_points + (-spend.delta), updated_at = pg_catalog.now()
    where user_id = p_user_id
    returning focus_points into cur;

  insert into public.credit_transactions(user_id, delta, reason, balance_after, request_id)
    values (p_user_id, -spend.delta, coalesce(p_reason, 'refund'), cur, p_request_id || ':refund');

  return query select true, cur, false;
end;
$function$;

-- ── stale-claim reconciliation ────────────────────────────────────────────
--
-- `FOR UPDATE SKIP LOCKED` inside the subquery plus the `status`/`lease`
-- predicate on the UPDATE means a row can be reclaimed by exactly one caller,
-- even with several instances sweeping at once. A row whose lease is still
-- running is never touched, which is what stops a live request losing its
-- claim to a concurrent reconciler.
create or replace function public.ai_request_reconcile_stale(
  p_user_id uuid,
  p_limit integer default 5
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare r record; n integer := 0;
begin
  if p_user_id is null then raise exception 'user id required'; end if;

  for r in
    update public.ai_requests a
      set status = 'failed',
          error = 'Kurulum yarida kaldi: istek suresi doldu ve ucreti iade edildi.',
          updated_at = pg_catalog.now()
      where a.ctid in (
        select b.ctid from public.ai_requests b
        where b.user_id = p_user_id
          and b.status = 'in_progress'
          and b.lease_expires_at < pg_catalog.now()
        limit p_limit
        for update skip locked
      )
      returning a.request_id
  loop
    -- Only the winner of the UPDATE reaches this, and the refund is idempotent
    -- even if it somehow ran twice.
    perform public.refund_focus_points(p_user_id, r.request_id, 'ai_stale_reclaim');
    n := n + 1;
  end loop;

  return n;
end;
$function$;

-- ── the claim ─────────────────────────────────────────────────────────────
create or replace function public.ai_request_begin(
  p_user_id uuid,
  p_request_id text,
  p_mode text,
  p_fingerprint text
)
returns table(outcome text, response jsonb, error text)
language plpgsql
security definer
set search_path = ''
as $function$
declare rec public.ai_requests;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  if p_request_id is null or pg_catalog.length(p_request_id) = 0 then
    raise exception 'request id required';
  end if;

  -- Sweep first, so an expired claim on THIS key is already settled by the
  -- time it is read below, and so abandoned keys the client never retries do
  -- not accumulate.
  perform public.ai_request_reconcile_stale(p_user_id, 5);

  insert into public.ai_requests (user_id, request_id, mode, input_fingerprint, status, lease_expires_at)
    values (p_user_id, p_request_id, p_mode, p_fingerprint, 'in_progress',
            pg_catalog.now() + interval '5 minutes')
    on conflict (user_id, request_id) do nothing
    returning * into rec;

  if found then
    return query select 'claimed'::text, null::jsonb, null::text;
    return;
  end if;

  select * into rec from public.ai_requests
    where user_id = p_user_id and request_id = p_request_id;

  -- Identity first: a key pointed at different input is misuse whatever state
  -- it is in, and must never be answered with the previous input's result.
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
create or replace function public.ai_request_complete(
  p_user_id uuid,
  p_request_id text,
  p_response jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare n int;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  if p_response is null then raise exception 'response required'; end if;

  update public.ai_requests
    set status = 'completed', response = p_response, error = null, updated_at = pg_catalog.now()
    where user_id = p_user_id and request_id = p_request_id and status = 'in_progress';
  get diagnostics n = row_count;
  return n = 1;
end;
$function$;

-- ── the failure ───────────────────────────────────────────────────────────
create or replace function public.ai_request_fail(
  p_user_id uuid,
  p_request_id text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare n int;
begin
  if p_user_id is null then raise exception 'user id required'; end if;

  update public.ai_requests
    set status = 'failed', error = p_error, updated_at = pg_catalog.now()
    where user_id = p_user_id and request_id = p_request_id and status = 'in_progress';
  get diagnostics n = row_count;
  return n = 1;
end;
$function$;

-- ── the un-claim ──────────────────────────────────────────────────────────
create or replace function public.ai_request_release(
  p_user_id uuid,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare n int;
begin
  if p_user_id is null then raise exception 'user id required'; end if;

  delete from public.ai_requests
    where user_id = p_user_id and request_id = p_request_id and status = 'in_progress';
  get diagnostics n = row_count;
  return n = 1;
end;
$function$;

-- ── privileges: server only ───────────────────────────────────────────────
--
-- The REVOKE FROM PUBLIC is the load-bearing one -- `anon` and `authenticated`
-- inherit PUBLIC, so revoking from them alone would leave the grant standing.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.ai_request_begin(uuid, text, text, text)',
    'public.ai_request_complete(uuid, text, jsonb)',
    'public.ai_request_fail(uuid, text, text)',
    'public.ai_request_release(uuid, text)',
    'public.ai_request_reconcile_stale(uuid, integer)',
    'public.spend_focus_points_v2(uuid, integer, text, text)',
    'public.refund_focus_points(uuid, text, text)',
    'public.get_or_init_subscription_for(uuid)'
  ] loop
    execute pg_catalog.format('revoke all on function %s from public', fn);
    execute pg_catalog.format('revoke all on function %s from anon', fn);
    execute pg_catalog.format('revoke all on function %s from authenticated', fn);
    execute pg_catalog.format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

comment on function public.ai_request_reconcile_stale(uuid, integer) is
  'Reclaims claims whose lease has expired: marks them failed and refunds '
  'whatever that key charged. Race-safe (FOR UPDATE SKIP LOCKED plus a '
  'conditional UPDATE) and idempotent (the refund refuses a second credit), so '
  'concurrent instances cannot double-refund or steal a live claim.';
