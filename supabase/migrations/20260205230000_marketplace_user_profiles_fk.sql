-- Add foreign key from marketplace_listings.seller_id to user_profiles.user_id
-- This enables PostgREST to understand the relationship for joins

-- First ensure all sellers have profiles (create if missing)
INSERT INTO user_profiles (user_id)
SELECT DISTINCT seller_id FROM marketplace_listings
WHERE seller_id IS NOT NULL
  AND seller_id NOT IN (SELECT user_id FROM user_profiles WHERE user_id IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Add the foreign key constraint with a named reference
ALTER TABLE marketplace_listings
ADD CONSTRAINT marketplace_listings_seller_profile_fkey
FOREIGN KEY (seller_id) REFERENCES user_profiles(user_id)
ON DELETE CASCADE;
