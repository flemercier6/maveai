CREATE TABLE public.user_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  provider text NOT NULL,
  account_email text,
  access_token text NOT NULL,
  refresh_token text,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_integrations_all_own"
ON public.user_integrations
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_integrations_set_updated_at
BEFORE UPDATE ON public.user_integrations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_user_integrations_user ON public.user_integrations(user_id);