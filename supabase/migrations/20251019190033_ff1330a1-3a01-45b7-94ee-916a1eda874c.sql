
-- Assign superadmin role to the user
INSERT INTO user_roles (user_id, role)
VALUES ('5ecaa484-cac5-4cdf-85da-477ec5fbe05a', 'superadmin')
ON CONFLICT (user_id, role) DO NOTHING;
