-- RPC function to update textures on all placed blocks for a given fungal tree tier.
-- Called from the Seed Design Panel when admin wants to propagate texture changes
-- to already-grown fungal trees.

CREATE OR REPLACE FUNCTION update_fungal_tree_textures(
  p_tier INTEGER,
  p_stem_texture_url TEXT,
  p_cap_top_texture_url TEXT,
  p_cap_underside_texture_url TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stem_updated INTEGER := 0;
  v_cap_top_updated INTEGER := 0;
  v_cap_underside_updated INTEGER := 0;
  v_tier_text TEXT := p_tier::TEXT;
BEGIN
  -- Update fungal_stem blocks: block_type matches 'fs_*_<tier>' pattern
  -- The block_type format is: fs_{depth}_{tier} (e.g., fs_-1_5, fs_0_5)
  UPDATE placed_blocks
  SET texture_url = p_stem_texture_url
  WHERE block_type LIKE 'fs_%_' || v_tier_text
  AND (texture_url IS DISTINCT FROM p_stem_texture_url);
  GET DIAGNOSTICS v_stem_updated = ROW_COUNT;

  -- Update fungal_cap_top blocks: block_type matches 'fct_*_<tier>'
  UPDATE placed_blocks
  SET texture_url = p_cap_top_texture_url
  WHERE block_type LIKE 'fct_%_' || v_tier_text
  AND (texture_url IS DISTINCT FROM p_cap_top_texture_url);
  GET DIAGNOSTICS v_cap_top_updated = ROW_COUNT;

  -- Update fungal_cap_underside blocks: block_type matches 'fcu_*_<tier>'
  UPDATE placed_blocks
  SET texture_url = p_cap_underside_texture_url
  WHERE block_type LIKE 'fcu_%_' || v_tier_text
  AND (texture_url IS DISTINCT FROM p_cap_underside_texture_url);
  GET DIAGNOSTICS v_cap_underside_updated = ROW_COUNT;

  RETURN json_build_object(
    'success', true,
    'tier', p_tier,
    'stem_updated', v_stem_updated,
    'cap_top_updated', v_cap_top_updated,
    'cap_underside_updated', v_cap_underside_updated,
    'total_updated', v_stem_updated + v_cap_top_updated + v_cap_underside_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION update_fungal_tree_textures(INTEGER, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_fungal_tree_textures(INTEGER, TEXT, TEXT, TEXT) TO service_role;
