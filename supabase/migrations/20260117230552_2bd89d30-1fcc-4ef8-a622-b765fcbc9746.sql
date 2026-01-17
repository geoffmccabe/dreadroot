-- Drop NOT NULL constraint on name column to allow NULL values
ALTER TABLE seed_definitions ALTER COLUMN name DROP NOT NULL;

-- NULL out all seed names except tiers 5, 11, 19, 29
UPDATE seed_definitions 
SET name = NULL 
WHERE tier NOT IN (5, 11, 19, 29);