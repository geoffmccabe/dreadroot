-- Add wide tree configuration columns to seed_definitions
ALTER TABLE seed_definitions
  ADD COLUMN IF NOT EXISTS wide_min_height integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS wide_max_height integer DEFAULT 100,
  ADD COLUMN IF NOT EXISTS wide_lean_angle real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wide_s_curve boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS wide_stem_random integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wide_base_trunk_radius integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wide_gradient_color_base text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wide_gradient_color_tip text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS wide_glow_color text DEFAULT '#88ffaa';
