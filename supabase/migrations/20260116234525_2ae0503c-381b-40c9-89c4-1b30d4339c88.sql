-- Phase 1A: Create worlds table with single-default enforcement

-- Create worlds table
CREATE TABLE IF NOT EXISTS public.worlds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  fortress_texture_url text,
  ground_texture_url text,
  sky_texture_url text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.worlds ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "worlds_select_public" ON public.worlds
  FOR SELECT USING (true);

-- Admin-only write access
CREATE POLICY "worlds_admin_all" ON public.worlds
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'superadmin'::public.app_role));

-- CRITICAL: Only one world can be default (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS worlds_single_default_true
  ON public.worlds ((is_default)) WHERE is_default = true;

-- Add updated_at trigger
CREATE TRIGGER update_worlds_updated_at
  BEFORE UPDATE ON public.worlds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default world (only if none exists)
INSERT INTO public.worlds (name, is_default)
SELECT 'Default World', true
WHERE NOT EXISTS (SELECT 1 FROM public.worlds);

-- Phase 1A Step 2: Add world_id to placed_blocks with backfill (NO TRUNCATE)

-- Add world_id column
ALTER TABLE public.placed_blocks
  ADD COLUMN IF NOT EXISTS world_id uuid;

-- Backfill existing blocks to default world
UPDATE public.placed_blocks
SET world_id = (SELECT id FROM public.worlds WHERE is_default = true LIMIT 1)
WHERE world_id IS NULL;

-- Make NOT NULL after backfill
ALTER TABLE public.placed_blocks
  ALTER COLUMN world_id SET NOT NULL;

-- Add foreign key
ALTER TABLE public.placed_blocks
  ADD CONSTRAINT placed_blocks_world_fk
  FOREIGN KEY (world_id) REFERENCES public.worlds(id) ON DELETE CASCADE;

-- Phase 1A Step 3: Add chunk_x and chunk_z as GENERATED columns

-- Server-computed, always correct, no client drift
ALTER TABLE public.placed_blocks
  ADD COLUMN IF NOT EXISTS chunk_x int
  GENERATED ALWAYS AS (floor(position_x / 16.0)::int) STORED;

ALTER TABLE public.placed_blocks
  ADD COLUMN IF NOT EXISTS chunk_z int
  GENERATED ALWAYS AS (floor(position_z / 16.0)::int) STORED;

-- Index for future chunk-based queries
CREATE INDEX IF NOT EXISTS placed_blocks_world_chunk_idx
  ON public.placed_blocks (world_id, chunk_x, chunk_z);

-- Phase 1A Step 4: Fix uniqueness constraint (world-scoped)
-- New world-scoped uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS placed_blocks_world_pos_unique
  ON public.placed_blocks (world_id, position_x, position_y, position_z);

-- Phase 1A Step 5: Create world-textures storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('world-textures', 'world-textures', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for world-textures bucket
CREATE POLICY "World textures are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'world-textures');

CREATE POLICY "Admins can upload world textures"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'world-textures' 
    AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
  );

CREATE POLICY "Admins can update world textures"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'world-textures' 
    AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
  );

CREATE POLICY "Admins can delete world textures"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'world-textures' 
    AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
  );