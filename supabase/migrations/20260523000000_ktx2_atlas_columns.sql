-- =====================================================================
-- KTX2 atlas system — Phase 1: parallel columns
-- =====================================================================
-- Adds `<existing>_url_ktx2` siblings for every texture URL the atlas
-- consumes, plus a per-row `texture_tier` ('standard' or 'premium').
-- Existing columns are NOT touched.
--
-- Defensive: each table is wrapped in a guard so missing tables are
-- skipped instead of erroring. Idempotent — safe to re-run.
-- =====================================================================

DO $ktx2$
DECLARE
  v_tbl text;
  v_tables text[] := ARRAY[
    'blocks',
    'seed_definitions',
    'shombie_definitions',
    'shwarm_definitions',
    'shnake_definitions',
    'walapa_definitions',
    'shtickman_definitions'
  ];
  v_cols jsonb := '{
    "blocks":                ["texture_url"],
    "seed_definitions":      ["trunk_texture_url","branch_texture_url","fruit_texture_url","fungal_stem_texture_url","fungal_cap_top_texture_url","fungal_cap_underside_texture_url"],
    "shombie_definitions":   ["texture_url"],
    "shwarm_definitions":    ["texture_url"],
    "shnake_definitions":    ["head_texture_url","body_texture_url","face_texture_url"],
    "walapa_definitions":    ["head_texture_url","body_texture_url","face_texture_url"],
    "shtickman_definitions": ["head_texture_url","body_texture_url","face_texture_url"]
  }'::jsonb;
  v_col text;
  v_constraint_name text;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      RAISE NOTICE 'skipping %, table does not exist', v_tbl;
      CONTINUE;
    END IF;

    -- Per-table _ktx2 columns.
    FOR v_col IN SELECT jsonb_array_elements_text(v_cols->v_tbl) LOOP
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text',
        v_tbl, v_col || '_ktx2'
      );
    END LOOP;

    -- texture_tier column + CHECK constraint.
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS texture_tier text NOT NULL DEFAULT ''standard''',
      v_tbl
    );
    v_constraint_name := v_tbl || '_texture_tier_check';
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      v_tbl, v_constraint_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (texture_tier IN (''standard'',''premium''))',
      v_tbl, v_constraint_name
    );

    RAISE NOTICE 'updated %', v_tbl;
  END LOOP;
END
$ktx2$;
