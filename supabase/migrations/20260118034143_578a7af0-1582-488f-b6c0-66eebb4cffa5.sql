-- =====================================================
-- SHWARM ENEMY SYSTEM - Database Schema
-- =====================================================

-- 1. Create shwarm_definitions table (admin-configurable enemy tiers)
CREATE TABLE public.shwarm_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier INTEGER NOT NULL UNIQUE CHECK (tier >= 1 AND tier <= 10),
  name TEXT NOT NULL,
  texture_url TEXT, -- null = use red-tinted fortress block
  speed REAL NOT NULL DEFAULT 5.0, -- blocks per second
  min_blocks INTEGER NOT NULL DEFAULT 10,
  max_blocks INTEGER NOT NULL DEFAULT 100,
  health_per_block INTEGER NOT NULL DEFAULT 50,
  damage_per_hit INTEGER NOT NULL DEFAULT 10, -- configurable damage
  spawn_chance_per_minute REAL NOT NULL DEFAULT 1.0,
  x_factor INTEGER NOT NULL DEFAULT 2, -- random movement variance
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create active_shwarms table (server-synced shwarm state)
CREATE TABLE public.active_shwarms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES public.worlds(id) ON DELETE CASCADE,
  definition_id UUID NOT NULL REFERENCES public.shwarm_definitions(id),
  authority_user_id UUID, -- who simulates + broadcasts movement
  state_json JSONB, -- periodic snapshot for reconnect
  killer_user_id UUID,
  spawned_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Enforce only 1 active shwarm globally at a time
CREATE UNIQUE INDEX one_active_shwarm_global
ON public.active_shwarms ((1))
WHERE is_active = true;

-- 3. Create shwarm_blocks table (individual block health)
CREATE TABLE public.shwarm_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shwarm_id UUID NOT NULL REFERENCES public.active_shwarms(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL, -- stable index for instancing
  initial_x REAL NOT NULL,
  initial_y REAL NOT NULL,
  initial_z REAL NOT NULL,
  current_health INTEGER NOT NULL,
  max_health INTEGER NOT NULL,
  last_hit_by UUID,
  last_hit_at TIMESTAMPTZ,
  is_alive BOOLEAN NOT NULL DEFAULT true
);

-- Index for efficient lookups
CREATE INDEX idx_shwarm_blocks_shwarm_id ON public.shwarm_blocks(shwarm_id);

-- 4. Create user_combat_stats table (kill tracking)
CREATE TABLE public.user_combat_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  enemy_type TEXT NOT NULL, -- 'shwarm_t1', 'shwarm_t2', etc.
  kills INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, enemy_type)
);

-- 5. Add health columns to user_profiles
ALTER TABLE public.user_profiles 
ADD COLUMN current_health INTEGER NOT NULL DEFAULT 100,
ADD COLUMN max_health INTEGER NOT NULL DEFAULT 100;

-- =====================================================
-- RLS Policies
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.shwarm_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_shwarms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shwarm_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_combat_stats ENABLE ROW LEVEL SECURITY;

-- shwarm_definitions: Public read, admin write only
CREATE POLICY "Anyone can view shwarm definitions" 
ON public.shwarm_definitions FOR SELECT 
USING (true);

CREATE POLICY "Admins can manage shwarm definitions" 
ON public.shwarm_definitions FOR ALL 
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- active_shwarms: Public read, no direct client write (edge function uses service role)
CREATE POLICY "Anyone can view active shwarms" 
ON public.active_shwarms FOR SELECT 
USING (true);

-- shwarm_blocks: Public read, no direct client write (edge function validates damage)
CREATE POLICY "Anyone can view shwarm blocks" 
ON public.shwarm_blocks FOR SELECT 
USING (true);

-- user_combat_stats: Users can view and update their own, admins can view all
CREATE POLICY "Users can view their own combat stats" 
ON public.user_combat_stats FOR SELECT 
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Users can insert their own combat stats" 
ON public.user_combat_stats FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own combat stats" 
ON public.user_combat_stats FOR UPDATE 
USING (auth.uid() = user_id);

-- =====================================================
-- Insert default tier definitions (T1-T5 to start)
-- =====================================================
INSERT INTO public.shwarm_definitions (tier, name, speed, min_blocks, max_blocks, health_per_block, damage_per_hit, spawn_chance_per_minute, x_factor)
VALUES 
  (1, 'Tier 1 Shwarm', 3.0, 10, 20, 30, 5, 2.0, 1),
  (2, 'Tier 2 Shwarm', 4.0, 15, 30, 50, 10, 1.5, 2),
  (3, 'Tier 3 Shwarm', 5.0, 20, 40, 75, 15, 1.0, 2),
  (4, 'Tier 4 Shwarm', 6.0, 30, 60, 100, 20, 0.5, 3),
  (5, 'Tier 5 Shwarm', 7.0, 40, 80, 150, 30, 0.25, 3);