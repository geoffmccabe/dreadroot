-- Delete ALL trunk/branch blocks that have no parent in tree_blocks
-- Since tree_blocks is empty, this deletes ALL tree blocks
DELETE FROM placed_blocks 
WHERE block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom');

-- Force chunk refetch
UPDATE chunk_versions 
SET version = version + 200000,
    updated_at = now();