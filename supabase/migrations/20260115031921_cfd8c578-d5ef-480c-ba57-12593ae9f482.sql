-- Revert avatar scale back to original 0.01 (0.012 made it too big)
UPDATE public.models 
SET default_scale = 0.01
WHERE key = 'y-bot';