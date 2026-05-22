-- Migration: Add RPC function to restore missing tree blocks from blueprints
-- This fixes trees that show metadata (seed text) but have missing blocks

-- Function to restore missing tree blocks from tree_blueprints
-- This uses the stored blueprint to insert any blocks that are missing from placed_blocks
CREATE OR REPLACE FUNCTION public.sync_missing_tree_blocks(
  p_world_id uuid,
  p_tree_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blueprint_data json;
  v_tree_record record;
  v_seed_def record;
  v_block record;
  v_inserted_count int := 0;
  v_skipped_count int := 0;
  v_block_type text;
  v_texture_url text;
BEGIN
  -- Get the tree record
  SELECT pt.*, sd.tier, sd.trunk_texture_url, sd.branch_texture_url, sd.fruit_texture_url
  INTO v_tree_record
  FROM planted_trees pt
  JOIN seed_definitions sd ON pt.seed_definition_id = sd.id
  WHERE pt.id = p_tree_id AND pt.world_id = p_world_id;

  IF v_tree_record IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Tree not found');
  END IF;

  -- Get the blueprint
  SELECT blueprint_data INTO v_blueprint_data
  FROM tree_blueprints
  WHERE planted_tree_id = p_tree_id;

  IF v_blueprint_data IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Blueprint not found for tree');
  END IF;

  -- Iterate through blueprint blocks and insert any that are missing
  FOR v_block IN
    SELECT value AS b FROM json_array_elements(v_blueprint_data->'blocks')
  LOOP
    -- Determine block type encoding (short code format: t=trunk, b=branch, l=leaf, etc.)
    v_block_type := CASE (v_block.b->>'type')
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
    END || '_' || COALESCE(v_block.b->>'branchDepth', '0') || '_' || v_tree_record.tier::text;

    -- Determine texture URL based on block type
    v_texture_url := CASE (v_block.b->>'type')
      WHEN 'trunk' THEN v_tree_record.trunk_texture_url
      WHEN 'branch' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'spike' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'nob' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'cross' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'shroom_stem' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'shroom_cap' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'leaf' THEN COALESCE(v_tree_record.fruit_texture_url, v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'fruit' THEN COALESCE(v_tree_record.fruit_texture_url, v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      ELSE v_tree_record.trunk_texture_url
    END;

    -- Try to insert the block (skip if already exists)
    BEGIN
      INSERT INTO placed_blocks (
        world_id,
        user_id,
        position_x,
        position_y,
        position_z,
        block_type,
        texture_url
      )
      VALUES (
        p_world_id,
        v_tree_record.planted_by,
        (v_block.b->>'x')::int,
        (v_block.b->>'y')::int,
        (v_block.b->>'z')::int,
        v_block_type,
        v_texture_url
      )
      ON CONFLICT (world_id, position_x, position_y, position_z) DO NOTHING;

      IF FOUND THEN
        v_inserted_count := v_inserted_count + 1;
      ELSE
        v_skipped_count := v_skipped_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'tree_id', p_tree_id,
    'blocks_inserted', v_inserted_count,
    'blocks_skipped', v_skipped_count
  );
END;
$$;

-- Function to sync all trees in a world that are missing blocks
CREATE OR REPLACE FUNCTION public.sync_all_missing_tree_blocks(
  p_world_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tree record;
  v_result json;
  v_total_inserted int := 0;
  v_trees_processed int := 0;
BEGIN
  -- Process each fully grown tree that has a blueprint
  FOR v_tree IN
    SELECT pt.id
    FROM planted_trees pt
    JOIN tree_blueprints tb ON pt.id = tb.planted_tree_id
    WHERE pt.world_id = p_world_id
      AND pt.is_fully_grown = true
  LOOP
    v_result := sync_missing_tree_blocks(p_world_id, v_tree.id);

    IF (v_result->>'success')::boolean THEN
      v_total_inserted := v_total_inserted + COALESCE((v_result->>'blocks_inserted')::int, 0);
      v_trees_processed := v_trees_processed + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'trees_processed', v_trees_processed,
    'total_blocks_inserted', v_total_inserted
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.sync_missing_tree_blocks(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_all_missing_tree_blocks(uuid) TO authenticated;
