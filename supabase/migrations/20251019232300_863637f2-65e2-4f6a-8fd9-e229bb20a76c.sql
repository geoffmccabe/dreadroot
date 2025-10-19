-- Create blocks table to store all block definitions
CREATE TABLE IF NOT EXISTS public.blocks (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  cost INTEGER NOT NULL DEFAULT 10,
  category TEXT NOT NULL DEFAULT 'building',
  rarity TEXT NOT NULL DEFAULT 'common',
  texture_url TEXT,
  properties JSONB DEFAULT '{"size": [1, 1, 1], "color": "#808080", "emissive": false, "transparent": false}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

-- Anyone can view blocks
CREATE POLICY "Blocks are publicly readable"
ON public.blocks
FOR SELECT
USING (true);

-- Only superadmins can insert blocks
CREATE POLICY "Superadmins can insert blocks"
ON public.blocks
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

-- Only superadmins can update blocks
CREATE POLICY "Superadmins can update blocks"
ON public.blocks
FOR UPDATE
USING (has_role(auth.uid(), 'superadmin'::app_role));

-- Only superadmins can delete blocks
CREATE POLICY "Superadmins can delete blocks"
ON public.blocks
FOR DELETE
USING (has_role(auth.uid(), 'superadmin'::app_role));

-- Create trigger for updating updated_at
CREATE TRIGGER update_blocks_updated_at
BEFORE UPDATE ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial blocks from the existing registry
INSERT INTO public.blocks (id, key, name, description, cost, category, rarity, texture_url, properties)
VALUES
  (1, 'fortress_block', 'Fortress Block', 'Basic stone building block', 10, 'building', 'common', '/cliff_texture_seamless.webp', '{"size": [1, 1, 1], "color": "#808080", "emissive": false, "transparent": false}'),
  (2, 'grass_block', 'Grass Block', 'Natural grass-covered block', 15, 'nature', 'common', '/grass_texture_seamless.webp', '{"size": [1, 1, 1], "color": "#7cb342", "emissive": false, "transparent": false}'),
  (3, 'glowing_block', 'Glowing Block', 'Emissive crystal block that glows', 25, 'special', 'rare', '/cliff_texture_seamless.webp', '{"size": [1, 1, 1], "color": "#00ffff", "emissive": true, "transparent": false}'),
  (4, 'crystal_block', 'Crystal Block', 'Transparent crystal block', 30, 'special', 'epic', '/cliff_texture_seamless.webp', '{"size": [1, 1, 1], "color": "#9c27b0", "emissive": true, "transparent": true}')
ON CONFLICT (id) DO NOTHING;