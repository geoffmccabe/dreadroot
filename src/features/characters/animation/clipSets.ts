/**
 * Which clip plays for each movement state, per skeleton.
 *
 * THE CONSTRAINT: two rigs that share NO bone names.
 *
 *   mixamo  Ash, Dago, Fluffer, Jankz, Rajax, Thorn  — the full ~110-clip library
 *   root    Flamma, Jeanette, Shi Yang               — only their own 15 clips
 *
 * So the root three will always do less. That is accepted, not a bug to fix
 * here: a clip cannot be played on a skeleton it was not authored for, and
 * retargeting them is a separate decision (see docs/CHARACTER_ANIMATION_PLAN.md
 * phase 7).
 *
 * A null slot means "we have no clip for this" and is a deliberate blank, not
 * an oversight. resolveClip walks a fallback chain to the nearest sensible
 * motion and says so ONCE per missing slot, so a gap shows up in the console as
 * a fact rather than as a character freezing with no explanation.
 */
import * as THREE from 'three';
import type { MoveState } from './movementState';

export type ClipSet = Record<MoveState, string | null>;

/** Animation libraries, loaded once and shared by every mixamo-rigged body. */
export const RIFLE_LIBRARY = '/siege/characters/siege_rifle_anims.glb';
export const LOCO_LIBRARY  = '/siege/characters/siege_loco_anims.glb';
export const MISC_LIBRARY  = '/siege/characters/siege_anims.glb';
/** The root rig's clips live inside Shi Yang's own file. */
export const ROOT_LIBRARY  = '/siege/characters/shiyang.glb';

/** Root-rig clips carry their Blender export names. */
const R = (n: string) => `Root|${n}|Animation Base Layer`;

/** Mixamo, weapon out. Gun-up idle, not the relaxed one. */
export const MIXAMO_ARMED: ClipSet = {
  idle:    'Anim_Rifle_Idle_Aiming_NoSkin',
  walkF:   'Anim_Rifle_Walk_Not_Aiming_NoSkin',
  walkB:   'Anim_Rifle_Backward_Run_NoSkin',
  strafeL: 'Anim_Rifle_Strafe_Left_NoSkin',
  strafeR: 'Anim_Rifle_Strafe_Right_NoSkin',
  runF:    'Anim_Rifle_Run_NoSkin',
  runL:    'Anim_Rifle_Run_Left_NoSkin',
  runR:    'Anim_Rifle_Run_Right_NoSkin',
  jump:    'Anim_Rifle_Jump_Up_NoSkin',
  fall:    'Anim_Idle_Falling_NoSkin',
  glide:   'Gliding',
};

/** Mixamo, nothing in hand — so the body is not posed around an invisible gun. */
export const MIXAMO_UNARMED: ClipSet = {
  idle:    'Loco_M_idle',
  walkF:   'Loco_M_walking',
  walkB:   'Anim_Walking_Backward_NoSkin',
  strafeL: 'Loco_M_left_strafe_walking',
  strafeR: 'Loco_M_right_strafe_walking',
  runF:    'Loco_M_running',
  runL:    'Loco_M_left_strafe',
  runR:    'Loco_M_right_strafe',
  jump:    'Loco_M_jump',
  fall:    'Anim_Idle_Falling_NoSkin',
  glide:   'Gliding',
};

/**
 * The root rig's entire vocabulary. Every clip it owns is a pistol-stance clip,
 * so armed and unarmed are the same set — there is no unarmed variant to pick.
 *
 * Genuinely absent: run-strafe (walk-strafe stands in), falling (the jump pose
 * holds), and gliding. 'Fall Over' is NOT used for falling — it is a death
 * ragdoll and would read as dying every time you stepped off a block.
 */
export const ROOT_SET: ClipSet = {
  idle:    R('3D_Pistol_Idle'),
  walkF:   R('3D_Pistol_Walk'),
  walkB:   R('3D_Pistol_Backwards'),
  strafeL: R('3D_Pistol_Left'),
  strafeR: R('3D_Pistol_Right'),
  runF:    R('3D_Pistol_Run'),
  runL:    null,
  runR:    null,
  jump:    R('3D_Pistol_Jump'),
  fall:    null,
  glide:   null,
};

/** Where to look next when a slot is empty. Ends at idle, which always exists. */
const FALLBACK: Record<MoveState, MoveState[]> = {
  idle:    [],
  walkF:   ['idle'],
  walkB:   ['walkF', 'idle'],
  strafeL: ['walkF', 'idle'],
  strafeR: ['walkF', 'idle'],
  runF:    ['walkF', 'idle'],
  runL:    ['strafeL', 'walkF', 'idle'],
  runR:    ['strafeR', 'walkF', 'idle'],
  jump:    ['idle'],
  fall:    ['jump', 'idle'],
  glide:   ['fall', 'jump', 'idle'],
};

const warned = new Set<string>();

/**
 * The clip to play, following the fallback chain past empty slots and past
 * clips the loaded model turns out not to have.
 *
 * `available` is checked because a slot can be filled in the table and still
 * missing at runtime — a library that failed to load, or a re-exported model
 * that dropped a clip. Silently playing nothing is the failure mode that reads
 * as "the character is frozen", so every substitution is reported once.
 */
export function resolveClip(
  set: ClipSet,
  state: MoveState,
  available: ReadonlySet<string>,
  setName: string,
): string | null {
  const chain: MoveState[] = [state, ...FALLBACK[state]];
  for (const s of chain) {
    const clip = set[s];
    if (clip && available.has(clip)) {
      if (s !== state) {
        const key = `${setName}:${state}`;
        if (!warned.has(key)) {
          warned.add(key);
          console.warn(`[charAnim] ${setName} has no "${state}" — using "${s}" (${clip}).`);
        }
      }
      return clip;
    }
  }
  const key = `${setName}:${state}:none`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[charAnim] ${setName} has nothing for "${state}" and no fallback loaded.`);
  }
  return null;
}

/**
 * Make the shared root-rig clips safe to play on Flamma and Jeanette.
 *
 * WHY THIS IS NEEDED, from the files themselves. The clips come from Shi Yang,
 * and his skeleton uses a DIFFERENT BONE AXIS from the models that borrow them:
 *
 *   shiyang   Spine_01 rest = [10.39, 0, 0]   bones run along X
 *   flamma    Spine_01 rest = [0, 10.39, 0]   bones run along Y
 *   jeanette  Spine_01 rest = [0, 10.39, 0]   bones run along Y
 *
 * Same proportions, different convention. The clip animates POSITION for all
 * 49 bones, so playing it on Flamma drives every bone's offset down the wrong
 * axis at once and tears the model apart. My earlier attempt only stripped the
 * Root track, which is why it barely helped: the problem is every bone, not one.
 *
 * The fix is the standard one for two rigs that share bone NAMES but not rest
 * poses — retarget on ROTATION ONLY. Each model then keeps its own bone
 * offsets, authored for its own axis, and the clip supplies just the joint
 * angles, which are convention-independent.
 *
 * Losing the position tracks also loses root motion, which is what we want:
 * these are in-place animations and the game's physics owns where the body is.
 * The Siege self-avatar drops Hips.position from its loose FBX clips for the
 * same reason.
 */
export function prepareRootRigClips(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  return clips.map((clip) => {
    const rot = clip.tracks.filter((t) => /\.quaternion$/.test(t.name));
    if (rot.length === clip.tracks.length) return clip;
    const c = clip.clone();
    c.tracks = rot;
    return c;
  });
}

/** Jump clips open with a crouch wind-up; the physics jump is instant, so we
 *  start past the wind-up or the leap reads as delayed. */
export const JUMP_OFFSET: Record<string, number> = {
  'Loco_M_jump': 0.85,
  'Anim_Rifle_Jump_Up_NoSkin': 0.12,
};

/**
 * One-shot ACTION clips per rig.
 *
 * A null here is a real gap, not laziness — the clip does not exist for that
 * skeleton. Notably neither the rifle nor the misc library has a grenade throw
 * for the Mixamo rig, while the root rig has one baked in; and the root rig has
 * no landing clip at all.
 *
 * 'Fall Over' is NOT used as the root rig's hit reaction. It is a full collapse
 * and would read as dying every time you were grazed.
 */
export type ActionClipSet = Partial<Record<
  'shoot' | 'reload' | 'throw' | 'hit' | 'death' | 'land' | 'climb' | 'vault', string | null
>>;

export const MIXAMO_ACTIONS: ActionClipSet = {
  shoot:  'Anim_Rifle_Firing_NoSkin',
  reload: 'Anim_Rifle_Reload_Standing_NoSkin',
  throw:  null,   // no throw clip exists for this rig
  hit:    'Anim_Hit_Knocked_Backwards_NoSkin',
  death:  'Anim_Death_Slow_Fall_Back_NoSkin',
  land:   'Anim_Hit_Falling_To_Landing_NoSkin',
  climb:  'Climbing Up Wall',
  vault:  'Anim_Parkour_Run_To_Kick-Jump_Over_1m_Object',
};

/** Only used when the fall was fast enough to warrant it. */
export const MIXAMO_HARD_LAND = 'Anim_Hit_Falling_To_Hard_Landing_NoSkin';
/** A hard landing WHILE RUNNING rolls out of it instead of absorbing it on the
 *  spot. Requires forward momentum — rolling from a standing drop looks silly,
 *  and the clip carries the body forward, so playing it without matching
 *  movement would slide the character. */
export const MIXAMO_DROP_ROLL = 'Anim_Parkour_Jump_Down_To_Roll_NoSkin';

export const ROOT_ACTIONS: ActionClipSet = {
  shoot:  R('3D_Pistol_Shoot'),
  reload: R('3D_Reload'),
  throw:  R('3D_ThrowNade'),
  hit:    null,   // only 'Fall Over' exists, which is a collapse, not a flinch
  death:  R('dead'),
  land:   null,
  climb:  null,   // no climb clip on this rig — these three do not mantle
  vault:  null,   // nor vault
};

export function actionClipSetFor(rig: 'mixamo' | 'root'): ActionClipSet {
  return rig === 'root' ? ROOT_ACTIONS : MIXAMO_ACTIONS;
}

export function clipSetFor(rig: 'mixamo' | 'root', armed: boolean): { set: ClipSet; name: string } {
  if (rig === 'root') return { set: ROOT_SET, name: 'root' };
  return armed
    ? { set: MIXAMO_ARMED, name: 'mixamo/armed' }
    : { set: MIXAMO_UNARMED, name: 'mixamo/unarmed' };
}
