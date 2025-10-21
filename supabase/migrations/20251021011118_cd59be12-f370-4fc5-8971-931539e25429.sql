-- Add glow_factor column to blocks table
ALTER TABLE public.blocks
ADD COLUMN glow_factor real;

-- Add comment to explain the column
COMMENT ON COLUMN public.blocks.glow_factor IS 'Glow intensity multiplier for emissive blocks. Range: 0.0-10.0. Null for non-glowing blocks.';

-- Update existing glowing blocks with default glow_factor of 3.0
-- These are blocks that have emissive property set to true
UPDATE public.blocks
SET glow_factor = 3.0
WHERE properties->>'emissive' = 'true';