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
  sizeByChar?: Record<string, number>;  // baked per-character size multiplier (auto-fit × this); default 1
  rotByChar?: Record<string, [number, number, number]>;   // baked per-character rotDeg (else rotDeg)
  gripByChar?: Record<string, [number, number, number]>;  // baked per-character gripPos (else gripPos)
  leftHand?: { point: [number, number, number]; wrist: number };  // baked support-hand grip (gun-local) + wrist°
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
// Baseline orientation/grip carried from the tuned AK74 onto the other (untuned) weapons as a starting
// point — each SWU model differs, so they still need a per-weapon pass, but this beats raw/floating.
const R: [number, number, number] = [2, 3, -81];
const G: [number, number, number] = [0.02, 0.3, 0.04];
export const HELD_WEAPONS: HeldWeapon[] = [
  // AK74 tuned + baked PER CHARACTER (from the in-lineup export). lengthM 0.765 is the base; sizeByChar
  // is each character's own multiplier; rotByChar/gripByChar are each character's finger-on-trigger fit.
  { key: 'ak47', name: 'AK74', itemNumbers: [20, 111, 112, 113, 114, 115, 116], url: '/siege/weapons/ak47.glb', lengthM: 0.765,
    rotDeg: [2, 3, -81], gripPos: [0.02, 0.3, 0.04], animSet: 'rifle',
    rotByChar:  { Ash: [2, 3, -81], Dago: [2, 1, -79], Fluffer: [3, -5, -81], Jankz: [2, 3, -81], Rajax: [2, 3, -81], Thorn: [2, 3, -77] },
    gripByChar: { Ash: [-0.04, 0.28, 0.04], Dago: [-0.22, 0.34, -0.06], Fluffer: [0.04, 0.4, 0.04], Jankz: [-0.02, 0.16, 0.04], Rajax: [0.02, 0.3, 0.04], Thorn: [0, 0.16, 0.02] },
    sizeByChar: { Ash: 0.82, Dago: 1.00, Fluffer: 1.15, Jankz: 1.00, Rajax: 0.87, Thorn: 0.79 },
    leftHand: { point: [-0.249, 0.061, 0.074], wrist: 0 } },
  // Tuned + baked per character (in-lineup export). Same rotation for all; grip = Rajax's fit;
  // sizeByChar = each character's AK74 ratio vs Rajax (0.87) × Rajax's own tuned size for this gun.
  { key: 'burst_rifle',   name: 'Powerful Burst Rifle', itemNumbers: [17],  url: '/siege/weapons/item_17.glb',  lengthM: 0.9,
    rotDeg: [-88, -9, -89], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.06, 0.34, 0.04] },
    sizeByChar: { Ash: 1.08, Dago: 1.32, Fluffer: 1.52, Jankz: 1.32, Rajax: 1.15, Thorn: 1.04 } },
  { key: 'm27',           name: 'M27',                  itemNumbers: [18],  url: '/siege/weapons/item_18.glb',  lengthM: 0.9,
    rotDeg: [-88, -9, -87], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.04, 0.3, 0.04] },
    sizeByChar: { Ash: 1.15, Dago: 1.40, Fluffer: 1.61, Jankz: 1.40, Rajax: 1.22, Thorn: 1.11 } },
  { key: 'dragunov',      name: 'Dragunov',             itemNumbers: [19],  url: '/siege/weapons/item_19.glb',  lengthM: 1.2,
    rotDeg: [-83, -9, -86], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.06, 0.42, 0.04] },
    sizeByChar: { Ash: 1.02, Dago: 1.24, Fluffer: 1.43, Jankz: 1.24, Rajax: 1.08, Thorn: 0.98 },
    leftHand: { point: [0.032, -0.012, 0.009], wrist: 0 } },
  { key: 'submgun',       name: 'SubMGun',              itemNumbers: [142], url: '/siege/weapons/item_142.glb', lengthM: 0.6,
    rotDeg: [-88, -9, -87], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.06, 0.24, 0.04] },
    sizeByChar: { Ash: 1.38, Dago: 1.68, Fluffer: 1.93, Jankz: 1.68, Rajax: 1.46, Thorn: 1.33 },
    leftHand: { point: [0.02, 0.033, 0.121], wrist: 0 } },
  { key: 'plasma_sniper4',name: 'Plasma Sniper',        itemNumbers: [4],   url: '/siege/weapons/item_4.glb',   lengthM: 1.3, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'plasma_sniper12',name: 'Plasma Sniper II',    itemNumbers: [12],  url: '/siege/weapons/item_12.glb',  lengthM: 1.3, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'db_shotgun',    name: 'Double Barrel Shotgun',itemNumbers: [1],   url: '/siege/weapons/item_1.glb',   lengthM: 1.0, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'plasma_shotgun',name: 'Plasma Shotgun',       itemNumbers: [5],   url: '/siege/weapons/item_5.glb',   lengthM: 1.0, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'shotgun',       name: 'Shotgun',              itemNumbers: [208], url: '/siege/weapons/item_208.glb', lengthM: 1.0, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'musket',        name: 'Musket',               itemNumbers: [2],   url: '/siege/weapons/item_2.glb',   lengthM: 1.4, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'db_musket',     name: 'Double Barrel Musket', itemNumbers: [3],   url: '/siege/weapons/item_3.glb',   lengthM: 1.4, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'raygun',        name: 'Raygun',               itemNumbers: [6],   url: '/siege/weapons/item_6.glb',   lengthM: 0.7, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'rocket',        name: 'Rocket Launcher',      itemNumbers: [14],  url: '/siege/weapons/item_14.glb',  lengthM: 1.2, rotDeg: R, gripPos: G, animSet: 'rifle' },
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
