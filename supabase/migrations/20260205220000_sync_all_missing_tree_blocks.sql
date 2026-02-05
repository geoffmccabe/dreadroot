-- Sync all missing tree blocks for all worlds
-- This restores blocks from tree_blueprints for trees marked as fully grown
-- Required because process_tree_growth() was never running (cron was commented out)

-- Loop through all worlds and sync missing tree blocks
DO $$
DECLARE
  v_world RECORD;
  v_result JSON;
  v_total_blocks INTEGER := 0;
  v_total_trees INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting sync of missing tree blocks for all worlds...';

  FOR v_world IN
    SELECT DISTINCT w.id, w.name
    FROM worlds w
    JOIN planted_trees pt ON pt.world_id = w.id
    WHERE pt.is_fully_grown = true
  LOOP
    RAISE NOTICE 'Syncing world: % (%)', v_world.name, v_world.id;

    v_result := sync_all_missing_tree_blocks(v_world.id);

    v_total_blocks := v_total_blocks + COALESCE((v_result->>'total_blocks_inserted')::int, 0);
    v_total_trees := v_total_trees + COALESCE((v_result->>'trees_processed')::int, 0);

    RAISE NOTICE '  Result: % blocks inserted for % trees',
      COALESCE((v_result->>'total_blocks_inserted')::int, 0),
      COALESCE((v_result->>'trees_processed')::int, 0);
  END LOOP;

  RAISE NOTICE 'Sync complete. Total: % blocks inserted across % trees', v_total_blocks, v_total_trees;
END $$;
