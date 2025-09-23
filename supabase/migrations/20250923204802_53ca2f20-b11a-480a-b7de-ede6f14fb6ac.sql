-- Add blockchain_address column to user_profiles table
ALTER TABLE public.user_profiles 
ADD COLUMN blockchain_address TEXT;