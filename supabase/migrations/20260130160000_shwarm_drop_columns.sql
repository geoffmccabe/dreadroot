-- Add loot drop configuration columns to shwarm_definitions
ALTER TABLE shwarm_definitions
  ADD COLUMN IF NOT EXISTS drop_rate numeric(4,1) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS drop_table_code text DEFAULT NULL;

-- Set defaults: T1=1%, T2=2%, ..., T10=10%, all using DT1
UPDATE shwarm_definitions SET drop_rate = tier * 1.0, drop_table_code = 'DT1'
  WHERE drop_rate IS NULL;
