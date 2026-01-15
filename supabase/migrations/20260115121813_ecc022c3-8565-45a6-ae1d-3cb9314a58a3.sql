-- Increase avatar scale from 0.0094 to 0.01 for ~1.8m height
UPDATE models 
SET 
  default_scale = 0.01,
  updated_at = now()
WHERE key = 'y-bot';