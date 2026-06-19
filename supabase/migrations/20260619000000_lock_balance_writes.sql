-- SECURITY (money): user_token_balances shipped with client UPDATE + INSERT RLS policies, which let
-- ANY logged-in user set their own `coins` directly from the browser console
-- (supabase.from('user_token_balances').update({coins: 999999})), bypassing pools + grant_currency
-- entirely. Remove them. Balances are mutated ONLY by SECURITY DEFINER functions (grant_currency,
-- buy_block, ensure_token_balance, handle_new_user), which bypass RLS. The client may only READ its
-- own balances (the SELECT policy stays) and set its withdrawal address via set_blockchain_address,
-- which can touch ONLY blockchain_address — never coins.
drop policy if exists "Users can update their own token balances" on public.user_token_balances;
drop policy if exists "Users can insert their own token balances" on public.user_token_balances;

create or replace function public.set_blockchain_address(p_token_theme_id uuid, p_address text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  update public.user_token_balances
     set blockchain_address = nullif(p_address, ''), updated_at = now()
   where user_id = auth.uid() and token_theme_id = p_token_theme_id;
end;
$fn$;
grant execute on function public.set_blockchain_address(uuid, text) to authenticated;
