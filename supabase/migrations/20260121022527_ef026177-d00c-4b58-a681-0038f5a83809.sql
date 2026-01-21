
-- Remove orphaned T13 trunk block at (38, 0, 23) - ghost seed with no parent tree
DELETE FROM placed_blocks 
WHERE id = '9338f2a8-6158-4779-8d24-416b06c3024c';
