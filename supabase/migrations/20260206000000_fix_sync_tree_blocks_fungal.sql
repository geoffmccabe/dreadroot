-- Migration: Fix sync_missing_tree_blocks to handle fungal tree block types
-- The previous version didn't have cases for fungal_stem, fungal_cap_top,
-- fungal_cap_underside, glow_bark, or root block types, causing them to
-- default to trunk with wrong textures.

-- Drop and recreate the function with fixed block type handling
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
  v_raw_type text;
BEGIN
  -- Get the tree record with all seed definition textures
  SELECT
    pt.*,
    sd.tier,
    sd.tree_type,
    sd.trunk_texture_url,
    sd.branch_texture_url,
    sd.fruit_texture_url,
    sd.fungal_stem_texture_url,
    sd.fungal_cap_top_texture_url,
    sd.fungal_cap_underside_texture_url
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
    SELECT * FROM json_array_elements(v_blueprint_data->'blocks') AS b
  LOOP
    v_raw_type := v_block.b->>'type';

    -- Determine block type encoding (short code format)
    -- This must match the encoder in blockTypeEncoder.ts
    v_block_type := CASE v_raw_type
      -- Original tree types
      WHEN 'trunk' THEN 't'
      WHEN 'branch' THEN 'b'
      WHEN 'leaf' THEN 'l'
      WHEN 'spike' THEN 's'
      WHEN 'nob' THEN 'n'
      WHEN 'cross' THEN 'x'
      WHEN 'fruit' THEN 'f'
      WHEN 'invisiblock' THEN 'ib'
      -- Shroom types (for original trees with shroom decorations)
      WHEN 'shroom' THEN 'sm'
      WHEN 'shroom_stem' THEN 'ss'
      WHEN 'shroom_cap' THEN 'sc'
      -- Fungal tree types
      WHEN 'fungal_stem' THEN 'fs'
      WHEN 'fungal_cap_top' THEN 'fct'
      WHEN 'fungal_cap_underside' THEN 'fcu'
      -- Additional types
      WHEN 'glow_bark' THEN 'gb'
      WHEN 'root' THEN 'r'
      WHEN 'shrine' THEN 'sh'
      ELSE 't'
    END || '_' || COALESCE(v_block.b->>'branchDepth', '0') || '_' || v_tree_record.tier::text;

    -- Determine texture URL based on block type
    v_texture_url := CASE v_raw_type
      -- Original tree types
      WHEN 'trunk' THEN v_tree_record.trunk_texture_url
      WHEN 'branch' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'spike' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'nob' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'cross' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'shroom_stem' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'shroom_cap' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'leaf' THEN COALESCE(v_tree_record.fruit_texture_url, v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'fruit' THEN COALESCE(v_tree_record.fruit_texture_url, v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      -- Fungal tree types
      WHEN 'fungal_stem' THEN COALESCE(v_tree_record.fungal_stem_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'fungal_cap_top' THEN COALESCE(v_tree_record.fungal_cap_top_texture_url, v_tree_record.fungal_stem_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'fungal_cap_underside' THEN COALESCE(v_tree_record.fungal_cap_underside_texture_url, v_tree_record.fungal_stem_texture_url, v_tree_record.trunk_texture_url)
      -- Additional types
      WHEN 'glow_bark' THEN COALESCE(v_tree_record.branch_texture_url, v_tree_record.trunk_texture_url)
      WHEN 'root' THEN COALESCE(v_tree_record.trunk_texture_url, v_tree_record.branch_texture_url)
      -- Invisiblocks have no texture
      WHEN 'invisiblock' THEN NULL
      -- Default fallback
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.sync_missing_tree_blocks(uuid, uuid) TO authenticated;
