UPDATE models SET 
  default_scale = 0.012,
  animations = '[
    {"name": "Walk", "file": "/Unarmed_Walk_Forward.fbx", "trigger": "movement", "loop": true, "speed": 1, "fadeInDuration": 0.2, "fadeOutDuration": 0.2},
    {"name": "Idle", "file": "/Pistol_Walk.fbx", "trigger": "idle", "loop": true, "speed": 0, "fadeInDuration": 0.3, "fadeOutDuration": 0.3}
  ]'::jsonb
WHERE key = 'y-bot';