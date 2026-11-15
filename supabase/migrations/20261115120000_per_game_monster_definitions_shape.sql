-- Per-game monster definitions, step 1 of 2: make the SHAPE support it.
--
-- DreadRoot, Pinkland and Siege Worlds share one Supabase. The eight monster
-- definition tables are currently global: every client reads every row, so the
-- games cannot have different monsters. Six of the tables already carry a
-- `game` column (migration 20260608100000); shpider and walapa were added
-- afterwards and do not.
--
-- The real blocker was uniqueness: `tier` is unique table-wide, so a second
-- game's tier 1 cannot exist. A June 2026 attempt failed here because it
-- assumed the constraints were all named `<table>_tier_key` - shnake's is a
-- bare unique INDEX called shnake_definitions_tier_unique with no constraint
-- behind it, so the DROP missed and the copy hit the surviving UNIQUE(tier).
-- This version finds them by DEFINITION, not by name, and handles both forms.
--
-- Deliberately NO data change here. Every row stays game='dreadroot' and both
-- clients still read unfiltered, so this migration is invisible at runtime.
-- The clients get game-filtered first; the Pinkland rows are inserted last.

ALTER TABLE public.shpider_definitions ADD COLUMN IF NOT EXISTS game text NOT NULL DEFAULT 'dreadroot';
ALTER TABLE public.walapa_definitions  ADD COLUMN IF NOT EXISTS game text NOT NULL DEFAULT 'dreadroot';

DO $mig$
DECLARE
  t text;
  r record;
  tables text[] := ARRAY[
    'shombie_definitions','shtickman_definitions','shnake_definitions',
    'shwarm_definitions','shroomer_definitions','vortax_definitions',
    'shpider_definitions','walapa_definitions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP

    -- 1. drop any UNIQUE CONSTRAINT whose definition is exactly UNIQUE (tier)
    FOR r IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND con.contype = 'u'
        AND pg_get_constraintdef(con.oid) = 'UNIQUE (tier)'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, r.conname);
      RAISE NOTICE 'dropped constraint %.%', t, r.conname;
    END LOOP;

    -- 2. drop any leftover bare UNIQUE INDEX on (tier) alone (the shnake case)
    FOR r IN
      SELECT i.indexname
      FROM pg_indexes i
      WHERE i.schemaname = 'public' AND i.tablename = t
        AND i.indexdef LIKE '%UNIQUE%'
        AND i.indexdef LIKE '%(tier)'
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
      RAISE NOTICE 'dropped index %.%', t, r.indexname;
    END LOOP;

    -- 3. per-game uniqueness. A real CONSTRAINT (not a bare index) so that
    --    PostgREST upserts with onConflict=game,tier resolve it reliably.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname=t AND con.contype='u'
        AND pg_get_constraintdef(con.oid) = 'UNIQUE (game, tier)'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (game, tier)',
                     t, t || '_game_tier_unique');
      RAISE NOTICE 'added UNIQUE(game,tier) on %', t;
    END IF;

    -- 4. reads will filter on game, so index it
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (game)',
                   t || '_game_idx', t);
  END LOOP;
END
$mig$;
