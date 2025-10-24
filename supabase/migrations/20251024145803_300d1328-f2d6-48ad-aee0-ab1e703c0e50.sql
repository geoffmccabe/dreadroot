-- Insert 29 Mystery blocks (Tier 2 through Tier 30)
INSERT INTO blocks (key, name, description, cost, tier, category, rarity, class, properties, glow_factor) VALUES
-- Tier 2-3: Common (glow_factor 1)
('mystery_1', 'Tier 2', 'Tier 2', 0, 2, 'special', 'common', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 1),
('mystery_2', 'Tier 3', 'Tier 3', 0, 3, 'special', 'common', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 1),

-- Tier 4-6: Uncommon (glow_factor 2)
('mystery_3', 'Tier 4', 'Tier 4', 0, 4, 'special', 'uncommon', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 2),
('mystery_4', 'Tier 5', 'Tier 5', 0, 5, 'special', 'uncommon', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 2),
('mystery_5', 'Tier 6', 'Tier 6', 0, 6, 'special', 'uncommon', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 2),

-- Tier 7-9: Rare (glow_factor 3)
('mystery_6', 'Tier 7', 'Tier 7', 0, 7, 'special', 'rare', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 3),
('mystery_7', 'Tier 8', 'Tier 8', 0, 8, 'special', 'rare', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 3),
('mystery_8', 'Tier 9', 'Tier 9', 0, 9, 'special', 'rare', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 3),

-- Tier 10-12: Epic (glow_factor 4)
('mystery_9', 'Tier 10', 'Tier 10', 0, 10, 'special', 'epic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 4),
('mystery_10', 'Tier 11', 'Tier 11', 0, 11, 'special', 'epic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 4),
('mystery_11', 'Tier 12', 'Tier 12', 0, 12, 'special', 'epic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 4),

-- Tier 13-15: Legendary (glow_factor 5)
('mystery_12', 'Tier 13', 'Tier 13', 0, 13, 'special', 'legendary', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 5),
('mystery_13', 'Tier 14', 'Tier 14', 0, 14, 'special', 'legendary', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 5),
('mystery_14', 'Tier 15', 'Tier 15', 0, 15, 'special', 'legendary', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 5),

-- Tier 16-18: Divine (glow_factor 6)
('mystery_15', 'Tier 16', 'Tier 16', 0, 16, 'special', 'divine', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 6),
('mystery_16', 'Tier 17', 'Tier 17', 0, 17, 'special', 'divine', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 6),
('mystery_17', 'Tier 18', 'Tier 18', 0, 18, 'special', 'divine', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 6),

-- Tier 19-21: Mystic (glow_factor 7)
('mystery_18', 'Tier 19', 'Tier 19', 0, 19, 'special', 'mystic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 7),
('mystery_19', 'Tier 20', 'Tier 20', 0, 20, 'special', 'mystic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 7),
('mystery_20', 'Tier 21', 'Tier 21', 0, 21, 'special', 'mystic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 7),

-- Tier 22-24: Rainbow (glow_factor 8)
('mystery_21', 'Tier 22', 'Tier 22', 0, 22, 'special', 'rainbow', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 8),
('mystery_22', 'Tier 23', 'Tier 23', 0, 23, 'special', 'rainbow', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 8),
('mystery_23', 'Tier 24', 'Tier 24', 0, 24, 'special', 'rainbow', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 8),

-- Tier 25-27: Apocalyptic (glow_factor 9)
('mystery_24', 'Tier 25', 'Tier 25', 0, 25, 'special', 'apocalyptic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 9),
('mystery_25', 'Tier 26', 'Tier 26', 0, 26, 'special', 'apocalyptic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 9),
('mystery_26', 'Tier 27', 'Tier 27', 0, 27, 'special', 'apocalyptic', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 9),

-- Tier 28-30: Infinite (glow_factor 10)
('mystery_27', 'Tier 28', 'Tier 28', 0, 28, 'special', 'infinite', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 10),
('mystery_28', 'Tier 29', 'Tier 29', 0, 29, 'special', 'infinite', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 10),
('mystery_29', 'Tier 30', 'Tier 30', 0, 30, 'special', 'infinite', 'mystery', '{"size": [1, 1, 1], "color": "#FFFFFF", "emissive": true, "transparent": true}'::jsonb, 10);