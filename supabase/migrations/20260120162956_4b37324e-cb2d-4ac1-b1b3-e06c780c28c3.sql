-- Phase 1: Create new tables for tree architecture rebuild

-- 1.1 Create tree_blueprints table
CREATE TABLE public.tree_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planted_tree_id UUID NOT NULL REFERENCES public.planted_trees(id) ON DELETE CASCADE,
  world_id UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  blueprint_data JSONB NOT NULL,
  block_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(planted_tree_id),
  CONSTRAINT blueprint_size_limit CHECK (block_count <= 5000)
);
CREATE INDEX idx_tree_blueprints_world ON public.tree_blueprints(world_id);
CREATE INDEX idx_tree_blueprints_planted_tree ON public.tree_blueprints(planted_tree_id);

-- RLS for tree_blueprints
ALTER TABLE public.tree_blueprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own blueprints" ON public.tree_blueprints
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.planted_trees WHERE id = planted_tree_id AND planted_by = auth.uid())
  );

CREATE POLICY "Blueprints are readable by all" ON public.tree_blueprints 
  FOR SELECT USING (true);

CREATE POLICY "Users can delete own blueprints" ON public.tree_blueprints
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.planted_trees WHERE id = planted_tree_id AND planted_by = auth.uid())
  );

-- 1.2 Create block_overlaps table (multi-overlap with priority)
CREATE TABLE public.block_overlaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id UUID NOT NULL REFERENCES public.planted_trees(id) ON DELETE CASCADE,
  world_id UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  position_x INTEGER NOT NULL,
  position_y INTEGER NOT NULL,
  position_z INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  tree_planted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tree_id, position_x, position_y, position_z)
);
CREATE INDEX idx_overlaps_priority ON public.block_overlaps(world_id, position_x, position_y, position_z, tree_planted_at ASC);
CREATE INDEX idx_overlaps_tree ON public.block_overlaps(tree_id);

-- RLS for block_overlaps
ALTER TABLE public.block_overlaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Overlaps readable by all" ON public.block_overlaps 
  FOR SELECT USING (true);

CREATE POLICY "Auth users can insert overlaps" ON public.block_overlaps 
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 1.3 Create overlap_check_queue table
CREATE TABLE public.overlap_check_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  position_x INTEGER NOT NULL,
  position_y INTEGER NOT NULL,
  position_z INTEGER NOT NULL,
  added_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(world_id, position_x, position_y, position_z)
);
CREATE INDEX idx_overlap_queue_world ON public.overlap_check_queue(world_id);

-- RLS for overlap_check_queue
ALTER TABLE public.overlap_check_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can insert to queue" ON public.overlap_check_queue 
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Queue readable by all" ON public.overlap_check_queue 
  FOR SELECT USING (true);

CREATE POLICY "Service role can delete from queue" ON public.overlap_check_queue
  FOR DELETE USING (true);

-- 1.4 Create tier planting limits config table
CREATE TABLE public.tier_planting_limits (
  tier_min INTEGER NOT NULL,
  tier_max INTEGER NOT NULL,
  max_per_chunk INTEGER NOT NULL,
  PRIMARY KEY (tier_min, tier_max)
);

-- Insert default tier limits
INSERT INTO public.tier_planting_limits (tier_min, tier_max, max_per_chunk) VALUES 
  (1, 2, 4),
  (3, 4, 3),
  (5, 8, 2),
  (9, 99, 1);

-- RLS for tier_planting_limits (read-only for users)
ALTER TABLE public.tier_planting_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tier limits readable by all" ON public.tier_planting_limits 
  FOR SELECT USING (true);

CREATE POLICY "Only admins can modify tier limits" ON public.tier_planting_limits
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));