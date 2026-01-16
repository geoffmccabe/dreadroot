-- Delete corrupted blocks that have UUID block_types instead of proper block keys
DELETE FROM placed_blocks 
WHERE block_type ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';