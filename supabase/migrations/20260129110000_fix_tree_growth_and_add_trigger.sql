-- Fix process_tree_growth: remove chunk_x/chunk_z from INSERT (they are generated columns)
-- Also create trigger_tree_growth wrapper if it doesn't exist

-- Ensure tree_growth_config table exists
CREATE TABLE IF NOT EXISTS public.tree_growth_config (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  description TEXT
);

INSERT INTO public.tree_growth_config (key, value, description) VALUES
  ('base_growth_interval_ms', 10000, 'Base milliseconds per growth order (10 seconds)'),
  ('testing_mode', 1, 'Set to 1 for 100x speed, 0 for normal'),
  ('speed_multiplier', 100, 'Speed multiplier when testing_mode is enabled'),
  ('max_trees_per_run', 50, 'Maximum trees to process per cron run'),
  ('max_blocks_per_tree', 100, 'Maximum blocks to insert per tree per run')
ON CONFLICT (key) DO NOTHING;

-- Function to get growth config value
CREATE OR REPLACE FUNCTION get_growth_config(p_key TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT value FROM public.tree_growth_config WHERE key = p_key;
$$;

-- Fixed process_tree_growth - no chunk_x/chunk_z in INSERT (generated columns)
CREATE OR REPLACE FUNCTION process_tree_growth()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tree RECORD;
  v_blueprint JSONB;
  v_block RECORD;
  v_blocks_to_insert JSONB[];
  v_affected_chunks JSONB;
  v_elapsed_ms NUMERIC;
  v_growth_interval_ms NUMERIC;
  v_expected_orders INTEGER;
  v_max_order INTEGER;
  v_existing_count INTEGER;
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
BEGIN
  -- Load config
  v_base_interval := get_growth_config('base_growth_interval_ms');
  v_testing_mode := get_growth_config('testing_mode') = 1;
  v_speed_mult := get_growth_config('speed_multiplier');
  v_max_trees := get_growth_config('max_trees_per_run');
  v_max_blocks_per_tree := get_growth_config('max_blocks_per_tree');

  -- Process each growing tree
  FOR v_tree IN
    SELECT
      pt.id,
      pt.world_id,
      pt.planted_by,
      pt.planted_at,
      pt.current_block_count,
      pt.target_block_count,
      pt.base_x,
      pt.base_y,
      pt.base_z,
      sd.growth_factor,
      sd.tier,
      sd.trunk_texture_url,
      sd.branch_texture_url,
      sd.fruit_texture_url,
      sd.tree_type,
      sd.fungal_stem_texture_url,
      sd.fungal_cap_top_texture_url,
      sd.fungal_cap_underside_texture_url,
      tb.blueprint_data
    FROM planted_trees pt
    JOIN seed_definitions sd ON pt.seed_definition_id = sd.id
    JOIN tree_blueprints tb ON tb.planted_tree_id = pt.id
    WHERE pt.is_fully_grown = false
    ORDER BY pt.planted_at ASC
    LIMIT v_max_trees
  LOOP
    v_trees_processed := v_trees_processed + 1;
    v_inserted_count := 0;
    v_blocks_to_insert := ARRAY[]::JSONB[];
    v_chunks_to_update := '[]'::JSONB;

    -- Calculate expected growth orders based on elapsed time
    v_elapsed_ms := EXTRACT(EPOCH FROM (now() - v_tree.planted_at)) * 1000;

    -- Apply growth factor and testing mode
    v_growth_interval_ms := v_base_interval / v_tree.growth_factor;
    IF v_testing_mode THEN
      v_growth_interval_ms := v_growth_interval_ms / v_speed_mult;
    END IF;

    v_expected_orders := FLOOR(v_elapsed_ms / v_growth_interval_ms);

    -- Get max growth order from blueprint
    SELECT COALESCE(MAX((b->>'growthOrder')::INTEGER), 0) INTO v_max_order
    FROM jsonb_array_elements(v_tree.blueprint_data->'blocks') AS b;

    -- Cap expected orders at max
    IF v_expected_orders > v_max_order THEN
      v_expected_orders := v_max_order;
    END IF;

    -- Get blocks that should exist but don't
    FOR v_block IN
      SELECT
        (b->>'x')::INTEGER AS x,
        (b->>'y')::INTEGER AS y,
        (b->>'z')::INTEGER AS z,
        b->>'type' AS block_type,
        COALESCE((b->>'branchDepth')::INTEGER, -1) AS branch_depth,
        (b->>'growthOrder')::INTEGER AS growth_order
      FROM jsonb_array_elements(v_tree.blueprint_data->'blocks') AS b
      WHERE (b->>'growthOrder')::INTEGER <= v_expected_orders
      AND NOT EXISTS (
        SELECT 1 FROM placed_blocks pb
        WHERE pb.world_id = v_tree.world_id
        AND pb.position_x = (b->>'x')::INTEGER
        AND pb.position_y = (b->>'y')::INTEGER
        AND pb.position_z = (b->>'z')::INTEGER
      )
      ORDER BY (b->>'growthOrder')::INTEGER ASC
      LIMIT v_max_blocks_per_tree
    LOOP
      -- Encode block type
      v_encoded_type := CASE v_block.block_type
        WHEN 'trunk' THEN 't'
        WHEN 'branch' THEN 'b'
        WHEN 'leaf' THEN 'l'
        WHEN 'spike' THEN 's'
        WHEN 'nob' THEN 'n'
        WHEN 'cross' THEN 'x'
        WHEN 'shroom' THEN 'sm'
        WHEN 'shroom_stem' THEN 'ss'
        WHEN 'shroom_cap' THEN 'sc'
        WHEN 'invisiblock' THEN 'ib'
        WHEN 'fruit' THEN 'f'
        ELSE 't'
      END || '_' || v_block.branch_depth::TEXT || '_' || v_tree.tier::TEXT;

      -- Get texture URL based on block type and tree type
      IF COALESCE(v_tree.tree_type, 'original') = 'fungal' THEN
        v_texture_url := CASE v_block.block_type
          WHEN 'trunk' THEN COALESCE(v_tree.fungal_stem_texture_url, v_tree.trunk_texture_url)
          WHEN 'branch' THEN COALESCE(v_tree.fungal_stem_texture_url, v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'shroom_cap' THEN COALESCE(v_tree.fungal_cap_top_texture_url, v_tree.trunk_texture_url)
          WHEN 'shroom_stem' THEN COALESCE(v_tree.fungal_cap_underside_texture_url, v_tree.trunk_texture_url)
          ELSE COALESCE(v_tree.fungal_stem_texture_url, v_tree.trunk_texture_url)
        END;
      ELSE
        v_texture_url := CASE v_block.block_type
          WHEN 'trunk' THEN v_tree.trunk_texture_url
          WHEN 'branch' THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'spike' THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'nob' THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'cross' THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'shroom_stem' THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'shroom_cap' THEN COALESCE(v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'leaf' THEN COALESCE(v_tree.fruit_texture_url, v_tree.branch_texture_url, v_tree.trunk_texture_url)
          WHEN 'fruit' THEN COALESCE(v_tree.fruit_texture_url, v_tree.branch_texture_url, v_tree.trunk_texture_url)
          ELSE v_tree.trunk_texture_url
        END;
      END IF;

      -- Calculate chunk coordinates (for version tracking only, not inserted)
      v_chunk_x := FLOOR(v_block.x::NUMERIC / 16);
      v_chunk_z := FLOOR(v_block.z::NUMERIC / 16);

      -- Insert the block (chunk_x/chunk_z are generated columns, omitted)
      INSERT INTO placed_blocks (
        world_id,
        user_id,
        position_x,
        position_y,
        position_z,
        block_type,
        texture_url
      ) VALUES (
        v_tree.world_id,
        v_tree.planted_by,
        v_block.x,
        v_block.y,
        v_block.z,
        v_encoded_type,
        v_texture_url
      )
      ON CONFLICT (world_id, position_x, position_y, position_z) DO NOTHING;

      IF FOUND THEN
        v_inserted_count := v_inserted_count + 1;

        -- Track affected chunks for version bump
        IF NOT v_chunks_to_update @> jsonb_build_array(jsonb_build_object('x', v_chunk_x, 'z', v_chunk_z)) THEN
          v_chunks_to_update := v_chunks_to_update || jsonb_build_array(jsonb_build_object('x', v_chunk_x, 'z', v_chunk_z));
        END IF;
      END IF;
    END LOOP;

    v_total_blocks_inserted := v_total_blocks_inserted + v_inserted_count;

    -- Update chunk versions for realtime notifications
    IF v_inserted_count > 0 THEN
      FOR v_block IN SELECT * FROM jsonb_array_elements(v_chunks_to_update)
      LOOP
        INSERT INTO chunk_versions (world_id, chunk_x, chunk_z, version, updated_at)
        VALUES (
          v_tree.world_id,
          (v_block.value->>'x')::INTEGER,
          (v_block.value->>'z')::INTEGER,
          1,
          now()
        )
        ON CONFLICT (world_id, chunk_x, chunk_z)
        DO UPDATE SET version = chunk_versions.version + 1, updated_at = now();
      END LOOP;
    END IF;

    -- Count actual blocks placed for this tree
    SELECT COUNT(*) INTO v_existing_count
    FROM placed_blocks pb
    WHERE pb.world_id = v_tree.world_id
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tree.blueprint_data->'blocks') AS b
      WHERE pb.position_x = (b->>'x')::INTEGER
      AND pb.position_y = (b->>'y')::INTEGER
      AND pb.position_z = (b->>'z')::INTEGER
    );

    -- Update tree's current block count
    UPDATE planted_trees
    SET
      current_block_count = v_existing_count,
      last_growth_at = now()
    WHERE id = v_tree.id;

    -- Check if tree is now fully grown
    IF v_expected_orders >= v_max_order THEN
      IF v_existing_count >= v_tree.target_block_count THEN
        UPDATE planted_trees
        SET is_fully_grown = true
        WHERE id = v_tree.id;

        v_trees_completed := v_trees_completed + 1;
      END IF;
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

-- Grant execute to service role (for cron/edge functions)
GRANT EXECUTE ON FUNCTION process_tree_growth() TO service_role;

-- Create trigger_tree_growth wrapper for authenticated users
CREATE OR REPLACE FUNCTION trigger_tree_growth()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN process_tree_growth();
END;
$$;

-- Grant to authenticated users for client-side polling
GRANT EXECUTE ON FUNCTION trigger_tree_growth() TO authenticated;

-- Create index to speed up finding growing trees
CREATE INDEX IF NOT EXISTS idx_planted_trees_growing_ordered
ON planted_trees(planted_at ASC)
WHERE is_fully_grown = false;
