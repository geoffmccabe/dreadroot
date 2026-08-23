-- Guest accounts: one per device, convertible to a real account via LW-SSO.
--
-- A guest is a genuine Supabase ANONYMOUS auth user, so auth.uid(), RLS, the
-- signup trigger and every existing RPC keep working with no special cases.
-- What it lacks is an email, which is exactly what makes it unrecoverable if
-- the browser forgets it -- an accepted trade, not a bug.
--
-- This table is the server-side half of "one guest per device". The client
-- half is a random device id kept in IndexedDB. The device id is NOT a
-- fingerprint and identifies nothing about the machine; it is a random value
-- this browser generated about itself, which is why it can be stored without
-- collecting device details a player did not agree to hand over.

CREATE TABLE IF NOT EXISTS public.guest_devices (
  device_id    TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at   TIMESTAMPTZ,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS guest_devices_user_id_idx ON public.guest_devices(user_id);

-- No direct table access from the browser. Everything goes through the two
-- SECURITY DEFINER functions below, which is what keeps a client from
-- rebinding somebody else's device row to itself.
ALTER TABLE public.guest_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_devices FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- register_guest_device: bind this device to the CALLING guest account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_guest_device(
  p_device_id  TEXT,
  p_user_agent TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_anon BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  -- Only a guest may claim a device slot. A real account calling this would
  -- otherwise be able to park itself in the guest table.
  SELECT is_anonymous INTO v_is_anon FROM auth.users WHERE id = v_user_id;
  IF NOT COALESCE(v_is_anon, false) THEN
    RAISE EXCEPTION 'Only guest sessions register devices' USING ERRCODE = '42501';
  END IF;
  IF p_device_id IS NULL OR length(p_device_id) < 8 OR length(p_device_id) > 64
     OR p_device_id !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Invalid device id' USING ERRCODE = '22023';
  END IF;

  -- One guest per device. Re-registering replaces the binding: it means the
  -- browser lost the old session and started a fresh guest, which Geoff's
  -- design explicitly accepts. Any earlier claim already moved that data, so
  -- there is nothing left to preserve on the old row.
  INSERT INTO guest_devices (device_id, user_id, user_agent)
  VALUES (p_device_id, v_user_id, left(COALESCE(p_user_agent, ''), 400))
  ON CONFLICT (device_id) DO UPDATE
    SET user_id      = EXCLUDED.user_id,
        user_agent   = EXCLUDED.user_agent,
        last_seen_at = now(),
        claimed_by   = NULL,
        claimed_at   = NULL
  WHERE guest_devices.user_id IS DISTINCT FROM EXCLUDED.user_id
     OR guest_devices.claimed_by IS NOT NULL;

  UPDATE guest_devices SET last_seen_at = now()
   WHERE device_id = p_device_id AND user_id = v_user_id;

  RETURN json_build_object('device_id', p_device_id, 'user_id', v_user_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- claim_guest_account: convert a guest into the caller's REAL account.
--
-- Called right after an SSO login, by the real account, naming the guest it
-- is replacing. Moves the guest's progress across.
--
-- DELIBERATELY NOT MOVED: currency, token balances, wallet links, NFT/DIVI
-- holdings and roles. Guests are free and unlimited, so anything that moves
-- value across this boundary is a mint. Items, builds and stats carry over;
-- money does not.
--
-- Only migrates into an EMPTY real account. If the player already has items
-- on their real account, their real progress wins and the guest is simply
-- marked claimed -- never silently overwritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_guest_account(
  p_device_id      TEXT,
  p_guest_user_id  UUID
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_is_anon  BOOLEAN;
  v_g_anon   BOOLEAN;
  v_row      guest_devices%ROWTYPE;
  v_had_data BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_user_id = p_guest_user_id THEN
    RETURN json_build_object('claimed', false, 'reason', 'same_account');
  END IF;

  SELECT is_anonymous INTO v_is_anon FROM auth.users WHERE id = v_user_id;
  IF COALESCE(v_is_anon, false) THEN
    RAISE EXCEPTION 'A guest cannot claim a guest' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM guest_devices
   WHERE device_id = p_device_id AND user_id = p_guest_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('claimed', false, 'reason', 'no_such_guest_device');
  END IF;
  IF v_row.claimed_by IS NOT NULL THEN
    RETURN json_build_object('claimed', false, 'reason', 'already_claimed');
  END IF;

  -- The named account must really be a guest, so this can never be used to
  -- siphon a registered player's data.
  SELECT is_anonymous INTO v_g_anon FROM auth.users WHERE id = p_guest_user_id;
  IF NOT COALESCE(v_g_anon, false) THEN
    RAISE EXCEPTION 'Named account is not a guest' USING ERRCODE = '42501';
  END IF;

  v_had_data := EXISTS (SELECT 1 FROM user_slots WHERE user_id = v_user_id);

  IF NOT v_had_data THEN
    UPDATE user_slots        SET user_id = v_user_id WHERE user_id = p_guest_user_id;
    UPDATE placed_blocks     SET user_id = v_user_id WHERE user_id = p_guest_user_id;
    UPDATE user_fruits       SET user_id = v_user_id WHERE user_id = p_guest_user_id;
    UPDATE user_vault        SET user_id = v_user_id WHERE user_id = p_guest_user_id;
    BEGIN
      UPDATE user_stats        SET user_id = v_user_id WHERE user_id = p_guest_user_id;
      UPDATE user_combat_stats SET user_id = v_user_id WHERE user_id = p_guest_user_id;
    EXCEPTION WHEN unique_violation THEN
      -- The real account already had a stats row; keep it and drop the guest's.
      DELETE FROM user_stats        WHERE user_id = p_guest_user_id;
      DELETE FROM user_combat_stats WHERE user_id = p_guest_user_id;
    END;
  END IF;

  UPDATE guest_devices
     SET claimed_by = v_user_id, claimed_at = now(), last_seen_at = now()
   WHERE device_id = p_device_id;

  RETURN json_build_object('claimed', true, 'migrated', NOT v_had_data);
END;
$$;

REVOKE ALL ON FUNCTION public.register_guest_device(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_guest_device(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_guest_account(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_guest_account(TEXT, UUID) TO authenticated;
