-- Create game-sounds storage bucket for custom sound uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'game-sounds',
  'game-sounds',
  true,
  5242880, -- 5MB limit
  ARRAY['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4']
)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read sounds (public bucket)
CREATE POLICY "Public read access for game sounds"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'game-sounds');

-- Only admins can upload sounds
CREATE POLICY "Admin upload access for game sounds"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'game-sounds'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  );

-- Only admins can update sounds
CREATE POLICY "Admin update access for game sounds"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'game-sounds'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  );

-- Only admins can delete sounds
CREATE POLICY "Admin delete access for game sounds"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'game-sounds'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'superadmin')
    )
  );
