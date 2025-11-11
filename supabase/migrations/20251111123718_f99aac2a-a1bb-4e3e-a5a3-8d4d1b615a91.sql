-- Allow admins and superadmins to view all user profiles
create policy "Admins can view all profiles"
on public.user_profiles
for select
to authenticated
using (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'superadmin'::app_role)
);

-- Allow admins to view all user roles
create policy "Admins can view all user roles"
on public.user_roles
for select
to authenticated
using (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'superadmin'::app_role)
);

-- Allow admins to view all user inventories
create policy "Admins can view all inventories"
on public.user_inventory
for select
to authenticated
using (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'superadmin'::app_role)
);

-- Allow admins to view all token balances
create policy "Admins can view all token balances"
on public.user_token_balances
for select
to authenticated
using (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'superadmin'::app_role)
);