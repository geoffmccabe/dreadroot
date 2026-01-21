-- Create table for global enemy sound settings
CREATE TABLE public.enemy_sound_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enemy_type TEXT NOT NULL UNIQUE, -- 'shwarm' or 'shnake'
  volume INTEGER NOT NULL DEFAULT 100, -- 0-200 percent
  ambient_sound_url TEXT DEFAULT NULL, -- Custom ambient/movement sound
  death_sound_url TEXT DEFAULT NULL, -- Custom death sound
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default rows for both enemy types
INSERT INTO public.enemy_sound_settings (enemy_type, volume)
VALUES 
  ('shwarm', 100),
  ('shnake', 100);

-- Enable RLS
ALTER TABLE public.enemy_sound_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read (public game settings)
CREATE POLICY "Anyone can read enemy sound settings"
ON public.enemy_sound_settings
FOR SELECT
USING (true);

-- Only admins can update
CREATE POLICY "Admins can update enemy sound settings"
ON public.enemy_sound_settings
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role IN ('admin', 'superadmin')
  )
);