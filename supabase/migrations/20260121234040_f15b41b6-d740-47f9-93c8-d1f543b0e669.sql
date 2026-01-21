-- Create shombie_definitions table (enemy tier configurations)
CREATE TABLE public.shombie_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE DEFAULT 1,
  name TEXT NOT NULL DEFAULT 'Shombie',
  texture_url TEXT DEFAULT NULL,
  speed REAL NOT NULL DEFAULT 2.0,
  health REAL NOT NULL DEFAULT 100,
  damage_per_hit REAL NOT NULL DEFAULT 10,
  knockback_received REAL NOT NULL DEFAULT 2.0,
  spawn_chance_per_minute REAL NOT NULL DEFAULT 1.0,
  ai_config JSONB DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.shombie_definitions ENABLE ROW LEVEL SECURITY;

-- Allow all users to read definitions
CREATE POLICY "Anyone can view shombie definitions" 
ON public.shombie_definitions 
FOR SELECT 
USING (true);

-- Allow admins to modify definitions
CREATE POLICY "Admins can manage shombie definitions" 
ON public.shombie_definitions 
FOR ALL 
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- Insert tier 1 default
INSERT INTO public.shombie_definitions (tier, name, speed, health, damage_per_hit, knockback_received, spawn_chance_per_minute)
VALUES (1, 'Shambler', 2.0, 100, 10, 2.0, 1.0);

-- Add updated_at trigger
CREATE TRIGGER update_shombie_definitions_updated_at
BEFORE UPDATE ON public.shombie_definitions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();