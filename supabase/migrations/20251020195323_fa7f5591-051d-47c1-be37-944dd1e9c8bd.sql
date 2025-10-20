
-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Superadmins can insert blocks" ON public.blocks;

-- Create a new INSERT policy that directly checks the user_roles table
CREATE POLICY "Superadmins can insert blocks" 
ON public.blocks
FOR INSERT 
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'superadmin'::app_role
  )
);
