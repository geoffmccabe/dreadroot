-- Add new columns for enhanced tree decoration factors
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS low_branch_height integer DEFAULT 2;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS spike_chance real DEFAULT 0;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS spike_length integer DEFAULT 3;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS nob_chance real DEFAULT 0;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS nob_size integer DEFAULT 1;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS cross_chance real DEFAULT 0;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS cross_length integer DEFAULT 3;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS shroom_chance real DEFAULT 0;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS shroom_length integer DEFAULT 5;
ALTER TABLE seed_definitions ADD COLUMN IF NOT EXISTS shroom_cap_diameter integer DEFAULT 3;