-- Delete extra users, keep only the superadmin
DELETE FROM user_roles WHERE user_id != '96a0e074-b5e7-404c-aac2-d74cd65bec38';
DELETE FROM user_inventory WHERE user_id != '96a0e074-b5e7-404c-aac2-d74cd65bec38';
DELETE FROM placed_blocks WHERE user_id != '96a0e074-b5e7-404c-aac2-d74cd65bec38';
DELETE FROM user_profiles WHERE user_id != '96a0e074-b5e7-404c-aac2-d74cd65bec38';
DELETE FROM auth.users WHERE id != '96a0e074-b5e7-404c-aac2-d74cd65bec38';