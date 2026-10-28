


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."user_subscriptions" (
    "user_id" "uuid" NOT NULL,
    "tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "billing_period" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "focus_points" integer DEFAULT 30 NOT NULL,
    "monthly_grant" integer DEFAULT 30 NOT NULL,
    "credits_period_end" timestamp with time zone DEFAULT ("now"() + '1 mon'::interval) NOT NULL,
    "sub_period_end" timestamp with time zone,
    "provider" "text" DEFAULT 'mock'::"text",
    "provider_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_subscriptions_billing_period_check" CHECK (("billing_period" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "user_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "user_subscriptions_tier_check" CHECK (("tier" = ANY (ARRAY['free'::"text", 'plus'::"text", 'pro'::"text"])))
);


ALTER TABLE "public"."user_subscriptions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activate_subscription"("p_user_id" "uuid", "p_tier" "text", "p_period" "text", "p_provider" "text" DEFAULT 'revenuecat'::"text", "p_provider_ref" "text" DEFAULT NULL::"text") RETURNS "public"."user_subscriptions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE grant_amt int; pend timestamptz; sub public.user_subscriptions;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required'; END IF;
  IF p_tier NOT IN ('plus','pro') THEN RAISE EXCEPTION 'invalid tier'; END IF;
  IF p_period NOT IN ('weekly','monthly','yearly') THEN RAISE EXCEPTION 'invalid period'; END IF;
  grant_amt := CASE p_tier WHEN 'plus' THEN 100 WHEN 'pro' THEN 1000 ELSE 30 END;
  pend := CASE p_period WHEN 'weekly' THEN now()+interval '7 days'
                        WHEN 'yearly' THEN now()+interval '1 year'
                        ELSE now()+interval '1 month' END;
  INSERT INTO public.user_subscriptions(user_id, tier, billing_period, status, monthly_grant, focus_points,
                                        credits_period_end, sub_period_end, provider, provider_ref)
  VALUES (p_user_id, p_tier, p_period, 'active', grant_amt, grant_amt,
          now()+interval '1 month', pend, p_provider, p_provider_ref)
  ON CONFLICT (user_id) DO UPDATE
    SET tier=EXCLUDED.tier, billing_period=EXCLUDED.billing_period, status='active',
        monthly_grant=EXCLUDED.monthly_grant, focus_points=EXCLUDED.monthly_grant,
        credits_period_end=now()+interval '1 month', sub_period_end=EXCLUDED.sub_period_end,
        provider=EXCLUDED.provider, provider_ref=EXCLUDED.provider_ref, updated_at=now()
  RETURNING * INTO sub;
  INSERT INTO public.credit_transactions(user_id, delta, reason, balance_after)
    VALUES (p_user_id, grant_amt, 'subscription_activated:'||p_tier, sub.focus_points);
  RETURN sub;
END; $$;


ALTER FUNCTION "public"."activate_subscription"("p_user_id" "uuid", "p_tier" "text", "p_period" "text", "p_provider" "text", "p_provider_ref" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_xp"("p_user_id" "uuid", "p_xp_amount" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_current_xp integer;
  v_next_level_xp integer;
  v_level integer;
  v_new_xp integer;
  v_level_up boolean := false;
  v_initial_level integer;
begin
  -- Get current user stats
  select current_level_xp, next_level_xp, level
  into v_current_xp, v_next_level_xp, v_level
  from profiles
  where id = p_user_id;

  v_initial_level := v_level;
  v_new_xp := v_current_xp + p_xp_amount;

  -- Level Up Logic (While loop allows multiple level ups at once)
  while v_new_xp >= v_next_level_xp loop
    v_level_up := true;
    v_new_xp := v_new_xp - v_next_level_xp;
    v_level := v_level + 1;
    -- Increase next level requirement by 10% each level roughly
    v_next_level_xp := floor(v_next_level_xp * 1.15)::integer;
  end loop;

  -- Update Profile
  update profiles
  set
    total_xp = total_xp + p_xp_amount,
    current_level_xp = v_new_xp,
    level = v_level,
    next_level_xp = v_next_level_xp,
    willpower_rank = public.get_rank_for_level(v_level)
  where id = p_user_id;

end;
$$;


ALTER FUNCTION "public"."add_xp"("p_user_id" "uuid", "p_xp_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_request_begin"("p_user_id" "uuid", "p_request_id" "text", "p_mode" "text", "p_fingerprint" "text") RETURNS TABLE("outcome" "text", "response" "jsonb", "error" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare rec public.ai_requests;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  if p_request_id is null or pg_catalog.length(p_request_id) = 0 then
    raise exception 'request id required';
  end if;

  perform public.ai_request_reconcile_stale(p_user_id, 5);

  insert into public.ai_requests (user_id, request_id, mode, input_fingerprint, status, lease_expires_at)
    values (p_user_id, p_request_id, p_mode, p_fingerprint, 'in_progress',
            pg_catalog.now() + interval '5 minutes')
    on conflict (user_id, request_id) do nothing
    returning * into rec;
  if found then return query select 'claimed'::text, null::jsonb, null::text; return; end if;

  select * into rec from public.ai_requests
    where user_id = p_user_id and request_id = p_request_id;

  if rec.mode is distinct from p_mode or rec.input_fingerprint is distinct from p_fingerprint then
    return query select 'mismatch'::text, null::jsonb, null::text; return;
  end if;
  if rec.status = 'completed' then
    return query select 'replay'::text, rec.response, null::text; return;
  end if;
  if rec.status = 'failed' then
    return query select 'consumed'::text, null::jsonb, rec.error; return;
  end if;
  return query select 'in_progress'::text, null::jsonb, null::text;
end;
$$;


ALTER FUNCTION "public"."ai_request_begin"("p_user_id" "uuid", "p_request_id" "text", "p_mode" "text", "p_fingerprint" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_request_complete"("p_user_id" "uuid", "p_request_id" "text", "p_response" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."ai_request_complete"("p_user_id" "uuid", "p_request_id" "text", "p_response" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_request_fail"("p_user_id" "uuid", "p_request_id" "text", "p_error" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare n int;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  update public.ai_requests
    set status = 'failed', error = p_error, updated_at = pg_catalog.now()
    where user_id = p_user_id and request_id = p_request_id and status = 'in_progress';
  get diagnostics n = row_count;
  return n = 1;
end;
$$;


ALTER FUNCTION "public"."ai_request_fail"("p_user_id" "uuid", "p_request_id" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_request_reconcile_stale"("p_user_id" "uuid", "p_limit" integer DEFAULT 5) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
        where b.user_id = p_user_id and b.status = 'in_progress'
          and b.lease_expires_at < pg_catalog.now()
        limit p_limit for update skip locked
      )
      returning a.request_id
  loop
    perform public.refund_focus_points(p_user_id, r.request_id, 'ai_stale_reclaim');
    n := n + 1;
  end loop;
  return n;
end;
$$;


ALTER FUNCTION "public"."ai_request_reconcile_stale"("p_user_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ai_request_reconcile_stale"("p_user_id" "uuid", "p_limit" integer) IS 'Reclaims claims whose lease has expired: marks them failed and refunds whatever that key charged. Race-safe (FOR UPDATE SKIP LOCKED plus a conditional UPDATE) and idempotent (the refund refuses a second credit).';



CREATE OR REPLACE FUNCTION "public"."ai_request_release"("p_user_id" "uuid", "p_request_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare n int;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  delete from public.ai_requests
    where user_id = p_user_id and request_id = p_request_id and status = 'in_progress';
  get diagnostics n = row_count;
  return n = 1;
end;
$$;


ALTER FUNCTION "public"."ai_request_release"("p_user_id" "uuid", "p_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_touch_conversation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.ai_conversations
     SET last_message_at = NEW.created_at,
         updated_at      = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ai_touch_conversation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buy_shop_item"("p_item_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_price INT;
v_user_coins INT;
BEGIN -- Get item price
SELECT price INTO v_price
FROM shop_items
WHERE id = p_item_id;
IF NOT FOUND THEN RAISE EXCEPTION 'Eşya bulunamadı';
END IF;
SELECT coins INTO v_user_coins
FROM profiles
WHERE id = auth.uid();
IF v_user_coins < v_price THEN RAISE EXCEPTION 'Yetersiz altın. % altın gerekiyor ama sende % var.',
v_price,
v_user_coins;
END IF;
UPDATE profiles
SET coins = coins - v_price
WHERE id = auth.uid();
INSERT INTO user_inventory (user_id, item_id, quantity)
VALUES (auth.uid(), p_item_id, 1) ON CONFLICT (user_id, item_id) DO
UPDATE
SET quantity = user_inventory.quantity + 1;
RETURN json_build_object(
    'success',
    true,
    'remaining_coins',
    v_user_coins - v_price
);
END;
$$;


ALTER FUNCTION "public"."buy_shop_item"("p_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_award_badges"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_total_xp INT;
v_level INT;
v_streak INT;
v_total_logs INT;
BEGIN -- Get current profile stats
v_total_xp := NEW.total_xp;
v_level := NEW.level;
SELECT COUNT(*) INTO v_total_logs
FROM public.habit_logs
WHERE user_id = NEW.id
    AND is_completed = true;
SELECT COALESCE(MAX(streak_best), 0) INTO v_streak
FROM public.habits
WHERE user_id = NEW.id;
IF v_total_logs >= 1 THEN
INSERT INTO public.profile_badges (user_id, badge_name, icon, description)
VALUES (
        NEW.id,
        'İlk Adım',
        '🌱',
        'İlk alışkanlığını tamamladın!'
    ) ON CONFLICT (user_id, badge_name) DO NOTHING;
END IF;
IF v_streak >= 7 THEN
INSERT INTO public.profile_badges (user_id, badge_name, icon, description)
VALUES (
        NEW.id,
        'Düzenli Savaşçı',
        '⚔️',
        '7 gün üst üste bir alışkanlığı sürdürdün!'
    ) ON CONFLICT (user_id, badge_name) DO NOTHING;
END IF;
IF v_streak >= 30 THEN
INSERT INTO public.profile_badges (user_id, badge_name, icon, description)
VALUES (
        NEW.id,
        'Demir İrade',
        '🛡️',
        '30 gün kesintisiz seri! Gerçek bir savaşçısın.'
    ) ON CONFLICT (user_id, badge_name) DO NOTHING;
END IF;
IF v_total_xp >= 1000 THEN
INSERT INTO public.profile_badges (user_id, badge_name, icon, description)
VALUES (
        NEW.id,
        'XP Avcısı',
        '💎',
        '1000 XP topladın! İrade gücün artıyor.'
    ) ON CONFLICT (user_id, badge_name) DO NOTHING;
END IF;
IF v_total_xp >= 5000 THEN
INSERT INTO public.profile_badges (user_id, badge_name, icon, description)
VALUES (
        NEW.id,
        'Efsane Yolcusu',
        '🔥',
        '5000 XP! Efsanelerin arasına girdin.'
    ) ON CONFLICT (user_id, badge_name) DO NOTHING;
END IF;
IF v_level >= 10 THEN
INSERT INTO public.profile_badges (user_id, badge_name, icon, description)
VALUES (
        NEW.id,
        'Savaşçı Rütbesi',
        '⚡',
        'Seviye 10 - Savaşçı rütbesine yükseldin!'
    ) ON CONFLICT (user_id, badge_name) DO NOTHING;
END IF;
IF v_level >= 25 THEN
INSERT INTO public.profile_badges (user_id, badge_name, icon, description)
VALUES (
        NEW.id,
        'Şövalye Nişanı',
        '🏰',
        'Seviye 25 - İrade Şövalyesi oldun!'
    ) ON CONFLICT (user_id, badge_name) DO NOTHING;
END IF;
IF v_total_logs >= 100 THEN
INSERT INTO public.profile_badges (user_id, badge_name, icon, description)
VALUES (
        NEW.id,
        'Yüzüncü Adım',
        '💯',
        '100 alışkanlık tamamladın! Azmin takdire şayan.'
    ) ON CONFLICT (user_id, badge_name) DO NOTHING;
END IF;
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_and_award_badges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_reset_makeup_credits"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_last_reset TIMESTAMP;
v_user_id UUID;
BEGIN v_user_id := auth.uid();
SELECT last_credit_reset INTO v_last_reset
FROM user_gamification
WHERE user_id = v_user_id;
IF v_last_reset < NOW() - INTERVAL '7 days' THEN
UPDATE user_gamification
SET makeup_credits = 3,
  last_credit_reset = NOW()
WHERE user_id = v_user_id;
END IF;
END;
$$;


ALTER FUNCTION "public"."check_and_reset_makeup_credits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_level_up_and_grant_skills"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE previous_level INT;
new_level INT;
level_diff INT;
BEGIN previous_level := OLD.level;
new_level := NEW.level;
level_diff := new_level - previous_level;
IF level_diff > 0 THEN NEW.skill_points := NEW.skill_points + level_diff;
END IF;
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_level_up_and_grant_skills"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_quest_reward"("p_user_quest_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_completed BOOLEAN;
v_reward INT;
v_already_claimed BOOLEAN;
BEGIN -- Get quest details
SELECT uq.is_completed,
    q.reward_coins INTO v_already_claimed,
    v_reward
FROM user_quests uq
    JOIN quests q ON q.id = uq.quest_id
WHERE uq.id = p_user_quest_id
    AND uq.user_id = auth.uid();
IF NOT FOUND THEN RAISE EXCEPTION 'Görev bulunamadı';
END IF;
IF v_already_claimed THEN RAISE EXCEPTION 'Bu görev zaten tamamlanmış';
END IF;
UPDATE user_quests
SET is_completed = TRUE
WHERE id = p_user_quest_id;
UPDATE profiles
SET coins = COALESCE(coins, 0) + v_reward
WHERE id = auth.uid();
RETURN json_build_object('success', true, 'rewarded', v_reward);
END;
$$;


ALTER FUNCTION "public"."claim_quest_reward"("p_user_quest_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_ai_calls"() RETURNS "void"
    LANGUAGE "sql"
    AS $$
  DELETE FROM public.ai_calls WHERE called_at < now() - interval '7 days';
$$;


ALTER FUNCTION "public"."cleanup_old_ai_calls"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  -- Insert variables here
begin
  -- Insert logic here
  return event;
end;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deal_damage_to_active_boss"("p_user_id" "uuid", "p_damage" integer DEFAULT 10) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_boss_record RECORD;
v_new_hp INT;
BEGIN -- Find active boss
SELECT * INTO v_boss_record
FROM global_bosses
WHERE is_active = true
    AND current_hp > 0
    AND end_time > NOW()
ORDER BY id
LIMIT 1;
IF FOUND THEN -- Add or update contributor
INSERT INTO boss_contributors (boss_id, user_id, total_damage)
VALUES (v_boss_record.id, p_user_id, p_damage) ON CONFLICT (boss_id, user_id) DO
UPDATE
SET total_damage = boss_contributors.total_damage + EXCLUDED.total_damage;
v_new_hp := v_boss_record.current_hp - p_damage;
IF v_new_hp <= 0 THEN -- Boss is dead! Grant rewards & close boss
UPDATE global_bosses
SET current_hp = 0,
    is_active = false
WHERE id = v_boss_record.id;
UPDATE profiles
SET coins = coins + v_boss_record.reward_coins,
    total_xp = total_xp + v_boss_record.reward_xp
WHERE id IN (
        SELECT user_id
        FROM boss_contributors
        WHERE boss_id = v_boss_record.id
    );
ELSE -- Boss still alive, just update HP
UPDATE global_bosses
SET current_hp = v_new_hp
WHERE id = v_boss_record.id;
END IF;
END IF;
END;
$$;


ALTER FUNCTION "public"."deal_damage_to_active_boss"("p_user_id" "uuid", "p_damage" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_subscription"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.user_subscriptions
    SET tier='free', billing_period=NULL, status='expired', monthly_grant=30,
        sub_period_end=NULL, updated_at=now()
    WHERE user_id = p_user_id;
END; $$;


ALTER FUNCTION "public"."expire_subscription"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_habit_log_award"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_prev integer;
  v_delta integer;
  v_entering_done boolean;
begin
  v_prev := case when TG_OP = 'UPDATE' then COALESCE(OLD.xp, 0) else 0 end;
  v_delta := COALESCE(NEW.xp, 0) - v_prev;

  v_entering_done := (NEW.state = 'done')
    and (TG_OP = 'INSERT' or COALESCE(OLD.state, '') <> 'done');

  -- Seri yalnız "done'a geçişte" artar
  if v_entering_done then
    update public.habits
    set streak_current = COALESCE(streak_current, 0) + 1,
        streak_best = greatest(COALESCE(streak_best, 0), COALESCE(streak_current, 0) + 1)
    where id = NEW.habit_id;
  end if;

  -- Profile + haftalık XP'ye yalnız pozitif fark eklenir (add_xp level/rank/badges zincirini tetikler)
  if v_delta > 0 then
    perform public.add_xp(NEW.user_id, v_delta);
    perform public.track_weekly_xp(NEW.user_id, v_delta);
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "public"."fn_habit_log_award"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_habit_log_set_xp"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_type integer;
  v_streak integer;
  v_entering_done boolean;
  v_prospective integer;
  v_mult numeric;
  v_award integer;
begin
  v_type := public.habit_xp_value(NEW.habit_id, NEW.state, NEW.value);

  v_entering_done := (NEW.state = 'done')
    and (TG_OP = 'INSERT' or COALESCE(OLD.state, '') <> 'done');

  v_streak := COALESCE((select streak_current from public.habits where id = NEW.habit_id), 0);
  v_prospective := v_streak + (case when v_entering_done then 1 else 0 end);
  v_mult := case
              when v_prospective >= 30 then 1.5
              when v_prospective >= 10 then 1.2
              else 1.0
            end;

  v_award := round(v_type * v_mult)::int;
  -- Yüksek-su-işareti: mevcut değerin altına inme
  NEW.xp := greatest(v_award, COALESCE(OLD.xp, 0));
  return NEW;
end;
$$;


ALTER FUNCTION "public"."fn_habit_log_set_xp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_habits_record_purged_xp"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_xp bigint;
begin
  select coalesce(sum(coalesce(xp, 0)), 0) into v_xp
  from public.habit_logs
  where habit_id = OLD.id;

  if v_xp > 0 then
    update public.profiles
       set purged_xp = coalesce(purged_xp, 0) + v_xp::int
     where id = OLD.user_id;
  end if;

  return OLD;
end;
$$;


ALTER FUNCTION "public"."fn_habits_record_purged_xp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_boss_status"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_boss RECORD;
v_my_damage INT;
v_total_contributors INT;
BEGIN
SELECT * INTO v_boss
FROM global_bosses
WHERE is_active = true
    AND end_time > NOW()
ORDER BY id DESC
LIMIT 1;
IF NOT FOUND THEN RETURN json_build_object('active', false);
END IF;
SELECT total_damage INTO v_my_damage
FROM boss_contributors
WHERE boss_id = v_boss.id
    AND user_id = auth.uid();
SELECT COUNT(*) INTO v_total_contributors
FROM boss_contributors
WHERE boss_id = v_boss.id;
RETURN json_build_object(
    'active',
    true,
    'boss',
    json_build_object(
        'name',
        v_boss.name,
        'description',
        v_boss.description,
        'current_hp',
        v_boss.current_hp,
        'max_hp',
        v_boss.max_hp,
        'reward_coins',
        v_boss.reward_coins,
        'reward_xp',
        v_boss.reward_xp,
        'end_time',
        v_boss.end_time
    ),
    'my_damage',
    COALESCE(v_my_damage, 0),
    'total_contributors',
    v_total_contributors
);
END;
$$;


ALTER FUNCTION "public"."get_active_boss_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_quests"() RETURNS TABLE("user_quest_id" "uuid", "quest_id" "uuid", "title" character varying, "description" "text", "target_value" integer, "reward_coins" integer, "progress" integer, "is_completed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_user_id UUID := auth.uid();
BEGIN -- Check if user has quests for CURRENT_DATE
IF NOT EXISTS (
    SELECT 1
    FROM user_quests
    WHERE user_id = v_user_id
        AND assigned_date = CURRENT_DATE
) THEN -- Insert random 3 quests for today
INSERT INTO user_quests (user_id, quest_id, assigned_date)
SELECT v_user_id,
    id,
    CURRENT_DATE
FROM quests
ORDER BY random()
LIMIT 3;
END IF;
RETURN QUERY
SELECT uq.id as user_quest_id,
    q.id as quest_id,
    q.title,
    q.description,
    q.target_value,
    q.reward_coins,
    uq.progress,
    uq.is_completed
FROM user_quests uq
    JOIN quests q ON q.id = uq.quest_id
WHERE uq.user_id = v_user_id
    AND uq.assigned_date = CURRENT_DATE;
END;
$$;


ALTER FUNCTION "public"."get_daily_quests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_global_leaderboard"("limit_val" integer DEFAULT 50) RETURNS TABLE("user_id" "uuid", "username" "text", "level" integer, "total_xp" integer, "willpower_rank" "text", "rank" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT p.id AS user_id,
         COALESCE(p.username, 'Gizli Savaşçı') AS username,
         COALESCE(p.level, 1) AS level,
         COALESCE(p.total_xp, 0) AS total_xp,
         COALESCE(p.willpower_rank, 'Acemi') AS willpower_rank,
         RANK() OVER (ORDER BY COALESCE(p.total_xp, 0) DESC) AS rank
  FROM public.profiles p
  WHERE COALESCE(p.total_xp, 0) > 0
  ORDER BY COALESCE(p.total_xp, 0) DESC
  LIMIT limit_val;
END;
$$;


ALTER FUNCTION "public"."get_global_leaderboard"("limit_val" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_monthly_habits"("start_date" "date", "end_date" "date") RETURNS TABLE("id" "uuid", "user_id" "uuid", "name" "text", "color" "text", "streak_goal" integer, "preferred_time_of_day" "text", "target_days" integer[], "category" "text", "icon" "text", "tracking_type" "text", "daily_goal" integer, "unit" "text", "logs" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE current_user_id UUID;
BEGIN current_user_id := auth.uid();
RETURN QUERY
SELECT h.id,
  h.user_id,
  h.name,
  h.color,
  h.streak_goal,
  h.preferred_time_of_day,
  h.target_days,
  h.category,
  h.icon,
  h.tracking_type,
  h.daily_goal,
  h.unit,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'log_id',
        hl.id,
        'completed_at',
        hl.completed_at,
        'is_completed',
        hl.is_completed,
        'current_streak',
        hl.current_streak,
        'notes',
        hl.notes,
        'value',
        hl.value,
        'is_makeup',
        hl.is_makeup
      )
      ORDER BY hl.completed_at
    ) FILTER (
      WHERE hl.id IS NOT NULL
    ),
    '[]'::jsonb
  ) AS logs
FROM habits h
  LEFT JOIN habit_logs hl ON h.id = hl.habit_id
  AND hl.completed_at >= start_date
  AND hl.completed_at <= end_date
WHERE h.user_id = current_user_id
  AND (
    h.status = 'active'
    OR h.status = 'queued'
  )
GROUP BY h.id;
END;
$$;


ALTER FUNCTION "public"."get_monthly_habits"("start_date" "date", "end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_init_subscription"() RETURNS "public"."user_subscriptions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE uid uuid := auth.uid(); sub public.user_subscriptions;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO sub FROM public.user_subscriptions WHERE user_id = uid;
  IF NOT FOUND THEN
    INSERT INTO public.user_subscriptions(user_id) VALUES (uid) RETURNING * INTO sub;
  END IF;
  -- Abonelik süresi bittiyse Free'ye düşür (grant'i de free yap)
  IF sub.tier <> 'free' AND sub.sub_period_end IS NOT NULL AND sub.sub_period_end <= now() THEN
    UPDATE public.user_subscriptions
      SET tier='free', billing_period=NULL, status='expired', monthly_grant=30, updated_at=now()
      WHERE user_id = uid RETURNING * INTO sub;
  END IF;
  -- Kredi periyodu dolduysa yenile (reset, devretmez)
  IF sub.credits_period_end <= now() THEN
    UPDATE public.user_subscriptions
      SET focus_points = monthly_grant, credits_period_end = now() + interval '1 month', updated_at=now()
      WHERE user_id = uid RETURNING * INTO sub;
    INSERT INTO public.credit_transactions(user_id, delta, reason, balance_after)
      VALUES (uid, sub.monthly_grant, 'monthly_renewal', sub.focus_points);
  END IF;
  RETURN sub;
END; $$;


ALTER FUNCTION "public"."get_or_init_subscription"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_init_subscription_for"("p_user_id" "uuid") RETURNS "public"."user_subscriptions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."get_or_init_subscription_for"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rank_for_level"("lvl" integer) RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if lvl >= 50 then return 'Efsane';
  elsif lvl >= 30 then return 'Usta';
  elsif lvl >= 20 then return 'Şövalye';
  elsif lvl >= 10 then return 'Savaşçı';
  elsif lvl >= 5 then return 'Çırak';
  else return 'Acemi';
  end if;
end;
$$;


ALTER FUNCTION "public"."get_rank_for_level"("lvl" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_gamification" (
    "user_id" "uuid" NOT NULL,
    "makeup_credits" integer DEFAULT 3 NOT NULL,
    "last_credit_reset" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_gamification" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_gamification"() RETURNS SETOF "public"."user_gamification"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN -- Ensure record exists
INSERT INTO user_gamification (user_id)
VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
RETURN QUERY
SELECT *
FROM user_gamification
WHERE user_id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."get_user_gamification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_pet_status"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_user_level INT;
v_pet_record RECORD;
v_new_stage_id INT;
BEGIN -- Get user level
SELECT level INTO v_user_level
FROM profiles
WHERE id = auth.uid();
SELECT * INTO v_pet_record
FROM user_pets
WHERE user_id = auth.uid();
IF NOT FOUND THEN
INSERT INTO user_pets (user_id, current_stage_id)
VALUES (auth.uid(), 1)
RETURNING * INTO v_pet_record;
END IF;
SELECT id INTO v_new_stage_id
FROM pet_stages
WHERE min_level <= v_user_level
ORDER BY min_level DESC
LIMIT 1;
IF v_new_stage_id > v_pet_record.current_stage_id THEN -- EVOLVE!
UPDATE user_pets
SET current_stage_id = v_new_stage_id
WHERE id = v_pet_record.id;
v_pet_record.current_stage_id := v_new_stage_id;
END IF;
RETURN (
    SELECT json_build_object(
            'pet_id',
            up.id,
            'name',
            up.pet_name,
            'health',
            up.health,
            'happiness',
            up.happiness,
            'stage_name',
            ps.name,
            'stage_min_level',
            ps.min_level,
            'icon',
            ps.icon,
            'color',
            ps.color,
            'description',
            ps.description
        )
    FROM user_pets up
        JOIN pet_stages ps ON ps.id = up.current_stage_id
    WHERE up.user_id = auth.uid()
);
END;
$$;


ALTER FUNCTION "public"."get_user_pet_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_rank"("target_user_id" "uuid") RETURNS TABLE("rank" bigint, "total_xp" integer, "level" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN RETURN QUERY WITH RankedProfiles AS (
        SELECT p.id,
            p.total_xp,
            p.level,
            RANK() OVER (
                ORDER BY p.total_xp DESC
            ) as current_rank
        FROM public.profiles p
        WHERE p.total_xp > 0
    )
SELECT r.current_rank as rank,
    r.total_xp,
    r.level
FROM RankedProfiles r
WHERE r.id = target_user_id;
END;
$$;


ALTER FUNCTION "public"."get_user_rank"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_skill_tree"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_user_points INT;
v_skills_json JSON;
BEGIN
SELECT skill_points INTO v_user_points
FROM profiles
WHERE id = auth.uid();
SELECT json_agg(
        json_build_object(
            'skill_key',
            s.key,
            'name',
            s.name,
            'description',
            s.description,
            'icon',
            s.icon,
            'max_level',
            s.max_level,
            'current_level',
            COALESCE(us.current_level, 0)
        )
    ) INTO v_skills_json
FROM skills s
    LEFT JOIN user_skills us ON us.skill_id = s.id
    AND us.user_id = auth.uid();
RETURN json_build_object(
    'available_points',
    v_user_points,
    'skills',
    COALESCE(v_skills_json, '[]'::json)
);
END;
$$;


ALTER FUNCTION "public"."get_user_skill_tree"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_weekly_leaderboard"("limit_val" integer DEFAULT 30) RETURNS TABLE("user_id" "uuid", "username" "text", "level" integer, "total_xp" integer, "weekly_xp" integer, "willpower_rank" "text", "rank" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_week_start DATE;
BEGIN v_week_start := date_trunc('week', CURRENT_DATE)::date;
RETURN QUERY
SELECT p.id as user_id,
    COALESCE(p.username, 'Gizli Savaşçı') as username,
    COALESCE(p.level, 1) as level,
    COALESCE(p.total_xp, 0) as total_xp,
    COALESCE(w.xp_earned, 0) as weekly_xp,
    COALESCE(p.willpower_rank, 'Acemi') as willpower_rank,
    RANK() OVER (
        ORDER BY COALESCE(w.xp_earned, 0) DESC
    ) as rank
FROM public.profiles p
    LEFT JOIN public.weekly_xp w ON p.id = w.user_id
    AND w.week_start = v_week_start
WHERE COALESCE(w.xp_earned, 0) > 0
ORDER BY COALESCE(w.xp_earned, 0) DESC
LIMIT limit_val;
END;
$$;


ALTER FUNCTION "public"."get_weekly_leaderboard"("limit_val" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_willpower_stats"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE -- Using auth.uid() ensures only the current user's data is calculated
  current_active_count integer;
current_queue_size integer;
current_willpower_load integer;
recommendation_text text;
user_uuid uuid;
BEGIN user_uuid := auth.uid();
IF user_uuid IS NULL THEN RAISE EXCEPTION 'Not authenticated';
END IF;
SELECT COUNT(*),
  COALESCE(SUM(difficulty), 0) INTO current_active_count,
  current_willpower_load
FROM habits
WHERE user_id = user_uuid
  AND status = 'active';
SELECT COUNT(*) INTO current_queue_size
FROM habits
WHERE user_id = user_uuid
  AND status IN ('queued', 'paused');
IF current_willpower_load >= 15 THEN recommendation_text := 'Maksimum irade kapasitesine ulaÅŸÄ±ldÄ± (15/15). Yeni alÄ±ÅŸkanlÄ±k eklemeden Ã¶nce bazÄ±larÄ±nÄ± beklemeye al.';
ELSE recommendation_text := format(
  'KullanÄ±labilir irade: %s/15. Yeni alÄ±ÅŸkanlÄ±k ekleyebilirsin.',
  15 - current_willpower_load
);
END IF;
RETURN json_build_object(
  'active_count',
  current_active_count,
  'queue_size',
  current_queue_size,
  'willpower_load',
  current_willpower_load,
  'recommendation',
  recommendation_text
);
END;
$$;


ALTER FUNCTION "public"."get_willpower_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."habit_xp_value"("p_habit_id" "uuid", "p_state" "text", "p_value" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  h record;
  v_freq_factor numeric;
  v_base numeric;
  v_behavior_bonus numeric;
  v_impact_bonus numeric;
  v_tracking_bonus numeric;
  v_time_bonus numeric;
  v_raw numeric;
  v_cost integer;
  v_base_xp integer;
  v_ratio numeric;
begin
  select difficulty, impact_level, behavior_type, tracking_type,
         estimated_minutes, daily_goal, target_direction,
         coalesce(frequency_config->>'kind', 'daily') as freq_kind
  into h
  from public.habits
  where id = p_habit_id;

  if not found then return 0; end if;

  v_freq_factor := case h.freq_kind
                     when 'weekly' then 0.7
                     when 'monthly' then 0.5
                     else 1.0
                   end;
  v_base := coalesce(h.difficulty, 3) * v_freq_factor;
  v_behavior_bonus := case when h.behavior_type = 'negative' then 1.5 else 0 end;
  v_impact_bonus := case h.impact_level
                      when 'critical' then 1.5
                      when 'high' then 1.0
                      when 'medium' then 0.5
                      else 0
                    end;
  v_tracking_bonus := case when h.tracking_type = 'numeric' then 0.5 else 0 end;
  v_time_bonus := least(2, floor(coalesce(h.estimated_minutes, 0) / 30.0) * 0.5);

  v_raw := v_base + v_behavior_bonus + v_impact_bonus + v_tracking_bonus + v_time_bonus;
  v_cost := greatest(1, least(10, round(v_raw)::int));
  v_base_xp := 10 * v_cost;

  if p_state = 'done' then
    return v_base_xp;

  elsif p_state = 'partial' then
    -- ceiling: mirrors ceilingRatio in lib/habitEngine.ts
    if h.target_direction = 'at_most' then
      if p_value is null then return 0; end if;
      if h.daily_goal is null or h.daily_goal < 0 then
        return round(v_base_xp * 0.5)::int;
      end if;
      if p_value <= h.daily_goal then return v_base_xp; end if;
      if h.daily_goal = 0 then return 0; end if;
      v_ratio := 1 - (p_value - h.daily_goal)::numeric / h.daily_goal;
      return greatest(0, least(v_base_xp, round(v_base_xp * v_ratio)::int));
    end if;

    -- floor (unchanged)
    if coalesce(h.daily_goal, 0) > 0 and coalesce(p_value, 0) > 0 then
      return greatest(0, least(v_base_xp, round(v_base_xp * (p_value::numeric / h.daily_goal))::int));
    end if;
    return round(v_base_xp * 0.5)::int;

  else
    return 0;
  end if;
end;
$$;


ALTER FUNCTION "public"."habit_xp_value"("p_habit_id" "uuid", "p_state" "text", "p_value" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ BEGIN
INSERT INTO public.profiles (id, email, username)
VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'username'
  );
RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."initialize_user_pet"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN
INSERT INTO user_pets (user_id, current_stage_id)
VALUES (NEW.id, 1) -- 1 is Egg stage
    ON CONFLICT (user_id) DO NOTHING;
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."initialize_user_pet"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."interact_with_pet"("p_action" character varying) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_cost INT := 0;
v_happiness_gain INT := 0;
v_health_gain INT := 0;
BEGIN IF p_action = 'feed' THEN v_cost := 50;
v_health_gain := 20;
ELSIF p_action = 'play' THEN v_cost := 25;
v_happiness_gain := 30;
ELSE RAISE EXCEPTION 'Geçersiz aksiyon';
END IF;
IF (
    SELECT coins
    FROM profiles
    WHERE id = auth.uid()
) < v_cost THEN RAISE EXCEPTION 'Yetersiz altın. Bu işlem % altın gerektiriyor.',
v_cost;
END IF;
UPDATE profiles
SET coins = coins - v_cost
WHERE id = auth.uid();
UPDATE user_pets
SET health = LEAST(100, health + v_health_gain),
    happiness = LEAST(100, happiness + v_happiness_gain),
    last_interaction_at = NOW()
WHERE user_id = auth.uid();
RETURN json_build_object('success', true, 'action', p_action);
END;
$$;


ALTER FUNCTION "public"."interact_with_pet"("p_action" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."jsonb_is_string_map"("v" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
  select jsonb_typeof(v) = 'object'
     and not exists (
       select 1 from jsonb_each(v) as e
       where jsonb_typeof(e.value) <> 'string'
     );
$$;


ALTER FUNCTION "public"."jsonb_is_string_map"("v" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."jsonb_is_string_map"("v" "jsonb") IS 'True when the value is a JSON object whose every value is a string. Used by monthly_reviews.answers so "free shape" does not mean "any shape".';



CREATE OR REPLACE FUNCTION "public"."log_makeup_completion"("p_habit_id" "uuid", "p_date" "date", "p_is_completed" boolean DEFAULT true, "p_notes" "text" DEFAULT NULL::"text", "p_value" integer DEFAULT NULL::integer) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_credits INTEGER;
v_user_id UUID;
v_result JSON;
BEGIN v_user_id := auth.uid();
SELECT makeup_credits INTO v_credits
FROM user_gamification
WHERE user_id = v_user_id;
IF v_credits IS NULL
OR v_credits < 1 THEN RAISE EXCEPTION 'Yetersiz Telafi HakkÄ± (0)';
END IF;
UPDATE user_gamification
SET makeup_credits = makeup_credits - 1
WHERE user_id = v_user_id;
INSERT INTO habit_logs (
    user_id,
    habit_id,
    completed_at,
    is_completed,
    notes,
    value,
    is_makeup
  )
VALUES (
    v_user_id,
    p_habit_id,
    p_date,
    p_is_completed,
    p_notes,
    p_value,
    TRUE
  ) ON CONFLICT (user_id, habit_id, completed_at) DO
UPDATE
SET is_completed = EXCLUDED.is_completed,
  notes = COALESCE(EXCLUDED.notes, habit_logs.notes),
  value = COALESCE(EXCLUDED.value, habit_logs.value),
  is_makeup = TRUE,
  -- Ensure it is marked as makeup if updated via this function
  updated_at = NOW();
SELECT json_build_object(
    'success',
    true,
    'remaining_credits',
    v_credits - 1
  ) INTO v_result;
RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."log_makeup_completion"("p_habit_id" "uuid", "p_date" "date", "p_is_completed" boolean, "p_notes" "text", "p_value" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mock_activate_subscription"("p_tier" "text", "p_period" "text") RETURNS "public"."user_subscriptions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE uid uuid := auth.uid(); grant_amt int; pend timestamptz; sub public.user_subscriptions;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_tier NOT IN ('plus','pro') THEN RAISE EXCEPTION 'invalid tier'; END IF;
  IF p_period NOT IN ('weekly','monthly','yearly') THEN RAISE EXCEPTION 'invalid period'; END IF;
  grant_amt := CASE p_tier WHEN 'plus' THEN 100 WHEN 'pro' THEN 1000 ELSE 30 END;
  pend := CASE p_period WHEN 'weekly' THEN now()+interval '7 days'
                        WHEN 'yearly' THEN now()+interval '1 year'
                        ELSE now()+interval '1 month' END;
  PERFORM public.get_or_init_subscription();
  UPDATE public.user_subscriptions
    SET tier=p_tier, billing_period=p_period, status='active',
        monthly_grant=grant_amt, focus_points=grant_amt,
        credits_period_end=now()+interval '1 month', sub_period_end=pend,
        provider='mock', updated_at=now()
    WHERE user_id = uid RETURNING * INTO sub;
  INSERT INTO public.credit_transactions(user_id, delta, reason, balance_after)
    VALUES (uid, grant_amt, 'subscription_activated:'||p_tier, sub.focus_points);
  RETURN sub;
END; $$;


ALTER FUNCTION "public"."mock_activate_subscription"("p_tier" "text", "p_period" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rebuild_profile_xp"("p_user_id" "uuid") RETURNS TABLE("before_total" integer, "after_total" integer, "logged_total" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_before integer;
  v_logged bigint;
  v_purged integer;
BEGIN
  select coalesce(total_xp, 0), coalesce(purged_xp, 0)
    into v_before, v_purged
  from public.profiles where id = p_user_id;
  if not found then raise exception 'no such profile: %', p_user_id; end if;

  select coalesce(sum(coalesce(xp, 0)), 0) into v_logged
  from public.habit_logs where user_id = p_user_id;

  v_logged := v_logged + v_purged;

  update public.profiles
     set total_xp = 0, current_level_xp = 0, level = 1,
         next_level_xp = 100, willpower_rank = public.get_rank_for_level(1)
   where id = p_user_id;

  if v_logged > 0 then
    perform public.add_xp(p_user_id, v_logged::int);
  end if;

  return query
    select v_before,
           (select coalesce(total_xp, 0) from public.profiles where id = p_user_id),
           v_logged;
END;
$$;


ALTER FUNCTION "public"."rebuild_profile_xp"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rebuild_profile_xp"("p_user_id" "uuid") IS 'Recomputes profiles.total_xp/level/rank for one user from habit_logs.xp + profiles.purged_xp by replaying add_xp from a clean slate. Service-role only.';



CREATE OR REPLACE FUNCTION "public"."refund_focus_points"("p_user_id" "uuid", "p_request_id" "text", "p_reason" "text") RETURNS TABLE("ok" boolean, "balance" integer, "already" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare spend public.credit_transactions; cur int;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  if p_request_id is null then raise exception 'request id required'; end if;
  select focus_points into cur from public.user_subscriptions where user_id = p_user_id for update;
  select * into spend from public.credit_transactions
    where user_id = p_user_id and request_id = p_request_id and delta < 0 limit 1;
  if not found then return query select false, cur, false; return; end if;
  if exists (select 1 from public.credit_transactions
             where user_id = p_user_id and request_id = p_request_id || ':refund') then
    return query select true, cur, true; return;
  end if;
  update public.user_subscriptions
    set focus_points = focus_points + (-spend.delta), updated_at = pg_catalog.now()
    where user_id = p_user_id returning focus_points into cur;
  insert into public.credit_transactions(user_id, delta, reason, balance_after, request_id)
    values (p_user_id, -spend.delta, coalesce(p_reason, 'refund'), cur, p_request_id || ':refund');
  return query select true, cur, false;
end;
$$;


ALTER FUNCTION "public"."refund_focus_points"("p_user_id" "uuid", "p_request_id" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."spend_focus_points"("p_amount" integer, "p_reason" "text") RETURNS TABLE("ok" boolean, "balance" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE uid uuid := auth.uid(); cur int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  PERFORM public.get_or_init_subscription();
  SELECT focus_points INTO cur FROM public.user_subscriptions WHERE user_id = uid FOR UPDATE;
  IF cur < p_amount THEN
    RETURN QUERY SELECT false, cur; RETURN;
  END IF;
  UPDATE public.user_subscriptions SET focus_points = focus_points - p_amount, updated_at=now()
    WHERE user_id = uid RETURNING focus_points INTO cur;
  INSERT INTO public.credit_transactions(user_id, delta, reason, balance_after)
    VALUES (uid, -p_amount, COALESCE(p_reason,'spend'), cur);
  RETURN QUERY SELECT true, cur;
END; $$;


ALTER FUNCTION "public"."spend_focus_points"("p_amount" integer, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."spend_focus_points_v2"("p_user_id" "uuid", "p_amount" integer, "p_reason" "text", "p_request_id" "text") RETURNS TABLE("ok" boolean, "balance" integer, "replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare cur int; prior public.credit_transactions;
begin
  if p_user_id is null then raise exception 'user id required'; end if;
  if p_amount <= 0 then raise exception 'invalid amount'; end if;
  perform public.get_or_init_subscription_for(p_user_id);
  select focus_points into cur from public.user_subscriptions where user_id = p_user_id for update;
  if p_request_id is not null then
    select * into prior from public.credit_transactions
      where user_id = p_user_id and request_id = p_request_id and delta < 0 limit 1;
    if found then
      if exists (select 1 from public.credit_transactions
                 where user_id = p_user_id and request_id = p_request_id || ':refund') then
        return query select false, cur, false; return;
      end if;
      return query select true, cur, true; return;
    end if;
  end if;
  if cur < p_amount then return query select false, cur, false; return; end if;
  update public.user_subscriptions
    set focus_points = focus_points - p_amount, updated_at = pg_catalog.now()
    where user_id = p_user_id returning focus_points into cur;
  insert into public.credit_transactions(user_id, delta, reason, balance_after, request_id)
    values (p_user_id, -p_amount, coalesce(p_reason, 'spend'), cur, p_request_id);
  return query select true, cur, false;
end;
$$;


ALTER FUNCTION "public"."spend_focus_points_v2"("p_user_id" "uuid", "p_amount" integer, "p_reason" "text", "p_request_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_user_onboarding_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."touch_user_onboarding_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."track_weekly_xp"("p_user_id" "uuid", "p_xp" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_week_start DATE;
BEGIN -- Calculate current week's Monday
v_week_start := date_trunc('week', CURRENT_DATE)::date;
INSERT INTO public.weekly_xp (user_id, week_start, xp_earned)
VALUES (p_user_id, v_week_start, p_xp) ON CONFLICT (user_id, week_start) DO
UPDATE
SET xp_earned = public.weekly_xp.xp_earned + p_xp;
END;
$$;


ALTER FUNCTION "public"."track_weekly_xp"("p_user_id" "uuid", "p_xp" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_damage_on_habit_log"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN -- Only dealing damage if it's a regular 'completed' action, not skipped or failed if that exists
    IF NEW.is_completed = true THEN -- Deal 10 damage for every completed habit
    PERFORM deal_damage_to_active_boss(NEW.user_id, 10);
END IF;
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_damage_on_habit_log"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_events_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_events_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upgrade_skill"("p_skill_key" character varying) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_skill_id INT;
v_max_level INT;
v_current_level INT;
v_user_points INT;
BEGIN -- Get skill info
SELECT id,
    max_level INTO v_skill_id,
    v_max_level
FROM skills
WHERE key = p_skill_key;
IF NOT FOUND THEN RAISE EXCEPTION 'Yetenek bulunamadı.';
END IF;
SELECT skill_points INTO v_user_points
FROM profiles
WHERE id = auth.uid();
IF v_user_points <= 0 THEN RAISE EXCEPTION 'Yeterli yetenek puanı yok. Seviye atlayarak kazanabilirsin!';
END IF;
SELECT current_level INTO v_current_level
FROM user_skills
WHERE user_id = auth.uid()
    AND skill_id = v_skill_id;
IF v_current_level IS NULL THEN v_current_level := 0;
INSERT INTO user_skills (user_id, skill_id, current_level)
VALUES (auth.uid(), v_skill_id, 0);
END IF;
IF v_current_level >= v_max_level THEN RAISE EXCEPTION 'Bu yetenek zaten maksimum seviyede!';
END IF;
UPDATE user_skills
SET current_level = current_level + 1
WHERE user_id = auth.uid()
    AND skill_id = v_skill_id;
UPDATE profiles
SET skill_points = skill_points - 1
WHERE id = auth.uid();
RETURN json_build_object(
    'success',
    true,
    'new_level',
    v_current_level + 1
);
END;
$$;


ALTER FUNCTION "public"."upgrade_skill"("p_skill_key" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."xp_drift"() RETURNS TABLE("user_id" "uuid", "recorded_total" integer, "logged_total" bigint, "drift" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.id,
         coalesce(p.total_xp, 0) as recorded_total,
         coalesce(l.sum_xp, 0) + coalesce(p.purged_xp, 0) as logged_total,
         coalesce(p.total_xp, 0) - (coalesce(l.sum_xp, 0) + coalesce(p.purged_xp, 0)) as drift
  from public.profiles p
  left join (
    select hl.user_id, sum(coalesce(hl.xp, 0)) as sum_xp
    from public.habit_logs hl
    group by hl.user_id
  ) l on l.user_id = p.id
  where coalesce(p.total_xp, 0) <> coalesce(l.sum_xp, 0) + coalesce(p.purged_xp, 0);
$$;


ALTER FUNCTION "public"."xp_drift"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."xp_drift"() IS 'Users whose profiles.total_xp disagrees with sum(habit_logs.xp) + profiles.purged_xp. Empty is the healthy state. Deleting a habit cascades its logs away, so purged_xp is what keeps the comparison honest for anyone who has ever deleted one. Service-role only: it reads every profile.';



CREATE TABLE IF NOT EXISTS "public"."ai_calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "called_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_calls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_conversation_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "assistant_message_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "ai_actions_resolved_agrees_with_status" CHECK (((("status" = 'pending'::"text") AND ("resolved_at" IS NULL)) OR (("status" <> 'pending'::"text") AND ("resolved_at" IS NOT NULL)))),
    CONSTRAINT "ai_actions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "ai_actions_type_check" CHECK (("action_type" = ANY (ARRAY['propose_habit'::"text", 'propose_habit_plan'::"text", 'log_habit'::"text"])))
);


ALTER TABLE "public"."ai_conversation_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "project_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_message_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    CONSTRAINT "ai_conversations_title_len" CHECK ((("char_length"("btrim"("title")) >= 1) AND ("char_length"("btrim"("title")) <= 200)))
);


ALTER TABLE "public"."ai_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "request_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_messages_content_len" CHECK ((("char_length"("btrim"("content")) >= 1) AND ("char_length"("btrim"("content")) <= 8000))),
    CONSTRAINT "ai_messages_request_id_len" CHECK ((("request_id" IS NULL) OR (("char_length"("request_id") >= 8) AND ("char_length"("request_id") <= 128)))),
    CONSTRAINT "ai_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"])))
);


ALTER TABLE "public"."ai_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_requests" (
    "user_id" "uuid" NOT NULL,
    "request_id" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "input_fingerprint" "text" NOT NULL,
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "response" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lease_expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval) NOT NULL,
    CONSTRAINT "ai_requests_completed_has_response" CHECK ((("status" <> 'completed'::"text") OR ("response" IS NOT NULL))),
    CONSTRAINT "ai_requests_mode_check" CHECK (("mode" = ANY (ARRAY['coach'::"text", 'routine'::"text", 'summarize'::"text", 'insights'::"text"]))),
    CONSTRAINT "ai_requests_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."ai_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_requests" IS 'One row per (user, request_id): the durable identity of a single logical AI operation. Claimed before the provider is called, fingerprinted against the input that claimed it, and holding the successful payload so a replay is answered from here instead of from Anthropic.';



COMMENT ON COLUMN "public"."ai_requests"."lease_expires_at" IS 'When this claim stops protecting the key. Past it the row may be reclaimed by ai_request_reconcile_stale, which refunds whatever the key charged and marks it failed. Five minutes: far beyond the 20s client deadline and the platform request cap, so an active request can never be reclaimed.';



CREATE TABLE IF NOT EXISTS "public"."bad_habits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "quit_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cost_per_day" numeric(12,2) DEFAULT 0 NOT NULL,
    "time_wasted_per_day" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bad_habits_cost_per_day_check" CHECK (("cost_per_day" >= (0)::numeric)),
    CONSTRAINT "bad_habits_description_check" CHECK ((("description" IS NULL) OR ("length"("description") <= 2000))),
    CONSTRAINT "bad_habits_name_check" CHECK ((("length"("btrim"("name")) >= 1) AND ("length"("btrim"("name")) <= 120))),
    CONSTRAINT "bad_habits_time_wasted_per_day_check" CHECK (("time_wasted_per_day" >= 0))
);


ALTER TABLE "public"."bad_habits" OWNER TO "postgres";


COMMENT ON TABLE "public"."bad_habits" IS 'Quit-tracking with a cost/time saving. Replaces the unauthenticated /api/bad-habits on the retired FastAPI service, which stored every user''s rows under user_id = "default".';



CREATE TABLE IF NOT EXISTS "public"."boss_contributors" (
    "id" integer NOT NULL,
    "boss_id" integer,
    "user_id" "uuid",
    "total_damage" integer DEFAULT 0
);


ALTER TABLE "public"."boss_contributors" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."boss_contributors_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."boss_contributors_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."boss_contributors_id_seq" OWNED BY "public"."boss_contributors"."id";



CREATE TABLE IF NOT EXISTS "public"."calendars" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color_hex" "text" DEFAULT '#4A90E2'::"text" NOT NULL,
    "type" "text" DEFAULT 'personal'::"text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "calendars_type_check" CHECK (("type" = ANY (ARRAY['work'::"text", 'family'::"text", 'social'::"text", 'samsung'::"text", 'personal'::"text"])))
);


ALTER TABLE "public"."calendars" OWNER TO "postgres";


COMMENT ON TABLE "public"."calendars" IS 'Stores user calendars (Work, Family, Social, Samsung, Personal)';



COMMENT ON COLUMN "public"."calendars"."type" IS 'Calendar type: work, family, social, samsung, or personal';



COMMENT ON COLUMN "public"."calendars"."is_default" IS 'Whether this is the default calendar for new events';



CREATE TABLE IF NOT EXISTS "public"."challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "duration_days" integer DEFAULT 30 NOT NULL,
    "icon" "text",
    "color" "text",
    "difficulty_level" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    CONSTRAINT "challenges_difficulty_level_check" CHECK (("difficulty_level" = ANY (ARRAY['easy'::"text", 'medium'::"text", 'hard'::"text"])))
);


ALTER TABLE "public"."challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "delta" integer NOT NULL,
    "reason" "text",
    "balance_after" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_id" "text"
);


ALTER TABLE "public"."credit_transactions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."credit_transactions"."request_id" IS 'Idempotency key for one user-initiated AI action. Unique per user when set, so a client retry replays the first outcome instead of charging again.';



CREATE TABLE IF NOT EXISTS "public"."daily_capacity" (
    "user_id" "uuid" NOT NULL,
    "capacity_date" "date" NOT NULL,
    "habit_load" numeric DEFAULT 0 NOT NULL,
    "task_load" numeric DEFAULT 0 NOT NULL,
    "focus_load" numeric DEFAULT 0 NOT NULL,
    "overdue_pressure" numeric DEFAULT 0 NOT NULL,
    "raw_load" numeric DEFAULT 0 NOT NULL,
    "normalised_load" numeric DEFAULT 0 NOT NULL,
    "band" "text" DEFAULT 'dusuk'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "daily_capacity_band_check" CHECK (("band" = ANY (ARRAY['dusuk'::"text", 'dengeli'::"text", 'yuksek'::"text", 'asiri'::"text"]))),
    CONSTRAINT "daily_capacity_normalised_load_check" CHECK ((("normalised_load" >= (0)::numeric) AND ("normalised_load" <= (100)::numeric)))
);


ALTER TABLE "public"."daily_capacity" OWNER TO "postgres";


COMMENT ON TABLE "public"."daily_capacity" IS 'Per-day snapshot of the Capacity Engine V1 output (frontend/lib/capacity.ts dailyLoad). v1 heuristic values, not a measured psychological quantity -- see that file''s module doc.';



CREATE TABLE IF NOT EXISTS "public"."deep_work_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "subject" "text" NOT NULL,
    "duration_minutes" integer NOT NULL,
    "date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "deep_work_sessions_duration_minutes_check" CHECK (("duration_minutes" > 0))
);


ALTER TABLE "public"."deep_work_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "template_name" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."event_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_templates" IS 'Stores user-created event templates for quick event creation';



COMMENT ON COLUMN "public"."event_templates"."data" IS 'JSONB object containing only the fields user selected when saving template';



CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "calendar_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "location" "text",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "is_all_day" boolean DEFAULT false NOT NULL,
    "visibility" "text" DEFAULT 'standard'::"text" NOT NULL,
    "transparency" "text" DEFAULT 'busy'::"text" NOT NULL,
    "color_hex" "text",
    "category_type" "text",
    "attendees" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "recurrence_rule" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "events_category_type_check" CHECK (("category_type" = ANY (ARRAY['birthday'::"text", 'anniversary'::"text", 'meeting'::"text", 'holiday'::"text", 'other'::"text"]))),
    CONSTRAINT "events_transparency_check" CHECK (("transparency" = ANY (ARRAY['busy'::"text", 'free'::"text"]))),
    CONSTRAINT "events_visibility_check" CHECK (("visibility" = ANY (ARRAY['standard'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON TABLE "public"."events" IS 'Stores calendar events with full details';



COMMENT ON COLUMN "public"."events"."visibility" IS 'Event visibility: standard or private';



COMMENT ON COLUMN "public"."events"."transparency" IS 'Show time as: busy or free';



COMMENT ON COLUMN "public"."events"."attendees" IS 'Array of attendee emails/names in JSONB format';



COMMENT ON COLUMN "public"."events"."recurrence_rule" IS 'Recurring event rule in RRULE format';



CREATE TABLE IF NOT EXISTS "public"."focus_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "task_title" "text",
    "mode" "text" DEFAULT 'work'::"text" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "planned_seconds" integer DEFAULT 1500 NOT NULL,
    "completed_seconds" integer DEFAULT 0,
    "completed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "focus_sessions_mode_check" CHECK (("mode" = ANY (ARRAY['work'::"text", 'shortBreak'::"text", 'longBreak'::"text"])))
);


ALTER TABLE "public"."focus_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."focus_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "completed" boolean DEFAULT false NOT NULL,
    "selected" boolean DEFAULT false NOT NULL,
    "estimated_pomodoros" integer DEFAULT 1,
    "completed_pomodoros" integer DEFAULT 0,
    "total_focus_seconds" integer DEFAULT 0,
    "color" "text" DEFAULT '#6366f1'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."focus_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."global_bosses" (
    "id" integer NOT NULL,
    "name" character varying NOT NULL,
    "description" "text",
    "max_hp" integer DEFAULT 10000 NOT NULL,
    "current_hp" integer DEFAULT 10000 NOT NULL,
    "is_active" boolean DEFAULT true,
    "reward_coins" integer DEFAULT 500,
    "reward_xp" integer DEFAULT 1000,
    "end_time" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."global_bosses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."global_bosses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."global_bosses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."global_bosses_id_seq" OWNED BY "public"."global_bosses"."id";



CREATE TABLE IF NOT EXISTS "public"."goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "title" "text" NOT NULL,
    "progress" integer DEFAULT 0,
    "year" integer,
    "quarter" integer,
    "month" integer,
    "archived" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "goals_kind_check" CHECK (("kind" = ANY (ARRAY['yearly'::"text", 'quarterly'::"text", 'monthly'::"text"]))),
    CONSTRAINT "goals_month_check" CHECK ((("month" >= 1) AND ("month" <= 12))),
    CONSTRAINT "goals_progress_check" CHECK ((("progress" >= 0) AND ("progress" <= 100))),
    CONSTRAINT "goals_quarter_check" CHECK ((("quarter" >= 1) AND ("quarter" <= 4)))
);


ALTER TABLE "public"."goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."google_calendar_integrations" (
    "user_id" "uuid" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text" DEFAULT ''::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "scope" "text",
    "token_type" "text",
    "calendar_id" "text",
    "calendar_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."google_calendar_integrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."google_calendar_integrations" IS 'Google Calendar OAuth tokens. SERVER-ONLY / FAIL-CLOSED: RLS enabled with zero policies by design, so no client can read or write it. Reached only by the google-auth edge function via the service role, after it verifies the caller. Same model as spotify_accounts. Adding a client policy here would expose a long-lived refresh token to any holder of the user JWT.';



CREATE TABLE IF NOT EXISTS "public"."habit_deletions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "habit_id" "uuid" NOT NULL,
    "habit_name" "text",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."habit_deletions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."habit_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "habit_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "completed_at" "date" NOT NULL,
    "is_completed" boolean DEFAULT true,
    "current_streak" integer DEFAULT 0,
    "notes" "text",
    "mood_rating" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "photo_url" "text",
    "voice_note_url" "text",
    "caption" "text",
    "value" integer DEFAULT 1,
    "is_makeup" boolean DEFAULT false,
    "state" "text" DEFAULT 'miss'::"text" NOT NULL,
    "xp" integer DEFAULT 0,
    CONSTRAINT "habit_logs_mood_rating_check" CHECK ((("mood_rating" >= 1) AND ("mood_rating" <= 5))),
    CONSTRAINT "habit_logs_state_check" CHECK (("state" = ANY (ARRAY['done'::"text", 'partial'::"text", 'skip'::"text", 'miss'::"text"])))
);


ALTER TABLE "public"."habit_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."habit_logs" IS 'Per-day habit completion rows. RLS: owner-scoped on user_id, and INSERT/UPDATE additionally require that habit_id belongs to the caller - without that, a user could attach logs to another user habit (found live 2026-08-30).';



COMMENT ON COLUMN "public"."habit_logs"."value" IS 'Numeric value for measurable habits (e.g. pages read)';



CREATE TABLE IF NOT EXISTS "public"."habit_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "habit_id" "uuid",
    "time" time without time zone NOT NULL,
    "enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."habit_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."habit_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text" DEFAULT 'General'::"text",
    "icon" "text" DEFAULT 'star'::"text",
    "habits" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "color" "text" DEFAULT '#8b5cf6'::"text",
    "main_category" "text",
    "sub_category" "text",
    "behavior_type" "text",
    "type" "text"
);


ALTER TABLE "public"."habit_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."habits" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "frequency" "text" DEFAULT 'daily'::"text",
    "target_days" integer[] DEFAULT '{}'::integer[],
    "color" "text",
    "icon" "text",
    "streak_current" integer DEFAULT 0,
    "streak_best" integer DEFAULT 0,
    "strength_score" double precision DEFAULT 0,
    "impact" integer DEFAULT 1,
    "difficulty" integer DEFAULT 1,
    "priority" "text" DEFAULT 'medium'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "streak_goal" integer DEFAULT 7,
    "preferred_time_of_day" "text" DEFAULT 'any'::"text",
    "domain" "text" DEFAULT 'general'::"text",
    "reminders" "jsonb" DEFAULT '[]'::"jsonb",
    "goal_type" character varying(20) DEFAULT 'streak'::character varying,
    "goal_date" "date",
    "goal_amount" integer,
    "goal_unit" character varying(20),
    "behavior_type" character varying(20) DEFAULT 'positive'::character varying,
    "tracking_type" "text" DEFAULT 'boolean'::"text",
    "unit" "text",
    "daily_goal" integer DEFAULT 1,
    "log_question" "text",
    "focus_score" double precision DEFAULT 0,
    "habit_type" "text" DEFAULT 'positive'::"text",
    "quit_date" timestamp with time zone,
    "cost_per_day" double precision DEFAULT 0,
    "time_wasted_per_day" integer DEFAULT 0,
    "willpower_cost" integer DEFAULT 3 NOT NULL,
    "target_direction" "text",
    "frequency_config" "jsonb" DEFAULT '{"kind": "daily"}'::"jsonb" NOT NULL,
    "end_condition" "jsonb",
    "impact_level" "text",
    "urgency" "text",
    "estimated_minutes" integer DEFAULT 0,
    "cue_habit_id" "uuid",
    "cue_note" "text",
    "life_area" "text",
    "install_id" "uuid",
    CONSTRAINT "check_difficulty_positive" CHECK (("difficulty" >= 1)),
    CONSTRAINT "habits_domain_check" CHECK (("domain" = ANY (ARRAY['health'::"text", 'work'::"text", 'finance'::"text", 'learning'::"text", 'social'::"text", 'personal'::"text", 'general'::"text", 'creativity'::"text"]))),
    CONSTRAINT "habits_goal_type_check" CHECK ((("goal_type")::"text" = ANY ((ARRAY['streak'::character varying, 'total_count'::character varying, 'frequency'::character varying])::"text"[]))),
    CONSTRAINT "habits_impact_level_check" CHECK ((("impact_level" IS NULL) OR ("impact_level" = ANY (ARRAY['critical'::"text", 'high'::"text", 'medium'::"text", 'low'::"text"])))),
    CONSTRAINT "habits_life_area_check" CHECK ((("life_area" IS NULL) OR ("life_area" = ANY (ARRAY['saglik'::"text", 'kariyer'::"text", 'egitim'::"text", 'finans'::"text", 'aile'::"text", 'sosyal'::"text", 'ruhsal'::"text", 'hobiler'::"text"])))),
    CONSTRAINT "habits_preferred_time_of_day_check" CHECK (("preferred_time_of_day" = ANY (ARRAY['morning'::"text", 'afternoon'::"text", 'evening'::"text", 'any'::"text"]))),
    CONSTRAINT "habits_target_direction_check" CHECK (("target_direction" = ANY (ARRAY['at_least'::"text", 'at_most'::"text"]))),
    CONSTRAINT "habits_tracking_type_check" CHECK (("tracking_type" = ANY (ARRAY['boolean'::"text", 'numeric'::"text", 'duration'::"text", 'abstinence'::"text"]))),
    CONSTRAINT "habits_urgency_check" CHECK ((("urgency" IS NULL) OR ("urgency" = ANY (ARRAY['urgent'::"text", 'not_urgent'::"text"]))))
);


ALTER TABLE "public"."habits" OWNER TO "postgres";


COMMENT ON COLUMN "public"."habits"."tracking_type" IS 'Type of tracking: boolean (Yes/No) or numeric (Measurable)';



COMMENT ON COLUMN "public"."habits"."unit" IS 'Unit of measurement for numeric habits (e.g., pages, km)';



COMMENT ON COLUMN "public"."habits"."daily_goal" IS 'Daily target value for completion';



COMMENT ON COLUMN "public"."habits"."log_question" IS 'Custom question displayed during logging';



COMMENT ON COLUMN "public"."habits"."install_id" IS 'The onboarding install that created this row, or NULL for every habit made by hand, by a Routine Pack or by the AI builder. Recovery counts rows by (user_id, install_id) -- never by how many habits the account has, which is not evidence about any particular install.';



CREATE TABLE IF NOT EXISTS "public"."journal_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "mood" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_summary" boolean DEFAULT false NOT NULL,
    CONSTRAINT "journal_entries_mood_check" CHECK ((("mood" >= 1) AND ("mood" <= 5)))
);


ALTER TABLE "public"."journal_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."journal_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "period_key" "text" NOT NULL,
    "content" "text" NOT NULL,
    "entry_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "journal_insights_period_check" CHECK (("period" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'yearly'::"text"])))
);


ALTER TABLE "public"."journal_insights" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."key_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "okr_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "current_value" numeric DEFAULT 0 NOT NULL,
    "target_value" numeric NOT NULL,
    "unit" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "key_results_target_value_check" CHECK (("target_value" > (0)::numeric))
);


ALTER TABLE "public"."key_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."life_area_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "area" "text" NOT NULL,
    "value" integer NOT NULL,
    CONSTRAINT "life_area_logs_value_check" CHECK ((("value" >= 1) AND ("value" <= 10)))
);


ALTER TABLE "public"."life_area_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "month_key" "text" NOT NULL,
    "answers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monthly_reviews_answers_shape" CHECK (("public"."jsonb_is_string_map"("answers") AND ("length"(("answers")::"text") <= 20000))),
    CONSTRAINT "monthly_reviews_month_key_check" CHECK (("month_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::"text"))
);


ALTER TABLE "public"."monthly_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."monthly_reviews" IS 'One reflection per user per month. Source of truth; AsyncStorage keeps only a per-account draft of the month being edited. Replaces the device-local, account-unscoped monthly_review_<key> AsyncStorage entry.';



CREATE TABLE IF NOT EXISTS "public"."notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notion_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "access_token" "text" NOT NULL,
    "workspace_id" "text",
    "workspace_name" "text",
    "workspace_icon" "text",
    "bot_id" "text",
    "habits_database_id" "text",
    "tasks_database_id" "text",
    "habits_url" "text",
    "tasks_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notion_integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."okrs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "objective" "text" NOT NULL,
    "year" integer NOT NULL,
    "quarter" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "okrs_quarter_check" CHECK ((("quarter" >= 1) AND ("quarter" <= 4)))
);


ALTER TABLE "public"."okrs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pet_stages" (
    "id" integer NOT NULL,
    "name" character varying NOT NULL,
    "description" "text",
    "min_level" integer NOT NULL,
    "icon" character varying NOT NULL,
    "color" character varying NOT NULL
);


ALTER TABLE "public"."pet_stages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pet_stages_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pet_stages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pet_stages_id_seq" OWNED BY "public"."pet_stages"."id";



CREATE TABLE IF NOT EXISTS "public"."profile_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "badge_name" "text" NOT NULL,
    "icon" "text",
    "description" "text",
    "earned_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."profile_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "username" "text",
    "level" integer DEFAULT 1,
    "total_xp" integer DEFAULT 0,
    "current_level_xp" integer DEFAULT 0,
    "next_level_xp" integer DEFAULT 100,
    "willpower_rank" "text" DEFAULT 'Acemi'::"text",
    "streak_record" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "makeup_credits" integer DEFAULT 3,
    "last_credit_reset" timestamp with time zone DEFAULT "now"(),
    "push_token" "text",
    "ai_persona" "text" DEFAULT 'zen'::"text",
    "last_ai_context" "text",
    "coins" integer DEFAULT 0,
    "skill_points" integer DEFAULT 0,
    "purged_xp" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "profiles_ai_persona_check" CHECK (("ai_persona" = ANY (ARRAY['drill_sergeant'::"text", 'zen'::"text", 'cheerleader'::"text", 'analyst'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."purged_xp" IS 'XP earned by habit_logs that were removed when their habit was deleted. Server-written only (see trg_habits_record_purged_xp). Exists so total_xp stays reconstructible after a purge: total_xp = sum(habit_logs.xp) + purged_xp.';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#6366f1'::"text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "title" character varying NOT NULL,
    "description" "text",
    "condition_type" character varying NOT NULL,
    "target_value" integer NOT NULL,
    "reward_coins" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."quests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reading_list" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "author" "text",
    "type" "text" DEFAULT 'book'::"text" NOT NULL,
    "status" "text" DEFAULT 'want_to_read'::"text" NOT NULL,
    "url" "text",
    "notes" "text",
    "rating" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reading_list_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5))),
    CONSTRAINT "reading_list_status_check" CHECK (("status" = ANY (ARRAY['want_to_read'::"text", 'reading'::"text", 'completed'::"text"]))),
    CONSTRAINT "reading_list_type_check" CHECK (("type" = ANY (ARRAY['book'::"text", 'article'::"text", 'video'::"text", 'podcast'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."reading_list" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recovery_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "habit_id" "uuid" NOT NULL,
    "source_date" "date" NOT NULL,
    "target_date" "date" NOT NULL,
    "strategy" "text" DEFAULT 'complete_today'::"text" NOT NULL,
    "note" "text",
    "reminder_time" "text",
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_log_id" "uuid",
    "deficit_type" "text",
    "deficit_value" numeric,
    "distributed_days" "jsonb",
    "completed_at" timestamp with time zone,
    CONSTRAINT "recovery_plans_completed_at_agrees_with_status" CHECK (((("status" = 'completed'::"text") AND ("completed_at" IS NOT NULL)) OR (("status" <> 'completed'::"text") AND ("completed_at" IS NULL)))),
    CONSTRAINT "recovery_plans_deficit_type_check" CHECK ((("deficit_type" IS NULL) OR ("deficit_type" = ANY (ARRAY['numeric'::"text", 'binary'::"text"])))),
    CONSTRAINT "recovery_plans_deficit_value_nonneg" CHECK ((("deficit_value" IS NULL) OR ("deficit_value" >= (0)::numeric))),
    CONSTRAINT "recovery_plans_distributed_days_shape" CHECK ((("distributed_days" IS NULL) OR ("jsonb_typeof"("distributed_days") = 'array'::"text"))),
    CONSTRAINT "recovery_plans_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'completed'::"text", 'expired'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "recovery_plans_strategy_check" CHECK (("strategy" = ANY (ARRAY['complete_today'::"text", 'push_tomorrow'::"text", 'split_two_days'::"text", 'skip'::"text"])))
);


ALTER TABLE "public"."recovery_plans" OWNER TO "postgres";


COMMENT ON COLUMN "public"."recovery_plans"."strategy" IS 'v2 vocabulary only: complete_today | push_tomorrow | split_two_days | skip. The legacy full/half/mini/reschedule spellings were mapped and retired by 20260906g as part of the coordinated v2 release; the temporary compatibility rollback in 20260831_recovery_vocabulary_compat_rollback is now discharged.';



COMMENT ON COLUMN "public"."recovery_plans"."status" IS 'v2 vocabulary only: planned | completed | expired | cancelled. The legacy done/skipped spellings were mapped by 20260906g (done -> completed, skipped -> cancelled), reconciling completed_at with recovery_plans_completed_at_agrees_with_status in the same statement.';



COMMENT ON COLUMN "public"."recovery_plans"."source_log_id" IS 'The habit_logs row this recovery plan responds to. Nullable: existing rows predate this column and older writers may not populate it either, until frontend/store rewiring lands (see frontend/lib/recovery.ts).';



COMMENT ON COLUMN "public"."recovery_plans"."deficit_type" IS 'numeric | binary. See frontend/lib/recovery.ts DeficitType -- a numeric/duration target falls short by an amount; a boolean/abstinence habit is a whole unit owed or not.';



COMMENT ON COLUMN "public"."recovery_plans"."deficit_value" IS 'How much was owed, from lib/recovery.deficitFor. Was silently dropped on every save until 20260831.';



COMMENT ON COLUMN "public"."recovery_plans"."distributed_days" IS 'Per-day split produced by the "2 gune bol" strategy. Null for every other strategy. See frontend/lib/recovery.ts recoveryOptions/splitAcrossDays for the exact split rule (odd deficits give the earlier day the larger half; zero-value days are omitted).';



COMMENT ON COLUMN "public"."recovery_plans"."completed_at" IS 'Set when status transitions to completed. Distinct from created_at (when the plan was made) and target_date (when it was scheduled for).';



CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "trigger_minutes_before" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reminders_trigger_minutes_before_check" CHECK (("trigger_minutes_before" >= 0))
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


COMMENT ON TABLE "public"."reminders" IS 'Stores event reminders with trigger times';



COMMENT ON COLUMN "public"."reminders"."trigger_minutes_before" IS 'Minutes before event to trigger reminder (e.g., 15, 30, 60)';



CREATE TABLE IF NOT EXISTS "public"."routine_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "routine_id" "uuid" NOT NULL,
    "habit_template" "jsonb" NOT NULL
);


ALTER TABLE "public"."routine_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."routines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "source" "text" DEFAULT 'custom'::"text" NOT NULL,
    "prompt" "text",
    CONSTRAINT "routines_source_check" CHECK (("source" = ANY (ARRAY['ai'::"text", 'library'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."routines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" character varying NOT NULL,
    "description" "text",
    "price" integer NOT NULL,
    "icon" character varying NOT NULL,
    "item_type" character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."shop_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" integer NOT NULL,
    "key" character varying NOT NULL,
    "name" character varying NOT NULL,
    "description" "text",
    "icon" character varying NOT NULL,
    "max_level" integer DEFAULT 3
);


ALTER TABLE "public"."skills" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."skills_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."skills_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."skills_id_seq" OWNED BY "public"."skills"."id";



CREATE TABLE IF NOT EXISTS "public"."spotify_accounts" (
    "user_id" "uuid" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "scope" "text",
    "spotify_user_id" "text",
    "display_name" "text",
    "product" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."spotify_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "due_date" timestamp with time zone,
    "time_block_start" "text",
    "time_block_end" "text",
    "completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "is_subtask" boolean DEFAULT false,
    "parent_task_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "list_name" "text" DEFAULT 'Default'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "priority" "text" DEFAULT 'none'::"text" NOT NULL,
    "list_type" "text" DEFAULT 'inbox'::"text" NOT NULL,
    "project_id" "uuid",
    "notes_text" "text",
    "quadrant" "text",
    CONSTRAINT "tasks_list_type_check" CHECK (("list_type" = ANY (ARRAY['inbox'::"text", 'this_week'::"text", 'someday'::"text"]))),
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text", 'none'::"text"]))),
    CONSTRAINT "tasks_quadrant_check" CHECK (("quadrant" = ANY (ARRAY['UI'::"text", 'NI'::"text", 'UN'::"text", 'NN'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tasks"."list_name" IS 'Task list name for organization (e.g., Work, Personal, Shopping)';



COMMENT ON COLUMN "public"."tasks"."status" IS 'Task status: pending, in_progress, completed, or cancelled';



CREATE TABLE IF NOT EXISTS "public"."user_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "challenge_id" "uuid",
    "start_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "progress" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "habit_id" "uuid",
    CONSTRAINT "user_challenges_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'abandoned'::"text"])))
);


ALTER TABLE "public"."user_challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_inventory" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "item_id" "uuid",
    "quantity" integer DEFAULT 1,
    "purchased_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_onboarding" (
    "user_id" "uuid" NOT NULL,
    "onboarding_version" integer DEFAULT 1 NOT NULL,
    "goals" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "primary_barrier" "text",
    "pace" "text",
    "preferred_dayparts" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "reminder_intent" boolean,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "install_id" "uuid",
    "install_expected_habits" integer,
    "install_return_status" "text",
    CONSTRAINT "user_onboarding_barrier_check" CHECK ((("primary_barrier" IS NULL) OR ("primary_barrier" = ANY (ARRAY['getting_started'::"text", 'consistency'::"text", 'forgetting'::"text", 'motivation'::"text", 'oversized_goals'::"text", 'lack_of_time'::"text", 'unsure_where_to_start'::"text"])))),
    CONSTRAINT "user_onboarding_completed_at_agrees_with_status" CHECK (((("status" = 'completed'::"text") AND ("completed_at" IS NOT NULL)) OR (("status" <> 'completed'::"text") AND ("completed_at" IS NULL)))),
    CONSTRAINT "user_onboarding_dayparts_check" CHECK (("preferred_dayparts" <@ ARRAY['morning'::"text", 'daytime'::"text", 'evening'::"text", 'bedtime'::"text"])),
    CONSTRAINT "user_onboarding_goals_check" CHECK ((("goals" <@ ARRAY['health_energy'::"text", 'focus_productivity'::"text", 'sleep'::"text", 'learning'::"text", 'mental_wellbeing'::"text", 'daily_order'::"text", 'finance'::"text", 'other'::"text"]) AND (("array_length"("goals", 1) IS NULL) OR ("array_length"("goals", 1) <= 3)))),
    CONSTRAINT "user_onboarding_install_expected_nonneg" CHECK ((("install_expected_habits" IS NULL) OR ("install_expected_habits" >= 0))),
    CONSTRAINT "user_onboarding_install_return_status_check" CHECK ((("install_return_status" IS NULL) OR ("install_return_status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'skipped'::"text", 'legacy'::"text"])))),
    CONSTRAINT "user_onboarding_pace_check" CHECK ((("pace" IS NULL) OR ("pace" = ANY (ARRAY['gentle'::"text", 'balanced'::"text", 'intensive'::"text"])))),
    CONSTRAINT "user_onboarding_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'installing'::"text", 'completed'::"text", 'skipped'::"text", 'legacy'::"text"])))
);


ALTER TABLE "public"."user_onboarding" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_onboarding" IS 'First-run onboarding answers, one row per user. status: pending (new user, not finished) | completed (finished the flow) | skipped (chose to skip) | legacy (existed before the feature shipped; not required to onboard). reminder_intent is the USER''S WISH, not the OS notification permission.';



COMMENT ON COLUMN "public"."user_onboarding"."reminder_intent" IS 'User intent only. Never treat true as "notifications are working" -- the OS permission is a separate fact and may be denied or revoked.';



COMMENT ON COLUMN "public"."user_onboarding"."status" IS 'pending (new, unfinished) | installing (habits are being written; a durable claim that survives process death) | completed | skipped | legacy (predates the feature). See 20260906b for the install recovery protocol.';



COMMENT ON COLUMN "public"."user_onboarding"."install_id" IS 'The install claimed by status = ''installing'', written BEFORE any habit exists. Kept after completion as an audit trail of which rows the plan produced.';



COMMENT ON COLUMN "public"."user_onboarding"."install_expected_habits" IS 'How many habits the claimed install should produce. Recovery compares the actual matching row count against it, so a partial insert is detectable rather than being rounded up to "landed".';



COMMENT ON COLUMN "public"."user_onboarding"."install_return_status" IS 'The lifecycle status that existed before `status` was set to ''installing'', written in the same upsert as the claim and restored verbatim if the habit insert fails. NULL means no install is in flight. ''installing'' is not an accepted value: it is the status being displaced, never a destination.';



CREATE TABLE IF NOT EXISTS "public"."user_pets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "pet_name" character varying DEFAULT 'Dostum'::character varying,
    "current_stage_id" integer,
    "health" integer DEFAULT 100,
    "happiness" integer DEFAULT 100,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_interaction_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_pets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_quests" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "quest_id" "uuid",
    "progress" integer DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    "assigned_date" "date" DEFAULT CURRENT_DATE,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_quests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_skills" (
    "user_id" "uuid" NOT NULL,
    "skill_id" integer NOT NULL,
    "current_level" integer DEFAULT 0
);


ALTER TABLE "public"."user_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "event_types" "text"[] DEFAULT ARRAY['habit_completed'::"text", 'task_completed'::"text"] NOT NULL,
    "headers" "jsonb",
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "webhooks_event_types_check" CHECK (((("array_length"("event_types", 1) >= 1) AND ("array_length"("event_types", 1) <= 8)) AND ("event_types" <@ ARRAY['habit_completed'::"text", 'task_completed'::"text"]))),
    CONSTRAINT "webhooks_url_check" CHECK ((("url" ~* '^https://[^[:space:]]+$'::"text") AND ("length"("url") <= 2048)))
);


ALTER TABLE "public"."webhooks" OWNER TO "postgres";


COMMENT ON TABLE "public"."webhooks" IS 'Outbound webhook registrations, owner-scoped. Delivery is client-side (services/webhookService.ts) so a user-supplied URL is never fetched by our infrastructure. Replaces /api/webhooks on the retired FastAPI service.';



CREATE TABLE IF NOT EXISTS "public"."weekly_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_key" "text" NOT NULL,
    "wins" "text",
    "challenges" "text",
    "next_week" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weekly_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_xp" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "xp_earned" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."weekly_xp" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."willpower_state" (
    "user_id" "uuid" NOT NULL,
    "state_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "daily_budget" integer DEFAULT 15 NOT NULL,
    "used" integer DEFAULT 0 NOT NULL,
    "focus_capacity" integer DEFAULT 3 NOT NULL,
    "active_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."willpower_state" OWNER TO "postgres";


ALTER TABLE ONLY "public"."boss_contributors" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."boss_contributors_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."global_bosses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."global_bosses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pet_stages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pet_stages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."skills" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."skills_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ai_calls"
    ADD CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_conversation_actions"
    ADD CONSTRAINT "ai_conversation_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_requests"
    ADD CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("user_id", "request_id");



ALTER TABLE ONLY "public"."bad_habits"
    ADD CONSTRAINT "bad_habits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."boss_contributors"
    ADD CONSTRAINT "boss_contributors_boss_id_user_id_key" UNIQUE ("boss_id", "user_id");



ALTER TABLE ONLY "public"."boss_contributors"
    ADD CONSTRAINT "boss_contributors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendars"
    ADD CONSTRAINT "calendars_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_transactions"
    ADD CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_capacity"
    ADD CONSTRAINT "daily_capacity_pkey" PRIMARY KEY ("user_id", "capacity_date");



ALTER TABLE ONLY "public"."deep_work_sessions"
    ADD CONSTRAINT "deep_work_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_templates"
    ADD CONSTRAINT "event_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."focus_sessions"
    ADD CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."focus_tasks"
    ADD CONSTRAINT "focus_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."global_bosses"
    ADD CONSTRAINT "global_bosses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."google_calendar_integrations"
    ADD CONSTRAINT "google_calendar_integrations_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."habit_deletions"
    ADD CONSTRAINT "habit_deletions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."habit_logs"
    ADD CONSTRAINT "habit_logs_habit_id_completed_at_key" UNIQUE ("habit_id", "completed_at");



ALTER TABLE ONLY "public"."habit_logs"
    ADD CONSTRAINT "habit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."habit_reminders"
    ADD CONSTRAINT "habit_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."habit_templates"
    ADD CONSTRAINT "habit_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."habits"
    ADD CONSTRAINT "habits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."journal_insights"
    ADD CONSTRAINT "journal_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."journal_insights"
    ADD CONSTRAINT "journal_insights_user_id_period_period_key_key" UNIQUE ("user_id", "period", "period_key");



ALTER TABLE ONLY "public"."key_results"
    ADD CONSTRAINT "key_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."life_area_logs"
    ADD CONSTRAINT "life_area_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."life_area_logs"
    ADD CONSTRAINT "life_area_logs_user_id_date_area_key" UNIQUE ("user_id", "date", "area");



ALTER TABLE ONLY "public"."monthly_reviews"
    ADD CONSTRAINT "monthly_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_reviews"
    ADD CONSTRAINT "monthly_reviews_user_id_month_key_key" UNIQUE ("user_id", "month_key");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notion_integrations"
    ADD CONSTRAINT "notion_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notion_integrations"
    ADD CONSTRAINT "notion_integrations_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."okrs"
    ADD CONSTRAINT "okrs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pet_stages"
    ADD CONSTRAINT "pet_stages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_badges"
    ADD CONSTRAINT "profile_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_badges"
    ADD CONSTRAINT "profile_badges_user_id_badge_name_key" UNIQUE ("user_id", "badge_name");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quests"
    ADD CONSTRAINT "quests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reading_list"
    ADD CONSTRAINT "reading_list_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recovery_plans"
    ADD CONSTRAINT "recovery_plans_habit_source_unique" UNIQUE ("habit_id", "source_date");



ALTER TABLE ONLY "public"."recovery_plans"
    ADD CONSTRAINT "recovery_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routine_items"
    ADD CONSTRAINT "routine_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."routines"
    ADD CONSTRAINT "routines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_items"
    ADD CONSTRAINT "shop_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."spotify_accounts"
    ADD CONSTRAINT "spotify_accounts_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_challenges"
    ADD CONSTRAINT "user_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_challenges"
    ADD CONSTRAINT "user_challenges_user_id_challenge_id_key" UNIQUE ("user_id", "challenge_id");



ALTER TABLE ONLY "public"."user_gamification"
    ADD CONSTRAINT "user_gamification_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_inventory"
    ADD CONSTRAINT "user_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_inventory"
    ADD CONSTRAINT "user_inventory_user_id_item_id_key" UNIQUE ("user_id", "item_id");



ALTER TABLE ONLY "public"."user_onboarding"
    ADD CONSTRAINT "user_onboarding_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_pets"
    ADD CONSTRAINT "user_pets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_pets"
    ADD CONSTRAINT "user_pets_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_quests"
    ADD CONSTRAINT "user_quests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_quests"
    ADD CONSTRAINT "user_quests_user_id_quest_id_assigned_date_key" UNIQUE ("user_id", "quest_id", "assigned_date");



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_pkey" PRIMARY KEY ("user_id", "skill_id");



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."webhooks"
    ADD CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_reviews"
    ADD CONSTRAINT "weekly_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_reviews"
    ADD CONSTRAINT "weekly_reviews_user_id_week_key_key" UNIQUE ("user_id", "week_key");



ALTER TABLE ONLY "public"."weekly_xp"
    ADD CONSTRAINT "weekly_xp_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_xp"
    ADD CONSTRAINT "weekly_xp_user_id_week_start_key" UNIQUE ("user_id", "week_start");



ALTER TABLE ONLY "public"."willpower_state"
    ADD CONSTRAINT "willpower_state_pkey" PRIMARY KEY ("user_id", "state_date");



CREATE INDEX "ai_actions_conversation_pending_idx" ON "public"."ai_conversation_actions" USING "btree" ("conversation_id", "created_at" DESC) WHERE ("status" = 'pending'::"text");



CREATE INDEX "ai_actions_user_idx" ON "public"."ai_conversation_actions" USING "btree" ("user_id");



CREATE INDEX "ai_calls_user_day" ON "public"."ai_calls" USING "btree" ("user_id", "called_at" DESC);



CREATE INDEX "ai_conversations_user_project_recent_idx" ON "public"."ai_conversations" USING "btree" ("user_id", "project_id", "last_message_at" DESC) WHERE ("project_id" IS NOT NULL);



CREATE INDEX "ai_conversations_user_recent_idx" ON "public"."ai_conversations" USING "btree" ("user_id", "last_message_at" DESC);



CREATE UNIQUE INDEX "ai_messages_assistant_request_uniq" ON "public"."ai_messages" USING "btree" ("conversation_id", "request_id") WHERE (("role" = 'assistant'::"text") AND ("request_id" IS NOT NULL));



CREATE INDEX "ai_messages_conversation_created_idx" ON "public"."ai_messages" USING "btree" ("conversation_id", "created_at" DESC, "id" DESC);



CREATE INDEX "ai_messages_user_idx" ON "public"."ai_messages" USING "btree" ("user_id");



CREATE INDEX "ai_requests_created_idx" ON "public"."ai_requests" USING "btree" ("created_at");



CREATE INDEX "ai_requests_stale_idx" ON "public"."ai_requests" USING "btree" ("user_id", "lease_expires_at") WHERE ("status" = 'in_progress'::"text");



CREATE INDEX "bad_habits_user_created_idx" ON "public"."bad_habits" USING "btree" ("user_id", "created_at" DESC, "id" DESC);



CREATE UNIQUE INDEX "credit_transactions_user_request_uidx" ON "public"."credit_transactions" USING "btree" ("user_id", "request_id") WHERE ("request_id" IS NOT NULL);



CREATE INDEX "credit_tx_user_date" ON "public"."credit_transactions" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "daily_capacity_user_date" ON "public"."daily_capacity" USING "btree" ("user_id", "capacity_date" DESC);



CREATE INDEX "focus_sessions_user_idx" ON "public"."focus_sessions" USING "btree" ("user_id", "started_at" DESC);



CREATE UNIQUE INDEX "habits_install_id_name_uniq" ON "public"."habits" USING "btree" ("user_id", "install_id", "name") WHERE ("install_id" IS NOT NULL);



CREATE INDEX "habits_user_install_idx" ON "public"."habits" USING "btree" ("user_id", "install_id") WHERE ("install_id" IS NOT NULL);



CREATE INDEX "habits_user_status" ON "public"."habits" USING "btree" ("user_id", "status");



CREATE INDEX "idx_calendars_type" ON "public"."calendars" USING "btree" ("type");



CREATE INDEX "idx_calendars_user_id" ON "public"."calendars" USING "btree" ("user_id");



CREATE INDEX "idx_event_templates_name" ON "public"."event_templates" USING "btree" ("template_name");



CREATE INDEX "idx_event_templates_user_id" ON "public"."event_templates" USING "btree" ("user_id");



CREATE INDEX "idx_events_calendar_id" ON "public"."events" USING "btree" ("calendar_id");



CREATE INDEX "idx_events_category_type" ON "public"."events" USING "btree" ("category_type");



CREATE INDEX "idx_events_end_time" ON "public"."events" USING "btree" ("end_time");



CREATE INDEX "idx_events_start_time" ON "public"."events" USING "btree" ("start_time");



CREATE INDEX "idx_events_user_id" ON "public"."events" USING "btree" ("user_id");



CREATE INDEX "idx_habit_logs_habit_date" ON "public"."habit_logs" USING "btree" ("habit_id", "completed_at");



CREATE INDEX "idx_habit_logs_user_date" ON "public"."habit_logs" USING "btree" ("user_id", "completed_at");



CREATE INDEX "idx_reminders_event_id" ON "public"."reminders" USING "btree" ("event_id");



CREATE INDEX "idx_tasks_list_name" ON "public"."tasks" USING "btree" ("list_name");



CREATE INDEX "idx_tasks_status" ON "public"."tasks" USING "btree" ("status");



CREATE INDEX "journal_insights_user_period_idx" ON "public"."journal_insights" USING "btree" ("user_id", "period", "period_key");



CREATE INDEX "journal_user_date_idx" ON "public"."journal_entries" USING "btree" ("user_id", "date" DESC);



CREATE INDEX "key_results_okr" ON "public"."key_results" USING "btree" ("okr_id");



CREATE INDEX "monthly_reviews_user_month_idx" ON "public"."monthly_reviews" USING "btree" ("user_id", "month_key" DESC);



CREATE INDEX "notes_user_idx" ON "public"."notes" USING "btree" ("user_id", "updated_at" DESC);



CREATE UNIQUE INDEX "profile_badges_user_badge_uidx" ON "public"."profile_badges" USING "btree" ("user_id", "badge_name");



CREATE INDEX "reading_list_status_idx" ON "public"."reading_list" USING "btree" ("user_id", "status");



CREATE INDEX "reading_list_user_id_idx" ON "public"."reading_list" USING "btree" ("user_id");



CREATE INDEX "recovery_plans_habit_idx" ON "public"."recovery_plans" USING "btree" ("habit_id");



CREATE INDEX "recovery_plans_user_status_idx" ON "public"."recovery_plans" USING "btree" ("user_id", "status", "target_date");



CREATE INDEX "tasks_due_date_idx" ON "public"."tasks" USING "btree" ("due_date") WHERE ("due_date" IS NOT NULL);



CREATE INDEX "tasks_user_list_idx" ON "public"."tasks" USING "btree" ("user_id", "list_type");



CREATE INDEX "tasks_user_status_idx" ON "public"."tasks" USING "btree" ("user_id", "status");



CREATE INDEX "webhooks_user_enabled_idx" ON "public"."webhooks" USING "btree" ("user_id", "created_at" DESC, "id" DESC);



CREATE UNIQUE INDEX "weekly_xp_user_week_uidx" ON "public"."weekly_xp" USING "btree" ("user_id", "week_start");



CREATE INDEX "wp_state_user_date" ON "public"."willpower_state" USING "btree" ("user_id", "state_date" DESC);



CREATE OR REPLACE TRIGGER "ai_messages_touch_conversation" AFTER INSERT ON "public"."ai_messages" FOR EACH ROW EXECUTE FUNCTION "public"."ai_touch_conversation"();



CREATE OR REPLACE TRIGGER "focus_tasks_updated_at" BEFORE UPDATE ON "public"."focus_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "notes_updated_at" BEFORE UPDATE ON "public"."notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "on_habit_completed_damage_boss" AFTER INSERT ON "public"."habit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_damage_on_habit_log"();



CREATE OR REPLACE TRIGGER "on_profile_created_pet" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."initialize_user_pet"();



CREATE OR REPLACE TRIGGER "on_profile_update_badges" AFTER UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."check_and_award_badges"();



CREATE OR REPLACE TRIGGER "trg_habit_log_award" AFTER INSERT OR UPDATE ON "public"."habit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."fn_habit_log_award"();



CREATE OR REPLACE TRIGGER "trg_habit_log_set_xp" BEFORE INSERT OR UPDATE ON "public"."habit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."fn_habit_log_set_xp"();



CREATE OR REPLACE TRIGGER "trg_habits_record_purged_xp" BEFORE DELETE ON "public"."habits" FOR EACH ROW EXECUTE FUNCTION "public"."fn_habits_record_purged_xp"();



CREATE OR REPLACE TRIGGER "trg_skill_points_on_level_up" BEFORE UPDATE OF "level" ON "public"."profiles" FOR EACH ROW WHEN (("old"."level" IS DISTINCT FROM "new"."level")) EXECUTE FUNCTION "public"."check_level_up_and_grant_skills"();



CREATE OR REPLACE TRIGGER "trg_user_onboarding_updated_at" BEFORE UPDATE ON "public"."user_onboarding" FOR EACH ROW EXECUTE FUNCTION "public"."touch_user_onboarding_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_events_updated_at" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."update_events_updated_at"();



ALTER TABLE ONLY "public"."ai_calls"
    ADD CONSTRAINT "ai_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_conversation_actions"
    ADD CONSTRAINT "ai_conversation_actions_assistant_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."ai_messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_conversation_actions"
    ADD CONSTRAINT "ai_conversation_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_conversation_actions"
    ADD CONSTRAINT "ai_conversation_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_requests"
    ADD CONSTRAINT "ai_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bad_habits"
    ADD CONSTRAINT "bad_habits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boss_contributors"
    ADD CONSTRAINT "boss_contributors_boss_id_fkey" FOREIGN KEY ("boss_id") REFERENCES "public"."global_bosses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boss_contributors"
    ADD CONSTRAINT "boss_contributors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendars"
    ADD CONSTRAINT "calendars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_transactions"
    ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_capacity"
    ADD CONSTRAINT "daily_capacity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deep_work_sessions"
    ADD CONSTRAINT "deep_work_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_templates"
    ADD CONSTRAINT "event_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."focus_sessions"
    ADD CONSTRAINT "focus_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."focus_tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."focus_sessions"
    ADD CONSTRAINT "focus_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."focus_tasks"
    ADD CONSTRAINT "focus_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."google_calendar_integrations"
    ADD CONSTRAINT "google_calendar_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."habit_deletions"
    ADD CONSTRAINT "habit_deletions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."habit_logs"
    ADD CONSTRAINT "habit_logs_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."habit_logs"
    ADD CONSTRAINT "habit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."habit_reminders"
    ADD CONSTRAINT "habit_reminders_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."habits"
    ADD CONSTRAINT "habits_cue_habit_id_fkey" FOREIGN KEY ("cue_habit_id") REFERENCES "public"."habits"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."habits"
    ADD CONSTRAINT "habits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journal_entries"
    ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."journal_insights"
    ADD CONSTRAINT "journal_insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."key_results"
    ADD CONSTRAINT "key_results_okr_id_fkey" FOREIGN KEY ("okr_id") REFERENCES "public"."okrs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."key_results"
    ADD CONSTRAINT "key_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."life_area_logs"
    ADD CONSTRAINT "life_area_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_reviews"
    ADD CONSTRAINT "monthly_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notion_integrations"
    ADD CONSTRAINT "notion_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."okrs"
    ADD CONSTRAINT "okrs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_badges"
    ADD CONSTRAINT "profile_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reading_list"
    ADD CONSTRAINT "reading_list_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recovery_plans"
    ADD CONSTRAINT "recovery_plans_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recovery_plans"
    ADD CONSTRAINT "recovery_plans_source_log_id_fkey" FOREIGN KEY ("source_log_id") REFERENCES "public"."habit_logs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recovery_plans"
    ADD CONSTRAINT "recovery_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routine_items"
    ADD CONSTRAINT "routine_items_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."routines"
    ADD CONSTRAINT "routines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."spotify_accounts"
    ADD CONSTRAINT "spotify_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_challenges"
    ADD CONSTRAINT "user_challenges_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_challenges"
    ADD CONSTRAINT "user_challenges_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_challenges"
    ADD CONSTRAINT "user_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_gamification"
    ADD CONSTRAINT "user_gamification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_inventory"
    ADD CONSTRAINT "user_inventory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_inventory"
    ADD CONSTRAINT "user_inventory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_onboarding"
    ADD CONSTRAINT "user_onboarding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_pets"
    ADD CONSTRAINT "user_pets_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "public"."pet_stages"("id");



ALTER TABLE ONLY "public"."user_pets"
    ADD CONSTRAINT "user_pets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_quests"
    ADD CONSTRAINT "user_quests_quest_id_fkey" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_quests"
    ADD CONSTRAINT "user_quests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_skills"
    ADD CONSTRAINT "user_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."webhooks"
    ADD CONSTRAINT "webhooks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_reviews"
    ADD CONSTRAINT "weekly_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_xp"
    ADD CONSTRAINT "weekly_xp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."willpower_state"
    ADD CONSTRAINT "willpower_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can read challenges" ON "public"."challenges" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Anyone can read templates" ON "public"."habit_templates" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Anyone can view bosses" ON "public"."global_bosses" FOR SELECT USING (true);



CREATE POLICY "Challenges imply public read" ON "public"."challenges" FOR SELECT USING (true);



CREATE POLICY "Everyone can read patterns" ON "public"."habit_templates" FOR SELECT USING (true);



CREATE POLICY "Public read quests" ON "public"."quests" FOR SELECT USING (true);



CREATE POLICY "Public read shop items" ON "public"."shop_items" FOR SELECT USING (true);



CREATE POLICY "System can manage weekly xp" ON "public"."weekly_xp" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can CRUD own habits" ON "public"."habits" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can CRUD own tasks" ON "public"."tasks" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete own calendars" ON "public"."calendars" FOR DELETE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete own events" ON "public"."events" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."calendars" "c"
  WHERE (("c"."id" = "events"."calendar_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete own logs" ON "public"."habit_logs" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own reminders" ON "public"."reminders" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."events" "e"
     JOIN "public"."calendars" "c" ON (("e"."calendar_id" = "c"."id")))
  WHERE (("e"."id" = "reminders"."event_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can delete own templates" ON "public"."event_templates" FOR DELETE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can delete their own habit reminders" ON "public"."habit_reminders" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."habits"
  WHERE (("habits"."id" = "habit_reminders"."habit_id") AND ("habits"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert own calendars" ON "public"."calendars" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can insert own events" ON "public"."events" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."calendars" "c"
  WHERE (("c"."id" = "events"."calendar_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert own gamification stats" ON "public"."user_gamification" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own logs" ON "public"."habit_logs" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."habits" "h"
  WHERE (("h"."id" = "habit_logs"."habit_id") AND ("h"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can insert own reminders" ON "public"."reminders" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."events" "e"
     JOIN "public"."calendars" "c" ON (("e"."calendar_id" = "c"."id")))
  WHERE (("e"."id" = "reminders"."event_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can insert own templates" ON "public"."event_templates" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can insert their own habit reminders" ON "public"."habit_reminders" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."habits"
  WHERE (("habits"."id" = "habit_reminders"."habit_id") AND ("habits"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can manage own challenge enrollments" ON "public"."user_challenges" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own tasks" ON "public"."tasks" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their challenges" ON "public"."user_challenges" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read all weekly xp" ON "public"."weekly_xp" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can read own badges" ON "public"."profile_badges" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own calendars" ON "public"."calendars" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own events" ON "public"."events" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."calendars" "c"
  WHERE (("c"."id" = "events"."calendar_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update own gamification stats" ON "public"."user_gamification" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own logs" ON "public"."habit_logs" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."habits" "h"
  WHERE (("h"."id" = "habit_logs"."habit_id") AND ("h"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own reminders" ON "public"."reminders" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."events" "e"
     JOIN "public"."calendars" "c" ON (("e"."calendar_id" = "c"."id")))
  WHERE (("e"."id" = "reminders"."event_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update own templates" ON "public"."event_templates" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update their own habit reminders" ON "public"."habit_reminders" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."habits"
  WHERE (("habits"."id" = "habit_reminders"."habit_id") AND ("habits"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view all contributors for active boss" ON "public"."boss_contributors" FOR SELECT USING (true);



CREATE POLICY "Users can view own calendars" ON "public"."calendars" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view own events" ON "public"."events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."calendars" "c"
  WHERE (("c"."id" = "events"."calendar_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view own gamification stats" ON "public"."user_gamification" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own logs" ON "public"."habit_logs" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view own reminders" ON "public"."reminders" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."events" "e"
     JOIN "public"."calendars" "c" ON (("e"."calendar_id" = "c"."id")))
  WHERE (("e"."id" = "reminders"."event_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can view own templates" ON "public"."event_templates" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can view their own habit reminders" ON "public"."habit_reminders" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."habits"
  WHERE (("habits"."id" = "habit_reminders"."habit_id") AND ("habits"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users insert own quests" ON "public"."user_quests" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own notion integration" ON "public"."notion_integrations" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users own deep_work_sessions" ON "public"."deep_work_sessions" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users own goals" ON "public"."goals" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users own life_area_logs" ON "public"."life_area_logs" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users own weekly_reviews" ON "public"."weekly_reviews" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users update own pet" ON "public"."user_pets" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own quests" ON "public"."user_quests" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own skills" ON "public"."user_skills" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users view own inventory" ON "public"."user_inventory" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users view own pet" ON "public"."user_pets" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users view own quests" ON "public"."user_quests" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users view own skills" ON "public"."user_skills" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "ai_actions_delete_own" ON "public"."ai_conversation_actions" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "ai_actions_insert_own" ON "public"."ai_conversation_actions" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."ai_conversations" "c"
  WHERE (("c"."id" = "ai_conversation_actions"."conversation_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "ai_actions_select_own" ON "public"."ai_conversation_actions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "ai_actions_update_own" ON "public"."ai_conversation_actions" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."ai_calls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_calls_self" ON "public"."ai_calls" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."ai_conversation_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_conversations_delete_own" ON "public"."ai_conversations" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "ai_conversations_insert_own" ON "public"."ai_conversations" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (("project_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "ai_conversations"."project_id") AND ("p"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "ai_conversations_select_own" ON "public"."ai_conversations" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "ai_conversations_update_own" ON "public"."ai_conversations" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (("project_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "ai_conversations"."project_id") AND ("p"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



ALTER TABLE "public"."ai_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_messages_delete_own" ON "public"."ai_messages" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "ai_messages_insert_own" ON "public"."ai_messages" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."ai_conversations" "c"
  WHERE (("c"."id" = "ai_messages"."conversation_id") AND ("c"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "ai_messages_select_own" ON "public"."ai_messages" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."ai_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_requests_owner_select" ON "public"."ai_requests" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."bad_habits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bad_habits_delete_own" ON "public"."bad_habits" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bad_habits_insert_own" ON "public"."bad_habits" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bad_habits_select_own" ON "public"."bad_habits" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "bad_habits_update_own" ON "public"."bad_habits" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."boss_contributors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendars" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_tx_select_own" ON "public"."credit_transactions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."daily_capacity" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_capacity_self" ON "public"."daily_capacity" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."deep_work_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."focus_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "focus_sessions_own" ON "public"."focus_sessions" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."focus_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "focus_tasks_own" ON "public"."focus_tasks" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."global_bosses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."google_calendar_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."habit_deletions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "habit_deletions_insert_own" ON "public"."habit_deletions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "habit_deletions_select_own" ON "public"."habit_deletions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."habit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."habit_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."habit_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."habits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insights_delete_own" ON "public"."journal_insights" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "insights_insert_own" ON "public"."journal_insights" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "insights_select_own" ON "public"."journal_insights" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "insights_update_own" ON "public"."journal_insights" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."journal_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."journal_insights" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "journal_own" ON "public"."journal_entries" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."key_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kr_all_own" ON "public"."key_results" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."okrs" "o"
  WHERE (("o"."id" = "key_results"."okr_id") AND ("o"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."life_area_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monthly_reviews_delete_own" ON "public"."monthly_reviews" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "monthly_reviews_insert_own" ON "public"."monthly_reviews" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "monthly_reviews_select_own" ON "public"."monthly_reviews" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "monthly_reviews_update_own" ON "public"."monthly_reviews" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notes_own" ON "public"."notes" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."notion_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."okrs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "okrs_all_own" ON "public"."okrs" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."pet_stages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pet_stages_read_all" ON "public"."pet_stages" FOR SELECT USING (true);



ALTER TABLE "public"."profile_badges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_own" ON "public"."projects" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."quests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reading_list" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reading_list_delete" ON "public"."reading_list" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "reading_list_insert" ON "public"."reading_list" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "reading_list_select" ON "public"."reading_list" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "reading_list_update" ON "public"."reading_list" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."recovery_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."routine_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "routine_items_self" ON "public"."routine_items" USING (("routine_id" IN ( SELECT "routines"."id"
   FROM "public"."routines"
  WHERE ("routines"."user_id" = "auth"."uid"())))) WITH CHECK (("routine_id" IN ( SELECT "routines"."id"
   FROM "public"."routines"
  WHERE ("routines"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."routines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "routines_self" ON "public"."routines" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "rp_delete" ON "public"."recovery_plans" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rp_insert" ON "public"."recovery_plans" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."habits" "h"
  WHERE (("h"."id" = "recovery_plans"."habit_id") AND ("h"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "rp_select" ON "public"."recovery_plans" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rp_update" ON "public"."recovery_plans" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."habits" "h"
  WHERE (("h"."id" = "recovery_plans"."habit_id") AND ("h"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."shop_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "skills_read_all" ON "public"."skills" FOR SELECT USING (true);



ALTER TABLE "public"."spotify_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subs_select_own" ON "public"."user_subscriptions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_own" ON "public"."tasks" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_gamification" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_onboarding" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_onboarding_owner" ON "public"."user_onboarding" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_pets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_quests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "webhooks_delete_own" ON "public"."webhooks" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "webhooks_insert_own" ON "public"."webhooks" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "webhooks_select_own" ON "public"."webhooks" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "webhooks_update_own" ON "public"."webhooks" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."weekly_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_xp" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "willpower_self" ON "public"."willpower_state" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."willpower_state" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_subscriptions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_subscriptions" TO "service_role";



REVOKE ALL ON FUNCTION "public"."activate_subscription"("p_user_id" "uuid", "p_tier" "text", "p_period" "text", "p_provider" "text", "p_provider_ref" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."activate_subscription"("p_user_id" "uuid", "p_tier" "text", "p_period" "text", "p_provider" "text", "p_provider_ref" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_xp"("p_user_id" "uuid", "p_xp_amount" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_xp"("p_user_id" "uuid", "p_xp_amount" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_request_begin"("p_user_id" "uuid", "p_request_id" "text", "p_mode" "text", "p_fingerprint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_request_begin"("p_user_id" "uuid", "p_request_id" "text", "p_mode" "text", "p_fingerprint" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_request_complete"("p_user_id" "uuid", "p_request_id" "text", "p_response" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_request_complete"("p_user_id" "uuid", "p_request_id" "text", "p_response" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_request_fail"("p_user_id" "uuid", "p_request_id" "text", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_request_fail"("p_user_id" "uuid", "p_request_id" "text", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_request_reconcile_stale"("p_user_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_request_reconcile_stale"("p_user_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_request_release"("p_user_id" "uuid", "p_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_request_release"("p_user_id" "uuid", "p_request_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ai_touch_conversation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_touch_conversation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."buy_shop_item"("p_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."buy_shop_item"("p_item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_award_badges"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_reset_makeup_credits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_reset_makeup_credits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_level_up_and_grant_skills"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_quest_reward"("p_user_quest_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_quest_reward"("p_user_quest_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_ai_calls"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_ai_calls"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_ai_calls"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."deal_damage_to_active_boss"("p_user_id" "uuid", "p_damage" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deal_damage_to_active_boss"("p_user_id" "uuid", "p_damage" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_subscription"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_subscription"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_habit_log_award"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_habit_log_set_xp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_habits_record_purged_xp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_boss_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_boss_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_daily_quests"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_quests"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_global_leaderboard"("limit_val" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_global_leaderboard"("limit_val" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_monthly_habits"("start_date" "date", "end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_monthly_habits"("start_date" "date", "end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_init_subscription"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_init_subscription"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_init_subscription"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_or_init_subscription_for"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_or_init_subscription_for"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rank_for_level"("lvl" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_rank_for_level"("lvl" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rank_for_level"("lvl" integer) TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_gamification" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_gamification" TO "authenticated";
GRANT ALL ON TABLE "public"."user_gamification" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_gamification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_gamification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_pet_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_pet_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_rank"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_rank"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_skill_tree"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_skill_tree"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_skill_tree"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_weekly_leaderboard"("limit_val" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_weekly_leaderboard"("limit_val" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_weekly_leaderboard"("limit_val" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_willpower_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_willpower_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_willpower_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."habit_xp_value"("p_habit_id" "uuid", "p_state" "text", "p_value" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."initialize_user_pet"() TO "service_role";



GRANT ALL ON FUNCTION "public"."interact_with_pet"("p_action" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."interact_with_pet"("p_action" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."interact_with_pet"("p_action" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."jsonb_is_string_map"("v" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."jsonb_is_string_map"("v" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."jsonb_is_string_map"("v" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_makeup_completion"("p_habit_id" "uuid", "p_date" "date", "p_is_completed" boolean, "p_notes" "text", "p_value" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."log_makeup_completion"("p_habit_id" "uuid", "p_date" "date", "p_is_completed" boolean, "p_notes" "text", "p_value" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_makeup_completion"("p_habit_id" "uuid", "p_date" "date", "p_is_completed" boolean, "p_notes" "text", "p_value" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mock_activate_subscription"("p_tier" "text", "p_period" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mock_activate_subscription"("p_tier" "text", "p_period" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rebuild_profile_xp"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rebuild_profile_xp"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refund_focus_points"("p_user_id" "uuid", "p_request_id" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refund_focus_points"("p_user_id" "uuid", "p_request_id" "text", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."spend_focus_points"("p_amount" integer, "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."spend_focus_points"("p_amount" integer, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."spend_focus_points"("p_amount" integer, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."spend_focus_points_v2"("p_user_id" "uuid", "p_amount" integer, "p_reason" "text", "p_request_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."spend_focus_points_v2"("p_user_id" "uuid", "p_amount" integer, "p_reason" "text", "p_request_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_user_onboarding_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_user_onboarding_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."track_weekly_xp"("p_user_id" "uuid", "p_xp" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."track_weekly_xp"("p_user_id" "uuid", "p_xp" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_damage_on_habit_log"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_events_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upgrade_skill"("p_skill_key" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."upgrade_skill"("p_skill_key" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upgrade_skill"("p_skill_key" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."xp_drift"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."xp_drift"() TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."ai_calls" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."ai_calls" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_calls" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."ai_conversation_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_conversation_actions" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."ai_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_conversations" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."ai_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_messages" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."ai_requests" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."ai_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_requests" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."bad_habits" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."bad_habits" TO "authenticated";
GRANT ALL ON TABLE "public"."bad_habits" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."boss_contributors" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."boss_contributors" TO "authenticated";
GRANT ALL ON TABLE "public"."boss_contributors" TO "service_role";



GRANT ALL ON SEQUENCE "public"."boss_contributors_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."boss_contributors_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."boss_contributors_id_seq" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."calendars" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."calendars" TO "authenticated";
GRANT ALL ON TABLE "public"."calendars" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenges" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."challenges" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."credit_transactions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."credit_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_transactions" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."daily_capacity" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."daily_capacity" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_capacity" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."deep_work_sessions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."deep_work_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."deep_work_sessions" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."event_templates" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."event_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."event_templates" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."events" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."focus_sessions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."focus_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."focus_sessions" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."focus_tasks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."focus_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."focus_tasks" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."global_bosses" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."global_bosses" TO "authenticated";
GRANT ALL ON TABLE "public"."global_bosses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."global_bosses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."global_bosses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."global_bosses_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."goals" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."google_calendar_integrations" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."google_calendar_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."google_calendar_integrations" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habit_deletions" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habit_deletions" TO "authenticated";
GRANT ALL ON TABLE "public"."habit_deletions" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habit_logs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."habit_logs" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habit_reminders" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habit_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."habit_reminders" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habit_templates" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habit_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."habit_templates" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habits" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."habits" TO "authenticated";
GRANT ALL ON TABLE "public"."habits" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."journal_entries" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."journal_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."journal_entries" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."journal_insights" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."journal_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."journal_insights" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."key_results" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."key_results" TO "authenticated";
GRANT ALL ON TABLE "public"."key_results" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."life_area_logs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."life_area_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."life_area_logs" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."monthly_reviews" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."monthly_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_reviews" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notes" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notes" TO "authenticated";
GRANT ALL ON TABLE "public"."notes" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notion_integrations" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."notion_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."notion_integrations" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."okrs" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."okrs" TO "authenticated";
GRANT ALL ON TABLE "public"."okrs" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."pet_stages" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."pet_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."pet_stages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pet_stages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pet_stages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pet_stages_id_seq" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profile_badges" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profile_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_badges" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT UPDATE("username") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."projects" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."quests" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."quests" TO "authenticated";
GRANT ALL ON TABLE "public"."quests" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."reading_list" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."reading_list" TO "authenticated";
GRANT ALL ON TABLE "public"."reading_list" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."recovery_plans" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."recovery_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."recovery_plans" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."reminders" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."routine_items" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."routine_items" TO "authenticated";
GRANT ALL ON TABLE "public"."routine_items" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."routines" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."routines" TO "authenticated";
GRANT ALL ON TABLE "public"."routines" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."shop_items" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."shop_items" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_items" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."skills" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."skills" TO "authenticated";
GRANT ALL ON TABLE "public"."skills" TO "service_role";



GRANT ALL ON SEQUENCE "public"."skills_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."skills_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."skills_id_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."spotify_accounts" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."spotify_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."spotify_accounts" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."tasks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_challenges" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."user_challenges" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_inventory" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."user_inventory" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_onboarding" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_onboarding" TO "authenticated";
GRANT ALL ON TABLE "public"."user_onboarding" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_pets" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_pets" TO "authenticated";
GRANT ALL ON TABLE "public"."user_pets" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_quests" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_quests" TO "authenticated";
GRANT ALL ON TABLE "public"."user_quests" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_skills" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."user_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."user_skills" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."webhooks" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."webhooks" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."weekly_reviews" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."weekly_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_reviews" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."weekly_xp" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."weekly_xp" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_xp" TO "service_role";



GRANT INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."willpower_state" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."willpower_state" TO "authenticated";
GRANT ALL ON TABLE "public"."willpower_state" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







