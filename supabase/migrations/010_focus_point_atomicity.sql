-- ============================================================
-- Focus Points: charge exactly once, or not at all.
--
-- `spend_focus_points` itself is sound — `SELECT ... FOR UPDATE`, a balance
-- check, and the debit plus its ledger row in one transaction, so the balance
-- cannot go negative and cannot be lost to a concurrent writer. Every defect
-- below is in how `supabase/functions/generate-routine` USES it, and two of
-- them need a database change to fix properly.
--
-- ── 1. The ordering gave away free AI output ────────────────────────────
--
-- The edge function read the balance, called Anthropic, then debited:
--
--     const { data: spendRes } = await supabase.rpc('spend_focus_points', ...);
--     if (Array.isArray(spendRes) && spendRes[0]) newBalance = spendRes[0].balance;
--
-- `spend_focus_points` returns `(ok boolean, balance integer)` and `ok` was
-- never read. So when the debit legitimately refused — `ok = false`, the user
-- no longer had the points — the edge took `balance`, the UN-debited number,
-- and returned it as though the charge had gone through. The user got the
-- answer for free.
--
-- That is not hypothetical. Two requests at balance 5 with cost 5 both pass
-- the up-front check, both call Anthropic, the first debits to 0 and the
-- second gets `ok = false`. Two answers, one charge. The pre-check was doing
-- the gating, and a pre-check separated from its debit by a multi-second
-- network call is not a gate.
--
-- The fix is ordering, not a new lock: debit FIRST — the atomic debit is the
-- gate — and refund if the AI call fails. Which needs a refund that cannot
-- itself be replayed, hence `p_request_id` below.
--
-- ── 2. A retry charged twice, or paid Anthropic twice ───────────────────
--
-- There was no idempotency key. A client that retried after a dropped
-- response ran the whole flow again: a second Anthropic call (real money) and
-- a second debit. `credit_transactions` gets `request_id` and a unique index,
-- so a replay returns the first outcome instead of repeating it.
--
-- ── 3. A failed debit was reported as a successful one ──────────────────
--
--     } catch (_) { /* harcama kaydı başarısız olsa da yanıtı döndür */ }
--
-- The `catch` never fired: supabase-js RETURNS an RPC error in `error`, it
-- does not throw, and `error` was not destructured. So an RPC failure left
-- `newBalance = balance - cost` — a number the database had never agreed to.
-- The client showed the deduction; the next refresh put the points back.
--
-- Scope: one nullable column, one partial unique index, two new functions.
-- `spend_focus_points` is left exactly as it is so nothing that calls it
-- changes behaviour.
-- ============================================================

alter table public.credit_transactions
  add column if not exists request_id text;

comment on column public.credit_transactions.request_id is
  'Idempotency key for one user-initiated AI action. Unique per user when set, so a client retry replays the first outcome instead of charging again.';

-- Partial: the monthly renewal rows and any historic spend have no key, and
-- must not collide with each other.
create unique index if not exists credit_transactions_user_request_uidx
  on public.credit_transactions (user_id, request_id)
  where request_id is not null;

-- ── spend, idempotently ────────────────────────────────────────────────
create or replace function public.spend_focus_points_v2(
  p_amount     integer,
  p_reason     text,
  p_request_id text
)
returns table(ok boolean, balance integer, replayed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  uid  uuid := auth.uid();
  cur  int;
  prior public.credit_transactions;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;

  PERFORM public.get_or_init_subscription();

  -- Take the row lock FIRST, before looking for a prior charge. Doing the
  -- lookup first would let two concurrent replays of the same request_id both
  -- see "no prior row" and both proceed to debit; the unique index would then
  -- turn one of them into an error rather than a replay.
  SELECT focus_points INTO cur
    FROM public.user_subscriptions WHERE user_id = uid FOR UPDATE;

  IF p_request_id IS NOT NULL THEN
    SELECT * INTO prior FROM public.credit_transactions
      WHERE user_id = uid AND request_id = p_request_id AND delta < 0
      LIMIT 1;
    IF FOUND THEN
      -- A key that was charged and then REFUNDED is spent, not reusable.
      -- Replaying it would return "already paid" against a balance that was
      -- given back -- i.e. a free run. The client uses a fresh key per
      -- attempt, so this is a client bug, and it fails closed.
      IF EXISTS (
        SELECT 1 FROM public.credit_transactions
        WHERE user_id = uid AND request_id = p_request_id || ':refund'
      ) THEN
        RETURN QUERY SELECT false, cur, false;
        RETURN;
      END IF;
      -- Already settled. Report the CURRENT balance, not the one recorded at
      -- the time: other spends may have happened since, and the caller is
      -- about to show this number to the user.
      RETURN QUERY SELECT true, cur, true;
      RETURN;
    END IF;
  END IF;

  IF cur < p_amount THEN
    RETURN QUERY SELECT false, cur, false;
    RETURN;
  END IF;

  UPDATE public.user_subscriptions
    SET focus_points = focus_points - p_amount, updated_at = now()
    WHERE user_id = uid
    RETURNING focus_points INTO cur;

  INSERT INTO public.credit_transactions(user_id, delta, reason, balance_after, request_id)
    VALUES (uid, -p_amount, COALESCE(p_reason, 'spend'), cur, p_request_id);

  RETURN QUERY SELECT true, cur, false;
END;
$function$;

-- ── refund one spend, at most once ─────────────────────────────────────
-- Called when the AI step fails after the debit. Keyed on the same
-- request_id, so a retried refund is a no-op rather than a second credit --
-- the mirror of the double-charge problem, and just as easy to create.
create or replace function public.refund_focus_points(
  p_request_id text,
  p_reason     text
)
returns table(ok boolean, balance integer, already boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  uid   uuid := auth.uid();
  spend public.credit_transactions;
  cur   int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'request id required'; END IF;

  SELECT focus_points INTO cur
    FROM public.user_subscriptions WHERE user_id = uid FOR UPDATE;

  -- The original debit. `delta < 0` matters: without it a refund could find
  -- its own credit row and refund the refund.
  SELECT * INTO spend FROM public.credit_transactions
    WHERE user_id = uid AND request_id = p_request_id AND delta < 0
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, cur, false;
    RETURN;
  END IF;

  -- The refund row carries `<key>:refund`, not `<key>` -- the unique index on
  -- (user_id, request_id) would reject a second row under the same key. So
  -- the "already refunded" check must look for THAT key, which an earlier
  -- draft of this function got wrong: it searched for `p_request_id` with
  -- `delta > 0`, which can never match, and would have refunded every time.
  IF EXISTS (
    SELECT 1 FROM public.credit_transactions
    WHERE user_id = uid AND request_id = p_request_id || ':refund'
  ) THEN
    RETURN QUERY SELECT true, cur, true;
    RETURN;
  END IF;

  UPDATE public.user_subscriptions
    SET focus_points = focus_points + (-spend.delta), updated_at = now()
    WHERE user_id = uid
    RETURNING focus_points INTO cur;

  INSERT INTO public.credit_transactions(user_id, delta, reason, balance_after, request_id)
    VALUES (uid, -spend.delta, COALESCE(p_reason, 'refund'), cur, p_request_id || ':refund');

  RETURN QUERY SELECT true, cur, false;
END;
$function$;

revoke all on function public.spend_focus_points_v2(integer, text, text) from public;
revoke all on function public.refund_focus_points(text, text) from public;
grant execute on function public.spend_focus_points_v2(integer, text, text) to authenticated;
grant execute on function public.refund_focus_points(text, text) to authenticated;
