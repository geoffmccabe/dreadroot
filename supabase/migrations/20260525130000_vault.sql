-- =====================================================================
-- Vault: per-account stash for items outside the hot inventory.
-- =====================================================================
-- Goals:
--   * Per-account (NOT per-world). One vault travels with the player
--     across every world's fortress back-wall trigger.
--   * Multiple pages, each is a fixed cols x rows grid. Default 4
--     pages of 5x5. A future "Vault-Extension" consumable will bump
--     cols / rows / page_count via user_vault_config.
--   * Items stack inside the vault regardless of whether they stack
--     in the player inventory (grenades, potions). The client layer
--     splits them back into single-quantity rows on vault → inventory
--     transfer.
--   * RLS: a user only ever reads/writes their own vault rows.
-- =====================================================================

-- ---------------------------------------------------------------------
-- user_vault_config — one row per user, holds the dimensions for THAT
-- user's vault. Bumped by Vault-Extension consumables (future).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_vault_config (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  page_count  integer NOT NULL DEFAULT 4 CHECK (page_count BETWEEN 1 AND 32),
  cols        integer NOT NULL DEFAULT 5 CHECK (cols BETWEEN 1 AND 12),
  rows        integer NOT NULL DEFAULT 5 CHECK (rows BETWEEN 1 AND 12),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_vault_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own vault config"
  ON public.user_vault_config FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own vault config"
  ON public.user_vault_config FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own vault config"
  ON public.user_vault_config FOR UPDATE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- user_vault — one row per occupied slot. Empty slots = no row.
-- (page, slot) addresses a tile inside the grid. slot is row-major:
-- slot = row * cols + col.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_vault (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page       integer NOT NULL CHECK (page >= 0),
  slot       integer NOT NULL CHECK (slot >= 0),
  item_id    uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantity   integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page, slot)
);

CREATE INDEX IF NOT EXISTS idx_user_vault_user ON public.user_vault(user_id);

ALTER TABLE public.user_vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own vault"
  ON public.user_vault FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own vault"
  ON public.user_vault FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own vault"
  ON public.user_vault FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users delete own vault"
  ON public.user_vault FOR DELETE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Auto-bump updated_at on UPDATE for both tables.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_user_vault_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_vault_updated_at ON public.user_vault;
CREATE TRIGGER trg_user_vault_updated_at
  BEFORE UPDATE ON public.user_vault
  FOR EACH ROW EXECUTE FUNCTION public.touch_user_vault_updated_at();

DROP TRIGGER IF EXISTS trg_user_vault_config_updated_at ON public.user_vault_config;
CREATE TRIGGER trg_user_vault_config_updated_at
  BEFORE UPDATE ON public.user_vault_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_user_vault_updated_at();
