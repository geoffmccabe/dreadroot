-- Increase growth speed multiplier from 100x to 1000x for testing
UPDATE tree_growth_config
SET value = 1000
WHERE key = 'speed_multiplier';
