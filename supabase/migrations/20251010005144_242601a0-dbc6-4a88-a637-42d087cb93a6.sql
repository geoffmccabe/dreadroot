-- First, remove duplicate blocks (keep the oldest one based on created_at)
DELETE FROM public.placed_blocks a
USING public.placed_blocks b
WHERE a.id > b.id 
  AND a.position_x = b.position_x 
  AND a.position_y = b.position_y 
  AND a.position_z = b.position_z;

-- Create role enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create user_roles table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies first (before dropping function)
DROP POLICY IF EXISTS "Public access to placed blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Anyone can view placed blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Authenticated users can place blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Users can delete own blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Admins can delete any block" ON public.placed_blocks;
DROP POLICY IF EXISTS "Users can update own blocks" ON public.placed_blocks;
DROP POLICY IF EXISTS "Admins can update any block" ON public.placed_blocks;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;

-- Now drop and recreate security definer function
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role) CASCADE;

CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Recreate all RLS policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Recreate all RLS policies for placed_blocks with ownership
CREATE POLICY "Anyone can view placed blocks"
ON public.placed_blocks
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can place blocks"
ON public.placed_blocks
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own blocks"
ON public.placed_blocks
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can delete any block"
ON public.placed_blocks
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can update own blocks"
ON public.placed_blocks
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can update any block"
ON public.placed_blocks
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (true);