-- Add velocity column to bullet_definitions table
ALTER TABLE public.bullet_definitions 
ADD COLUMN velocity numeric NOT NULL DEFAULT 100;

-- Update default velocities for each tier (100, 150, 200, ...)
UPDATE public.bullet_definitions SET velocity = 100 WHERE tier = 1;
UPDATE public.bullet_definitions SET velocity = 150 WHERE tier = 2;
UPDATE public.bullet_definitions SET velocity = 200 WHERE tier = 3;
UPDATE public.bullet_definitions SET velocity = 250 WHERE tier = 4;
UPDATE public.bullet_definitions SET velocity = 300 WHERE tier = 5;
UPDATE public.bullet_definitions SET velocity = 350 WHERE tier = 6;
UPDATE public.bullet_definitions SET velocity = 400 WHERE tier = 7;
UPDATE public.bullet_definitions SET velocity = 450 WHERE tier = 8;
UPDATE public.bullet_definitions SET velocity = 500 WHERE tier = 9;
UPDATE public.bullet_definitions SET velocity = 550 WHERE tier = 10;