-- Create token_themes table
CREATE TABLE token_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  flow_speed REAL NOT NULL DEFAULT 1.2,
  ms_between_drops REAL NOT NULL DEFAULT 1.0,
  coin_rate INTEGER NOT NULL DEFAULT 6,
  coin_size REAL NOT NULL DEFAULT 0.8,
  color_palette JSONB NOT NULL DEFAULT '[
    {"hex": "#06c8c0", "weight": 10},
    {"hex": "#028eef", "weight": 10},
    {"hex": "#194ca8", "weight": 20},
    {"hex": "#18488a", "weight": 30},
    {"hex": "#103d6a", "weight": 30},
    {"hex": "#0a2847", "weight": 15}
  ]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create app_settings table
CREATE TABLE app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  active_token_theme_id UUID REFERENCES token_themes(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert seed data for Waterfall
INSERT INTO token_themes (name, display_name) 
VALUES ('waterfall', 'Waterfall');

-- Insert seed data for Harold
INSERT INTO token_themes (name, display_name) 
VALUES ('harold', 'Harold');

-- Set Waterfall as default active theme
INSERT INTO app_settings (active_token_theme_id)
SELECT id FROM token_themes WHERE name = 'waterfall';

-- Enable RLS
ALTER TABLE token_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read active themes
CREATE POLICY "Token themes are readable by all"
  ON token_themes FOR SELECT
  USING (is_active = true);

-- Only admins/superadmins can modify themes
CREATE POLICY "Admins can manage token themes"
  ON token_themes FOR ALL
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));

-- Everyone can read app settings
CREATE POLICY "App settings are readable by all"
  ON app_settings FOR SELECT
  USING (true);

-- Only admins/superadmins can update app settings
CREATE POLICY "Admins can update app settings"
  ON app_settings FOR UPDATE
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));

-- Update triggers
CREATE TRIGGER update_token_themes_updated_at
  BEFORE UPDATE ON token_themes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();