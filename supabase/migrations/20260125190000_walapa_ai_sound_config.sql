-- Add AI and sound config columns to walapa_definitions
ALTER TABLE public.walapa_definitions
ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sound_config JSONB DEFAULT NULL;

-- Ensure walapa entry exists in enemy_sound_settings
INSERT INTO public.enemy_sound_settings (enemy_type, volume)
VALUES ('walapa', 100)
ON CONFLICT (enemy_type) DO NOTHING;

-- Add call_sound_url and hurt_sound_url columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'enemy_sound_settings' AND column_name = 'call_sound_url'
  ) THEN
    ALTER TABLE public.enemy_sound_settings ADD COLUMN call_sound_url TEXT DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'enemy_sound_settings' AND column_name = 'hurt_sound_url'
  ) THEN
    ALTER TABLE public.enemy_sound_settings ADD COLUMN hurt_sound_url TEXT DEFAULT NULL;
  END IF;
END $$;
