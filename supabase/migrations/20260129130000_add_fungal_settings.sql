-- Add fungal tree generation settings to seed_definitions
-- These allow per-tier configuration of fungal tree shape

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_min_height INTEGER DEFAULT 30;

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_max_height INTEGER DEFAULT 60;

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_min_cap_width INTEGER DEFAULT 40;

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_max_cap_width INTEGER DEFAULT 100;

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_stem_random INTEGER DEFAULT 0;

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_lean_angle INTEGER DEFAULT 0;

ALTER TABLE public.seed_definitions
ADD COLUMN IF NOT EXISTS fungal_s_curve BOOLEAN DEFAULT FALSE;
