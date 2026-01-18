-- Add symmetry column to seed_definitions
ALTER TABLE public.seed_definitions 
ADD COLUMN symmetry text NOT NULL DEFAULT 'none';

-- Add check constraint for valid values
ALTER TABLE public.seed_definitions 
ADD CONSTRAINT seed_definitions_symmetry_check 
CHECK (symmetry IN ('none', '2xs', '4r', '4x2'));