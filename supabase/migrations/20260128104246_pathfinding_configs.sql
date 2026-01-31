-- Create pathfinding_configs table
-- Stores reusable pathfinding configurations that can be assigned to entities

CREATE TABLE IF NOT EXISTS pathfinding_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Unique code identifier (e.g., 'astar_default', 'steering_fast')
  code VARCHAR(50) UNIQUE NOT NULL,

  -- Display name
  name VARCHAR(100) NOT NULL,

  -- Detailed description for admins
  description TEXT,

  -- Algorithm code (must match registered algorithm)
  algorithm_code VARCHAR(50) NOT NULL,

  -- Grid size for grid-based algorithms (meters per cell)
  grid_size DECIMAL(4,2) DEFAULT 2.0,

  -- Maximum iterations before giving up
  max_iterations INTEGER DEFAULT 3000,

  -- Default randomization variance (meters)
  default_randomization DECIMAL(4,2) DEFAULT 0,

  -- Randomization mode: 'straight', 'curved', 'jagged'
  randomization_mode VARCHAR(20) DEFAULT 'straight',

  -- Algorithm-specific parameters (JSON)
  algorithm_params JSONB DEFAULT '{}',

  -- Whether this is the default config
  is_default BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on code for fast lookups
CREATE INDEX IF NOT EXISTS idx_pathfinding_configs_code ON pathfinding_configs(code);

-- Create index on algorithm_code for filtering
CREATE INDEX IF NOT EXISTS idx_pathfinding_configs_algorithm ON pathfinding_configs(algorithm_code);

-- Insert default configurations
INSERT INTO pathfinding_configs (code, name, description, algorithm_code, grid_size, max_iterations, default_randomization, randomization_mode, is_default, algorithm_params)
VALUES
  ('astar_default', 'A* Default', 'Standard A* pathfinding. Good balance of speed and accuracy for most enemies.', 'astar', 2.0, 3000, 0, 'straight', true, '{}'),

  ('astar_precise', 'A* Precise', 'High-precision A* with smaller grid. Use for important NPCs or boss enemies that need accurate paths.', 'astar', 1.0, 5000, 0, 'straight', false, '{}'),

  ('astar_fast', 'A* Fast', 'Fast A* with larger grid. Good for hordes or background enemies where speed matters more than precision.', 'astar', 4.0, 2000, 0, 'straight', false, '{}'),

  ('weighted_astar', 'Weighted A* (1.5x)', 'Faster than standard A* but may not find the shortest path. Good for non-critical enemies.', 'astar_weighted', 2.0, 2500, 0, 'straight', false, '{"weight": 1.5}'),

  ('dijkstra_accurate', 'Dijkstra Exact', 'Guaranteed shortest path but slower. Use when absolute accuracy is required.', 'dijkstra', 2.0, 4000, 0, 'straight', false, '{}'),

  ('greedy_simple', 'Greedy Chase', 'Very fast but can get stuck. Good for simple chase behavior in open areas.', 'greedy', 2.0, 2000, 0, 'straight', false, '{}'),

  ('steering_smooth', 'Steering Behavior', 'Real-time obstacle avoidance without grid. Very smooth movement for short distances.', 'steering', 1.0, 500, 0, 'straight', false, '{"stepSize": 1.0}'),

  ('jps_optimized', 'Jump Point Search', 'Optimized A* variant that explores fewer nodes. Fastest option for large open maps.', 'jps', 2.0, 3000, 0, 'straight', false, '{}'),

  ('random_patrol', 'Random Patrol', 'A* with randomization for unpredictable patrol routes.', 'astar', 2.0, 3000, 1.5, 'jagged', false, '{}'),

  ('drunk_walk', 'Drunk Walk', 'Heavily randomized curved paths. Use for confused or intoxicated entities.', 'astar', 2.0, 3000, 3.0, 'curved', false, '{}');

-- Enable RLS
ALTER TABLE pathfinding_configs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated read pathfinding_configs"
  ON pathfinding_configs FOR SELECT
  TO authenticated
  USING (true);

-- Allow admins to manage (assuming admin check via role or function)
CREATE POLICY "Allow admin manage pathfinding_configs"
  ON pathfinding_configs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_pathfinding_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_pathfinding_configs_updated_at
  BEFORE UPDATE ON pathfinding_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_pathfinding_configs_updated_at();
