-- Add texture_url column to placed_blocks for custom per-block textures (used by tree trunk blocks)
ALTER TABLE placed_blocks ADD COLUMN texture_url TEXT;