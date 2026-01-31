-- Create walapa_definitions table (floating whale enemy configurations)
CREATE TABLE public.walapa_definitions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tier INTEGER NOT NULL UNIQUE DEFAULT 1,
  name TEXT NOT NULL DEFAULT 'Sky Drifter',
  body_texture_url TEXT DEFAULT NULL,
  belly_texture_url TEXT DEFAULT NULL,
  eyes_texture_url TEXT DEFAULT NULL,
  speed REAL NOT NULL DEFAULT 100,
  health REAL NOT NULL DEFAULT 500,
  wait_time_seconds REAL NOT NULL DEFAULT 30,
  min_tree_tier INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.walapa_definitions ENABLE ROW LEVEL SECURITY;

-- Allow all users to read definitions
CREATE POLICY "Anyone can view walapa definitions"
ON public.walapa_definitions
FOR SELECT
USING (true);

-- Allow admins to modify definitions
CREATE POLICY "Admins can manage walapa definitions"
ON public.walapa_definitions
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- Insert tier 1 default
INSERT INTO public.walapa_definitions (tier, name, speed, health, wait_time_seconds, min_tree_tier)
VALUES (1, 'Sky Drifter', 100, 500, 30, 1);

-- Add updated_at trigger
CREATE TRIGGER update_walapa_definitions_updated_at
BEFORE UPDATE ON public.walapa_definitions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
