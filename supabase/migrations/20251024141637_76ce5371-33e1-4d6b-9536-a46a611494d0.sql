-- Add tier field to blocks table
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS tier integer NOT NULL DEFAULT 0;

-- Add check constraint for valid tier range (0-30)
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_tier_check;
ALTER TABLE blocks ADD CONSTRAINT blocks_tier_check 
  CHECK (tier >= 0 AND tier <= 30);

-- Set all existing blocks to Tier 0
UPDATE blocks SET tier = 0;

-- Set Glowing Block to Tier 1
UPDATE blocks SET tier = 1 WHERE key = 'glowing_block';