-- Add position columns to billboard_walls table
ALTER TABLE public.billboard_walls 
ADD COLUMN position_x REAL DEFAULT 0.0,
ADD COLUMN position_y REAL DEFAULT 0.0, 
ADD COLUMN position_z REAL DEFAULT 0.0,
ADD COLUMN rotation_x REAL DEFAULT 0.0,
ADD COLUMN rotation_y REAL DEFAULT 0.0,
ADD COLUMN rotation_z REAL DEFAULT 0.0;

-- Set default positions for existing walls
UPDATE public.billboard_walls SET 
  position_x = 0.0, position_y = 10.0, position_z = -9.5,
  rotation_x = 0.0, rotation_y = 0.0, rotation_z = 0.0
WHERE wall_number = 1;

UPDATE public.billboard_walls SET 
  position_x = 17.0, position_y = 8.0, position_z = -23.0,
  rotation_x = 0.0, rotation_y = -1.5708, rotation_z = 0.0
WHERE wall_number = 2;

UPDATE public.billboard_walls SET 
  position_x = 0.0, position_y = 8.0, position_z = -37.0,
  rotation_x = 0.0, rotation_y = 3.14159, rotation_z = 0.0
WHERE wall_number = 3;

UPDATE public.billboard_walls SET 
  position_x = -17.0, position_y = 8.0, position_z = -23.0,
  rotation_x = 0.0, rotation_y = 1.5708, rotation_z = 0.0
WHERE wall_number = 4;