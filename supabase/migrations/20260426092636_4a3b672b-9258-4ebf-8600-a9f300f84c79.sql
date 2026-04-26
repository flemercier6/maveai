-- Add columns to track consolidated memories
ALTER TABLE public.user_memories
  ADD COLUMN IF NOT EXISTS consolidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_count integer NOT NULL DEFAULT 1;

-- Track per-user consolidation runs (for UI feedback + cron skip-if-recent)
CREATE TABLE IF NOT EXISTS public.memory_consolidation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  before_count integer NOT NULL DEFAULT 0,
  after_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error text
);

ALTER TABLE public.memory_consolidation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "runs_select_own" ON public.memory_consolidation_runs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "runs_insert_own" ON public.memory_consolidation_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Enable required extensions for cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;