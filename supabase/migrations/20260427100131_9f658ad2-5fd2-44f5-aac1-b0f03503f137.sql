-- Add billed_at to usage_events to track which events have been billed
ALTER TABLE public.usage_events
ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usage_events_user_billed
ON public.usage_events (user_id, billed_at);

-- billing_accounts: one row per user when they upgrade to Plus
CREATE TABLE public.billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  next_billing_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT billing_accounts_plan_check CHECK (plan IN ('free','plus')),
  CONSTRAINT billing_accounts_cycle_check CHECK (billing_cycle IN ('daily','weekly','monthly')),
  CONSTRAINT billing_accounts_status_check CHECK (status IN ('active','past_due','suspended'))
);

ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_accounts_all_own" ON public.billing_accounts
FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER billing_accounts_set_updated_at
BEFORE UPDATE ON public.billing_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- payment_methods: cards saved by the user
CREATE TABLE public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stripe_payment_method_id TEXT NOT NULL UNIQUE,
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_methods_user ON public.payment_methods (user_id);

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_methods_all_own" ON public.payment_methods
FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- billing_invoices: each charge attempt
CREATE TABLE public.billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  amount_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT billing_invoices_status_check CHECK (status IN ('pending','paid','failed','skipped_below_threshold'))
);

CREATE INDEX idx_billing_invoices_user ON public.billing_invoices (user_id, created_at DESC);

ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_invoices_all_own" ON public.billing_invoices
FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER billing_invoices_set_updated_at
BEFORE UPDATE ON public.billing_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();