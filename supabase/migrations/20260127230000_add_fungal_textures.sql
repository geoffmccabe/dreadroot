-- Add fungal tree texture columns to seed_definitions
-- Fungal trees have 3 texture types: stem, cap_top, cap_underside

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_stem_texture_url TEXT DEFAULT NULL;

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_cap_top_texture_url TEXT DEFAULT NULL;

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_cap_underside_texture_url TEXT DEFAULT NULL;
