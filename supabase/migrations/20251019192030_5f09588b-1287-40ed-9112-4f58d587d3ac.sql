-- Clear all users one more time
DELETE FROM user_roles;
DELETE FROM user_inventory;
DELETE FROM placed_blocks;
DELETE FROM user_profiles;
DELETE FROM auth.users;

-- Now create ONE user and assign superadmin role immediately
DO $$
DECLARE
  new_user_id uuid;
BEGIN
  -- Create anonymous user (simulating what the app would do)
  -- Note: We can't actually create auth.users directly, so this is just cleanup
  -- The user will be created by the app on next load
END $$;