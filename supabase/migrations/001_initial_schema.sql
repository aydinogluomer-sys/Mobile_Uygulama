-- ============================================================
-- Alışkanlık Uygulaması — Initial Schema
-- Supabase Dashboard > SQL Editor'da çalıştırın
-- ============================================================

-- HABITS
CREATE TABLE IF NOT EXISTS public.habits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  icon             text,
  color            text DEFAULT '#6366f1',
  behavior_type    text NOT NULL DEFAULT 'positive' CHECK (behavior_type IN ('positive','negative')),
  type             text NOT NULL DEFAULT 'yes_no' CHECK (type IN ('yes_no','measurable')),
  unit             text,
  target_value     numeric,
  target_direction text CHECK (target_direction IN ('at_least','at_most')),
  frequency        jsonb NOT NULL DEFAULT '{"kind":"daily"}',
  willpower_cost   int NOT NULL DEFAULT 3 CHECK (willpower_cost BETWEEN 1 AND 10),
  status           text NOT NULL DEFAULT 'waiting' CHECK (status IN ('active','waiting','paused','completed','archived')),
  end_condition    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- HABIT_LOGS
CREATE TABLE IF NOT EXISTS public.habit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id   uuid NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  date       date NOT NULL DEFAULT CURRENT_DATE,
  value      numeric,
  state      text NOT NULL DEFAULT 'miss' CHECK (state IN ('done','partial','skip','miss')),
  xp         int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (habit_id, date)
);

-- WILLPOWER_STATE (bir kullanıcı için günlük bütçe)
CREATE TABLE IF NOT EXISTS public.willpower_state (
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date            date NOT NULL DEFAULT CURRENT_DATE,
  daily_budget    int NOT NULL DEFAULT 15,
  used            int NOT NULL DEFAULT 0 CHECK (used >= 0),
  focus_capacity  int NOT NULL DEFAULT 3,
  active_count    int NOT NULL DEFAULT 0 CHECK (active_count >= 0),
  PRIMARY KEY (user_id, date)
);

-- ROUTINES
CREATE TABLE IF NOT EXISTS public.routines (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name     text NOT NULL,
  source   text NOT NULL DEFAULT 'custom' CHECK (source IN ('ai','library','custom')),
  prompt   text
);

-- ROUTINE_ITEMS
CREATE TABLE IF NOT EXISTS public.routine_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id     uuid NOT NULL REFERENCES public.routines(id) ON DELETE CASCADE,
  habit_template jsonb NOT NULL
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.habits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.willpower_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_items   ENABLE ROW LEVEL SECURITY;

-- habits: kullanıcı sadece kendi alışkanlıklarını görür/değiştirir
CREATE POLICY "habits_self" ON public.habits
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- habit_logs: kullanıcı sadece kendi habit'larına ait logları görür
CREATE POLICY "habit_logs_self" ON public.habit_logs
  USING (
    habit_id IN (SELECT id FROM public.habits WHERE user_id = auth.uid())
  )
  WITH CHECK (
    habit_id IN (SELECT id FROM public.habits WHERE user_id = auth.uid())
  );

-- willpower_state
CREATE POLICY "willpower_self" ON public.willpower_state
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- routines
CREATE POLICY "routines_self" ON public.routines
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- routine_items: kullanıcı sadece kendi routine'lerine ait item'ları görür
CREATE POLICY "routine_items_self" ON public.routine_items
  USING (
    routine_id IN (SELECT id FROM public.routines WHERE user_id = auth.uid())
  )
  WITH CHECK (
    routine_id IN (SELECT id FROM public.routines WHERE user_id = auth.uid())
  );

-- ============================================================
-- INDEX'LER (performans)
-- ============================================================

CREATE INDEX IF NOT EXISTS habits_user_status ON public.habits (user_id, status);
CREATE INDEX IF NOT EXISTS habit_logs_habit_date ON public.habit_logs (habit_id, date DESC);
CREATE INDEX IF NOT EXISTS habit_logs_date ON public.habit_logs (date DESC);
