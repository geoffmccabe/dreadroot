-- Tree System Database Schema
-- Fully isolated tables - can be dropped to remove feature

-- 1. Seed Definitions (30 tiers, admin-configurable)
CREATE TABLE public.seed_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier integer NOT NULL UNIQUE CHECK (tier >= 1 AND tier <= 30),
  name text NOT NULL,
  trunk_texture_url text,
  branch_texture_url text,
  fruit_texture_url text,
  width_factor real NOT NULL DEFAULT 0.5 CHECK (width_factor >= 0.1 AND width_factor <= 1.0),
  branching_factor real NOT NULL DEFAULT 0.5 CHECK (branching_factor >= 0.1 AND branching_factor <= 1.0),
  fruiting_factor real NOT NULL DEFAULT 0.5 CHECK (fruiting_factor >= 0.1 AND fruiting_factor <= 1.0),
  growth_factor real NOT NULL DEFAULT 0.5 CHECK (growth_factor >= 0.1 AND growth_factor <= 1.0),
  cost integer NOT NULL DEFAULT 100,
  rarity text NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Planted Trees (active/growing trees)
CREATE TABLE public.planted_trees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  seed_definition_id uuid NOT NULL REFERENCES public.seed_definitions(id) ON DELETE CASCADE,
  planted_by uuid NOT NULL,
  base_x integer NOT NULL,
  base_y integer NOT NULL,
  base_z integer NOT NULL,
  growth_seed integer NOT NULL,
  current_block_count integer NOT NULL DEFAULT 0,
  target_block_count integer NOT NULL,
  is_fully_grown boolean NOT NULL DEFAULT false,
  planted_at timestamptz NOT NULL DEFAULT now(),
  last_growth_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(world_id, base_x, base_y, base_z)
);

-- 3. Tree Blocks (individual trunk/branch blocks)
CREATE TABLE public.tree_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id uuid NOT NULL REFERENCES public.planted_trees(id) ON DELETE CASCADE,
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  position_x integer NOT NULL,
  position_y integer NOT NULL,
  position_z integer NOT NULL,
  block_type text NOT NULL CHECK (block_type IN ('trunk', 'branch')),
  growth_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(world_id, position_x, position_y, position_z)
);

-- 4. Tree Fruits (spawned fruits on trees)
CREATE TABLE public.tree_fruits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id uuid NOT NULL REFERENCES public.planted_trees(id) ON DELETE CASCADE,
  world_id uuid NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  position_x integer NOT NULL,
  position_y integer NOT NULL,
  position_z integer NOT NULL,
  tier integer NOT NULL,
  is_falling boolean NOT NULL DEFAULT false,
  is_collectible boolean NOT NULL DEFAULT false,
  velocity_y real NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_planted_trees_world ON public.planted_trees(world_id);
CREATE INDEX idx_planted_trees_growing ON public.planted_trees(world_id) WHERE is_fully_grown = false;
CREATE INDEX idx_tree_blocks_world ON public.tree_blocks(world_id);
CREATE INDEX idx_tree_blocks_tree ON public.tree_blocks(tree_id);
CREATE INDEX idx_tree_fruits_world ON public.tree_fruits(world_id);
CREATE INDEX idx_tree_fruits_collectible ON public.tree_fruits(world_id) WHERE is_collectible = true;

-- Enable RLS
ALTER TABLE public.seed_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planted_trees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tree_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tree_fruits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for seed_definitions (read all, write admin only)
CREATE POLICY "Anyone can view seed definitions"
  ON public.seed_definitions FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage seed definitions"
  ON public.seed_definitions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- RLS Policies for planted_trees
CREATE POLICY "Anyone can view planted trees in world"
  ON public.planted_trees FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can plant trees"
  ON public.planted_trees FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = planted_by);

CREATE POLICY "Users can update their own trees"
  ON public.planted_trees FOR UPDATE
  USING (auth.uid() = planted_by);

CREATE POLICY "Users can delete their own trees"
  ON public.planted_trees FOR DELETE
  USING (auth.uid() = planted_by);

-- RLS Policies for tree_blocks
CREATE POLICY "Anyone can view tree blocks"
  ON public.tree_blocks FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert tree blocks"
  ON public.tree_blocks FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Tree owners can delete tree blocks"
  ON public.tree_blocks FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.planted_trees pt
    WHERE pt.id = tree_id AND pt.planted_by = auth.uid()
  ));

-- RLS Policies for tree_fruits
CREATE POLICY "Anyone can view tree fruits"
  ON public.tree_fruits FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert fruits"
  ON public.tree_fruits FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can update fruits for collection"
  ON public.tree_fruits FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can collect fruits"
  ON public.tree_fruits FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at on seed_definitions
CREATE TRIGGER update_seed_definitions_updated_at
  BEFORE UPDATE ON public.seed_definitions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default seed definitions for tiers 1-3 (for testing)
INSERT INTO public.seed_definitions (tier, name, width_factor, branching_factor, fruiting_factor, growth_factor, cost, rarity)
VALUES 
  (1, 'Sprout', 0.3, 0.2, 0.3, 0.8, 10, 'common'),
  (2, 'Sapling', 0.4, 0.3, 0.4, 0.6, 25, 'common'),
  (3, 'Seedling', 0.5, 0.4, 0.5, 0.5, 50, 'uncommon');