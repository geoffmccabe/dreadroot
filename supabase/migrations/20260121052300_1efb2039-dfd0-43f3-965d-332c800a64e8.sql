-- Shnake definitions (tree-dwelling segmented enemies)

create table if not exists public.shnake_definitions (
  id uuid primary key default gen_random_uuid(),
  tier integer not null check (tier >= 1 and tier <= 30),
  name text not null,
  head_texture_url text,
  body_texture_url text,
  face_texture_url text,
  health_per_segment integer not null default 100,
  damage_per_hit integer not null default 10,
  knockback numeric not null default 6,
  armor integer not null default 0,
  speed numeric not null default 1.0,
  spawn_chance_per_minute numeric not null default 1.0,
  max_spawn_per_tree integer not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists shnake_definitions_tier_unique on public.shnake_definitions(tier);

-- Seed defaults for tiers 1..30
insert into public.shnake_definitions (
  tier, name, health_per_segment, damage_per_hit, knockback, armor, speed, spawn_chance_per_minute, max_spawn_per_tree
)
select
  t as tier,
  'Shnake T' || t as name,
  75 + (t * 5) as health_per_segment,
  6 + floor(t / 2.0) as damage_per_hit,
  6 + (t * 0.2) as knockback,
  floor(t / 4.0) as armor,
  0.8 + (t * 0.03) as speed,
  1.0 as spawn_chance_per_minute,
  case when t <= 10 then 2 when t <= 20 then 1 else 1 end as max_spawn_per_tree
from generate_series(1, 30) as t
on conflict (tier) do nothing;

-- Enable RLS
alter table public.shnake_definitions enable row level security;

-- Read for everyone
create policy "Shnake definitions are viewable by everyone"
on public.shnake_definitions
for select
using (true);

-- Write for admins/superadmins only
create policy "Shnake definitions are editable by admins"
on public.shnake_definitions
for all
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('admin', 'superadmin')
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('admin', 'superadmin')
  )
);