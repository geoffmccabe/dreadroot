-- Add 'wood' and 'fruit' block definitions for tree rendering
INSERT INTO blocks (key, name, description, category, class, rarity, tier, cost)
VALUES 
  ('wood', 'Wood', 'Tree trunk block', 'building', 'basic', 'common', 1, 0),
  ('fruit', 'Fruit', 'Tree fruit block', 'building', 'basic', 'common', 1, 0)
ON CONFLICT (key) DO NOTHING;