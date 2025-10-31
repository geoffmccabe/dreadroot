-- Create table for per-token user balances
CREATE TABLE public.user_token_balances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  token_theme_id UUID NOT NULL,
  coins INTEGER NOT NULL DEFAULT 100,
  blockchain_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, token_theme_id)
);

-- Enable RLS
ALTER TABLE public.user_token_balances ENABLE ROW LEVEL SECURITY;

-- Users can view their own token balances
CREATE POLICY "Users can view their own token balances" 
ON public.user_token_balances 
FOR SELECT 
USING (user_id = auth.uid());

-- Users can insert their own token balances
CREATE POLICY "Users can insert their own token balances" 
ON public.user_token_balances 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Users can update their own token balances
CREATE POLICY "Users can update their own token balances" 
ON public.user_token_balances 
FOR UPDATE 
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Add trigger for updated_at
CREATE TRIGGER update_user_token_balances_updated_at
BEFORE UPDATE ON public.user_token_balances
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate existing data from user_profiles to user_token_balances
-- Create balances for each user for all active token themes
INSERT INTO public.user_token_balances (user_id, token_theme_id, coins, blockchain_address)
SELECT 
  up.user_id,
  tt.id as token_theme_id,
  up.coins,
  up.blockchain_address
FROM user_profiles up
CROSS JOIN token_themes tt
WHERE tt.is_active = true
ON CONFLICT (user_id, token_theme_id) DO NOTHING;

-- Update handle_new_user function to create token balances for all active themes
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Insert user profile with starting coins (keeping for backwards compatibility)
  INSERT INTO public.user_profiles (user_id, coins)
  VALUES (NEW.id, 100);
  
  -- Insert default 'user' role for the new user
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Create token balances for all active token themes
  INSERT INTO public.user_token_balances (user_id, token_theme_id, coins)
  SELECT NEW.id, id, 100
  FROM token_themes
  WHERE is_active = true;
  
  RETURN NEW;
END;
$function$;