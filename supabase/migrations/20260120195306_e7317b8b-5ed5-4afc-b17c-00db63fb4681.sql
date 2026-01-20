
-- Delete orphaned legacy 'trunk' and 'branch' blocks (ghost trees from old system)
DELETE FROM placed_blocks 
WHERE block_type IN ('trunk', 'branch');

-- Delete planted_trees that don't have blueprints (orphaned tree records)
DELETE FROM planted_trees 
WHERE id NOT IN (SELECT planted_tree_id FROM tree_blueprints);
