-- Branches (explorations) opened from a specific assistant message
CREATE TABLE public.chat_branches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  quoted_text TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT 'Exploration',
  status TEXT NOT NULL DEFAULT 'open',
  merged_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches_all_own"
ON public.chat_branches
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_branches_conv ON public.chat_branches(conversation_id);
CREATE INDEX idx_branches_source ON public.chat_branches(source_message_id);

CREATE TRIGGER trg_branches_updated
BEFORE UPDATE ON public.chat_branches
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Messages inside a branch
CREATE TABLE public.branch_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.branch_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branch_msg_all_own"
ON public.branch_messages
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_branch_msg_branch ON public.branch_messages(branch_id, created_at);