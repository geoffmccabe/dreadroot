-- Game wallet deposit address per coin pool — the address the owner sends real coins to when topping
-- a pool up. Shown in the admin-only GAME WALLET panel with a copy button. See docs/CURRENCY_LEDGER_PLAN.md.
alter table public.token_pools add column if not exists deposit_address text;

create or replace function public.set_pool_address(p_token_theme_id uuid, p_address text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'superadmin'::app_role)) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.token_pools (token_theme_id, deposit_address)
  values (p_token_theme_id, nullif(p_address, ''))
  on conflict (token_theme_id) do update set deposit_address = nullif(p_address, ''), updated_at = now();
end;
$fn$;

grant execute on function public.set_pool_address(uuid, text) to authenticated;
