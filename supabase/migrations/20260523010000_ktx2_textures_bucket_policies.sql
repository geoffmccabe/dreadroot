-- Storage RLS policies for the ktx2-textures bucket.
-- The bucket itself is created via the Supabase dashboard (Public = ON).
-- These policies let authenticated users (admins, in practice — gated
-- by isSuperAdmin checks in the app) upload, replace, and delete
-- objects. Anonymous reads are allowed so the game client can fetch
-- compressed textures without auth.
--
-- Idempotent: drops + recreates each policy.

-- Public read (matches the bucket's Public flag explicitly).
DROP POLICY IF EXISTS "ktx2_textures_public_read" ON storage.objects;
CREATE POLICY "ktx2_textures_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ktx2-textures');

-- Authenticated insert.
DROP POLICY IF EXISTS "ktx2_textures_auth_insert" ON storage.objects;
CREATE POLICY "ktx2_textures_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'ktx2-textures');

-- Authenticated update (upsert path).
DROP POLICY IF EXISTS "ktx2_textures_auth_update" ON storage.objects;
CREATE POLICY "ktx2_textures_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'ktx2-textures')
  WITH CHECK (bucket_id = 'ktx2-textures');

-- Authenticated delete (lets us replace by hash without leaving orphans).
DROP POLICY IF EXISTS "ktx2_textures_auth_delete" ON storage.objects;
CREATE POLICY "ktx2_textures_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'ktx2-textures');
