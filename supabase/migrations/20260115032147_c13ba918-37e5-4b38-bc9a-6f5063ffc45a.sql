-- Further reduce avatar scale - 0.01 is still too big
-- Try 0.008 which should make it about 80% of previous size
UPDATE public.models 
SET default_scale = 0.008
WHERE key = 'y-bot';