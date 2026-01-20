-- Phase 5: Create ownership-verified RPC for tree deletion

CREATE OR REPLACE FUNCTION public.delete_tree_with_blocks(
  p_tree_id UUID,
  p_user_id UUID,
  p_world_id UUID,
  p_block_positions JSONB
) RETURNS JSONB AS $$
DECLARE
  deleted_count INTEGER := 0;
  tree_owner UUID;
BEGIN
  -- Verify ownership
  SELECT planted_by INTO tree_owner FROM public.planted_trees WHERE id = p_tree_id;
  IF tree_owner IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tree not found');
  END IF;
  IF tree_owner != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not owner');
  END IF;
  
  -- Delete blocks at positions OWNED BY THIS USER (critical security check)
  WITH deleted AS (
    DELETE FROM public.placed_blocks
    WHERE user_id = p_user_id
      AND world_id = p_world_id
      AND (position_x::int, position_y::int, position_z::int) IN (
        SELECT (pos->>'x')::int, (pos->>'y')::int, (pos->>'z')::int
        FROM jsonb_array_elements(p_block_positions) AS pos
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  -- Delete overlaps for this tree (cascades automatically, but be explicit)
  DELETE FROM public.block_overlaps WHERE tree_id = p_tree_id;
  
  -- Delete blueprint (cascades automatically, but be explicit)
  DELETE FROM public.tree_blueprints WHERE planted_tree_id = p_tree_id;
  
  -- Delete tree record
  DELETE FROM public.planted_trees WHERE id = p_tree_id;
  
  RETURN jsonb_build_object('success', true, 'deleted_count', deleted_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;