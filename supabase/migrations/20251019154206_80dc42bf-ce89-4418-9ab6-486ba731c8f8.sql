-- Create storage bucket for block textures
INSERT INTO storage.buckets (id, name, public)
VALUES ('block-textures', 'block-textures', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for block-textures bucket
-- Allow public read access so textures can be displayed
CREATE POLICY "Block textures are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'block-textures');

-- Only admins can upload/update block textures
CREATE POLICY "Only admins can upload block textures"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'block-textures' AND
  public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Only admins can update block textures"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'block-textures' AND
  public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Only admins can delete block textures"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'block-textures' AND
  public.has_role(auth.uid(), 'admin'::app_role)
);