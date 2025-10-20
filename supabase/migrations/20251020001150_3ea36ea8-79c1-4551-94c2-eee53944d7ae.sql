-- Add superadmin role to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'superadmin';

-- Update RLS policies to use superadmin instead of admin
DROP POLICY IF EXISTS "Admins can insert blocks" ON public.blocks;
DROP POLICY IF EXISTS "Admins can update blocks" ON public.blocks;
DROP POLICY IF EXISTS "Admins can delete blocks" ON public.blocks;

CREATE POLICY "Superadmins can insert blocks" ON public.blocks
FOR INSERT WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can update blocks" ON public.blocks
FOR UPDATE USING (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can delete blocks" ON public.blocks
FOR DELETE USING (has_role(auth.uid(), 'superadmin'::app_role));