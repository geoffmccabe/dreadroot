-- Fix RLS policies to use 'admin' instead of 'superadmin'
-- Drop the old policies
DROP POLICY IF EXISTS "Superadmins can insert blocks" ON public.blocks;
DROP POLICY IF EXISTS "Superadmins can update blocks" ON public.blocks;
DROP POLICY IF EXISTS "Superadmins can delete blocks" ON public.blocks;

-- Create new policies with correct role
CREATE POLICY "Admins can insert blocks" ON public.blocks
FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update blocks" ON public.blocks
FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete blocks" ON public.blocks
FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));