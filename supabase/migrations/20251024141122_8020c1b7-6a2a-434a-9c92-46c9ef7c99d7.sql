-- Add class field to blocks table to organize blocks into BASIC, MAGIC, MYSTERY, ICONIC
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS class text NOT NULL DEFAULT 'basic';

-- Add check constraint for valid classes
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_class_check;
ALTER TABLE blocks ADD CONSTRAINT blocks_class_check 
  CHECK (class IN ('basic', 'magic', 'mystery', 'iconic'));

-- Update existing blocks to appropriate classes
UPDATE blocks SET class = 'mystery' WHERE key = 'glowing_block';
UPDATE blocks SET class = 'iconic' WHERE key IN ('geoff_block', 'waterfall_logo_block');
UPDATE blocks SET class = 'basic' WHERE class = 'basic' AND key NOT IN ('glowing_block', 'geoff_block', 'waterfall_logo_block');