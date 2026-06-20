-- Creates the shared effect_definitions table (Smoke/VFX/Lights authored effects).
-- Saved effects (incl. authored lights, family 'lights') persist here under a reusable
-- `code`. Safe + idempotent. Run once in the Supabase SQL editor.
--
-- The app upserts with onConflict: 'code', so `code` is UNIQUE here.

CREATE TABLE IF NOT EXISTS public.effect_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                 -- reusable handle, e.g. 'shombie-face'
  name        text NOT NULL,
  family      text NOT NULL DEFAULT 'smoke',        -- smoke | lights | ...
  backend     text NOT NULL DEFAULT 'billboard',    -- billboard | lights | ...
  blend       text NOT NULL DEFAULT 'alpha',
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- all the authored values
  gameplay    jsonb,
  game_id     uuid REFERENCES public.games(id),
  owner_id    uuid REFERENCES auth.users(id),
  is_builtin  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS effect_definitions_family_idx ON public.effect_definitions (family);

ALTER TABLE public.effect_definitions ENABLE ROW LEVEL SECURITY;

-- Anyone can read active effects (they're shared, reusable building blocks).
DROP POLICY IF EXISTS effect_defs_read ON public.effect_definitions;
CREATE POLICY effect_defs_read ON public.effect_definitions
  FOR SELECT USING (is_active);

-- Creators manage their own rows.
DROP POLICY IF EXISTS effect_defs_write_own ON public.effect_definitions;
CREATE POLICY effect_defs_write_own ON public.effect_definitions
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
