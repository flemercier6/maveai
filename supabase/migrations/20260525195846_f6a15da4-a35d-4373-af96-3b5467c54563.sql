CREATE TABLE public.shared_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  share_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  title text NOT NULL DEFAULT 'Page',
  page jsonb NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_pages_all_own" ON public.shared_pages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "shared_pages_public_read" ON public.shared_pages
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

CREATE INDEX idx_shared_pages_token ON public.shared_pages(share_token);
CREATE INDEX idx_shared_pages_user ON public.shared_pages(user_id, created_at DESC);

CREATE TRIGGER shared_pages_set_updated_at
  BEFORE UPDATE ON public.shared_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();