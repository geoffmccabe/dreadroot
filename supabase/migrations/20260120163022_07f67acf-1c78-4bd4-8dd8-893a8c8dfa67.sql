-- Phase 2: Server-side planting limit enforcement trigger

CREATE OR REPLACE FUNCTION public.enforce_chunk_planting_limit()
RETURNS TRIGGER AS $$
DECLARE
  chunk_x INTEGER;
  chunk_z INTEGER;
  tree_tier INTEGER;
  current_count INTEGER;
  max_allowed INTEGER;
  tier_min_val INTEGER;
  tier_max_val INTEGER;
BEGIN
  -- Calculate chunk coordinates (16x16 chunks)
  chunk_x := FLOOR(NEW.base_x / 16.0);
  chunk_z := FLOOR(NEW.base_z / 16.0);
  
  -- Get the tier of the seed being planted
  SELECT tier INTO tree_tier FROM public.seed_definitions WHERE id = NEW.seed_definition_id;
  
  -- Get the tier category limits for this seed
  SELECT tier_min, tier_max, max_per_chunk INTO tier_min_val, tier_max_val, max_allowed 
  FROM public.tier_planting_limits
  WHERE tree_tier BETWEEN tier_min AND tier_max 
  LIMIT 1;
  
  -- If no limit found (shouldn't happen), allow the plant
  IF max_allowed IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Count existing trees in this chunk within the same tier category
  SELECT COUNT(*) INTO current_count 
  FROM public.planted_trees pt
  JOIN public.seed_definitions sd ON pt.seed_definition_id = sd.id
  WHERE pt.world_id = NEW.world_id
    AND FLOOR(pt.base_x / 16.0) = chunk_x
    AND FLOOR(pt.base_z / 16.0) = chunk_z
    AND sd.tier BETWEEN tier_min_val AND tier_max_val;
  
  -- Enforce the limit
  IF current_count >= max_allowed THEN
    RAISE EXCEPTION 'Chunk planting limit exceeded: maximum % trees of tier %-% allowed per chunk', 
      max_allowed, tier_min_val, tier_max_val;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create the trigger on planted_trees
DROP TRIGGER IF EXISTS enforce_planting_limit ON public.planted_trees;
CREATE TRIGGER enforce_planting_limit 
  BEFORE INSERT ON public.planted_trees
  FOR EACH ROW 
  EXECUTE FUNCTION public.enforce_chunk_planting_limit();