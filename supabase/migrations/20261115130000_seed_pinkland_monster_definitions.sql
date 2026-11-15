-- Per-game monster definitions, step 2 of 2: give Pinkland its own rows.
--
-- PREREQUISITE, already met: both clients filter their monster reads by
-- GAME_ID and are deployed (DreadRoot 4.354.0, Pinkland 0.19.0). Without that,
-- DreadRoot would read these new rows too and show every monster twice.
--
-- Copies every game='dreadroot' row to a matching game='pinkland' row, so
-- Pinkland starts from DreadRoot's balanced roster and can then diverge -
-- retune, rename, recolor, add tiers - without touching DreadRoot. The copies
-- initially point at the same texture URLs; replacing those per game is the
-- next step and is done through the design panels, not here.
--
-- Column lists are built dynamically so this does not have to be rewritten
-- every time a monster table gains a field. id/created_at/updated_at are
-- excluded so the copies get fresh server-side values.
--
-- Idempotent: ON CONFLICT (game, tier) DO NOTHING, so re-running adds only
-- tiers that are missing and never overwrites Pinkland's own edits.
--
-- To undo:  DELETE FROM <table> WHERE game = 'pinkland';

DO $mig$
DECLARE
  t text;
  cols text;
  n integer;
  total integer := 0;
  tables text[] := ARRAY[
    'shombie_definitions','shtickman_definitions','shnake_definitions',
    'shwarm_definitions','shroomer_definitions','vortax_definitions',
    'shpider_definitions','walapa_definitions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = t
       AND column_name NOT IN ('id', 'created_at', 'updated_at', 'game');

    EXECUTE format(
      'INSERT INTO public.%I (game, %s)
       SELECT ''pinkland'', %s FROM public.%I WHERE game = ''dreadroot''
       ON CONFLICT (game, tier) DO NOTHING',
      t, cols, cols, t);

    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    RAISE NOTICE '% : % pinkland row(s) created', t, n;
  END LOOP;
  RAISE NOTICE 'TOTAL: % pinkland monster definition row(s)', total;
END
$mig$;
