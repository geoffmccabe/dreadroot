-- Fix decoration blocks (spikes, shrooms) with null texture to use trunk texture
UPDATE placed_blocks 
SET texture_url = 'https://ditecxjpkgbqkeckebzb.supabase.co/storage/v1/object/public/block-textures/seed_13_trunk_1768699483817.webp'
WHERE (block_type LIKE 's_%_13' OR block_type LIKE 'ss_%_13' OR block_type LIKE 'sc_%_13' OR block_type LIKE 'n_%_13' OR block_type LIKE 'x_%_13')
AND texture_url IS NULL;