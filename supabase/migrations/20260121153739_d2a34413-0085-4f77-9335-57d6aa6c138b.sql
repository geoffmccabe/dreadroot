-- Phase 3: Add ai_config JSONB column to enemy definitions tables
-- This allows admin-configurable AI behaviors per tier

-- Add ai_config to shnake_definitions
ALTER TABLE public.shnake_definitions
ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT '{
  "behaviors": ["sleep", "wander", "chase", "attack"],
  "detectionRange": 32,
  "attackRange": 1.5,
  "angrySpeedMultiplier": 1.5,
  "angryDurationMs": 30000,
  "attackCooldownMs": 600
}'::jsonb;

-- Add ai_config to shwarm_definitions
ALTER TABLE public.shwarm_definitions
ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT '{
  "behaviors": ["sleep", "wander", "chase", "attack"],
  "detectionRange": 32,
  "attackRange": 2.0,
  "angrySpeedMultiplier": 1.5,
  "angryDurationMs": 30000,
  "attackCooldownMs": 500
}'::jsonb;

-- Add comment explaining the structure
COMMENT ON COLUMN public.shnake_definitions.ai_config IS 'AI behavior configuration: behaviors (array of behavior IDs), detectionRange, attackRange, angrySpeedMultiplier, angryDurationMs, attackCooldownMs';
COMMENT ON COLUMN public.shwarm_definitions.ai_config IS 'AI behavior configuration: behaviors (array of behavior IDs), detectionRange, attackRange, angrySpeedMultiplier, angryDurationMs, attackCooldownMs';