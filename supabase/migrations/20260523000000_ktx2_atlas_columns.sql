-- =====================================================================
-- KTX2 atlas system — Phase 1: parallel columns
-- =====================================================================
-- Adds `<existing>_url_ktx2` siblings for every texture URL the atlas
-- consumes, plus a per-row `texture_tier` ('standard' or 'premium').
-- Existing columns are NOT touched — the legacy 2D atlas keeps working
-- unchanged. The new array-atlas system reads the _ktx2 columns when
-- enabled via the window.__USE_ARRAY_ATLAS flag.
--
-- Idempotent: safe to run more than once (every ADD is IF NOT EXISTS,
-- CHECK constraints are dropped + re-added).
-- =====================================================================

-- ------ blocks (block-type definitions) ------
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS texture_tier text NOT NULL DEFAULT 'standard';
ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_texture_tier_check;
ALTER TABLE public.blocks
  ADD CONSTRAINT blocks_texture_tier_check CHECK (texture_tier IN ('standard','premium'));

-- ------ seed_definitions (tree + fungal: 6 texture columns each) ------
ALTER TABLE public.seed_definitions
  ADD COLUMN IF NOT EXISTS trunk_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS branch_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS fruit_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS fungal_stem_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS fungal_cap_top_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS fungal_cap_underside_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS texture_tier text NOT NULL DEFAULT 'standard';
ALTER TABLE public.seed_definitions DROP CONSTRAINT IF EXISTS seed_definitions_texture_tier_check;
ALTER TABLE public.seed_definitions
  ADD CONSTRAINT seed_definitions_texture_tier_check CHECK (texture_tier IN ('standard','premium'));

-- ------ shombie_definitions ------
ALTER TABLE public.shombie_definitions
  ADD COLUMN IF NOT EXISTS texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS texture_tier text NOT NULL DEFAULT 'standard';
ALTER TABLE public.shombie_definitions DROP CONSTRAINT IF EXISTS shombie_definitions_texture_tier_check;
ALTER TABLE public.shombie_definitions
  ADD CONSTRAINT shombie_definitions_texture_tier_check CHECK (texture_tier IN ('standard','premium'));

-- ------ shwarm_definitions ------
ALTER TABLE public.shwarm_definitions
  ADD COLUMN IF NOT EXISTS texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS texture_tier text NOT NULL DEFAULT 'standard';
ALTER TABLE public.shwarm_definitions DROP CONSTRAINT IF EXISTS shwarm_definitions_texture_tier_check;
ALTER TABLE public.shwarm_definitions
  ADD CONSTRAINT shwarm_definitions_texture_tier_check CHECK (texture_tier IN ('standard','premium'));

-- ------ shnake_definitions (3 parts) ------
ALTER TABLE public.shnake_definitions
  ADD COLUMN IF NOT EXISTS head_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS body_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS face_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS texture_tier text NOT NULL DEFAULT 'standard';
ALTER TABLE public.shnake_definitions DROP CONSTRAINT IF EXISTS shnake_definitions_texture_tier_check;
ALTER TABLE public.shnake_definitions
  ADD CONSTRAINT shnake_definitions_texture_tier_check CHECK (texture_tier IN ('standard','premium'));

-- ------ walapa_definitions (3 parts) ------
ALTER TABLE public.walapa_definitions
  ADD COLUMN IF NOT EXISTS head_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS body_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS face_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS texture_tier text NOT NULL DEFAULT 'standard';
ALTER TABLE public.walapa_definitions DROP CONSTRAINT IF EXISTS walapa_definitions_texture_tier_check;
ALTER TABLE public.walapa_definitions
  ADD CONSTRAINT walapa_definitions_texture_tier_check CHECK (texture_tier IN ('standard','premium'));

-- ------ shtickman_definitions (3 parts) — included for future-proofing ------
ALTER TABLE public.shtickman_definitions
  ADD COLUMN IF NOT EXISTS head_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS body_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS face_texture_url_ktx2 text,
  ADD COLUMN IF NOT EXISTS texture_tier text NOT NULL DEFAULT 'standard';
ALTER TABLE public.shtickman_definitions DROP CONSTRAINT IF EXISTS shtickman_definitions_texture_tier_check;
ALTER TABLE public.shtickman_definitions
  ADD CONSTRAINT shtickman_definitions_texture_tier_check CHECK (texture_tier IN ('standard','premium'));
