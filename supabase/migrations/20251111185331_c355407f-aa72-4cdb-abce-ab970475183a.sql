-- Check and populate items table if empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.items LIMIT 1) THEN
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
  END IF;
END $$;

-- Add item_id column to user_inventory if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_inventory' AND column_name = 'item_id'
  ) THEN
    ALTER TABLE public.user_inventory 
    ADD COLUMN item_id uuid REFERENCES public.items(id) ON DELETE CASCADE;
    
    -- Populate item_id based on existing item_type
    UPDATE public.user_inventory 
    SET item_id = items.id
    FROM public.items
    WHERE user_inventory.item_type = items.key;
    
    -- Create indexes
    CREATE INDEX idx_user_inventory_item_id ON public.user_inventory(item_id);
    CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id ON public.user_inventory(user_id);
  END IF;
END $$;

-- Create user_equipped_items table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.user_equipped_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  slot_type text NOT NULL,
  equipped_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, slot_type)
);

-- Enable RLS on user_equipped_items if not already enabled
ALTER TABLE public.user_equipped_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own equipped items" ON public.user_equipped_items;
DROP POLICY IF EXISTS "Users can insert their own equipped items" ON public.user_equipped_items;
DROP POLICY IF EXISTS "Users can update their own equipped items" ON public.user_equipped_items;
DROP POLICY IF EXISTS "Users can delete their own equipped items" ON public.user_equipped_items;
DROP POLICY IF EXISTS "Admins can view all equipped items" ON public.user_equipped_items;

-- Create policies
CREATE POLICY "Users can view their own equipped items" 
ON public.user_equipped_items 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own equipped items" 
ON public.user_equipped_items 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own equipped items" 
ON public.user_equipped_items 
FOR UPDATE 
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own equipped items" 
ON public.user_equipped_items 
FOR DELETE 
USING (user_id = auth.uid());

CREATE POLICY "Admins can view all equipped items" 
ON public.user_equipped_items 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_equipped_items_user_id ON public.user_equipped_items(user_id);
CREATE INDEX IF NOT EXISTS idx_user_equipped_items_item_id ON public.user_equipped_items(item_id);