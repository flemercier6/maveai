CREATE TABLE public.cost_thresholds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  amount_eur NUMERIC NOT NULL DEFAULT 10,
  period TEXT NOT NULL DEFAULT 'month',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_notified_at TIMESTAMPTZ,
  last_notified_period_start TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cost_thresholds_period_check CHECK (period IN ('day','week','month')),
  CONSTRAINT cost_thresholds_amount_check CHECK (amount_eur > 0)
);

ALTER TABLE public.cost_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_thresholds_all_own" ON public.cost_thresholds
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER cost_thresholds_set_updated_at
  BEFORE UPDATE ON public.cost_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();