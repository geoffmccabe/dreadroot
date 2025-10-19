-- Update the handle_new_user function to also create a default 'user' role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Insert user profile with starting coins
  INSERT INTO public.user_profiles (user_id, coins)
  VALUES (NEW.id, 100);
  
  -- Insert default 'user' role for the new user
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$function$;

-- Also assign 'user' role to any existing users who don't have a role yet
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT up.user_id, 'user'::app_role
FROM public.user_profiles up
LEFT JOIN public.user_roles ur ON up.user_id = ur.user_id
WHERE ur.user_id IS NULL
ON CONFLICT (user_id, role) DO NOTHING;