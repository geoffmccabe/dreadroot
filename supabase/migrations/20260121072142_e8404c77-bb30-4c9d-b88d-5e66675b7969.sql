-- Fix T1 and T5 shnake textures that are still .psd format
-- Set them to NULL so fallback colors are used until re-uploaded as webp

UPDATE shnake_definitions 
SET head_texture_url = NULL, body_texture_url = NULL
WHERE tier = 1 
  AND (head_texture_url LIKE '%.psd' OR body_texture_url LIKE '%.psd');

UPDATE shnake_definitions 
SET head_texture_url = NULL
WHERE tier = 5 
  AND head_texture_url LIKE '%.psd';