-- AI personalization preferences (per user)
CREATE TABLE public.ai_preferences (
  user_id uuid PRIMARY KEY,
  disabled_modes text[] NOT NULL DEFAULT '{}',          -- e.g. {'note','page','explore','map','web'}
  blacklisted_models text[] NOT NULL DEFAULT '{}',      -- e.g. {'gpt-4o-mini'}
  favorite_models text[] NOT NULL DEFAULT '{}',         -- ordered preference list
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_prefs_all_own" ON public.ai_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER ai_prefs_set_updated_at
  BEFORE UPDATE ON public.ai_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();