-- Add shrine_chance column to seed_definitions for shrine decoration spawning
-- Shrines are rare structures on tree branches used for Fruit Forging

ALTER TABLE seed_definitions
ADD COLUMN IF NOT EXISTS shrine_chance DOUBLE PRECISION DEFAULT 0.0001;

COMMENT ON COLUMN seed_definitions.shrine_chance IS 'Chance for shrine decoration to spawn on branches (0.0001 = 0.01%, 0.01 = 1%)';
