-- P2P Marketplace System
-- Enables peer-to-peer trading of Blocks, Fruits, Seeds, and Items using DIVI currency
-- Features: User stores, permanent/timed listings, comprehensive filtering/sorting

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. DIVI Currency Balances
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_divi_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_divi_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_divi_updated_at ON user_divi_balances;
CREATE TRIGGER trigger_divi_updated_at
  BEFORE UPDATE ON user_divi_balances
  FOR EACH ROW EXECUTE FUNCTION update_divi_updated_at();

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. User Storefronts
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  store_name TEXT NOT NULL,
  description TEXT,
  banner_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  total_sales INTEGER NOT NULL DEFAULT 0,
  rating REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_store_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_store_updated_at ON marketplace_stores;
CREATE TRIGGER trigger_store_updated_at
  BEFORE UPDATE ON marketplace_stores
  FOR EACH ROW EXECUTE FUNCTION update_store_updated_at();

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. Marketplace Listings
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID REFERENCES marketplace_stores(id) ON DELETE SET NULL,

  -- Item type discrimination
  item_category TEXT NOT NULL CHECK (item_category IN ('block', 'fruit', 'seed', 'item')),
  item_type TEXT,              -- For blocks/seeds (e.g., 'glitter_block', 'seed_tier_5')
  seed_definition_id UUID,     -- For seeds (references seed_definitions)
  seed_tier INTEGER,           -- For seeds (1-30)
  fruit_tier INTEGER,          -- For fruits (1-10+)
  item_id UUID,                -- For items table reference

  -- Pricing & quantity
  price_divi INTEGER NOT NULL CHECK (price_divi > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),

  -- Listing details
  seller_description TEXT,     -- User-added description
  expires_at TIMESTAMPTZ,      -- NULL = permanent listing
  is_active BOOLEAN NOT NULL DEFAULT true,
  views INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient filtering/sorting
CREATE INDEX IF NOT EXISTS idx_listings_seller ON marketplace_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_category ON marketplace_listings(item_category);
CREATE INDEX IF NOT EXISTS idx_listings_price ON marketplace_listings(price_divi);
CREATE INDEX IF NOT EXISTS idx_listings_created ON marketplace_listings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_expires ON marketplace_listings(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_active ON marketplace_listings(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_listings_item_type ON marketplace_listings(item_type) WHERE item_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_seed_tier ON marketplace_listings(seed_tier) WHERE seed_tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_fruit_tier ON marketplace_listings(fruit_tier) WHERE fruit_tier IS NOT NULL;

CREATE OR REPLACE FUNCTION update_listing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_listing_updated_at ON marketplace_listings;
CREATE TRIGGER trigger_listing_updated_at
  BEFORE UPDATE ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION update_listing_updated_at();

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. Transaction History
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL,    -- No FK, listing may be deleted
  seller_id UUID NOT NULL REFERENCES auth.users(id),
  buyer_id UUID NOT NULL REFERENCES auth.users(id),

  -- Snapshot of sold item
  item_category TEXT NOT NULL,
  item_type TEXT,
  seed_definition_id UUID,
  seed_tier INTEGER,
  fruit_tier INTEGER,
  item_id UUID,

  quantity INTEGER NOT NULL DEFAULT 1,
  price_divi INTEGER NOT NULL,
  total_divi INTEGER NOT NULL,  -- price * quantity

  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_seller ON marketplace_transactions(seller_id);
CREATE INDEX IF NOT EXISTS idx_transactions_buyer ON marketplace_transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_completed ON marketplace_transactions(completed_at DESC);

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. User Watchlist (Favorites)
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON marketplace_watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_listing ON marketplace_watchlist(listing_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- 6. Price History (Analytics)
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.marketplace_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_category TEXT NOT NULL,
  item_type TEXT,
  seed_definition_id UUID,
  seed_tier INTEGER,
  fruit_tier INTEGER,
  item_id UUID,
  price_divi INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_item ON marketplace_price_history(item_category, item_type, seed_tier, fruit_tier, item_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON marketplace_price_history(recorded_at DESC);

-- ════════════════════════════════════════════════════════════════════════════════
-- 7. Row Level Security Policies
-- ════════════════════════════════════════════════════════════════════════════════

-- DIVI Balances: Users can only read their own
ALTER TABLE user_divi_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own DIVI balance" ON user_divi_balances;
CREATE POLICY "Users read own DIVI balance"
  ON user_divi_balances FOR SELECT
  USING (user_id = auth.uid());

-- Stores: Public read for active stores, users manage their own
ALTER TABLE marketplace_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active stores publicly readable" ON marketplace_stores;
CREATE POLICY "Active stores publicly readable"
  ON marketplace_stores FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Users read own store" ON marketplace_stores;
CREATE POLICY "Users read own store"
  ON marketplace_stores FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create own store" ON marketplace_stores;
CREATE POLICY "Users create own store"
  ON marketplace_stores FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own store" ON marketplace_stores;
CREATE POLICY "Users update own store"
  ON marketplace_stores FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own store" ON marketplace_stores;
CREATE POLICY "Users delete own store"
  ON marketplace_stores FOR DELETE
  USING (user_id = auth.uid());

-- Listings: Public read for active/unexpired, users CRUD their own
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active listings publicly readable" ON marketplace_listings;
CREATE POLICY "Active listings publicly readable"
  ON marketplace_listings FOR SELECT
  USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

DROP POLICY IF EXISTS "Users read own listings" ON marketplace_listings;
CREATE POLICY "Users read own listings"
  ON marketplace_listings FOR SELECT
  USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "Users create listings" ON marketplace_listings;
CREATE POLICY "Users create listings"
  ON marketplace_listings FOR INSERT
  WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS "Users update own listings" ON marketplace_listings;
CREATE POLICY "Users update own listings"
  ON marketplace_listings FOR UPDATE
  USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own listings" ON marketplace_listings;
CREATE POLICY "Users delete own listings"
  ON marketplace_listings FOR DELETE
  USING (seller_id = auth.uid());

-- Transactions: Users read their own (as buyer or seller)
ALTER TABLE marketplace_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own transactions" ON marketplace_transactions;
CREATE POLICY "Users read own transactions"
  ON marketplace_transactions FOR SELECT
  USING (seller_id = auth.uid() OR buyer_id = auth.uid());

-- Watchlist: Users manage their own
ALTER TABLE marketplace_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own watchlist" ON marketplace_watchlist;
CREATE POLICY "Users read own watchlist"
  ON marketplace_watchlist FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users add to watchlist" ON marketplace_watchlist;
CREATE POLICY "Users add to watchlist"
  ON marketplace_watchlist FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users remove from watchlist" ON marketplace_watchlist;
CREATE POLICY "Users remove from watchlist"
  ON marketplace_watchlist FOR DELETE
  USING (user_id = auth.uid());

-- Price History: Public read
ALTER TABLE marketplace_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Price history publicly readable" ON marketplace_price_history;
CREATE POLICY "Price history publicly readable"
  ON marketplace_price_history FOR SELECT
  USING (true);

-- ════════════════════════════════════════════════════════════════════════════════
-- 8. Helper Functions
-- ════════════════════════════════════════════════════════════════════════════════

-- Ensure user has DIVI balance record
CREATE OR REPLACE FUNCTION ensure_divi_balance(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_id UUID;
BEGIN
  SELECT id INTO v_balance_id
  FROM user_divi_balances
  WHERE user_id = p_user_id;

  IF v_balance_id IS NULL THEN
    INSERT INTO user_divi_balances (user_id, balance)
    VALUES (p_user_id, 0)
    RETURNING id INTO v_balance_id;
  END IF;

  RETURN v_balance_id;
END;
$$;

-- Get user's DIVI balance (creates if not exists)
CREATE OR REPLACE FUNCTION get_divi_balance(p_user_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_balance INTEGER;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM ensure_divi_balance(v_user_id);

  SELECT balance INTO v_balance
  FROM user_divi_balances
  WHERE user_id = v_user_id;

  RETURN COALESCE(v_balance, 0);
END;
$$;

-- Award DIVI to user (for quests, achievements, etc.)
CREATE OR REPLACE FUNCTION award_divi(p_user_id UUID, p_amount INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  PERFORM ensure_divi_balance(p_user_id);

  UPDATE user_divi_balances
  SET
    balance = balance + p_amount,
    total_earned = total_earned + p_amount
  WHERE user_id = p_user_id
  RETURNING balance INTO v_new_balance;

  RETURN jsonb_build_object(
    'success', true,
    'amount_awarded', p_amount,
    'new_balance', v_new_balance
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 9. Atomic Purchase Function
-- Uses correct schema: user_inventory.item_type for blocks/seeds, user_fruits as individual rows
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION marketplace_purchase(
  p_listing_id UUID,
  p_quantity INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_id UUID;
  v_listing RECORD;
  v_total_cost INTEGER;
  v_buyer_balance INTEGER;
  v_new_buyer_balance INTEGER;
  v_new_seller_balance INTEGER;
  v_transaction_id UUID;
  v_existing_inv RECORD;
  v_i INTEGER;
BEGIN
  -- Get buyer ID
  v_buyer_id := auth.uid();
  IF v_buyer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Validate quantity
  IF p_quantity < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantity must be at least 1');
  END IF;

  -- Lock and fetch listing
  SELECT * INTO v_listing
  FROM marketplace_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF v_listing IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;

  -- Validate listing is active
  IF NOT v_listing.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing is no longer active');
  END IF;

  -- Check expiration
  IF v_listing.expires_at IS NOT NULL AND v_listing.expires_at <= now() THEN
    UPDATE marketplace_listings SET is_active = false WHERE id = p_listing_id;
    RETURN jsonb_build_object('success', false, 'error', 'Listing has expired');
  END IF;

  -- Validate sufficient quantity
  IF v_listing.quantity < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not enough quantity available', 'available', v_listing.quantity);
  END IF;

  -- Prevent self-purchase
  IF v_listing.seller_id = v_buyer_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot buy your own listing');
  END IF;

  -- Calculate total cost
  v_total_cost := v_listing.price_divi * p_quantity;

  -- Ensure buyer has balance record
  PERFORM ensure_divi_balance(v_buyer_id);

  -- Get and lock buyer balance
  SELECT balance INTO v_buyer_balance
  FROM user_divi_balances
  WHERE user_id = v_buyer_id
  FOR UPDATE;

  IF v_buyer_balance < v_total_cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient DIVI balance',
      'required', v_total_cost,
      'available', v_buyer_balance
    );
  END IF;

  -- Ensure seller has balance record
  PERFORM ensure_divi_balance(v_listing.seller_id);

  -- Deduct from buyer
  UPDATE user_divi_balances
  SET
    balance = balance - v_total_cost,
    total_spent = total_spent + v_total_cost
  WHERE user_id = v_buyer_id
  RETURNING balance INTO v_new_buyer_balance;

  -- Credit to seller
  UPDATE user_divi_balances
  SET
    balance = balance + v_total_cost,
    total_earned = total_earned + v_total_cost
  WHERE user_id = v_listing.seller_id
  RETURNING balance INTO v_new_seller_balance;

  -- Update listing quantity or deactivate
  IF v_listing.quantity = p_quantity THEN
    UPDATE marketplace_listings
    SET is_active = false, quantity = 0
    WHERE id = p_listing_id;
  ELSE
    UPDATE marketplace_listings
    SET quantity = quantity - p_quantity
    WHERE id = p_listing_id;
  END IF;

  -- Record transaction
  INSERT INTO marketplace_transactions (
    listing_id,
    seller_id,
    buyer_id,
    item_category,
    item_type,
    seed_definition_id,
    seed_tier,
    fruit_tier,
    item_id,
    quantity,
    price_divi,
    total_divi
  ) VALUES (
    p_listing_id,
    v_listing.seller_id,
    v_buyer_id,
    v_listing.item_category,
    v_listing.item_type,
    v_listing.seed_definition_id,
    v_listing.seed_tier,
    v_listing.fruit_tier,
    v_listing.item_id,
    p_quantity,
    v_listing.price_divi,
    v_total_cost
  )
  RETURNING id INTO v_transaction_id;

  -- Record price history
  INSERT INTO marketplace_price_history (
    item_category,
    item_type,
    seed_definition_id,
    seed_tier,
    fruit_tier,
    item_id,
    price_divi,
    quantity
  ) VALUES (
    v_listing.item_category,
    v_listing.item_type,
    v_listing.seed_definition_id,
    v_listing.seed_tier,
    v_listing.fruit_tier,
    v_listing.item_id,
    v_listing.price_divi,
    p_quantity
  );

  -- Update seller's store sales count if they have a store
  IF v_listing.store_id IS NOT NULL THEN
    UPDATE marketplace_stores
    SET total_sales = total_sales + p_quantity
    WHERE id = v_listing.store_id;
  END IF;

  -- Transfer items to buyer based on category
  -- BLOCKS: Add to user_inventory using item_type
  IF v_listing.item_category = 'block' AND v_listing.item_type IS NOT NULL THEN
    SELECT * INTO v_existing_inv
    FROM user_inventory
    WHERE user_id = v_buyer_id AND item_type = v_listing.item_type
    LIMIT 1;

    IF v_existing_inv IS NULL THEN
      INSERT INTO user_inventory (user_id, item_type, quantity)
      VALUES (v_buyer_id, v_listing.item_type, p_quantity);
    ELSE
      UPDATE user_inventory
      SET quantity = quantity + p_quantity, updated_at = now()
      WHERE id = v_existing_inv.id;
    END IF;
  END IF;

  -- SEEDS: Add to user_inventory using item_type and item_id
  IF v_listing.item_category = 'seed' AND v_listing.seed_definition_id IS NOT NULL THEN
    SELECT * INTO v_existing_inv
    FROM user_inventory
    WHERE user_id = v_buyer_id AND item_id = v_listing.seed_definition_id
    LIMIT 1;

    IF v_existing_inv IS NULL THEN
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      VALUES (v_buyer_id, COALESCE(v_listing.item_type, 'seed_tier_' || v_listing.seed_tier), v_listing.seed_definition_id, p_quantity);
    ELSE
      UPDATE user_inventory
      SET quantity = quantity + p_quantity, updated_at = now()
      WHERE id = v_existing_inv.id;
    END IF;
  END IF;

  -- FRUITS: Insert individual rows (user_fruits stores one row per fruit)
  IF v_listing.item_category = 'fruit' AND v_listing.fruit_tier IS NOT NULL THEN
    FOR v_i IN 1..p_quantity LOOP
      INSERT INTO user_fruits (user_id, tier, fruit_code)
      VALUES (v_buyer_id, v_listing.fruit_tier, 'FR1');
    END LOOP;
  END IF;

  -- ITEMS: Add to user_inventory if items are defined
  IF v_listing.item_category = 'item' AND v_listing.item_id IS NOT NULL THEN
    SELECT * INTO v_existing_inv
    FROM user_inventory
    WHERE user_id = v_buyer_id AND item_id = v_listing.item_id
    LIMIT 1;

    IF v_existing_inv IS NULL THEN
      INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
      VALUES (v_buyer_id, 'item', v_listing.item_id, p_quantity);
    ELSE
      UPDATE user_inventory
      SET quantity = quantity + p_quantity, updated_at = now()
      WHERE id = v_existing_inv.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'quantity_purchased', p_quantity,
    'total_cost', v_total_cost,
    'new_balance', v_new_buyer_balance,
    'item_category', v_listing.item_category
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 10. Create Listing Function (with inventory validation)
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION marketplace_create_listing(
  p_item_category TEXT,
  p_price_divi INTEGER,
  p_quantity INTEGER DEFAULT 1,
  p_item_type TEXT DEFAULT NULL,
  p_seed_definition_id UUID DEFAULT NULL,
  p_fruit_tier INTEGER DEFAULT NULL,
  p_item_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_store_id UUID;
  v_seed_tier INTEGER;
  v_available_qty INTEGER;
  v_listing_id UUID;
  v_inv_record RECORD;
  v_fruit_count INTEGER;
  v_i INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Validate inputs
  IF p_price_divi < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Price must be at least 1 DIVI');
  END IF;

  IF p_quantity < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantity must be at least 1');
  END IF;

  IF p_item_category NOT IN ('block', 'fruit', 'seed', 'item') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid item category');
  END IF;

  -- Get user's store if they have one
  SELECT id INTO v_store_id
  FROM marketplace_stores
  WHERE user_id = v_user_id AND is_active = true;

  -- Validate and deduct inventory based on category
  CASE p_item_category
    WHEN 'block' THEN
      IF p_item_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Item type required for block listings');
      END IF;

      SELECT * INTO v_inv_record
      FROM user_inventory
      WHERE user_id = v_user_id AND item_type = p_item_type
      FOR UPDATE;

      IF v_inv_record IS NULL OR v_inv_record.quantity < p_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient blocks in inventory', 'available', COALESCE(v_inv_record.quantity, 0));
      END IF;

      UPDATE user_inventory
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE id = v_inv_record.id;

    WHEN 'seed' THEN
      IF p_seed_definition_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Seed definition ID required for seed listings');
      END IF;

      -- Get seed tier
      SELECT tier INTO v_seed_tier
      FROM seed_definitions
      WHERE id = p_seed_definition_id;

      IF v_seed_tier IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Seed definition not found');
      END IF;

      SELECT * INTO v_inv_record
      FROM user_inventory
      WHERE user_id = v_user_id AND item_id = p_seed_definition_id
      FOR UPDATE;

      IF v_inv_record IS NULL OR v_inv_record.quantity < p_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient seeds in inventory', 'available', COALESCE(v_inv_record.quantity, 0));
      END IF;

      UPDATE user_inventory
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE id = v_inv_record.id;

    WHEN 'fruit' THEN
      IF p_fruit_tier IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Fruit tier required for fruit listings');
      END IF;

      -- Count available fruits of this tier (each row is one fruit)
      SELECT COUNT(*) INTO v_fruit_count
      FROM user_fruits
      WHERE user_id = v_user_id AND tier = p_fruit_tier;

      IF v_fruit_count < p_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient fruits in inventory', 'available', v_fruit_count);
      END IF;

      -- Delete the required number of fruit rows
      DELETE FROM user_fruits
      WHERE id IN (
        SELECT id FROM user_fruits
        WHERE user_id = v_user_id AND tier = p_fruit_tier
        LIMIT p_quantity
      );

    WHEN 'item' THEN
      IF p_item_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Item ID required for item listings');
      END IF;

      SELECT * INTO v_inv_record
      FROM user_inventory
      WHERE user_id = v_user_id AND item_id = p_item_id
      FOR UPDATE;

      IF v_inv_record IS NULL OR v_inv_record.quantity < p_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient items in inventory', 'available', COALESCE(v_inv_record.quantity, 0));
      END IF;

      UPDATE user_inventory
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE id = v_inv_record.id;

  END CASE;

  -- Create the listing
  INSERT INTO marketplace_listings (
    seller_id,
    store_id,
    item_category,
    item_type,
    seed_definition_id,
    seed_tier,
    fruit_tier,
    item_id,
    price_divi,
    quantity,
    seller_description,
    expires_at
  ) VALUES (
    v_user_id,
    v_store_id,
    p_item_category,
    p_item_type,
    p_seed_definition_id,
    v_seed_tier,
    p_fruit_tier,
    p_item_id,
    p_price_divi,
    p_quantity,
    p_description,
    p_expires_at
  )
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object(
    'success', true,
    'listing_id', v_listing_id,
    'item_category', p_item_category,
    'quantity', p_quantity,
    'price_divi', p_price_divi
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 11. Cancel Listing Function (returns items to seller)
-- ════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION marketplace_cancel_listing(p_listing_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_listing RECORD;
  v_existing_inv RECORD;
  v_i INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Lock and fetch listing
  SELECT * INTO v_listing
  FROM marketplace_listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF v_listing IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;

  -- Verify ownership
  IF v_listing.seller_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only cancel your own listings');
  END IF;

  -- Check if already inactive
  IF NOT v_listing.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing is already inactive');
  END IF;

  -- Return items to seller's inventory
  CASE v_listing.item_category
    WHEN 'block' THEN
      SELECT * INTO v_existing_inv
      FROM user_inventory
      WHERE user_id = v_user_id AND item_type = v_listing.item_type
      LIMIT 1;

      IF v_existing_inv IS NULL THEN
        INSERT INTO user_inventory (user_id, item_type, quantity)
        VALUES (v_user_id, v_listing.item_type, v_listing.quantity);
      ELSE
        UPDATE user_inventory
        SET quantity = quantity + v_listing.quantity, updated_at = now()
        WHERE id = v_existing_inv.id;
      END IF;

    WHEN 'seed' THEN
      SELECT * INTO v_existing_inv
      FROM user_inventory
      WHERE user_id = v_user_id AND item_id = v_listing.seed_definition_id
      LIMIT 1;

      IF v_existing_inv IS NULL THEN
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, COALESCE(v_listing.item_type, 'seed_tier_' || v_listing.seed_tier), v_listing.seed_definition_id, v_listing.quantity);
      ELSE
        UPDATE user_inventory
        SET quantity = quantity + v_listing.quantity, updated_at = now()
        WHERE id = v_existing_inv.id;
      END IF;

    WHEN 'fruit' THEN
      -- Re-insert individual fruit rows
      FOR v_i IN 1..v_listing.quantity LOOP
        INSERT INTO user_fruits (user_id, tier, fruit_code)
        VALUES (v_user_id, v_listing.fruit_tier, 'FR1');
      END LOOP;

    WHEN 'item' THEN
      SELECT * INTO v_existing_inv
      FROM user_inventory
      WHERE user_id = v_user_id AND item_id = v_listing.item_id
      LIMIT 1;

      IF v_existing_inv IS NULL THEN
        INSERT INTO user_inventory (user_id, item_type, item_id, quantity)
        VALUES (v_user_id, 'item', v_listing.item_id, v_listing.quantity);
      ELSE
        UPDATE user_inventory
        SET quantity = quantity + v_listing.quantity, updated_at = now()
        WHERE id = v_existing_inv.id;
      END IF;
  END CASE;

  -- Deactivate listing
  UPDATE marketplace_listings
  SET is_active = false
  WHERE id = p_listing_id;

  RETURN jsonb_build_object(
    'success', true,
    'listing_id', p_listing_id,
    'items_returned', v_listing.quantity,
    'item_category', v_listing.item_category
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 12. Enable Realtime for Marketplace Tables
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketplace_listings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketplace_listings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'marketplace_stores'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE marketplace_stores;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_divi_balances'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_divi_balances;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 13. Grant Starting DIVI to All Existing Users (1000 DIVI each)
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO user_divi_balances (user_id, balance, total_earned)
SELECT id, 1000, 1000
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
