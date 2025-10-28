-- Add coin details columns to token_themes table
ALTER TABLE token_themes
ADD COLUMN coin_image_url TEXT,
ADD COLUMN coin_name TEXT,
ADD COLUMN blockchain TEXT,
ADD COLUMN contract_address TEXT,
ADD COLUMN ticker_symbol TEXT,
ADD COLUMN website_url TEXT,
ADD COLUMN description TEXT;

-- Create storage bucket for coin images
INSERT INTO storage.buckets (id, name, public)
VALUES ('coin-images', 'coin-images', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for coin images bucket
CREATE POLICY "Coin images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'coin-images');

CREATE POLICY "Admins can upload coin images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'coin-images' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
);

CREATE POLICY "Admins can update coin images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'coin-images' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
);

CREATE POLICY "Admins can delete coin images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'coin-images' AND
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
);

-- Update seed data with initial coin details
UPDATE token_themes
SET 
  coin_image_url = '/waterfall_coin.png',
  coin_name = 'Waterfall Token',
  blockchain = 'Ethereum',
  ticker_symbol = 'WATER'
WHERE name = 'waterfall';

UPDATE token_themes
SET 
  coin_image_url = '/waterfall_coin.png',
  coin_name = 'Harold Token',
  blockchain = 'Solana',
  ticker_symbol = 'HAROLD'
WHERE name = 'harold';