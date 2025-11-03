-- Create models table as application-level resource
CREATE TABLE public.models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  model_type text NOT NULL CHECK (model_type IN ('Character', 'NPC', 'Enemy')),
  
  -- File information
  model_url text NOT NULL,
  file_format text NOT NULL CHECK (file_format IN ('fbx', 'glb', 'gltf')),
  
  -- Default appearance
  default_scale real NOT NULL DEFAULT 0.01,
  default_scale_x real NOT NULL DEFAULT 1.0,
  default_scale_y real NOT NULL DEFAULT 1.0,
  default_scale_z real NOT NULL DEFAULT 1.0,
  default_color text NOT NULL DEFAULT '#4a9eff',
  
  -- Animations stored as JSONB array
  animations jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Metadata
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  
  -- Future fields for inventory system
  rarity text NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  cost integer DEFAULT 0
);

-- Add updated_at trigger
CREATE TRIGGER update_models_updated_at
  BEFORE UPDATE ON public.models
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Models are publicly readable"
  ON public.models FOR SELECT
  USING (is_active = true);

CREATE POLICY "Superadmins can insert models"
  ON public.models FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can update models"
  ON public.models FOR UPDATE
  USING (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can delete models"
  ON public.models FOR DELETE
  USING (has_role(auth.uid(), 'superadmin'::app_role));

-- Seed Y-Bot model
INSERT INTO public.models (
  key, 
  name, 
  description, 
  model_type, 
  model_url, 
  file_format,
  default_scale,
  default_scale_x,
  default_scale_y,
  default_scale_z,
  default_color,
  animations,
  is_active
) VALUES (
  'y-bot',
  'Y-Bot Character',
  'Default humanoid character model',
  'Character',
  '/y-bot.fbx',
  'fbx',
  0.01,
  1.0,
  1.0,
  1.0,
  '#4a9eff',
  '[
    {
      "name": "Walk",
      "file": "/Unarmed_Walk_Forward.fbx",
      "trigger": "movement",
      "speed": 1.0,
      "loop": true,
      "fadeInDuration": 0.2,
      "fadeOutDuration": 0.2
    },
    {
      "name": "Idle",
      "file": "/Sitting_Laughing.fbx",
      "trigger": "idle",
      "speed": 1.0,
      "loop": true,
      "fadeInDuration": 0.3,
      "fadeOutDuration": 0.3
    }
  ]'::jsonb,
  true
);