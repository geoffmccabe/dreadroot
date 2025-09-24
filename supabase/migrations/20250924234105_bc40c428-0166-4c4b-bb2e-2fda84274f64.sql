-- First, let's clean up duplicate blocks (keep the first one)
WITH duplicates AS (
  SELECT id, 
         ROW_NUMBER() OVER (PARTITION BY position_x, position_y, position_z, block_type ORDER BY created_at) as rn
  FROM placed_blocks
)
DELETE FROM placed_blocks 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Fix all blocks with 0.5 positions by rounding them to integers
UPDATE placed_blocks 
SET 
  position_x = ROUND(position_x)::int,
  position_y = ROUND(position_y)::int, 
  position_z = ROUND(position_z)::int,
  updated_at = NOW()
WHERE 
  position_x::text LIKE '%.5' OR 
  position_y::text LIKE '%.5' OR 
  position_z::text LIKE '%.5';