-- Delete ghost tree blocks (orphaned trunk blocks with no parent tree)
DELETE FROM placed_blocks 
WHERE block_type IN ('trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom');