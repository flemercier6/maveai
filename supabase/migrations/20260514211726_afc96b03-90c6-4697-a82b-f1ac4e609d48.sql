ALTER TABLE public.ai_preferences
  ADD COLUMN IF NOT EXISTS memory_mode text NOT NULL DEFAULT 'classic';

ALTER TABLE public.user_memories
  ADD COLUMN IF NOT EXISTS confidence numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS hit_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS embedding double precision[];

CREATE TABLE IF NOT EXISTS public.memory_extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  outcome text,
  tokens_used integer NOT NULL DEFAULT 0,
  error text
);

ALTER TABLE public.memory_extraction_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "memext_select_own" ON public.memory_extraction_runs;
CREATE POLICY "memext_select_own" ON public.memory_extraction_runs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "memext_insert_own" ON public.memory_extraction_runs;
CREATE POLICY "memext_insert_own" ON public.memory_extraction_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS memext_user_started_idx
  ON public.memory_extraction_runs (user_id, started_at DESC);