
-- Fix storage RLS policies for block-textures bucket to allow superadmins to upload

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Superadmins can upload block textures" ON storage.objects;
DROP POLICY IF EXISTS "Superadmins can insert block textures" ON storage.objects;

-- Create policy for superadmins to upload (INSERT) block textures
CREATE POLICY "Superadmins can insert block textures"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'block-textures' 
  AND EXISTS (
    SELECT 1 
    FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'superadmin'::app_role
  )
);
