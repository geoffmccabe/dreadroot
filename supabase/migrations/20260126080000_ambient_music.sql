-- Add ambient music support to worlds

-- Create table to store uploaded ambient music tracks
CREATE TABLE IF NOT EXISTS ambient_music_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add RLS policies for ambient_music_tracks
ALTER TABLE ambient_music_tracks ENABLE ROW LEVEL SECURITY;

-- Anyone can read ambient music tracks
CREATE POLICY "Anyone can read ambient music tracks"
  ON ambient_music_tracks FOR SELECT
  USING (true);

-- Only admins can insert/update/delete (checked via user_roles)
CREATE POLICY "Admins can manage ambient music tracks"
  ON ambient_music_tracks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'superadmin')
    )
  );

-- Add ambient music columns to worlds table
ALTER TABLE worlds
ADD COLUMN IF NOT EXISTS ambient_music_url TEXT DEFAULT '/ambient_alien_planet_bkgd_1.mp3',
ADD COLUMN IF NOT EXISTS ambient_music_volume INTEGER DEFAULT 100 CHECK (ambient_music_volume >= 0 AND ambient_music_volume <= 200);

-- Insert the default ambient track that was just added
INSERT INTO ambient_music_tracks (name, url)
VALUES ('Alien Planet Ambient', '/ambient_alien_planet_bkgd_1.mp3')
ON CONFLICT DO NOTHING;

-- Create storage bucket for ambient music if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('ambient-music', 'ambient-music', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for ambient-music bucket
CREATE POLICY "Anyone can read ambient music files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ambient-music');

CREATE POLICY "Admins can upload ambient music files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ambient-music'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admins can delete ambient music files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'ambient-music'
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'superadmin')
    )
  );
