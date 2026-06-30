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
  animSet: 'rifle' | 'pistol';
}

// AK74 (keyed 'ak47' in the DB), tiers 1–7 = item_numbers 20 + 111–116. All two-handed automatics →
// one model, the rifle animation set; tiers differ only in stats (damage/fire-rate/clip), so they
// share this entry. Barrel runs along the model's X axis → rotDeg starts from the X-forward family;
// grip is a first-pass guess to be tuned once (then correct for every character).
// Every entry below is a REAL Siege Worlds Unity weapon, converted from its Item_<id> source FBX and
// keyed to that exact game item_number. lengthM is a real-world size guess (auto-fit handles per-hand
// scale); rotDeg/gripPos start as guesses to be tuned ONCE in the lineup (^x/y/z flips + size keys),
// then baked here. AK74 keeps the hand-cleaned model already accepted; the rest are the SWU models.
const R: [number, number, number] = [0, 0, 0];   // default raw orientation — flip each in the lineup
export const HELD_WEAPONS: HeldWeapon[] = [
  { key: 'ak47',          name: 'AK74',                 itemNumbers: [20, 111, 112, 113, 114, 115, 116], url: '/siege/weapons/ak47.glb',   lengthM: 0.9, rotDeg: [0, 0, -90], gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'burst_rifle',   name: 'Powerful Burst Rifle', itemNumbers: [17],  url: '/siege/weapons/item_17.glb',  lengthM: 0.9, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'm27',           name: 'M27',                  itemNumbers: [18],  url: '/siege/weapons/item_18.glb',  lengthM: 0.9, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'dragunov',      name: 'Dragunov',             itemNumbers: [19],  url: '/siege/weapons/item_19.glb',  lengthM: 1.2, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'submgun',       name: 'SubMGun',              itemNumbers: [142], url: '/siege/weapons/item_142.glb', lengthM: 0.6, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'plasma_sniper4',name: 'Plasma Sniper',        itemNumbers: [4],   url: '/siege/weapons/item_4.glb',   lengthM: 1.3, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'plasma_sniper12',name: 'Plasma Sniper II',    itemNumbers: [12],  url: '/siege/weapons/item_12.glb',  lengthM: 1.3, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'db_shotgun',    name: 'Double Barrel Shotgun',itemNumbers: [1],   url: '/siege/weapons/item_1.glb',   lengthM: 1.0, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'plasma_shotgun',name: 'Plasma Shotgun',       itemNumbers: [5],   url: '/siege/weapons/item_5.glb',   lengthM: 1.0, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'shotgun',       name: 'Shotgun',              itemNumbers: [208], url: '/siege/weapons/item_208.glb', lengthM: 1.0, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'musket',        name: 'Musket',               itemNumbers: [2],   url: '/siege/weapons/item_2.glb',   lengthM: 1.4, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'db_musket',     name: 'Double Barrel Musket', itemNumbers: [3],   url: '/siege/weapons/item_3.glb',   lengthM: 1.4, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'raygun',        name: 'Raygun',               itemNumbers: [6],   url: '/siege/weapons/item_6.glb',   lengthM: 0.7, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
  { key: 'rocket',        name: 'Rocket Launcher',      itemNumbers: [14],  url: '/siege/weapons/item_14.glb',  lengthM: 1.2, rotDeg: R, gripPos: [0, 0, 0], animSet: 'rifle' },
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
