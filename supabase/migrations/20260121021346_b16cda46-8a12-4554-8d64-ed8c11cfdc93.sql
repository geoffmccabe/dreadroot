-- Clean up remaining blocks with wrong t19 texture on t13 tree
DELETE FROM placed_blocks 
WHERE block_type LIKE '%_13' 
AND texture_url = 'https://ditecxjpkgbqkeckebzb.supabase.co/storage/v1/object/public/block-textures/seed_19_trunk_1768690922662.webp';

-- Also clean up any remaining legacy 'trunk' blocks with null texture
DELETE FROM placed_blocks 
WHERE block_type = 'trunk' 
AND texture_url IS NULL;