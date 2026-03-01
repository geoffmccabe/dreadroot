-- Add missing indexes on user-related tables.
-- Without these, queries in useUserData.ts do full table scans,
-- causing 30-second load times and 14-second event loop blocks.

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id
  ON user_profiles (user_id);

CREATE INDEX IF NOT EXISTS idx_user_token_balances_user_id
  ON user_token_balances (user_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
  ON user_roles (user_id);

CREATE INDEX IF NOT EXISTS idx_user_equipped_items_user_id
  ON user_equipped_items (user_id);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id
  ON user_inventory (user_id);
