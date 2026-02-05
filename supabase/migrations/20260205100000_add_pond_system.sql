-- ============================================
-- Pond System Migration
-- Adds world_ponds table and pond settings to worlds table
-- ============================================

-- Pond definitions for each world (generated at world creation)
CREATE TABLE IF NOT EXISTS public.world_ponds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  min_x INTEGER NOT NULL,        -- Bottom-left corner X
  min_z INTEGER NOT NULL,        -- Bottom-left corner Z
  width INTEGER NOT NULL,        -- X extent (blocks)
  height INTEGER NOT NULL,       -- Z extent (blocks)
  depth INTEGER NOT NULL,        -- Y depth below surface (3-20)
  water_type TEXT NOT NULL,      -- 'water' or 'lava'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_world_ponds_world ON public.world_ponds(world_id);
CREATE INDEX IF NOT EXISTS idx_world_ponds_bounds ON public.world_ponds(world_id, min_x, min_z);

-- Enable RLS
ALTER TABLE public.world_ponds ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can see ponds)
CREATE POLICY "world_ponds_select_public" ON public.world_ponds
  FOR SELECT USING (true);

-- Admin-only write access
CREATE POLICY "world_ponds_admin_all" ON public.world_ponds
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'superadmin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'superadmin'::public.app_role));

-- ============================================
-- World pond generation settings
-- Separate settings for water and lava ponds
-- ============================================

-- Water pond settings
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_pond_chance FLOAT DEFAULT 0.0;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_pond_min_width INTEGER DEFAULT 5;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_pond_max_width INTEGER DEFAULT 20;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_pond_min_height INTEGER DEFAULT 5;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_pond_max_height INTEGER DEFAULT 20;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_pond_min_depth INTEGER DEFAULT 3;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_pond_max_depth INTEGER DEFAULT 10;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_surface_texture_url TEXT DEFAULT NULL;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS water_tint_color TEXT DEFAULT '#88ddff';

-- Lava pond settings
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_pond_chance FLOAT DEFAULT 0.0;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_pond_min_width INTEGER DEFAULT 3;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_pond_max_width INTEGER DEFAULT 15;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_pond_min_height INTEGER DEFAULT 3;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_pond_max_height INTEGER DEFAULT 15;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_pond_min_depth INTEGER DEFAULT 3;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_pond_max_depth INTEGER DEFAULT 8;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_surface_texture_url TEXT DEFAULT NULL;
ALTER TABLE public.worlds ADD COLUMN IF NOT EXISTS lava_tint_color TEXT DEFAULT '#ff6622';

-- Add constraint for valid water types
ALTER TABLE public.world_ponds DROP CONSTRAINT IF EXISTS world_ponds_water_type_check;
ALTER TABLE public.world_ponds ADD CONSTRAINT world_ponds_water_type_check
  CHECK (water_type IN ('water', 'lava'));

-- Add constraints for valid ranges
ALTER TABLE public.world_ponds DROP CONSTRAINT IF EXISTS world_ponds_dimensions_check;
ALTER TABLE public.world_ponds ADD CONSTRAINT world_ponds_dimensions_check
  CHECK (width > 0 AND height > 0 AND depth > 0);
