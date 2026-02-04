-- Fruit System: schema changes, user_fruits table, egg_fruit item, forge RPC

-- 1. Add fruit_code to tree_fruits for extensibility (#FR1, #FR2, etc.)
ALTER TABLE tree_fruits ADD COLUMN IF NOT EXISTS fruit_code VARCHAR(10) NOT NULL DEFAULT 'FR1';

-- 2. Create user_fruits table (individually-tracked harvested fruits)
CREATE TABLE IF NOT EXISTS user_fruits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fruit_code VARCHAR(10) NOT NULL DEFAULT 'FR1',
  tier INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_fruits_user_id ON user_fruits(user_id);

ALTER TABLE user_fruits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own fruits"
  ON user_fruits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own fruits"
  ON user_fruits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own fruits"
  ON user_fruits FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Insert egg_fruit item definition
INSERT INTO items (key, name, item_category, tier, cost, rarity, class, description, properties)
VALUES (
  'egg_fruit',
  'Egg Fruit',
  'fruit',
  1,
  0,
  'legendary',
  'collectible',
  'A mysterious egg-shaped fruit with unknown potential.',
  '{"description": "A mysterious egg-shaped fruit"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- 4. Forge RPC: atomic delete-two + insert-one, validates ownership and same-tier
CREATE OR REPLACE FUNCTION forge_fruits(fruit_id_1 UUID, fruit_id_2 UUID, new_tier INT)
RETURNS SETOF user_fruits AS $$
DECLARE
  result user_fruits;
  tier1 INT;
  tier2 INT;
  code1 VARCHAR(10);
BEGIN
  -- Verify ownership and get tiers
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

  -- Delete both source fruits
  DELETE FROM user_fruits WHERE id IN (fruit_id_1, fruit_id_2) AND user_id = auth.uid();

  -- Insert the forged result
  INSERT INTO user_fruits (user_id, fruit_code, tier)
  VALUES (auth.uid(), code1, new_tier)
  RETURNING * INTO result;

  RETURN NEXT result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
