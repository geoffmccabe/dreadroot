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
  unit: 'flat' | 'multiplier';
  /** True when a LOWER number is better (damage reduction multiplies incoming
   *  damage, so 0.9 means you take 10% less). */
  lowerIsBetter?: boolean;
  hint?: string;
}

/** The five stats the Siege Worlds server actually balances characters on. */
export const SW_STAT_SCHEMA: CharacterStatSchema[] = [
  { key: 'maxHealth', label: 'Max Health', unit: 'flat' },
  { key: 'damageMultiplier', label: 'Damage', unit: 'multiplier' },
  { key: 'damageReduction', label: 'Damage Taken', unit: 'multiplier', lowerIsBetter: true,
    hint: 'multiplies INCOMING damage — lower is better' },
  { key: 'reloadSpeedMultiplier', label: 'Reload Speed', unit: 'multiplier' },
  { key: 'moveSpeedMultiplier', label: 'Move Speed', unit: 'multiplier' },
];

export interface SwStats {
  maxHealth: number;
  reloadSpeedMultiplier: number;
  damageReduction: number;
  moveSpeedMultiplier: number;
  damageMultiplier: number;
}

/** The server's baseline — an unbalanced character sits here. */
export const SW_BASELINE: SwStats = {
  maxHealth: 1000, reloadSpeedMultiplier: 1, damageReduction: 1,
  moveSpeedMultiplier: 1, damageMultiplier: 1,
};

export interface DreadrootCharacter {
  name: string;
  file: string;
  /** Raw model height from the glb bounding box. */
  rawH: number;
  /** Height this character should stand in the world, metres. */
  targetH: number;
  /** Where its animations come from. */
  rig: 'mixamo' | 'root';
  /** Clip name to idle on. */
  idleClip: string;
  stats: SwStats;
  /**
   * Correction applied to the model's root before anything else.
   *
   * These glbs are authored Z-up and the exporter normally writes a +90° X
   * rotation and a 0.01 scale onto the root Armature node. Jeanette's export
   * has NEITHER (root rotation and scale are both null, where Flamma's and Shi
   * Yang's carry them), which is why she rendered flat on her back at 100x
   * size. Applied here rather than editing the glb, so the asset stays as the
   * artist exported it.
   */
  rootFix?: { rotXDeg?: number; scale?: number };
  /**
   * Where this character's EYES sit above their feet, after scaling to
   * targetH. Measured from each model's own Head bone rather than guessed: a
   * single shared 1.6 put the camera inside Ash's hat, because his head sits
   * lower in his silhouette than Rajax's does.
   *
   * The Head bone is at the base of the skull, so the eyes are a little above
   * it — EYE_ABOVE_HEAD_BONE covers that.
   */
  eyeH: number;
  /** True when the numbers are the server default because the character does
   *  not exist in the Siege Worlds balance table yet. */
  statsAreDefault?: boolean;
  special?: { header: string; description: string };
}

/**
 * Two different skeletons are in play, and they share NO bone names:
 *   'mixamo' — pilot_*.glb, 50 joints named mixamorig:*. Animated by the
 *              shared character_idles.glb library.
 *   'root'   — flamma / jeanette / shiyang, 49 joints named Root, Hips,
 *              Spine_01... Flamma and Jeanette ship no animations of their
 *              own, but Shi Yang's 15 clips target all 49 of their bones
 *              (verified 49/49), so his library drives all three.
 */
export const ROOT_RIG_ANIM_SOURCE = '/siege/characters/shiyang.glb';
export const MIXAMO_IDLE_LIBRARY = '/siege/characters/character_idles.glb';
const ROOT_IDLE = 'Root|3D_Pistol_Idle|Animation Base Layer';

/** Everyone stands the same height in-world. */
/**
 * Reference size, from Geoff: ASH is 1.8m to the top of his head and about
 * 1.95m to the top of his HAT, with his eyes 0.23m below the hat.
 *
 * Everyone is scaled by the SAME factor from their real model height rather
 * than all being forced to one number, so the roster keeps its actual
 * proportions — Fluffer really is bigger than Dago, and flattening that was
 * hiding it.
 */
const STANDARD_H = 1.7;   // legacy; per-character targetH below is what is used
/** Head bone to eye line. The bone sits at the base of the skull. */
export const EYE_ABOVE_HEAD_BONE = 0.11;
/**
 * How far BEHIND the camera the head sits, so you look out from in front of
 * the face instead of from inside the skull. First person with a visible body
 * always has this problem; most games solve it by hiding the head, but the
 * whole point of the ghost avatar is to see yourself.
 */
export const HEAD_BEHIND_CAMERA = 0.08;

/**
 * Siege Worlds base movement, from FirstPersonController.cs:
 *     MaxWalkSpeed = 2f;  MaxRunSpeed = 3f;
 * and Player.cs applies the character multiplier:
 *     WalkSpeed = speedScale * MaxWalkSpeed
 *
 * PARITY NOTE: DreadRoot currently walks at 4.0 and sprints at 8.0 — about 2x
 * walk and 2.7x run versus Siege Worlds. Making a character "feel the same
 * across both games" means reconciling that, which is a gameplay decision, not
 * a bug fix, so nothing here changes movement. These constants exist so the
 * chooser can show what a character's speed WOULD be at Siege Worlds parity.
 */
export const SW_BASE_WALK = 2.0;
export const SW_BASE_RUN = 3.0;

/** This character's Siege Worlds walk/run speed in m/s. */
export function swSpeeds(c: { stats: SwStats }): { walk: number; run: number } {
  return {
    walk: +(SW_BASE_WALK * c.stats.moveSpeedMultiplier).toFixed(2),
    run: +(SW_BASE_RUN * c.stats.moveSpeedMultiplier).toFixed(2),
  };
}

/** Geoff's chosen order — this IS the Opt+Cmd+1..9 order. */
export const DREADROOT_CHARACTERS: DreadrootCharacter[] = [
  { name: 'Ash', file: '/siege/characters/pilot_ash.glb', rawH: 1.7906, targetH: 1.95,
    eyeH: 1.72, rig: 'mixamo', idleClip: 'idle_ash',
    stats: { maxHealth: 1500, reloadSpeedMultiplier: 1.3, damageReduction: 0.9, moveSpeedMultiplier: 1.2, damageMultiplier: 0.85 } },
  { name: 'Dago', file: '/siege/characters/pilot_dago.glb', rawH: 1.6946, targetH: 1.85,
    eyeH: 1.69, rig: 'mixamo', idleClip: 'idle_dago',
    stats: { maxHealth: 3000, reloadSpeedMultiplier: 1.1, damageReduction: 1.0, moveSpeedMultiplier: 1.1, damageMultiplier: 0.95 } },
  { name: 'Fluffer', file: '/siege/characters/pilot_fluffer.glb', rawH: 2.0355, targetH: 2.22,
    eyeH: 2.06, rig: 'mixamo', idleClip: 'idle_fluffer',
    stats: { ...SW_BASELINE }, statsAreDefault: true },
  { name: 'Jankz', file: '/siege/characters/pilot_jankz.glb', rawH: 1.7106, targetH: 1.86,
    eyeH: 1.74, rig: 'mixamo', idleClip: 'idle_jankz',
    stats: { maxHealth: 1400, reloadSpeedMultiplier: 1.35, damageReduction: 0.9, moveSpeedMultiplier: 1.3, damageMultiplier: 0.85 } },
  { name: 'Rajax', file: '/siege/characters/pilot_rajax.glb', rawH: 1.9260, targetH: 2.10,
    eyeH: 1.97, rig: 'mixamo', idleClip: 'idle_rajax',
    stats: { ...SW_BASELINE }, statsAreDefault: true },
  { name: 'Thorn', file: '/siege/characters/pilot_thorn.glb', rawH: 1.7598, targetH: 1.92,
    eyeH: 1.80, rig: 'mixamo', idleClip: 'idle_thorn',
    stats: { maxHealth: 1500, reloadSpeedMultiplier: 1.3, damageReduction: 0.9, moveSpeedMultiplier: 1.2, damageMultiplier: 0.85 } },
  { name: 'Flamma', file: '/siege/characters/flamma.glb', rawH: 1.7943, targetH: 1.95,
    eyeH: 1.83, rig: 'root', idleClip: ROOT_IDLE,
    stats: { maxHealth: 3000, reloadSpeedMultiplier: 1.2, damageReduction: 1.2, moveSpeedMultiplier: 1.2, damageMultiplier: 0.8 },
    special: { header: "Locked 'n Loaded", description: 'Increase reserve ammo by 50.' } },
  // Jeanette is authored LYING DOWN and ~100x oversized. Her bind pose measures
  // X 178 (arm span) x Y 33.7 (body depth) x Z 173 (head to toe) — so 33.7 was
  // never her height, it was her thickness, which is why scaling by it left her
  // wrong. rotXDeg stands her up; the preview then measures the rotated box, so
  // her height reads as the 173 axis and no hand-set scale is needed.
  { name: 'Jeanette', file: '/siege/characters/jeanette.glb', rawH: 173.0249, targetH: 1.75,
    eyeH: 1.65, rig: 'root', idleClip: ROOT_IDLE,
    rootFix: { rotXDeg: 90 },
    stats: { maxHealth: 1500, reloadSpeedMultiplier: 1.3, damageReduction: 0.9, moveSpeedMultiplier: 1.2, damageMultiplier: 0.85 },
    special: { header: 'Defenders Might', description: 'Potions heal extra 200HP.' } },
  { name: 'Shi Yang', file: '/siege/characters/shiyang.glb', rawH: 1.9247, targetH: 2.10,
    eyeH: 1.80, rig: 'root', idleClip: ROOT_IDLE,
    stats: { maxHealth: 1400, reloadSpeedMultiplier: 1.5, damageReduction: 0.9, moveSpeedMultiplier: 1.3, damageMultiplier: 0.8 },
    special: { header: 'Full Metal Jacket', description: 'First shot on enemy deals double damage. (Max +100).' } },
];

/** Percent difference from the server baseline, for display. */
export function statDelta(key: keyof SwStats, value: number): number {
  const base = SW_BASELINE[key];
  if (!base) return 0;
  return Math.round(100 * (value / base - 1));
}

export function characterByIndex(i: number): DreadrootCharacter | undefined {
  return DREADROOT_CHARACTERS[i];
}
export function characterByName(name: string): DreadrootCharacter | undefined {
  return DREADROOT_CHARACTERS.find((c) => c.name === name);
}
