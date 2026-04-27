-- Folders table
CREATE TABLE public.folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'slate',
  icon TEXT NOT NULL DEFAULT 'folder',
  image_url TEXT,
  instructions TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "folders_all_own" ON public.folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER folders_set_updated_at
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX folders_user_position_idx ON public.folders (user_id, position);

-- Link conversations to a folder (nullable = unfiled)
ALTER TABLE public.conversations
  ADD COLUMN folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;

CREATE INDEX conversations_folder_idx ON public.conversations (folder_id);

-- Scope memories to a folder (nullable = global)
ALTER TABLE public.user_memories
  ADD COLUMN folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;

CREATE INDEX user_memories_folder_idx ON public.user_memories (folder_id);

-- Public bucket for folder cover images
INSERT INTO storage.buckets (id, name, public)
VALUES ('folder-images', 'folder-images', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can view (public bucket)
CREATE POLICY "folder_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'folder-images');

-- Owners can upload to their own user-id folder
CREATE POLICY "folder_images_owner_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'folder-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "folder_images_owner_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'folder-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "folder_images_owner_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'folder-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );