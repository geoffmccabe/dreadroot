-- Add view_settings JSONB column to worlds table for distant chunk rendering configuration
ALTER TABLE public.worlds
ADD COLUMN IF NOT EXISTS view_settings JSONB DEFAULT '{}'::jsonb;
