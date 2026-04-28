-- Add public sharing capability to conversations
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS shared_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS conversations_share_token_idx ON public.conversations(share_token) WHERE share_token IS NOT NULL;

-- Allow anyone (anon + authenticated) to read a conversation if it's public and they have the token
CREATE POLICY "conv_public_read_by_token"
ON public.conversations
FOR SELECT
TO anon, authenticated
USING (is_public = true AND share_token IS NOT NULL);

-- Allow anyone to read messages of a public conversation
CREATE POLICY "msg_public_read_via_conv"
ON public.messages
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND c.is_public = true
      AND c.share_token IS NOT NULL
  )
);