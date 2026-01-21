-- Clear non-webp texture URLs so they fall back to tier colors
-- User can re-upload in admin panel which will auto-convert to 512x512 webp

UPDATE shnake_definitions 
SET head_texture_url = NULL 
WHERE head_texture_url IS NOT NULL AND head_texture_url NOT LIKE '%.webp';

UPDATE shnake_definitions 
SET body_texture_url = NULL 
WHERE body_texture_url IS NOT NULL AND body_texture_url NOT LIKE '%.webp';

UPDATE shnake_definitions 
SET face_texture_url = NULL 
WHERE face_texture_url IS NOT NULL AND face_texture_url NOT LIKE '%.webp';