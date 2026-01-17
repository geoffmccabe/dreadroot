-- Fix wood and fruit blocks to have valid textures and colors
-- Set texture_url to NULL so it uses default cliff texture fallback
-- But set distinct colors so they render differently

UPDATE blocks 
SET 
  texture_url = NULL,
  properties = jsonb_build_object(
    'color', '#8B4513',
    'emissive', false,
    'transparent', false,
    'size', ARRAY[1, 1, 1]
  )
WHERE key = 'wood';

UPDATE blocks 
SET 
  texture_url = NULL,
  glow_factor = 0.5,
  properties = jsonb_build_object(
    'color', '#FF6B35',
    'emissive', true,
    'transparent', false,
    'size', ARRAY[1, 1, 1]
  )
WHERE key = 'fruit';