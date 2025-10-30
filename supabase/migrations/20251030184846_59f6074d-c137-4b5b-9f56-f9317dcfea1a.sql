-- Fix storage policies for billboard-media bucket to allow atlas uploads

-- Drop existing restrictive policies if any
DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow atlas uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow atlas updates" ON storage.objects;

-- Create comprehensive policies for billboard-media bucket
-- Policy 1: Allow anyone to upload to billboard-media (for user uploads and atlas generation)
CREATE POLICY "Allow all uploads to billboard-media"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'billboard-media');

-- Policy 2: Allow anyone to update objects in billboard-media (for atlas regeneration)
CREATE POLICY "Allow all updates to billboard-media"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'billboard-media')
WITH CHECK (bucket_id = 'billboard-media');

-- Policy 3: Public read access (already exists, but ensuring it's correct)
DROP POLICY IF EXISTS "Allow public read access to billboard-media" ON storage.objects;
CREATE POLICY "Allow public read access to billboard-media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'billboard-media');

-- Policy 4: Allow deletion for cleanup
DROP POLICY IF EXISTS "Allow all deletes from billboard-media" ON storage.objects;
CREATE POLICY "Allow all deletes from billboard-media"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'billboard-media');