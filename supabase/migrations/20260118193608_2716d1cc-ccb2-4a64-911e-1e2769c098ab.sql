-- NUCLEAR CLEANUP: Delete ALL tree-related data to eliminate ghost trees

-- Step 1: Delete ALL tree-type blocks from placed_blocks
DELETE FROM placed_blocks 
WHERE block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom');

-- Step 2: Delete ALL tree_blocks records (scaffold data)
DELETE FROM tree_blocks;

-- Step 3: Delete ALL planted_trees records
DELETE FROM planted_trees;

-- Step 4: Bump ALL chunk versions by 1000 to force all clients to refetch
UPDATE chunk_versions SET version = version + 1000;