-- Grenades. Just the T1 row; the existing forge auto-creates higher
-- tiers (handleForge in ItemsTab.tsx) using the base key + tier suffix.
-- key='grenade' / item_category='consumable' / tier=1 / item_number=
-- arbitrary high number to avoid collision with the seeded weapon list.
INSERT INTO public.items (key, name, item_category, tier, item_number, description)
VALUES (
  'grenade', 'Grenade', 'consumable', 1, 229,
  'Press G to ready, click to throw. Tier color = damage tier; explodes 3 seconds after throw.'
)
ON CONFLICT (key) DO NOTHING;
