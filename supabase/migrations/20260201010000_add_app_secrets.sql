-- Secure storage for API keys (Helius, etc.) - admin-only access
CREATE TABLE IF NOT EXISTS app_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  provider TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- Only admins/superadmins can read
CREATE POLICY "Admins can read secrets"
  ON app_secrets FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'superadmin'::app_role)
  );

-- Only admins/superadmins can insert
CREATE POLICY "Admins can insert secrets"
  ON app_secrets FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'superadmin'::app_role)
  );

-- Only admins/superadmins can update
CREATE POLICY "Admins can update secrets"
  ON app_secrets FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'superadmin'::app_role)
  );

-- Only admins/superadmins can delete
CREATE POLICY "Admins can delete secrets"
  ON app_secrets FOR DELETE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'superadmin'::app_role)
  );

-- Auto-update updated_at
CREATE TRIGGER update_app_secrets_updated_at
  BEFORE UPDATE ON app_secrets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
