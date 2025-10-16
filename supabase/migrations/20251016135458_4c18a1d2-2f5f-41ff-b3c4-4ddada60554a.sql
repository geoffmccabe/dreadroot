-- Phase 2B: Database Security & Auto-Profile Setup

-- Step 1: Create trigger function to auto-create user profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, coins)
  VALUES (NEW.id, 100);
  RETURN NEW;
END;
$$;

-- Step 2: Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Step 3: Update user_profiles - make user_id NOT NULL and add constraint
ALTER TABLE public.user_profiles 
  ALTER COLUMN user_id SET NOT NULL,
  ADD CONSTRAINT user_profiles_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) 
    ON DELETE CASCADE;

-- Step 4: Update user_inventory - make user_id NOT NULL
ALTER TABLE public.user_inventory 
  ALTER COLUMN user_id SET NOT NULL;

-- Step 5: Drop existing overly permissive policies
DROP POLICY IF EXISTS "Public access to user profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Public access to user inventory" ON public.user_inventory;

-- Step 6: Create secure RLS policies for user_profiles
CREATE POLICY "Users can view their own profile"
  ON public.user_profiles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own profile"
  ON public.user_profiles
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Step 7: Create secure RLS policies for user_inventory
CREATE POLICY "Users can view their own inventory"
  ON public.user_inventory
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert into their own inventory"
  ON public.user_inventory
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own inventory"
  ON public.user_inventory
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own inventory"
  ON public.user_inventory
  FOR DELETE
  USING (user_id = auth.uid());