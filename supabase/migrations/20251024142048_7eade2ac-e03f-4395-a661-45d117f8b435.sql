-- Update rarity constraint to allow 10 specific types
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_rarity_check;
ALTER TABLE blocks ADD CONSTRAINT blocks_rarity_check 
  CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'divine', 'mystic', 'rainbow', 'apocalyptic', 'infinite'));