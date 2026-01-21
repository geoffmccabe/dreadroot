-- Delete ghost t19 tree blocks (legacy unencoded 'trunk' blocks with t19 texture)
DELETE FROM placed_blocks 
WHERE block_type = 'trunk' 
AND texture_url = 'https://ditecxjpkgbqkeckebzb.supabase.co/storage/v1/object/public/block-textures/seed_19_trunk_1768690922662.webp';

-- Also delete any remaining legacy 'branch' blocks with t19 texture
DELETE FROM placed_blocks 
WHERE block_type = 'branch' 
AND texture_url = 'https://ditecxjpkgbqkeckebzb.supabase.co/storage/v1/object/public/block-textures/seed_19_trunk_1768690922662.webp';

-- Update t13 branch blocks that have null texture to use trunk texture  
-- This fixes existing blocks with wrong/missing textures
UPDATE placed_blocks 
SET texture_url = 'https://ditecxjpkgbqkeckebzb.supabase.co/storage/v1/object/public/block-textures/seed_13_trunk_1768699483817.webp'
WHERE (block_type LIKE 'b_%_13' OR block_type LIKE 'ib_%_13')
AND texture_url IS NULL;