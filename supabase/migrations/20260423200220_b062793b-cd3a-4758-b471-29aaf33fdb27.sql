
CREATE TABLE public.usage_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID,
  message_id UUID,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  input_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
  output_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_select_own"
  ON public.usage_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "usage_insert_own"
  ON public.usage_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX usage_events_user_created_idx
  ON public.usage_events (user_id, created_at DESC);

CREATE INDEX usage_events_user_model_idx
  ON public.usage_events (user_id, model);
