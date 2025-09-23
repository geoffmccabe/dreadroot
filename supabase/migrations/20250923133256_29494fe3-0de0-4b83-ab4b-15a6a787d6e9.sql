-- Create user profiles table for user data including coins
CREATE TABLE public.user_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  coins INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for user profiles (public readable, user can update their own)
CREATE POLICY "User profiles are publicly readable" 
ON public.user_profiles 
FOR SELECT 
USING (true);

CREATE POLICY "Users can update their own profile" 
ON public.user_profiles 
FOR UPDATE 
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own profile" 
ON public.user_profiles 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Create user inventory table for blocks they own
CREATE TABLE public.user_inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  item_type TEXT NOT NULL DEFAULT 'fortress_block',
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;

-- Create policies for inventory
CREATE POLICY "Users can view their own inventory" 
ON public.user_inventory 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own inventory" 
ON public.user_inventory 
FOR UPDATE 
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own inventory" 
ON public.user_inventory 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Create placed blocks table for world persistence
CREATE TABLE public.placed_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  position_z REAL NOT NULL,
  block_type TEXT NOT NULL DEFAULT 'fortress_block',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.placed_blocks ENABLE ROW LEVEL SECURITY;

-- Create policies for placed blocks (publicly readable so all players can see blocks)
CREATE POLICY "Placed blocks are publicly readable" 
ON public.placed_blocks 
FOR SELECT 
USING (true);

CREATE POLICY "Users can place blocks" 
ON public.placed_blocks 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can remove their own blocks" 
ON public.placed_blocks 
FOR DELETE 
USING (user_id = auth.uid());

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_inventory_updated_at
BEFORE UPDATE ON public.user_inventory
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_placed_blocks_updated_at
BEFORE UPDATE ON public.placed_blocks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for placed blocks so all players see new blocks immediately
ALTER TABLE public.placed_blocks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD table public.placed_blocks;