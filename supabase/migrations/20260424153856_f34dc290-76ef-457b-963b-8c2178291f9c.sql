ALTER TABLE public.chat_branches ALTER COLUMN source_message_id DROP NOT NULL;
ALTER TABLE public.chat_branches ALTER COLUMN conversation_id DROP NOT NULL;