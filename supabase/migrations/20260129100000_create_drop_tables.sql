-- ============================================
-- Drop Tables System
-- ============================================

-- Step 1: Add item_number column to items table
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS item_number integer UNIQUE;
CREATE INDEX IF NOT EXISTS idx_items_item_number ON public.items(item_number);

-- Step 2: Create drop_tables table
CREATE TABLE public.drop_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drop_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drop tables are publicly readable"
  ON public.drop_tables FOR SELECT USING (true);

CREATE POLICY "Admins can insert drop tables"
  ON public.drop_tables FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update drop tables"
  ON public.drop_tables FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete drop tables"
  ON public.drop_tables FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER update_drop_tables_updated_at
  BEFORE UPDATE ON public.drop_tables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Step 3: Create drop_table_entries table
CREATE TABLE public.drop_table_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_table_id uuid NOT NULL REFERENCES public.drop_tables(id) ON DELETE CASCADE,
  item_number integer NOT NULL,
  item_name text NOT NULL,
  weight bigint NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drop_table_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drop table entries are publicly readable"
  ON public.drop_table_entries FOR SELECT USING (true);

CREATE POLICY "Admins can insert drop table entries"
  ON public.drop_table_entries FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update drop table entries"
  ON public.drop_table_entries FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete drop table entries"
  ON public.drop_table_entries FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX idx_drop_table_entries_table_id ON public.drop_table_entries(drop_table_id);

CREATE TRIGGER update_drop_table_entries_updated_at
  BEFORE UPDATE ON public.drop_table_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Step 4: Create DT1 drop table
INSERT INTO public.drop_tables (code, name, description)
VALUES ('DT1', 'Standard Monster Drop Table', 'Default loot table for monster kills');

-- Step 5: Seed items with item_number (upsert existing, insert new)
-- Weapons
INSERT INTO public.items (key, name, item_category, tier, item_number) VALUES
  ('ray_pistol', 'Ray Pistol', 'weapon', 1, 0),
  ('ray_pistol_t2', 'Ray Pistol Tier 2', 'weapon', 2, 33),
  ('ray_pistol_t3', 'Ray Pistol Tier 3', 'weapon', 3, 34),
  ('ray_pistol_t4', 'Ray Pistol Tier 4', 'weapon', 4, 35),
  ('ray_pistol_t5', 'Ray Pistol Tier 5', 'weapon', 5, 36),
  ('ray_pistol_t6', 'Ray Pistol Tier 6', 'weapon', 6, 37),
  ('ray_pistol_t7', 'Ray Pistol Tier 7', 'weapon', 7, 38),
  ('double_barrel_shotgun', 'Double Barrel Shotgun', 'weapon', 1, 1),
  ('double_barrel_shotgun_t2', 'Double Barrel Shotgun Tier 2', 'weapon', 2, 39),
  ('double_barrel_shotgun_t3', 'Double Barrel Shotgun Tier 3', 'weapon', 3, 40),
  ('double_barrel_shotgun_t4', 'Double Barrel Shotgun Tier 4', 'weapon', 4, 41),
  ('double_barrel_shotgun_t5', 'Double Barrel Shotgun Tier 5', 'weapon', 5, 42),
  ('double_barrel_shotgun_t6', 'Double Barrel Shotgun Tier 6', 'weapon', 6, 43),
  ('double_barrel_shotgun_t7', 'Double Barrel Shotgun Tier 7', 'weapon', 7, 44),
  ('musket', 'Musket', 'weapon', 1, 2),
  ('musket_t2', 'Musket Tier 2', 'weapon', 2, 45),
  ('musket_t3', 'Musket Tier 3', 'weapon', 3, 46),
  ('musket_t4', 'Musket Tier 4', 'weapon', 4, 47),
  ('musket_t5', 'Musket Tier 5', 'weapon', 5, 48),
  ('musket_t6', 'Musket Tier 6', 'weapon', 6, 49),
  ('musket_t7', 'Musket Tier 7', 'weapon', 7, 50),
  ('double_barrel_musket', 'Double Barrel Musket', 'weapon', 1, 3),
  ('double_barrel_musket_t2', 'Double Barrel Musket Tier 2', 'weapon', 2, 51),
  ('double_barrel_musket_t3', 'Double Barrel Musket Tier 3', 'weapon', 3, 52),
  ('double_barrel_musket_t4', 'Double Barrel Musket Tier 4', 'weapon', 4, 53),
  ('double_barrel_musket_t5', 'Double Barrel Musket Tier 5', 'weapon', 5, 54),
  ('double_barrel_musket_t6', 'Double Barrel Musket Tier 6', 'weapon', 6, 55),
  ('double_barrel_musket_t7', 'Double Barrel Musket Tier 7', 'weapon', 7, 56),
  ('ray_sniper', 'Ray Sniper', 'weapon', 1, 4),
  ('ray_sniper_t2', 'Ray Sniper Tier 2', 'weapon', 2, 57),
  ('ray_sniper_t3', 'Ray Sniper Tier 3', 'weapon', 3, 58),
  ('ray_sniper_t4', 'Ray Sniper Tier 4', 'weapon', 4, 59),
  ('ray_sniper_t5', 'Ray Sniper Tier 5', 'weapon', 5, 60),
  ('ray_sniper_t6', 'Ray Sniper Tier 6', 'weapon', 6, 61),
  ('ray_sniper_t7', 'Ray Sniper Tier 7', 'weapon', 7, 62),
  ('ray_shotgun', 'Ray Shotgun', 'weapon', 1, 5),
  ('ray_shotgun_t2', 'Ray Shotgun Tier 2', 'weapon', 2, 63),
  ('ray_shotgun_t3', 'Ray Shotgun Tier 3', 'weapon', 3, 64),
  ('ray_shotgun_t4', 'Ray Shotgun Tier 4', 'weapon', 4, 65),
  ('ray_shotgun_t5', 'Ray Shotgun Tier 5', 'weapon', 5, 66),
  ('ray_shotgun_t6', 'Ray Shotgun Tier 6', 'weapon', 6, 67),
  ('ray_shotgun_t7', 'Ray Shotgun Tier 7', 'weapon', 7, 68),
  ('ray_gun', 'Ray Gun', 'weapon', 1, 6),
  ('ray_gun_t2', 'Ray Gun Tier 2', 'weapon', 2, 69),
  ('ray_gun_t3', 'Ray Gun Tier 3', 'weapon', 3, 70),
  ('ray_gun_t4', 'Ray Gun Tier 4', 'weapon', 4, 71),
  ('ray_gun_t5', 'Ray Gun Tier 5', 'weapon', 5, 72),
  ('ray_gun_t6', 'Ray Gun Tier 6', 'weapon', 6, 73),
  ('ray_gun_t7', 'Ray Gun Tier 7', 'weapon', 7, 74),
  ('health_potion', 'Health Potion', 'consumable', 1, 8),
  ('plasma_auto_rifle', 'Plasma Auto Rifle', 'weapon', 1, 12),
  ('plasma_auto_rifle_t2', 'Plasma Auto Rifle Tier 2', 'weapon', 2, 75),
  ('plasma_auto_rifle_t3', 'Plasma Auto Rifle Tier 3', 'weapon', 3, 76),
  ('plasma_auto_rifle_t4', 'Plasma Auto Rifle Tier 4', 'weapon', 4, 77),
  ('plasma_auto_rifle_t5', 'Plasma Auto Rifle Tier 5', 'weapon', 5, 78),
  ('plasma_auto_rifle_t6', 'Plasma Auto Rifle Tier 6', 'weapon', 6, 79),
  ('plasma_auto_rifle_t7', 'Plasma Auto Rifle Tier 7', 'weapon', 7, 80),
  ('pistol', 'Pistol', 'weapon', 1, 15),
  ('pistol_t2', 'Pistol Tier 2', 'weapon', 2, 87),
  ('pistol_t3', 'Pistol Tier 3', 'weapon', 3, 88),
  ('pistol_t4', 'Pistol Tier 4', 'weapon', 4, 89),
  ('pistol_t5', 'Pistol Tier 5', 'weapon', 5, 90),
  ('pistol_t6', 'Pistol Tier 6', 'weapon', 6, 91),
  ('pistol_t7', 'Pistol Tier 7', 'weapon', 7, 92),
  ('m16', 'M16', 'weapon', 1, 17),
  ('m16_t2', 'M16 Tier 2', 'weapon', 2, 93),
  ('m16_t3', 'M16 Tier 3', 'weapon', 3, 94),
  ('m16_t4', 'M16 Tier 4', 'weapon', 4, 95),
  ('m16_t5', 'M16 Tier 5', 'weapon', 5, 96),
  ('m16_t6', 'M16 Tier 6', 'weapon', 6, 97),
  ('m16_t7', 'M16 Tier 7', 'weapon', 7, 98),
  ('m27', 'M27', 'weapon', 1, 18),
  ('m27_t2', 'M27 Tier 2', 'weapon', 2, 99),
  ('m27_t3', 'M27 Tier 3', 'weapon', 3, 100),
  ('m27_t4', 'M27 Tier 4', 'weapon', 4, 101),
  ('m27_t5', 'M27 Tier 5', 'weapon', 5, 102),
  ('m27_t6', 'M27 Tier 6', 'weapon', 6, 103),
  ('m27_t7', 'M27 Tier 7', 'weapon', 7, 104),
  ('dragonuv', 'Dragonuv', 'weapon', 1, 19),
  ('dragonuv_t2', 'Dragonuv Tier 2', 'weapon', 2, 105),
  ('dragonuv_t3', 'Dragonuv Tier 3', 'weapon', 3, 106),
  ('dragonuv_t4', 'Dragonuv Tier 4', 'weapon', 4, 107),
  ('dragonuv_t5', 'Dragonuv Tier 5', 'weapon', 5, 108),
  ('dragonuv_t6', 'Dragonuv Tier 6', 'weapon', 6, 109),
  ('dragonuv_t7', 'Dragonuv Tier 7', 'weapon', 7, 110),
  ('ak47', 'Ak47', 'weapon', 1, 20),
  ('ak47_t2', 'Ak47 Tier 2', 'weapon', 2, 111),
  ('ak47_t3', 'Ak47 Tier 3', 'weapon', 3, 112),
  ('ak47_t4', 'Ak47 Tier 4', 'weapon', 4, 113),
  ('ak47_t5', 'Ak47 Tier 5', 'weapon', 5, 114),
  ('ak47_t6', 'Ak47 Tier 6', 'weapon', 6, 115),
  ('ak47_t7', 'Ak47 Tier 7', 'weapon', 7, 116),
  ('rpg_ammo', 'Rpg Ammo', 'ammo', 1, 21),
  ('grenade', 'Grenade', 'weapon', 1, 23),
  ('ash_pistol', 'Ash Pistol', 'weapon', 1, 173),
  ('ash_pistol_t2', 'Ash Pistol Tier 2', 'weapon', 2, 174),
  ('ash_pistol_t3', 'Ash Pistol Tier 3', 'weapon', 3, 175),
  ('ash_pistol_t4', 'Ash Pistol Tier 4', 'weapon', 4, 176),
  ('ash_pistol_t5', 'Ash Pistol Tier 5', 'weapon', 5, 177),
  ('ash_pistol_t6', 'Ash Pistol Tier 6', 'weapon', 6, 178),
  ('ash_pistol_t7', 'Ash Pistol Tier 7', 'weapon', 7, 179),
  ('flame_glove', 'Flame Glove', 'weapon', 1, 193),
  ('flame_glove_t2', 'Flame Glove Tier 2', 'weapon', 2, 194),
  ('flame_glove_t3', 'Flame Glove Tier 3', 'weapon', 3, 195),
  ('flame_glove_t4', 'Flame Glove Tier 4', 'weapon', 4, 196),
  ('flame_glove_t5', 'Flame Glove Tier 5', 'weapon', 5, 197),
  ('flame_glove_t6', 'Flame Glove Tier 6', 'weapon', 6, 198),
  ('flame_glove_t7', 'Flame Glove Tier 7', 'weapon', 7, 199),
  ('flamethrower', 'Flamethrower', 'weapon', 1, 180),
  ('flamethrower_t2', 'Flamethrower Tier 2', 'weapon', 2, 181),
  ('flamethrower_t3', 'Flamethrower Tier 3', 'weapon', 3, 182),
  ('flamethrower_t4', 'Flamethrower Tier 4', 'weapon', 4, 183),
  ('flamethrower_t5', 'Flamethrower Tier 5', 'weapon', 5, 184),
  ('flamethrower_t6', 'Flamethrower Tier 6', 'weapon', 6, 185),
  ('flamethrower_t7', 'Flamethrower Tier 7', 'weapon', 7, 186),
  ('flame_ammo', 'Flame Ammo', 'ammo', 1, 189),
  ('nothing', 'Nothing', 'none', 0, -1)
ON CONFLICT (key) DO UPDATE SET item_number = EXCLUDED.item_number;

-- Step 6: Seed DT1 drop table entries
INSERT INTO public.drop_table_entries (drop_table_id, item_number, item_name, weight, sort_order)
SELECT dt.id, v.item_number, v.item_name, v.weight, v.sort_order
FROM public.drop_tables dt
CROSS JOIN (VALUES
  (0, 'Ray Pistol', 64000000, 1),
  (33, 'Ray Pistol Tier 2', 6400000, 2),
  (34, 'Ray Pistol Tier 3', 640000, 3),
  (35, 'Ray Pistol Tier 4', 64000, 4),
  (36, 'Ray Pistol Tier 5', 6400, 5),
  (37, 'Ray Pistol Tier 6', 640, 6),
  (38, 'Ray Pistol Tier 7', 64, 7),
  (1, 'Double Barrel Shotgun', 64000000, 8),
  (39, 'Double Barrel Shotgun Tier 2', 6400000, 9),
  (40, 'Double Barrel Shotgun Tier 3', 640000, 10),
  (41, 'Double Barrel Shotgun Tier 4', 64000, 11),
  (42, 'Double Barrel Shotgun Tier 5', 6400, 12),
  (43, 'Double Barrel Shotgun Tier 6', 640, 13),
  (44, 'Double Barrel Shotgun Tier 7', 64, 14),
  (2, 'Musket', 128000000, 15),
  (45, 'Musket Tier 2', 12800000, 16),
  (46, 'Musket Tier 3', 1280000, 17),
  (47, 'Musket Tier 4', 128000, 18),
  (48, 'Musket Tier 5', 12800, 19),
  (49, 'Musket Tier 6', 1280, 20),
  (50, 'Musket Tier 7', 128, 21),
  (3, 'Double Barrel Musket', 61000000, 22),
  (51, 'Double Barrel Musket Tier 2', 6100000, 23),
  (52, 'Double Barrel Musket Tier 3', 610000, 24),
  (53, 'Double Barrel Musket Tier 4', 61000, 25),
  (54, 'Double Barrel Musket Tier 5', 6100, 26),
  (55, 'Double Barrel Musket Tier 6', 610, 27),
  (56, 'Double Barrel Musket Tier 7', 61, 28),
  (4, 'Ray Sniper', 16000000, 29),
  (57, 'Ray Sniper Tier 2', 1600000, 30),
  (58, 'Ray Sniper Tier 3', 160000, 31),
  (59, 'Ray Sniper Tier 4', 16000, 32),
  (60, 'Ray Sniper Tier 5', 1600, 33),
  (61, 'Ray Sniper Tier 6', 160, 34),
  (62, 'Ray Sniper Tier 7', 16, 35),
  (5, 'Ray Shotgun', 16000000, 36),
  (63, 'Ray Shotgun Tier 2', 1600000, 37),
  (64, 'Ray Shotgun Tier 3', 160000, 38),
  (65, 'Ray Shotgun Tier 4', 16000, 39),
  (66, 'Ray Shotgun Tier 5', 1600, 40),
  (67, 'Ray Shotgun Tier 6', 160, 41),
  (68, 'Ray Shotgun Tier 7', 16, 42),
  (6, 'Ray Gun', 16000000, 43),
  (69, 'Ray Gun Tier 2', 1600000, 44),
  (70, 'Ray Gun Tier 3', 160000, 45),
  (71, 'Ray Gun Tier 4', 16000, 46),
  (72, 'Ray Gun Tier 5', 1600, 47),
  (73, 'Ray Gun Tier 6', 160, 48),
  (74, 'Ray Gun Tier 7', 16, 49),
  (8, 'Health Potion', 128000000, 50),
  (12, 'Plasma Auto Rifle', 32000000, 51),
  (75, 'Plasma Auto Rifle Tier 2', 3200000, 52),
  (76, 'Plasma Auto Rifle Tier 3', 320000, 53),
  (77, 'Plasma Auto Rifle Tier 4', 32000, 54),
  (78, 'Plasma Auto Rifle Tier 5', 3200, 55),
  (79, 'Plasma Auto Rifle Tier 6', 320, 56),
  (80, 'Plasma Auto Rifle Tier 7', 32, 57),
  (15, 'Pistol', 1000000, 58),
  (87, 'Pistol Tier 2', 100000, 59),
  (88, 'Pistol Tier 3', 10000, 60),
  (89, 'Pistol Tier 4', 1000, 61),
  (90, 'Pistol Tier 5', 100, 62),
  (91, 'Pistol Tier 6', 10, 63),
  (92, 'Pistol Tier 7', 1, 64),
  (17, 'M16', 8000000, 65),
  (93, 'M16 Tier 2', 800000, 66),
  (94, 'M16 Tier 3', 80000, 67),
  (95, 'M16 Tier 4', 8000, 68),
  (96, 'M16 Tier 5', 800, 69),
  (97, 'M16 Tier 6', 80, 70),
  (98, 'M16 Tier 7', 8, 71),
  (18, 'M27', 8000000, 72),
  (99, 'M27 Tier 2', 800000, 73),
  (100, 'M27 Tier 3', 80000, 74),
  (101, 'M27 Tier 4', 8000, 75),
  (102, 'M27 Tier 5', 800, 76),
  (103, 'M27 Tier 6', 80, 77),
  (104, 'M27 Tier 7', 8, 78),
  (19, 'Dragonuv', 4000000, 79),
  (105, 'Dragonuv Tier 2', 400000, 80),
  (106, 'Dragonuv Tier 3', 40000, 81),
  (107, 'Dragonuv Tier 4', 4000, 82),
  (108, 'Dragonuv Tier 5', 400, 83),
  (109, 'Dragonuv Tier 6', 40, 84),
  (110, 'Dragonuv Tier 7', 4, 85),
  (20, 'Ak47', 16000000, 86),
  (111, 'Ak47 Tier 2', 1600000, 87),
  (112, 'Ak47 Tier 3', 160000, 88),
  (113, 'Ak47 Tier 4', 16000, 89),
  (114, 'Ak47 Tier 5', 1600, 90),
  (115, 'Ak47 Tier 6', 160, 91),
  (116, 'Ak47 Tier 7', 16, 92),
  (21, 'Rpg Ammo', 56000000, 93),
  (23, 'Grenade', 256000000, 94),
  (173, 'Ash Pistol', 32000000, 95),
  (174, 'Ash Pistol Tier 2', 800000, 96),
  (175, 'Ash Pistol Tier 3', 80000, 97),
  (176, 'Ash Pistol Tier 4', 8000, 98),
  (177, 'Ash Pistol Tier 5', 800, 99),
  (178, 'Ash Pistol Tier 6', 80, 100),
  (179, 'Ash Pistol Tier 7', 8, 101),
  (193, 'Flame Glove', 32000000, 102),
  (194, 'Flame Glove Tier 2', 800000, 103),
  (195, 'Flame Glove Tier 3', 80000, 104),
  (196, 'Flame Glove Tier 4', 8000, 105),
  (197, 'Flame Glove Tier 5', 800, 106),
  (198, 'Flame Glove Tier 6', 80, 107),
  (199, 'Flame Glove Tier 7', 8, 108),
  (180, 'Flamethrower', 2000000, 109),
  (181, 'Flamethrower Tier 2', 200000, 110),
  (182, 'Flamethrower Tier 3', 20000, 111),
  (183, 'Flamethrower Tier 4', 2000, 112),
  (184, 'Flamethrower Tier 5', 200, 113),
  (185, 'Flamethrower Tier 6', 20, 114),
  (186, 'Flamethrower Tier 7', 2, 115),
  (189, 'Flame Ammo', 500000000, 116),
  (-1, 'Nothing', 409600000, 117)
) AS v(item_number, item_name, weight, sort_order)
WHERE dt.code = 'DT1';
