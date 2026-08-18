-- SECURITY FIX (2026-Aug-14): forge_fruits took the OUTPUT TIER from the client
-- and inserted it unvalidated. Two tier-1 fruits could be forged into a tier
-- 9999 fruit, and fruits are sellable on the P2P marketplace for DIVI.
--
-- Root cause: the forge bonus was rolled in the BROWSER
-- (FruitsTab.tsx: `while (Math.random() < 0.5 && bonus < MAX_FORGE_BONUS) bonus++`)
-- and merely reported to the server. Same class of bug as the loot rolls that
-- were already moved server-side (roll_shwarm_drop, roll_shpider_egg).
--
-- Fix: the SERVER rolls the bonus, with the identical distribution
-- (50% +1, 25% +2, 12.5% +3 ..., capped at MAX_FORGE_BONUS = 30), and derives
-- the new tier from the VERIFIED source tier. new_tier stays in the signature
-- so the shipped client keeps working, but is now ignored.
--
-- Also fixed here: this was the only SECURITY DEFINER function in the project
-- with no `SET search_path` (a privilege-escalation risk), and it had no GRANT,
-- so it defaulted to EXECUTE BY PUBLIC.
--
-- Existing data checked before changing: 213 fruits, tiers 1..6. No abuse.

CREATE OR REPLACE FUNCTION public.forge_fruits(fruit_id_1 uuid, fruit_id_2 uuid, new_tier integer)
 RETURNS SETOF user_fruits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result user_fruits;
  tier1 INT;
  tier2 INT;
  code1 VARCHAR(10);
  v_bonus INT := 1;
  v_max_bonus CONSTANT INT := 30;  -- mirrors FRUIT_CONFIG.MAX_FORGE_BONUS
BEGIN
  SELECT tier, fruit_code INTO tier1, code1
    FROM user_fruits WHERE id = fruit_id_1 AND user_id = auth.uid();
  SELECT tier INTO tier2
    FROM user_fruits WHERE id = fruit_id_2 AND user_id = auth.uid();

  IF tier1 IS NULL OR tier2 IS NULL THEN
    RAISE EXCEPTION 'Fruit not found or not owned by user';
  END IF;

  IF tier1 != tier2 THEN
    RAISE EXCEPTION 'Both fruits must be the same tier to forge';
  END IF;

  IF fruit_id_1 = fruit_id_2 THEN
    RAISE EXCEPTION 'Cannot forge a fruit with itself';
  END IF;

  -- AUTHORITATIVE ROLL: same distribution the client used, but server-side.
  WHILE random() < 0.5 AND v_bonus < v_max_bonus LOOP
    v_bonus := v_bonus + 1;
  END LOOP;

  DELETE FROM user_fruits WHERE id IN (fruit_id_1, fruit_id_2) AND user_id = auth.uid();

  INSERT INTO user_fruits (user_id, fruit_code, tier)
  VALUES (auth.uid(), code1, tier1 + v_bonus)
  RETURNING * INTO result;

  RETURN NEXT result;
END;
$function$;

REVOKE ALL ON FUNCTION public.forge_fruits(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forge_fruits(uuid, uuid, integer) TO authenticated;
