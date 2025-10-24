-- Restore texture_url for mystery blocks tier 2-30
UPDATE blocks
SET texture_url = 'https://ditecxjpkgbqkeckebzb.supabase.co/storage/v1/object/public/block-textures/3-1761006006042.gif'
WHERE class = 'mystery' 
  AND tier BETWEEN 2 AND 30
  AND texture_url IS NULL;