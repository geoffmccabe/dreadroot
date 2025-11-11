-- Step 1: Create items catalog table
CREATE TABLE public.items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  item_category text NOT NULL DEFAULT 'block',
  cost integer NOT NULL DEFAULT 10,
  rarity text NOT NULL DEFAULT 'common',
  tier integer NOT NULL DEFAULT 0,
  class text NOT NULL DEFAULT 'basic',
  properties jsonb DEFAULT '{}'::jsonb,
  texture_url text,
  glow_factor real,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on items
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- Items are publicly readable
CREATE POLICY "Items are publicly readable" 
ON public.items 
FOR SELECT 
USING (true);

-- Superadmins can manage items
CREATE POLICY "Superadmins can insert items" 
ON public.items 
FOR INSERT 
WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can update items" 
ON public.items 
FOR UPDATE 
USING (has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can delete items" 
ON public.items 
FOR DELETE 
USING (has_role(auth.uid(), 'superadmin'::app_role));

-- Step 2: Migrate existing blocks data to items table
INSERT INTO public.items (
  key, 
  name, 
  description, 
  item_category, 
  cost, 
  rarity, 
  tier, 
  class, 
  properties, 
  texture_url, 
  glow_factor,
  created_at,
  updated_at
)
SELECT 
  key,
  name,
  description,
  'block' as item_category,
  cost,
  rarity,
  tier,
  class,
  properties,
  texture_url,
  glow_factor,
  created_at,
  updated_at
FROM public.blocks;

-- Step 3: Add item_id column to user_inventory
ALTER TABLE public.user_inventory 
ADD COLUMN item_id uuid REFERENCES public.items(id) ON DELETE CASCADE;

-- Populate item_id based on existing item_type
UPDATE public.user_inventory 
SET item_id = items.id
FROM public.items
WHERE user_inventory.item_type = items.key;

-- Create indexes for performance
CREATE INDEX idx_user_inventory_item_id ON public.user_inventory(item_id);
CREATE INDEX idx_user_inventory_user_id ON public.user_inventory(user_id);

-- Step 4: Create user_equipped_items table
CREATE TABLE public.user_equipped_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  slot_type text NOT NULL,
  equipped_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, slot_type)
);

-- Enable RLS on user_equipped_items
ALTER TABLE public.user_equipped_items ENABLE ROW LEVEL SECURITY;

-- Users can view their own equipped items
CREATE POLICY "Users can view their own equipped items" 
ON public.user_equipped_items 
FOR SELECT 
USING (user_id = auth.uid());

-- Users can insert their own equipped items
CREATE POLICY "Users can insert their own equipped items" 
ON public.user_equipped_items 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Users can update their own equipped items
CREATE POLICY "Users can update their own equipped items" 
ON public.user_equipped_items 
FOR UPDATE 
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Users can delete their own equipped items
CREATE POLICY "Users can delete their own equipped items" 
ON public.user_equipped_items 
FOR DELETE 
USING (user_id = auth.uid());

-- Admins can view all equipped items
CREATE POLICY "Admins can view all equipped items" 
ON public.user_equipped_items 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- Create indexes for performance
CREATE INDEX idx_user_equipped_items_user_id ON public.user_equipped_items(user_id);
CREATE INDEX idx_user_equipped_items_item_id ON public.user_equipped_items(item_id);

-- Add trigger for updated_at on items table
CREATE TRIGGER update_items_updated_at
BEFORE UPDATE ON public.items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();