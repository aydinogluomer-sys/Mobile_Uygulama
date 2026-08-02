-- ============================================================
-- Entegrasyon Tabloları
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notion_integrations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  workspace_id text,
  workspace_name text,
  workspace_icon text,
  bot_id text,
  habits_database_id text,
  tasks_database_id text,
  habits_url text,
  tasks_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.google_calendar_integrations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  token_type text,
  calendar_id text,
  calendar_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notion_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notion_integrations_self" ON public.notion_integrations
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "google_calendar_integrations_self" ON public.google_calendar_integrations
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_notion_integrations_user_id ON public.notion_integrations (user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_integrations_user_id ON public.google_calendar_integrations (user_id);
