-- Insert enemy sound settings for shombie
INSERT INTO enemy_sound_settings (enemy_type, ambient_sound_url, death_sound_url, volume)
VALUES ('shombie', '/shombie_moan_1.mp3', NULL, 50)
ON CONFLICT (enemy_type) DO NOTHING;