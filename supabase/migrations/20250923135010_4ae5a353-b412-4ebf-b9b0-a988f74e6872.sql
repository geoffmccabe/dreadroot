-- Fix RLS policies to allow demo users (temporary solution)
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view their own inventory" ON public.user_inventory;
DROP POLICY IF EXISTS "Users can update their own inventory" ON public.user_inventory;
DROP POLICY IF EXISTS "Users can insert their own inventory" ON public.user_inventory;
DROP POLICY IF EXISTS "Users can place blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Users can remove their own blocks" ON public.placed_blocks;

-- Create new policies that allow demo users
CREATE POLICY "Allow demo users to manage profiles" 
ON public.user_profiles 
FOR ALL 
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow demo users to manage inventory" 
ON public.user_inventory 
FOR ALL 
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow demo users to place blocks" 
ON public.placed_blocks 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow demo users to remove blocks" 
ON public.placed_blocks 
FOR DELETE 
USING (true);