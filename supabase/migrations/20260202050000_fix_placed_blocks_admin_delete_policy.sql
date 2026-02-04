-- Fix: "Admins can delete any block" policy to also include superadmin role
-- Previously only checked for 'admin', so superadmins couldn't delete blocks via mining

DROP POLICY IF EXISTS "Admins can delete any block" ON public.placed_blocks;

CREATE POLICY "Admins can delete any block"
ON public.placed_blocks
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'superadmin'::app_role)
);
