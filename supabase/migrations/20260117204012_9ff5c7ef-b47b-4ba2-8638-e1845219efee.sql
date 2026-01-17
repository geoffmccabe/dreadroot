-- Add visible textures to wood and fruit blocks
-- Using a brown color for wood and orange for fruit (as simple hex colors that can be parsed)
UPDATE blocks 
SET 
  texture_url = 'color:#8B4513',
  glow_factor = 0
WHERE key = 'wood';

UPDATE blocks 
SET 
  texture_url = 'color:#FF6B35',
  glow_factor = 0.3
WHERE key = 'fruit';