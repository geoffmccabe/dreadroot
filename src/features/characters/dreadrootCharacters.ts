/**
 * The DreadRoot playable roster — 9 characters, borrowed from Siege Worlds.
 *
 * Stat SCHEMA is matched to the Siege Worlds Unity client so the two games
 * describe a character the same way. Source of truth found in
 * `Assets/Scripts/UI/CanvasManager/Abstraction/PreGameManagerModel.cs`:
 *
 *     MaxHealth, ReloadSpeedMultiplier, DamageReduction, WalkSpeed,
 *     RunSpeed, MovementMultiplier, DamageMultiplier   (+ a special ability)
 *
 * The NUMBERS could not be copied: in Unity they arrive from the game server
 * at runtime (read off a packet in that model's constructor), not from any
 * asset or config file. So every character starts at the Unity baselines
 * (health 1000, multipliers 1) and is editable, rather than invented.
 *
 * The special abilities ARE copied verbatim from
 * `AbstractPreGameManager.SetSpecialStat`. Only three of our nine appear
 * there — the other six are newer than the Unity build and genuinely have
 * none defined yet.
 */

export interface CharacterStatSchema {
  key: string;
  label: string;
  /** Unity baseline. */
  base: number;
  /** How to render it. */
  unit?: 'flat' | 'multiplier';
  hint?: string;
}

/** Matches PreGameManagerModel field-for-field. */
export const SW_STAT_SCHEMA: CharacterStatSchema[] = [
  { key: 'maxHealth', label: 'Max Health', base: 1000, unit: 'flat', hint: 'Unity scales the bar against 1000' },
  { key: 'damageMultiplier', label: 'Damage', base: 1, unit: 'multiplier' },
  { key: 'damageReduction', label: 'Damage Reduction', base: 1, unit: 'multiplier' },
  { key: 'reloadSpeedMultiplier', label: 'Reload Speed', base: 1, unit: 'multiplier' },
  { key: 'movementMultiplier', label: 'Movement', base: 1, unit: 'multiplier' },
  { key: 'walkSpeed', label: 'Walk Speed', base: 4, unit: 'flat' },
  { key: 'runSpeed', label: 'Run Speed', base: 8, unit: 'flat' },
];

export interface DreadrootCharacter {
  /** Display name. */
  name: string;
  /** glb under /siege/characters/. */
  file: string;
  /** Raw model height, measured from the glb bounding box. Used to normalise
   *  the preview so every character appears the same size. Jeanette's model is
   *  authored at ~33 units, which is why hers looks so different. */
  rawH: number;
  /** Clip in character_idles.glb, or null when the model has no idle at all. */
  idleClip: string | null;
  /** Clip inside the character's OWN glb, when it ships its own animations. */
  ownIdleClip?: string;
  special?: { header: string; description: string };
  /** True when nothing animates this model — it will stand in its bind pose. */
  staticOnly?: boolean;
}

/** Geoff's chosen order — this IS the Opt+Cmd+1..9 order. */
export const DREADROOT_CHARACTERS: DreadrootCharacter[] = [
  { name: 'Ash',      file: '/siege/characters/pilot_ash.glb',     rawH: 1.7906, idleClip: 'idle_ash' },
  { name: 'Dago',     file: '/siege/characters/pilot_dago.glb',    rawH: 1.6946, idleClip: 'idle_dago' },
  { name: 'Fluffer',  file: '/siege/characters/pilot_fluffer.glb', rawH: 2.0355, idleClip: 'idle_fluffer' },
  { name: 'Jankz',    file: '/siege/characters/pilot_jankz.glb',   rawH: 1.7106, idleClip: 'idle_jankz' },
  { name: 'Rajax',    file: '/siege/characters/pilot_rajax.glb',   rawH: 1.9260, idleClip: 'idle_rajax' },
  { name: 'Thorn',    file: '/siege/characters/pilot_thorn.glb',   rawH: 1.7598, idleClip: 'idle_thorn' },
  {
    name: 'Flamma', file: '/siege/characters/flamma.glb', rawH: 1.7943,
    idleClip: null, staticOnly: true,
    special: { header: "Locked 'n Loaded", description: 'Increase reserve ammo by 50.' },
  },
  {
    name: 'Jeanette', file: '/siege/characters/jeanette.glb', rawH: 33.7349,
    idleClip: null, staticOnly: true,
    special: { header: 'Defenders Might', description: 'Potions heal extra 200HP.' },
  },
  {
    name: 'Shi Yang', file: '/siege/characters/shiyang.glb', rawH: 1.9247,
    idleClip: null, ownIdleClip: 'Root|3D_Pistol_Idle|Animation Base Layer',
    special: { header: 'Full Metal Jacket', description: 'First shot on enemy deals double damage. (Max +100).' },
  },
];

export function characterByIndex(i: number): DreadrootCharacter | undefined {
  return DREADROOT_CHARACTERS[i];
}
export function characterByName(name: string): DreadrootCharacter | undefined {
  return DREADROOT_CHARACTERS.find((c) => c.name === name);
}
