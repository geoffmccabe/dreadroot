-- Delete ALL orphan tree-related blocks (727 blocks with no parent tree)
DELETE FROM placed_blocks 
WHERE block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom', 'invisibleblock');

-- Ensure tree tables are clean
DELETE FROM tree_blocks;
DELETE FROM planted_trees;

-- Force all clients to refetch by bumping chunk versions significantly
UPDATE chunk_versions 
SET version = version + 10000, 
    updated_at = now();