-- Create storage bucket for billboard media
INSERT INTO storage.buckets (id, name, public) VALUES ('billboard-media', 'billboard-media', true);

-- Create table for billboard wall configurations
CREATE TABLE public.billboard_walls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wall_number INTEGER NOT NULL CHECK (wall_number >= 1 AND wall_number <= 4),
  wall_type TEXT NOT NULL CHECK (wall_type IN ('screen', 'media-grid')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(wall_number)
);

-- Create table for screen URLs (wall 1)
CREATE TABLE public.screen_urls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wall_id UUID NOT NULL REFERENCES public.billboard_walls(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL CHECK (slot_number >= 1 AND slot_number <= 4),
  url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(wall_id, slot_number)
);

-- Create table for media grid items (walls 2-4)
CREATE TABLE public.media_grid_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wall_id UUID NOT NULL REFERENCES public.billboard_walls(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL CHECK (slot_number >= 1 AND slot_number <= 6),
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(wall_id, slot_number)
);

-- Enable Row Level Security
ALTER TABLE public.billboard_walls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screen_urls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_grid_items ENABLE ROW LEVEL SECURITY;

-- Create policies (public read, no authentication required for display)
CREATE POLICY "Billboard walls are publicly readable" 
ON public.billboard_walls 
FOR SELECT 
USING (true);

CREATE POLICY "Screen URLs are publicly readable" 
ON public.screen_urls 
FOR SELECT 
USING (true);

CREATE POLICY "Media grid items are publicly readable" 
ON public.media_grid_items 
FOR SELECT 
USING (true);

-- Allow public insert/update for admin functionality (you can restrict this later with auth)
CREATE POLICY "Allow public insert on billboard walls" 
ON public.billboard_walls 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update on billboard walls" 
ON public.billboard_walls 
FOR UPDATE 
USING (true);

CREATE POLICY "Allow public insert on screen URLs" 
ON public.screen_urls 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update on screen URLs" 
ON public.screen_urls 
FOR UPDATE 
USING (true);

CREATE POLICY "Allow public insert on media grid items" 
ON public.media_grid_items 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update on media grid items" 
ON public.media_grid_items 
FOR UPDATE 
USING (true);

-- Create storage policies for billboard media
CREATE POLICY "Billboard media is publicly accessible" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'billboard-media');

CREATE POLICY "Allow public upload to billboard media" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'billboard-media');

-- Insert default wall configurations
INSERT INTO public.billboard_walls (wall_number, wall_type) VALUES
  (1, 'screen'),
  (2, 'media-grid'),
  (3, 'media-grid'),
  (4, 'media-grid');

-- Insert default screen URLs for wall 1
INSERT INTO public.screen_urls (wall_id, slot_number, url) 
SELECT id, 1, 'https://waterfall.network'
FROM public.billboard_walls 
WHERE wall_number = 1;

INSERT INTO public.screen_urls (wall_id, slot_number, url) 
SELECT id, generate_series(2, 4), NULL
FROM public.billboard_walls 
WHERE wall_number = 1;

-- Insert empty slots for media grid walls (2-4)
INSERT INTO public.media_grid_items (wall_id, slot_number, media_url, media_type)
SELECT w.id, generate_series(1, 6), NULL, NULL
FROM public.billboard_walls w
WHERE w.wall_number IN (2, 3, 4);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_billboard_walls_updated_at
    BEFORE UPDATE ON public.billboard_walls
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_screen_urls_updated_at
    BEFORE UPDATE ON public.screen_urls
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_media_grid_items_updated_at
    BEFORE UPDATE ON public.media_grid_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();