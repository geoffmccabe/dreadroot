-- Update Waterfall Token to Waterfall Coin
UPDATE public.token_themes 
SET coin_name = 'Waterfall Coin' 
WHERE coin_name = 'Waterfall Token';

-- Create bulk delete function for tree blocks
CREATE OR REPLACE FUNCTION public.delete_tree_blocks(
  p_world_id UUID,
  p_positions JSONB
) RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH positions_to_delete AS (
    SELECT 
      (elem->>'x')::real AS px,
      (elem->>'y')::real AS py,
      (elem->>'z')::real AS pz
    FROM jsonb_array_elements(p_positions) AS elem
  )
  DELETE FROM public.placed_blocks pb
  USING positions_to_delete ptd
  WHERE pb.world_id = p_world_id
    AND pb.position_x = ptd.px
    AND pb.position_y = ptd.py
    AND pb.position_z = ptd.pz;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;