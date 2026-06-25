-- sw_monster_overrides — admin-editable BASE stats for Siege Worlds monsters.
--
-- The code ships default stats in siegeMonsterCatalog.CFG. This table holds per-npcType
-- OVERRIDES (only the fields an admin changed) as JSONB, merged over the code defaults at
-- spawn time. One row per npcType. Players read it (cached to IndexedDB); only admins write.
-- updated_at lets clients detect "models changed since last login" on world init.

CREATE TABLE IF NOT EXISTS public.sw_monster_overrides (
  npc_type   INTEGER PRIMARY KEY CHECK (npc_type >= 1 AND npc_type <= 100),
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- partial CFG override (changed fields only)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.sw_monster_overrides ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can READ (needed to spawn the right stats).
DROP POLICY IF EXISTS "read sw monster overrides" ON public.sw_monster_overrides;
CREATE POLICY "read sw monster overrides" ON public.sw_monster_overrides
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins / superadmins can WRITE.
DROP POLICY IF EXISTS "admin write sw monster overrides" ON public.sw_monster_overrides;
CREATE POLICY "admin write sw monster overrides" ON public.sw_monster_overrides
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- Keep updated_at fresh on every write (so "changed since last login" is reliable).
CREATE OR REPLACE FUNCTION public.touch_sw_monster_override()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sw_monster_overrides_touch ON public.sw_monster_overrides;
CREATE TRIGGER sw_monster_overrides_touch
  BEFORE INSERT OR UPDATE ON public.sw_monster_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_sw_monster_override();
