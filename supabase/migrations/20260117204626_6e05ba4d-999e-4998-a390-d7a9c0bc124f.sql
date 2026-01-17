-- Rename 'wood' to 'trunk' in blocks table
UPDATE blocks SET key = 'trunk', name = 'Trunk' WHERE key = 'wood';

-- Ensure trunk block exists with proper settings
INSERT INTO blocks (key, name, description, category, class, rarity, tier, cost, properties)
VALUES ('trunk', 'Trunk', 'Tree trunk block', 'building', 'basic', 'common', 1, 0, 
  '{"color": "#8B4513", "emissive": false, "transparent": false, "size": [1, 1, 1]}'::jsonb)
ON CONFLICT (key) DO UPDATE SET 
  name = 'Trunk',
  description = 'Tree trunk block',
  properties = '{"color": "#8B4513", "emissive": false, "transparent": false, "size": [1, 1, 1]}'::jsonb;