-- Clear all user-related data for fresh start
DELETE FROM user_roles;
DELETE FROM user_inventory;
DELETE FROM placed_blocks;
DELETE FROM user_profiles;

-- Delete all anonymous users (this will cascade to any remaining references)
DELETE FROM auth.users;