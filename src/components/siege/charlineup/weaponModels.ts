// weaponModels — the WEAPON REGISTRY: maps a weapon's in-game item_number(s) to the 3D model the
// character holds, its grip transform, and which animation set it uses. This is the foundation that
// makes "all tiers working" real: every tier of a weapon is a separate item_number with escalating
// stats but the SAME model + animations, so they all point at one registry entry.
//
// The grip fields match LineupWeaponDef (the lineup's attach reads them directly). Scale is NOT here
// — LineupWeapon auto-sizes from the model + the character's hand, so one entry fits every character.
export interface HeldWeapon {
  key: string;                 // stable key, e.g. 'ak47'
  name: string;                // display name
  itemNumbers: number[];       // EVERY tier's item_number that uses this model+anims
  url: string;                 // held model
  lengthM: number;             // target real-world length of the model's longest axis (metres)
  rotDeg: [number, number, number];   // grip orientation in the Hand_R local frame (shared, eye-tuned)
  gripPos: [number, number, number];  // grip offset in Hand_R local metres (shared, eye-tuned)
  worldYawDeg?: number;               // extra spin about the TRUE world vertical, applied after rotDeg
  animSet: 'rifle' | 'pistol';
}

// AK74 (keyed 'ak47' in the DB), tiers 1–7 = item_numbers 20 + 111–116. All two-handed automatics →
// one model, the rifle animation set; tiers differ only in stats (damage/fire-rate/clip), so they
// share this entry. Barrel runs along the model's X axis → rotDeg starts from the X-forward family;
// grip is a first-pass guess to be tuned once (then correct for every character).
export const HELD_WEAPONS: HeldWeapon[] = [
  {
    key: 'ak47',
    name: 'AK74',
    itemNumbers: [20, 111, 112, 113, 114, 115, 116],
    url: '/siege/weapons/ak47.glb',
    lengthM: 0.9,
    // AK model is authored barrel-along-+Z, "up" on the side axis. [0,0,90] makes it upright but
    // pointing BACK at the character; a 180° turn about the TRUE world vertical (worldYawDeg, applied
    // in world space because the hand frame is tilted) spins the heading away → forward + upright.
    rotDeg: [0, 0, 90],
    worldYawDeg: 180,
    gripPos: [0, 0, 0],
    animSet: 'rifle',
  },
];

const byItem = new Map<number, HeldWeapon>();
for (const w of HELD_WEAPONS) for (const n of w.itemNumbers) byItem.set(n, w);

/** The held-model config for a weapon item_number (any tier), or null if not registered yet. */
export function heldWeaponFor(itemNumber: number): HeldWeapon | null {
  return byItem.get(itemNumber) ?? null;
}

/** Look up a registered weapon by its stable key (e.g. the lineup demo holds 'ak47'). */
export function heldWeaponByKey(key: string): HeldWeapon | null {
  return HELD_WEAPONS.find((w) => w.key === key) ?? null;
}
