-- =====================================================================
-- Seeds must grow. Period.
-- =====================================================================
-- Three changes:
--   1. plant_seed_with_blueprint() RPC — atomic insert of planted_trees
--      + tree_blueprints in one transaction. If either fails, the whole
--      thing rolls back. No orphaned trees with no blueprint.
--   2. process_tree_growth() — fixed: completion is time-based, not
--      block-count-based. The old logic only marked a tree
--      `is_fully_grown=true` when every blueprint block existed in
--      placed_blocks, so if a player ever destroyed one block, the tree
--      stayed "growing" forever and was reprocessed every tick. Cheap
--      O(1) current_block_count update replaces the heavy cross-join.
--   3. pg_cron re-enabled at 1-minute cadence. Function early-exits in
--      the FOR loop when no trees match `is_fully_grown=false`, so this
--      is ~free when nothing is growing.
-- =====================================================================

-- One-time: any zombie trees older than a day are definitely done.
UPDATE public.planted_trees
SET is_fully_grown = true
WHERE is_fully_grown = false
  AND planted_at < now() - interval '24 hours';


-- ---------------------------------------------------------------------
-- 1. Atomic plant_seed_with_blueprint
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.plant_seed_with_blueprint(uuid, uuid, uuid, integer, integer, integer, integer, integer, integer, jsonb);

CREATE OR REPLACE FUNCTION public.plant_seed_with_blueprint(
  p_world_id           uuid,
  p_user_id            uuid,
  p_seed_definition_id uuid,
  p_base_x             integer,
  p_base_y             integer,
  p_base_z             integer,
  p_growth_seed        integer,
  p_target_block_count integer,
  p_first_block_count  integer,
  p_blueprint_data     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tree_id uuid;
  v_block_count integer;
BEGIN
  -- Auth check: caller must match the user they're planting as.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_block_count := jsonb_array_length(p_blueprint_data->'blocks');

  -- planted_trees first (so blueprint FK is valid).
  INSERT INTO public.planted_trees (
    world_id, seed_definition_id, planted_by,
    base_x, base_y, base_z, growth_seed,
    target_block_count, current_block_count, is_fully_grown
  ) VALUES (
    p_world_id, p_seed_definition_id, p_user_id,
    p_base_x, p_base_y, p_base_z, p_growth_seed,
    p_target_block_count, p_first_block_count, false
  )
  RETURNING id INTO v_tree_id;

  -- blueprint in the same transaction. Any failure here (CHECK
  -- constraint, FK, etc.) rolls back the planted_trees insert too.
  INSERT INTO public.tree_blueprints (
    planted_tree_id, world_id, blueprint_data, block_count
  ) VALUES (
    v_tree_id, p_world_id, p_blueprint_data, v_block_count
  );

  RETURN jsonb_build_object(
    'tree_id', v_tree_id,
    'block_count', v_block_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.plant_seed_with_blueprint(uuid, uuid, uuid, integer, integer, integer, integer, integer, integer, jsonb) TO authenticated;


-- ---------------------------------------------------------------------
-- 2. process_tree_growth — zombie-free + cheap completion
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_tree_growth()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tree RECORD;
  v_block RECORD;
  v_elapsed_ms NUMERIC;
  v_growth_interval_ms NUMERIC;
  v_expected_orders INTEGER;
  v_max_order INTEGER;
  v_inserted_count INTEGER := 0;
  v_trees_processed INTEGER := 0;
  v_trees_completed INTEGER := 0;
  v_total_blocks_inserted INTEGER := 0;
  v_base_interval NUMERIC;
  v_testing_mode BOOLEAN;
  v_speed_mult NUMERIC;
  v_max_trees INTEGER;
  v_max_blocks_per_tree INTEGER;
  v_encoded_type TEXT;
  v_texture_url TEXT;
  v_chunk_x INTEGER;
  v_chunk_z INTEGER;
  v_chunks_to_update JSONB := '[]'::JSONB;
  v_chunk JSONB;
BEGIN
  v_base_interval := get_growth_config('base_growth_interval_ms');
  v_testing_mode := get_growth_config('testing_mode') = 1;
  v_speed_mult := get_growth_config('speed_multiplier');
  v_max_trees := get_growth_config('max_trees_per_run');
  v_max_blocks_per_tree := get_growth_config('max_blocks_per_tree');

  FOR v_tree IN
    SELECT
      pt.id, pt.world_id, pt.planted_by, pt.planted_at,
      pt.target_block_count,
      sd.growth_factor, sd.tier,
      sd.trunk_texture_url, sd.branch_texture_url, sd.fruit_texture_url,
      sd.tree_type,
      sd.fungal_stem_texture_url, sd.fungal_cap_top_texture_url,
      sd.fungal_cap_underside_texture_url,
      tb.blueprint_data
    FROM planted_trees pt
    JOIN seed_definitions sd ON pt.seed_definition_id = sd.id
    JOIN tree_blueprints tb  ON tb.planted_tree_id    = pt.id
    WHERE pt.is_fully_grown = false
    ORDER BY pt.planted_at ASC
    LIMIT v_max_trees
  LOOP
    v_trees_processed := v_trees_processed + 1;
    v_inserted_count := 0;
    v_chunks_to_update := '[]'::JSONB;

    v_elapsed_ms := EXTRACT(EPOCH FROM (now() - v_tree.planted_at)) * 1000;
    v_growth_interval_ms := v_base_interval / GREATEST(COALESCE(v_tree.growth_factor, 0.5), 0.01);
    IF v_testing_mode THEN
      v_growth_interval_ms := v_growth_interval_ms / v_speed_mult;
    END IF;
    v_expected_orders := FLOOR(v_elapsed_ms / GREATEST(v_growth_interval_ms, 1));

    SELECT COALESCE(MAX((b->>'growthOrder')::INTEGER), 0)
      INTO v_max_order
      FROM jsonb_array_elements(v_tree.blueprint_data->'blocks') AS b;

    IF v_expected_orders > v_max_order THEN
      v_expected_orders := v_max_order;
    END IF;

    FOR v_block IN
      SELECT
        (b->>'x')::INTEGER  AS x,
        (b->>'y')::INTEGER  AS y,
        (b->>'z')::INTEGER  AS z,
        b->>'type'          AS block_type,
        COALESCE((b->>'branchDepth')::INTEGER, -1) AS branch_depth,
        (b->>'growthOrder')::INTEGER AS growth_order
      FROM jsonb_array_elements(v_tree.blueprint_data->'blocks') AS b
      WHERE (b->>'growthOrder')::INTEGER <= v_expected_orders
        AND NOT EXISTS (
          SELECT 1 FROM placed_blocks pb
           WHERE pb.world_id   = v_tree.world_id
             AND pb.position_x = (b->>'x')::INTEGER
             AND pb.position_y = (b->>'y')::INTEGER
             AND pb.position_z = (b->>'z')::INTEGER
        )
      ORDER BY (b->>'growthOrder')::INTEGER ASC
      LIMIT v_max_blocks_per_tree
    LOOP
      v_encoded_type := CASE v_block.block_type
        WHEN 'trunk'                THEN 't'
        WHEN 'branch'               THEN 'b'
        WHEN 'root'                 THEN 'r'
        WHEN 'leaf'                 THEN 'l'
        WHEN 'spike'                THEN 's'
        WHEN 'nob'                  THEN 'n'
        WHEN 'cross'                THEN 'x'
        WHEN 'shroom'               THEN 'sm'
        WHEN 'shroom_stem'          THEN 'ss'
        WHEN 'shroom_cap'           THEN 'sc'
        WHEN 'invisiblock'          THEN 'ib'
        WHEN 'glow_bark'            THEN 'gb'
        WHEN 'fruit'                THEN 'f'
        WHEN 'shrine'               THEN 'shr'
        WHEN 'fungal_stem'          THEN 'fs'
        WHEN 'fungal_cap_top'       THEN 'fct'
        WHEN 'fungal_cap_underside' THEN 'fcu'
        ELSE 't'
      END || '_' || v_block.branch_depth::TEXT || '_' || v_tree.tier::TEXT;

      IF COALESCE(v_tree.tree_type, 'original') = 'fungal' THEN
        v_texture_url := CASE v_block.block_type
          WHEN 'trunk'                THEN COALESCE(v_tree.fungal_stem_texture_url, v_tree.trunk_texture_url)
          WHEN 'fungal_stem'          THEN COALESCE(v_tree.fungal_stem_texture_url, v_tree.trunk_texture_url)
          WHEN 'branch'               THEN COALESCE(v_tree.fungal_stem_texture_url, v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'fungal_cap_top'       THEN COALESCE(v_tree.fungal_cap_top_texture_url, v_tree.trunk_texture_url)
          WHEN 'fungal_cap_underside' THEN COALESCE(v_tree.fungal_cap_underside_texture_url, v_tree.trunk_texture_url)
          WHEN 'shroom_cap'           THEN COALESCE(v_tree.fungal_cap_top_texture_url, v_tree.trunk_texture_url)
          WHEN 'shroom_stem'          THEN COALESCE(v_tree.fungal_cap_underside_texture_url, v_tree.trunk_texture_url)
          WHEN 'root'                 THEN COALESCE(v_tree.fungal_stem_texture_url, v_tree.trunk_texture_url)
          ELSE COALESCE(v_tree.fungal_stem_texture_url, v_tree.trunk_texture_url)
        END;
      ELSE
        v_texture_url := CASE v_block.block_type
          WHEN 'trunk'        THEN v_tree.trunk_texture_url
          WHEN 'root'         THEN v_tree.trunk_texture_url
          WHEN 'branch'       THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'spike'        THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'nob'          THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'cross'        THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'shroom_stem'  THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'shroom_cap'   THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'glow_bark'    THEN v_tree.trunk_texture_url
          WHEN 'leaf'         THEN COALESCE(v_tree.fruit_texture_url, v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'fruit'        THEN COALESCE(v_tree.fruit_texture_url, v_tree.branch_texture_url, v_tree.trunk_texture_url)
          ELSE v_tree.trunk_texture_url
        END;
      END IF;

      v_chunk_x := FLOOR(v_block.x::NUMERIC / 16);
      v_chunk_z := FLOOR(v_block.z::NUMERIC / 16);

      INSERT INTO placed_blocks (
        world_id, user_id, position_x, position_y, position_z,
        block_type, texture_url
      ) VALUES (
        v_tree.world_id, v_tree.planted_by,
        v_block.x, v_block.y, v_block.z,
        v_encoded_type, v_texture_url
      )
      ON CONFLICT (world_id, position_x, position_y, position_z) DO NOTHING;

      IF FOUND THEN
        v_inserted_count := v_inserted_count + 1;
        IF NOT v_chunks_to_update @> jsonb_build_array(jsonb_build_object('x', v_chunk_x, 'z', v_chunk_z)) THEN
          v_chunks_to_update := v_chunks_to_update || jsonb_build_array(jsonb_build_object('x', v_chunk_x, 'z', v_chunk_z));
        END IF;
      END IF;
    END LOOP;

    v_total_blocks_inserted := v_total_blocks_inserted + v_inserted_count;

    -- Bump chunk_versions for realtime sync.
    IF v_inserted_count > 0 THEN
      FOR v_chunk IN SELECT * FROM jsonb_array_elements(v_chunks_to_update)
      LOOP
        INSERT INTO chunk_versions (world_id, chunk_x, chunk_z, version, updated_at)
        VALUES (
          v_tree.world_id,
          (v_chunk->>'x')::INTEGER,
          (v_chunk->>'z')::INTEGER,
          1, now()
        )
        ON CONFLICT (world_id, chunk_x, chunk_z)
        DO UPDATE SET version = chunk_versions.version + 1, updated_at = now();
      END LOOP;
    END IF;

    -- O(1) running tally — no cross-join.
    UPDATE planted_trees
    SET current_block_count = current_block_count + v_inserted_count,
        last_growth_at = now()
    WHERE id = v_tree.id;

    -- TIME-BASED completion. If enough time has elapsed for every growth
    -- order, the tree is done — full stop. Player block destruction does
    -- NOT keep the tree "growing" forever.
    IF v_expected_orders >= v_max_order THEN
      UPDATE planted_trees
      SET is_fully_grown = true
      WHERE id = v_tree.id;
      v_trees_completed := v_trees_completed + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'trees_processed', v_trees_processed,
    'trees_completed', v_trees_completed,
    'total_blocks_inserted', v_total_blocks_inserted,
    'timestamp', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_tree_growth() TO service_role;

-- trigger_tree_growth wrapper for the client poller. Re-create to make
-- sure it's pointing at the new function body.
CREATE OR REPLACE FUNCTION public.trigger_tree_growth()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN process_tree_growth();
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_tree_growth() TO authenticated;


-- ---------------------------------------------------------------------
-- 3. Re-enable cron (every minute). Function is cheap when no trees
--    are growing — FOR loop body never runs.
-- ---------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process_tree_growth') THEN
    PERFORM cron.unschedule('process_tree_growth');
  END IF;
  PERFORM cron.schedule(
    'process_tree_growth',
    '* * * * *',
    $$SELECT process_tree_growth()$$
  );
END
$cron$;
