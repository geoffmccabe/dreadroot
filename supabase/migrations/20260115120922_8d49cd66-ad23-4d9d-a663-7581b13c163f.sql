-- Update y-bot model with correct scale (0.01 = ~1.8m, so 0.0094 ≈ 1.7m) and proper idle animation
UPDATE models 
SET 
  default_scale = 0.0094,
  animations = '[
    {
      "name": "Walk",
      "file": "/Unarmed_Walk_Forward.fbx",
      "trigger": "movement",
      "speed": 1,
      "loop": true,
      "fadeInDuration": 0.2,
      "fadeOutDuration": 0.2
    },
    {
      "name": "Idle",
      "file": "/Unarmed_Walk_Forward.fbx",
      "trigger": "idle",
      "speed": 0,
      "loop": true,
      "fadeInDuration": 0.3,
      "fadeOutDuration": 0.3
    },
    {
      "name": "PistolWalk",
      "file": "/Pistol_Walk.fbx",
      "trigger": "gun",
      "speed": 1,
      "loop": true,
      "fadeInDuration": 0.2,
      "fadeOutDuration": 0.2
    }
  ]'::jsonb,
  updated_at = now()
WHERE key = 'y-bot';