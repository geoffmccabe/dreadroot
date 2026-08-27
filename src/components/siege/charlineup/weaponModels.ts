// weaponModels — the WEAPON REGISTRY: maps a weapon's in-game item_number(s) to the 3D model the
// character holds, its grip transform, and which animation set it uses. This is the foundation that
// makes "all tiers working" real: every tier of a weapon is a separate item_number with escalating
// stats but the SAME model + animations, so they all point at one registry entry.
//
// The grip fields match LineupWeaponDef (the lineup's attach reads them directly). Scale is NOT here
// — LineupWeapon auto-sizes from the model + the character's hand, so one entry fits every character.
/**
 * PER-CHARACTER TUNING — how the Flamma / Jeanette / Shi Yang columns were derived
 * (2026-Aug-22), rather than eyeballed one gun at a time.
 *
 * Measuring the existing `sizeByChar` values showed they are NOT independent:
 * they factor almost exactly into (per-weapon) x (per-character), with the
 * per-character ratio constant to ~1% across all 11 tuned weapons:
 *
 *     Ash 1.000   Dago 1.219   Fluffer 1.4035
 *     Jankz 1.219   Rajax 1.062   Thorn 0.965
 *
 * So a new character needs ONE number, not fourteen. Each new character is
 * matched to the existing character of nearest height on the same rig scale,
 * and inherits that column:
 *
 *     Flamma   1.794 m  ~ Ash    1.791 m  -> factor 1.000
 *     Shi Yang 1.925 m  ~ Rajax  1.926 m  -> factor 1.062
 *     Jeanette 1.700 m  ~ Thorn  1.760 m  -> factor 0.965
 *       (Jeanette's glb is authored ~20x oversized; compared at her
 *        normalised in-world height, not the raw model height.)
 *
 * A hand-span regression was tried first and rejected: r was only 0.72 and it
 * produced nonsense for Jeanette because of that scale difference. Nearest
 * analogue is weaker in theory but does not blow up.
 *
 * `shotgun`, `musket` and `db_musket` had NO tuning for anyone. Their
 * per-weapon value comes from the nearest analogue by type and length
 * (db_shotgun for the shotgun, dragunov for both muskets) — `lengthM` alone
 * does not predict it (the ratio spans 0.5 to 2.3).
 *
 * These are STARTING VALUES meant to be eyeballed in the lineup editor and
 * re-exported, not final. They should be close enough to adjust rather than
 * build from nothing.
 */
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
    rotByChar:  { Ash: [2, 3, -81], Dago: [2, 1, -79], Fluffer: [3, -5, -81], Jankz: [2, 3, -81], Rajax: [2, 3, -81], Thorn: [2, 3, -77], Flamma: [2, 3, -81], Jeanette: [2, 3, -77], 'Shi Yang': [2, 3, -81] },
    gripByChar: { Ash: [-0.04, 0.28, 0.04], Dago: [-0.22, 0.34, -0.06], Fluffer: [0.04, 0.4, 0.04], Jankz: [-0.02, 0.16, 0.04], Rajax: [0.02, 0.3, 0.04], Thorn: [0, 0.16, 0.02], Flamma: [-0.04, 0.28, 0.04], Jeanette: [0, 0.16, 0.02], 'Shi Yang': [0.02, 0.3, 0.04] },
    sizeByChar: { Ash: 0.82, Dago: 1.00, Fluffer: 1.15, Jankz: 1.00, Rajax: 0.87, Thorn: 0.79, Flamma: 0.82, Jeanette: 0.79, 'Shi Yang': 0.87 },
    leftHand: { point: [-0.249, 0.061, 0.074], wrist: 0 } },
  // Tuned + baked per character (in-lineup export). Same rotation for all; grip = Rajax's fit;
  // sizeByChar = each character's AK74 ratio vs Rajax (0.87) × Rajax's own tuned size for this gun.
  { key: 'burst_rifle',   name: 'M16',                  itemNumbers: [17],  url: '/siege/weapons/item_17.glb',  lengthM: 0.9,
    rotDeg: [-88, -9, -89], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.06, 0.34, 0.04] },
    sizeByChar: { Ash: 1.08, Dago: 1.32, Fluffer: 1.52, Jankz: 1.32, Rajax: 1.15, Thorn: 1.04, Flamma: 1.08, Jeanette: 1.04, 'Shi Yang': 1.15 } },
  { key: 'm27',           name: 'M27',                  itemNumbers: [18],  url: '/siege/weapons/item_18.glb',  lengthM: 0.9,
    rotDeg: [-88, -9, -87], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.04, 0.3, 0.04] },
    sizeByChar: { Ash: 1.15, Dago: 1.40, Fluffer: 1.61, Jankz: 1.40, Rajax: 1.22, Thorn: 1.11, Flamma: 1.15, Jeanette: 1.11, 'Shi Yang': 1.22 } },
  { key: 'dragunov',      name: 'Dragunov',             itemNumbers: [19],  url: '/siege/weapons/item_19.glb',  lengthM: 1.2,
    rotDeg: [-83, -9, -86], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.06, 0.42, 0.04] },
    sizeByChar: { Ash: 1.02, Dago: 1.24, Fluffer: 1.43, Jankz: 1.24, Rajax: 1.08, Thorn: 0.98, Flamma: 1.02, Jeanette: 0.98, 'Shi Yang': 1.08 },
    leftHand: { point: [0.032, -0.012, 0.009], wrist: 0 } },
  { key: 'submgun',       name: 'MP5',                  itemNumbers: [142], url: '/siege/weapons/item_142.glb', lengthM: 0.6,
    rotDeg: [-88, -9, -87], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.06, 0.24, 0.04] },
    sizeByChar: { Ash: 1.38, Dago: 1.68, Fluffer: 1.94, Jankz: 1.68, Rajax: 1.47, Thorn: 1.33, Flamma: 1.38, Jeanette: 1.33, 'Shi Yang': 1.47 },
    leftHand: { point: [0.02, 0.033, 0.121], wrist: 0 } },
  { key: 'plasma_sniper4',name: 'Plasma Sniper',        itemNumbers: [4],   url: '/siege/weapons/item_4.glb',   lengthM: 1.3,
    rotDeg: [-88, -9, -87], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.06, 0.38, 0.04] },
    sizeByChar: { Ash: 0.77, Dago: 0.94, Fluffer: 1.08, Jankz: 0.94, Rajax: 0.82, Thorn: 0.74, Flamma: 0.77, Jeanette: 0.74, 'Shi Yang': 0.82 },
    leftHand: { point: [5.254, -0.952, -1.271], wrist: 0 } },
  { key: 'plasma_sniper12',name: 'Plasma Rifle',        itemNumbers: [12],  url: '/siege/weapons/item_12.glb',  lengthM: 1.3,
    rotDeg: [-88, -9, -87], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.08, 0.28, 0.04] },
    sizeByChar: { Ash: 0.65, Dago: 0.79, Fluffer: 0.91, Jankz: 0.79, Rajax: 0.69, Thorn: 0.63, Flamma: 0.65, Jeanette: 0.63, 'Shi Yang': 0.69 } },
  { key: 'db_shotgun',    name: 'Double Barrel Shotgun',itemNumbers: [1],   url: '/siege/weapons/item_1.glb',   lengthM: 1.0,
    rotDeg: [-88, -9, -87], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.02, 0.38, 0.04] },
    sizeByChar: { Ash: 1.08, Dago: 1.32, Fluffer: 1.52, Jankz: 1.32, Rajax: 1.15, Thorn: 1.04, Flamma: 1.08, Jeanette: 1.04, 'Shi Yang': 1.15 },
    leftHand: { point: [0.008, 0.015, -0.055], wrist: 0 } },
  // PISTOLS (one-handed) — animSet 'pistol'; no leftHand grip. These need pulling out of the two-handed
  // `*` cycle + their own animations (future). Tuning captured from the in-lineup export.
  { key: 'plasma_shotgun',name: 'Plasma Shotgun',       itemNumbers: [5],   url: '/siege/weapons/item_5.glb',   lengthM: 1.0,
    rotDeg: [-87, -11, -94], gripPos: G, animSet: 'pistol',
    gripByChar: { Rajax: [0.06, 0.3, 0.04] },
    sizeByChar: { Ash: 0.94, Dago: 1.15, Fluffer: 1.32, Jankz: 1.15, Rajax: 1.00, Thorn: 0.91, Flamma: 0.94, Jeanette: 0.91, 'Shi Yang': 1.00 } },
  { key: 'shotgun',       name: 'Shotgun',              itemNumbers: [208], url: '/siege/weapons/item_208.glb', lengthM: 1.0, rotDeg: R, gripPos: G, sizeByChar: { Ash: 1.08, Dago: 1.32, Fluffer: 1.52, Jankz: 1.32, Rajax: 1.15, Thorn: 1.04, Flamma: 1.08, Jeanette: 1.04, 'Shi Yang': 1.15 },
    animSet: 'pistol' },
  { key: 'musket',        name: 'Musket',               itemNumbers: [2],   url: '/siege/weapons/item_2.glb',   lengthM: 1.4, rotDeg: R, gripPos: G, sizeByChar: { Ash: 1.02, Dago: 1.24, Fluffer: 1.43, Jankz: 1.24, Rajax: 1.08, Thorn: 0.98, Flamma: 1.02, Jeanette: 0.98, 'Shi Yang': 1.08 },
    animSet: 'rifle' },
  { key: 'db_musket',     name: 'Double Barrel Musket', itemNumbers: [3],   url: '/siege/weapons/item_3.glb',   lengthM: 1.4, rotDeg: R, gripPos: G, sizeByChar: { Ash: 1.02, Dago: 1.24, Fluffer: 1.43, Jankz: 1.24, Rajax: 1.08, Thorn: 0.98, Flamma: 1.02, Jeanette: 0.98, 'Shi Yang': 1.08 },
    animSet: 'rifle' },
  { key: 'raygun',        name: 'Raygun',               itemNumbers: [6],   url: '/siege/weapons/item_6.glb',   lengthM: 0.7,
    rotDeg: [-88, -9, -87], gripPos: G, animSet: 'pistol',
    gripByChar: { Rajax: [0.06, 0.2, 0.04] },
    sizeByChar: { Ash: 0.66, Dago: 0.80, Fluffer: 0.93, Jankz: 0.80, Rajax: 0.70, Thorn: 0.64, Flamma: 0.66, Jeanette: 0.64, 'Shi Yang': 0.70 } },
  { key: 'rocket',        name: 'Rocket Launcher',      itemNumbers: [14],  url: '/siege/weapons/item_14.glb',  lengthM: 1.2,
    rotDeg: [92, 9, -93], gripPos: G, animSet: 'rifle',
    gripByChar: { Rajax: [0.12, 0.02, 0.04] },
    sizeByChar: { Ash: 0.94, Dago: 1.15, Fluffer: 1.32, Jankz: 1.15, Rajax: 1.00, Thorn: 0.91, Flamma: 0.94, Jeanette: 0.91, 'Shi Yang': 1.00 },
    leftHand: { point: [0.078, -0.025, -0.425], wrist: 0 } },

  // ── Converted from the Siege Worlds Unity project, 2026-Aug-27 ──────────
  // Assets/Content/_weapon/Weapons/Item_models/<id>_<name>/*.fbx, run through
  // Blender to GLB. These models existed all along; DreadRoot simply never had
  // them, which is why the starter loadout — Basic Pistol and Flame Glove —
  // rendered as empty hands.
  //
  // Orientation and grip start from the tuned AK74 baseline, exactly as the
  // earlier batch did. They need a per-weapon pass in the lineup editor, but a
  // weapon in roughly the right place beats no weapon at all.
  //
  // animSet follows Unity's weaponType, the same field that settled the hand
  // counts: pistols/revolvers/gloves are 'pistol', long guns are 'rifle'.
  { key: 'basic_pistol',  name: 'Basic Pistol',        itemNumbers: [15],  url: '/siege/weapons/item_15.glb',  lengthM: 0.28, rotDeg: R, gripPos: G, animSet: 'pistol' },
  { key: 'plasma_pistol', name: 'Plasma Pistol',       itemNumbers: [0],   url: '/siege/weapons/item_0.glb',   lengthM: 0.32, rotDeg: R, gripPos: G, animSet: 'pistol' },
  { key: 'revolver',      name: 'Revolver',            itemNumbers: [201], url: '/siege/weapons/item_201.glb', lengthM: 0.34, rotDeg: R, gripPos: G, animSet: 'pistol' },
  { key: 'shiyang_pistol',name: "Shi Yang's Pistol",   itemNumbers: [25],  url: '/siege/weapons/item_25.glb',  lengthM: 0.30, rotDeg: R, gripPos: G, animSet: 'pistol' },
  { key: 'flame_glove',   name: 'Flame Glove',         itemNumbers: [193], url: '/siege/weapons/item_193.glb', lengthM: 0.26, rotDeg: R, gripPos: G, animSet: 'pistol' },
  { key: 'bonnies_rifle', name: "Bonnie's Rifle",      itemNumbers: [24],  url: '/siege/weapons/item_24.glb',  lengthM: 1.10, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'zk5',           name: 'ZK-5',                itemNumbers: [168], url: '/siege/weapons/item_168.glb', lengthM: 0.90, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'flamethrower',  name: 'Flamethrower',        itemNumbers: [180], url: '/siege/weapons/item_180.glb', lengthM: 1.00, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'crossbow_cn',   name: 'Chinese Repeating Crossbow!', itemNumbers: [26], url: '/siege/weapons/item_26.glb', lengthM: 0.85, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'baseball_bat',  name: 'Baseball Bat',        itemNumbers: [215], url: '/siege/weapons/item_215.glb', lengthM: 0.85, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'golf_club',     name: 'GolfClub',            itemNumbers: [222], url: '/siege/weapons/item_222.glb', lengthM: 1.00, rotDeg: R, gripPos: G, animSet: 'rifle' },
  { key: 'pickaxe',       name: 'Pickaxe',             itemNumbers: [153], url: '/siege/weapons/item_153.glb', lengthM: 0.80, rotDeg: R, gripPos: G, animSet: 'rifle' },
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
