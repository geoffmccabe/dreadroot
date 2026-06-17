# Weapons, Equip Slots & Per-Weapon Firing — Plan

Owner: Window B (engine/items). Touches some shared HUD/firing files — coordinate with Window A.

## North star
The player owns items (many minted in Siege Worlds: e.g. a T5 Plasma Shotgun). When they
**equip a weapon**, Dreadroot's firing *simulates* that exact weapon — sound, damage, fire
rate, projectile feel, reload, crosshair kick — even though no 3D weapon model is shown.
Siege Worlds will later show the real held model + animations, reading the **same**
`weapon_stats`. Pinkland inherits everything automatically (shared engine).

## What already exists (reuse — do not rebuild)
- **`weapon_stats` table** (242 weapons): max_damage, shoot_cooldown, reload_time,
  ammo_clip_amount, bullets_per_tap, projectile (type string), effective_range,
  explosion_radius, is_automatic/shotgun/sniper/rocket, horizontal/vertical_spread,
  recoil_duration, fire_sound/empty_sound/reload_sound.
- **`game_sounds`**: all SW weapon/monster sounds are catalogued + cached (IndexedDB).
- **Inventory/cursor-stack DnD**: `features/inventory-system/` (SlotGrid, slotClick reducer,
  useCursorStack) — works across inventory ↔ quick-select ↔ vault. Region-based.
- **Quick-Access (6 slots)**: `user_slots` region `quick_select`; `selectedSlot` →
  `selectedItemDef` in Fortress.tsx (already used for Flame Glove detection).
- **Firing**: `useFortressShooting.handleShoot` (bullet pool), `FortressControls` fire path
  (hardcoded `FIRE_RATE_LIMIT=150`, hardcoded `gunshot` sound), `resolveBulletHit`
  (`BASE_BULLET_DAMAGE=25`, velocity-ratio scaling), bullet tiers via BulletDefinitionsContext.
- **Sprites**: `public/rocket_boots_t1..t10_256px.webp` already present.

## Key design decisions
- **Muzzle velocity is derived**, not stored. New `projectileRegistry`: projectile-type
  string → `{ speed, visual(color/size), kind: hitscan|projectile, pellets, splashRadius }`.
  Types: Normal_Bullet(+_8), Futuristic_Bullet(+_8), shotgun(+_8), Crossbow_Bolt,
  rocket_shell, Grenade, Level_N_FlameAttack (→ existing flamethrower), ""/"0" (melee).
- **Equip storage** = reuse `user_slots` with a new region `equip`, slots 1–4:
  1 weapon, 2 armor, 3 boots, 4 potion. No new table; extend the transfer/swap RPC to accept it.
- **Slot eligibility** by `items.item_category`: weapon→`weapon`, armor→`armor`,
  boots→`boots`, potion→`consumable`/`potion`. (Boots items get category `boots`.)
- **Active weapon for shooting** = the item in equip slot 1 (weapon). Falls back to the
  current bullet-tier behavior when empty (so nothing breaks for users with no weapon).
- **Boots never empty**: every user has ≥ a Tier-1 Rocket Boots (starter grant + the boots
  slot renders T1 as the default/min even if the row is absent).
- **`R` key**: the bottom-right "R for crosshairs" panel is removed; repurpose `R` → reload.
  Crosshairs stay on by default (the toggle moves to settings if still wanted).

## Phases

### Phase 1 — Data foundation (no gameplay change) ← START HERE
- [ ] 10 Rocket Boots items (item_number 300–309, category `boots`, tier 1–10,
      texture_url → the webp). SQL: `siege-worlds-port/rocket_boots_items.sql` (paste).
- [ ] Boots stats live in `items.properties` (e.g. `{ jet_power }`) per tier.
- [ ] Starter grant: give new users a T1 Rocket Boots.
- [ ] Confirm `user_slots` region `equip` is accepted by transfer/swap RPCs (or extend).

### Phase 2 — Equip Slots UI
- [ ] Remove bottom-right `InstructionsPanel` ("R for crosshairs").
- [ ] `EquipSlots` component (4 slots) bottom-right; greyed type-glyph when empty.
- [ ] Wire DnD via existing cursor-stack/slotClick to region `equip` + per-slot category check.
- [ ] Boots slot shows T1 by default (never empty).

### Phase 3 — Weapon → firing (core feel)
- [ ] Fetch the equipped weapon's `weapon_stats` (cache) → `selectedWeaponStats`.
- [ ] Drive fire cooldown (shoot_cooldown), damage (max_damage), fire sound (fire_sound),
      auto vs semi (is_automatic). Replace the hardcoded constants.

### Phase 4 — Ammo + reload
- [ ] Clip (ammo_clip_amount), reload_time, reload_sound, empty_sound; `R` → reload; HUD ammo.

### Phase 5 — Crosshair recoil + spread
- [ ] horizontal/vertical_spread → fire spread cone; recoil_duration → crosshair kick anim.

### Phase 6 — Projectile types
- [ ] `projectileRegistry` drives velocity + visual; shotgun pellets (bullets_per_tap);
      rocket splash (explosion_radius via existing explosion VFX); sniper/burst flags.

### Phase 7 — Other slots + passive stats
- [ ] Potion slot active-use (drink); armor (damage reduction) passive.
- [ ] **Boots → jet boosts** (the orange triangles in the HUD).
      - HUD: `features/shwarm/components/HealthBar.tsx` renders `jetBoostMax` triangles,
        fills `jetBoostAvailable`. Driven entirely by `jetBoostMax`.
      - Current max: `FortressControls.tsx:2257` → `Math.floor(playerLevel / 3)` (the
        Level bonus ALREADY EXISTS — 1 boost per 3 levels). Refill every 60s; consumed on
        space-while-airborne. Level from `profile.current_level`.
      - **Change**: `maxBoosts = Math.floor(playerLevel / 3) + (equippedBootsTier - 1)`.
        T1 boots = today's behavior (+0); each higher tier = +1. Pass the equipped boots
        tier as a prop (Fortress → FortressControls), default 1. Optional cap (e.g. 8) so
        the HUD row doesn't overflow. Boots slot never empty (min T1) ⇒ tier always ≥ 1.

### Phase 8 — Pinkland / Siege Worlds
- [ ] Pinkland: automatic (shared). SW: bind equipped weapon → real 3D held model + anims,
      reusing the same `weapon_stats`.
