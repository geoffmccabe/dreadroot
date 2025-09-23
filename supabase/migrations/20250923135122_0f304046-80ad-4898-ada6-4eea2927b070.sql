-- Drop ALL existing policies on user tables
DROP POLICY IF EXISTS "User profiles are publicly readable" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Allow demo users to manage profiles" ON public.user_profiles;

DROP POLICY IF EXISTS "Users can view their own inventory" ON public.user_inventory;
DROP POLICY IF EXISTS "Users can update their own inventory" ON public.user_inventory;
DROP POLICY IF EXISTS "Users can insert their own inventory" ON public.user_inventory;
DROP POLICY IF EXISTS "Allow demo users to manage inventory" ON public.user_inventory;

DROP POLICY IF EXISTS "Placed blocks are publicly readable" ON public.placed_blocks;
DROP POLICY IF EXISTS "Users can place blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Users can remove their own blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Allow demo users to place blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Allow demo users to remove blocks" ON public.placed_blocks;

-- Create permissive policies for demo users
CREATE POLICY "Public access to user profiles" 
ON public.user_profiles 
FOR ALL 
USING (true)
WITH CHECK (true);

CREATE POLICY "Public access to user inventory" 
ON public.user_inventory 
FOR ALL 
USING (true)
WITH CHECK (true);

CREATE POLICY "Public access to placed blocks" 
ON public.placed_blocks 
FOR ALL 
USING (true)
WITH CHECK (true);