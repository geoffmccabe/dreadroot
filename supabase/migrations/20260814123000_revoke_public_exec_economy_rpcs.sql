-- Defence in depth (2026-Aug-14): both functions already require auth.uid(),
-- so an anonymous caller could never succeed, but they were still EXECUTE-able
-- by PUBLIC. Narrow them to `authenticated` so the grant matches the intent.
REVOKE ALL ON FUNCTION public.spawn_coin_drop(uuid, text, numeric, int, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spawn_coin_drop(uuid, text, numeric, int, double precision, double precision, double precision) TO authenticated;

REVOKE ALL ON FUNCTION public.buy_block(text, integer, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buy_block(text, integer, uuid, uuid) TO authenticated;
