/**
 * One animated character body, used for BOTH the local player and everyone
 * else. Same component, same clip sets, same selector — so a remote player is
 * never a different, poorer thing than you are.
 *
 * The caller owns position and facing (the local avatar follows the camera,
 * remote ones follow the network). This only owns the body and its animation.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { frameLoop } from '@/lib/frameLoop';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { DREADROOT_CHARACTERS, type DreadrootCharacter } from '../dreadrootCharacters';
import { charGlbUrl } from '@/components/siege/charadmin/characterStats';
import { attachWeapon, weaponForItem, type AttachedWeapon } from './attachWeapon';
import { buildFakeReloadClip, FAKE_RELOAD_CLIP, FAKE_RELOAD_SECONDS } from './fakeReload';
import {
  AirborneTracker, pickMovementState, type MoveInput, type MoveState,
} from './movementState';
import {
  clipSetFor, resolveClip, JUMP_OFFSET, actionClipSetFor, MIXAMO_HARD_LAND, MIXAMO_DROP_ROLL,
  RECOIL_WEIGHT,
  prepareRootRigClips,
  RIFLE_LIBRARY, LOCO_LIBRARY, MISC_LIBRARY, ROOT_LIBRARY, PISTOL_LIBRARY,
} from './clipSets';
import {
  ACTION_HOLDS, ACTION_MODE, LOCAL_ACTOR, isUpperBodyTrack, takeAction,
  revivalCount, type ActionId,
} from './characterActions';

export interface CharacterAvatarProps {
  /** Character name from the roster; falls back to the first one. */
  character: string;
  /** Movement state, read fresh every frame. */
  getInput: () => MoveInput;
  /** World position, written into the group each frame by the caller's source. */
  getPosition: (out: THREE.Vector3) => void;
  /** Facing, in radians, Y axis. */
  getYaw: () => number;
  /** 0-1. The local avatar starts translucent while it is being tuned. */
  opacity?: number;
  /** Hidden in first person, but still ticked so the pose is right on zoom-out. */
  visible?: boolean;
  armed?: boolean;
  /** Which actor's one-shot actions this body plays. Local player by default. */
  actor?: string;
  /** item_number of the weapon in hand, or null for empty-handed. */
  weaponItemNumber?: number | null;
  /** The weapon's real reload time in seconds, so a generated reload can be
   *  matched to it rather than running at a fixed length. */
  reloadSeconds?: number | null;
  /**
   * Collapse the head (and whatever rides on it — hair, hat) so it cannot fill
   * the view. For YOUR OWN body in first person: you can never see your own
   * head anyway, and leaving it there put a skinned mesh across the whole
   * screen at zero distance.
   */
  hideHead?: boolean;
}

const CROSSFADE = 0.2;
/** Jumps snap in — a slow fade plus the clip's own wind-up reads as no jump. */
const JUMP_FADE = 0.06;

const warnedActions = new Set<string>();
/** Say once when a rig simply has no clip for an action — e.g. the Mixamo rig
 *  has no grenade throw, and the root rig has no landing. Silence would look
 *  like the trigger was broken rather than the library being incomplete. */
function warnMissingAction(rig: string, id: string): void {
  const key = `${rig}:${id}`;
  if (warnedActions.has(key)) return;
  warnedActions.add(key);
  console.warn(`[charAnim] the ${rig} rig has no "${id}" clip — skipping it.`);
}

function findCharacter(name: string): DreadrootCharacter {
  return DREADROOT_CHARACTERS.find((c) => c.name === name) ?? DREADROOT_CHARACTERS[0];
}

export const CharacterAvatar: React.FC<CharacterAvatarProps> = ({
  character, getInput, getPosition, getYaw,
  opacity = 1, visible = true, armed = false, actor = LOCAL_ACTOR,
  hideHead = false, weaponItemNumber = null, reloadSeconds = null,
}) => {
  const c = findCharacter(character);
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  // Versioned URLs, matching the character chooser and the Siege avatar. Not
  // cosmetic: useGLTF caches by URL, so loading "/x.glb" here while everything
  // else loads "/x.glb?a=37" downloads and parses every model TWICE.
  const { scene } = useGLTF(charGlbUrl(c.file), '/draco/');
  // Mixamo bodies pull from the shared libraries; root-rig bodies can only use
  // the clips inside Shi Yang's file, which is the whole vocabulary they have.
  const rifle = useGLTF(charGlbUrl(RIFLE_LIBRARY), '/draco/');
  const loco  = useGLTF(charGlbUrl(LOCO_LIBRARY), '/draco/');
  const misc  = useGLTF(charGlbUrl(MISC_LIBRARY), '/draco/');
  const root  = useGLTF(charGlbUrl(ROOT_LIBRARY), '/draco/');
  const pistol = useGLTF(charGlbUrl(PISTOL_LIBRARY), '/draco/');

  const heldWeapon = useMemo(() => weaponForItem(weaponItemNumber), [weaponItemNumber]);
  // useGLTF cannot be called conditionally, so when there is no weapon it loads
  // the character's own file — already in cache, so it costs nothing.
  const gunUrl = heldWeapon ? charGlbUrl(heldWeapon.url) : charGlbUrl(c.file);
  const { scene: gunScene } = useGLTF(gunUrl, '/draco/');

  const cloned = useMemo(() => {
    const g = SkeletonUtils.clone(scene) as THREE.Group;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      // NEVER raycast a player body. three.js still raycasts invisible objects,
      // so without this your own avatar intercepts your own shots.
      m.raycast = () => {};
    });
    return g;
  }, [scene]);

  /**
   * The ORIGINAL materials, captured once.
   *
   * Translucency must go on clones — the source materials are shared with every
   * other body using this model, so editing them in place would make everyone
   * see-through. But the clones have to be made from these originals every
   * time, not from whatever is currently attached: changing opacity a second
   * time would otherwise clone the previous clones, which the cleanup had just
   * disposed. Opacity is a live setting the user will change repeatedly, so
   * that path is the normal one, not an edge case.
   */
  const originals = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  useMemo(() => {
    originals.current = new Map();
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) originals.current.set(m, m.material);
    });
  }, [cloned]);

  useEffect(() => {
    const made: THREE.Material[] = [];
    for (const [mesh, orig] of originals.current) {
      if (opacity >= 1) { mesh.material = orig; continue; }
      const src = Array.isArray(orig) ? orig : [orig];
      const copies = src.map((mat) => {
        const cm = mat.clone();
        cm.transparent = true;
        cm.opacity = opacity;
        // Translucent surfaces must not write depth, or the body's own far side
        // punches holes in its near side.
        cm.depthWrite = false;
        made.push(cm);
        return cm;
      });
      mesh.material = Array.isArray(orig) ? copies : copies[0];
    }
    return () => {
      // Put the originals back BEFORE disposing, so nothing is left pointing at
      // a disposed material for even a frame.
      for (const [mesh, orig] of originals.current) mesh.material = orig;
      for (const m of made) m.dispose();
    };
  }, [cloned, opacity]);

  const clips = useMemo(() => (
    c.rig === 'root'
      // Rotation-only: Shi Yang's clips are authored on an X-axis bone
      // convention and Flamma/Jeanette use Y, so the position tracks drive
      // every bone down the wrong axis and shred the model.
      ? prepareRootRigClips(root.animations)
      // The generated pistol reload rides along with the loaded clips so the
      // action layer treats it exactly like any other.
      : [...rifle.animations, ...loco.animations, ...misc.animations,
         ...pistol.animations, buildFakeReloadClip()]
  ), [c.rig, root.animations, rifle.animations, loco.animations, misc.animations, pistol.animations]);

  /**
   * Additive variants of the upper-body action clips.
   *
   * Built once per rig. Filtering to upper-body tracks is what lets the legs
   * keep running while the arms fire; makeClipAdditive is what stops the result
   * being a 50/50 blend of two poses, because the mixer weights every bone both
   * clips touch. Renamed so an additive variant and its original can coexist in
   * the same mixer without one shadowing the other.
   */
  const additiveClips = useMemo(() => {
    const src = c.rig === 'root'
      ? prepareRootRigClips(root.animations)
      : [...rifle.animations, ...loco.animations, ...misc.animations, ...pistol.animations];
    const wanted = new Set(
      Object.entries(actionClipSetFor(c.rig))
        .filter(([id, clip]) => clip && ACTION_MODE[id as ActionId] === 'additive')
        .map(([, clip]) => clip as string),
    );
    const out: THREE.AnimationClip[] = [];
    for (const clip of src) {
      if (!wanted.has(clip.name)) continue;
      const upper = clip.clone();
      upper.tracks = upper.tracks.filter((t) => isUpperBodyTrack(t.name));
      if (upper.tracks.length === 0) continue;   // nothing to add — skip silently
      THREE.AnimationUtils.makeClipAdditive(upper);
      upper.name = `${clip.name}__additive`;
      out.push(upper);
    }
    return out;
  }, [c.rig, root.animations, rifle.animations, loco.animations, misc.animations]);

  const allClips = useMemo(() => [...clips, ...additiveClips], [clips, additiveClips]);
  const { actions } = useAnimations(allClips, inner);

  /**
   * Size and stand the body, same as the character chooser.
   *
   * rawH is each model's TRUE rendered height, taken from the GLB files. It is
   * not the number a bounding box reports at runtime: every pilot is a skinned
   * mesh under an armature scaled 0.01, and the renderer ignores that node
   * transform while Box3 does not — measuring Ash that way returns 0.0038
   * against a real 1.79, which scales him up about 450x.
   *
   * rootFix carries a rotation for Jeanette, who is authored lying on her back.
   */
  const fit = useMemo(() => ({
    scale: c.targetH / (c.rawH > 1e-4 ? c.rawH : 1),
    rotX: ((c.rootFix?.rotXDeg ?? 0) * Math.PI) / 180,
  }), [c]);
  const available = useMemo(() => new Set(clips.map((a) => a.name)), [clips]);
  const stance: 'rifle' | 'pistol' = heldWeapon?.animSet === 'pistol' ? 'pistol' : 'rifle';
  const actionSet = useMemo(() => actionClipSetFor(c.rig, stance), [c.rig, stance]);
  /** An override action owns the whole body until this time. */
  const overrideUntil = useRef(0);
  /** Death holds forever; nothing releases it but a respawn. */
  const held = useRef(false);
  /** Last revival tick we acted on, so a respawn releases the death pose exactly once. */
  const seenRevival = useRef(revivalCount(actor));
  const wasGrounded = useRef(true);
  const fallSpeed = useRef(0);

  /**
   * The head bone, so it can be collapsed for the local first-person body.
   *
   * Scaling the BONE rather than hiding a mesh, because on most of these models
   * the head is not its own mesh — Ash's head, torso and legs are one skinned
   * mesh, so hiding it would hide him entirely. Everything weighted to this
   * bone collapses with it, which is exactly what we want: the hat and hair
   * ride the head bone too, so they go with it and nothing has to know their
   * names.
   *
   * HeadTop_End is excluded — it is a Mixamo leaf marker, not the head.
   */
  const headBone = useMemo(() => {
    let found: THREE.Object3D | null = null;
    cloned.traverse((o) => {
      if (found) return;
      const n = o.name ?? '';
      if (/(^|:|_)head$/i.test(n)) found = o;
    });
    return found;
  }, [cloned]);

  /** The weapon parented to the hand, once the bones are live. */
  const attached = useRef<AttachedWeapon | null>(null);
  const attachedFor = useRef<number | null>(null);

  const air = useRef(new AirborneTracker());
  const current = useRef<string>('');
  const pos = useRef(new THREE.Vector3());

  /** Play one action. Additive rides on top of locomotion; override takes over. */
  const playAction = (id: ActionId, clip: string, mode: 'additive' | 'override', seconds?: number) => {
    // An additive action MUST use its prepared additive variant. Falling back
    // to the original clip and forcing blendMode on it would add absolute bone
    // values instead of a delta, which is not a worse animation — it is a
    // scrambled one. If the variant is missing, play it as an override instead.
    let useMode = mode;
    let name = clip;
    if (mode === 'additive') {
      const additive = `${clip}__additive`;
      if (actions[additive]) name = additive;
      else useMode = 'override';
    }
    const a = actions[name];
    if (!a) return;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = ACTION_HOLDS[id];
    /**
     * Match the generated reload to the WEAPON's own reload time. The weapons
     * carry real values (a Basic Pistol is 1.15s), so a fixed-length animation
     * would either still be swinging after the gun is loaded or finish early
     * and stand idle. One number fixes it.
     */
    a.timeScale = 1;
    if (id === 'reload' && clip === FAKE_RELOAD_CLIP) {
      const secs = reloadSeconds ?? FAKE_RELOAD_SECONDS;
      a.timeScale = FAKE_RELOAD_SECONDS / Math.max(0.3, secs);
    } else if (seconds && seconds > 0 && a.getClip().duration > 0) {
      // The caller knows how long this takes — a climb is carried along a
      // scripted path for a fixed time, and the clip was authored at some other
      // length entirely. Unscaled, the body finishes the move and then carries
      // on climbing thin air, which is exactly what "it climbs into the sky"
      // looked like from outside.
      a.timeScale = a.getClip().duration / seconds;
    }
    if (useMode === 'additive') {
      a.blendMode = THREE.AdditiveAnimationBlendMode;
      // A borrowed rifle recoil is far too big for a handgun. The additive
      // weight is the dial for exactly that.
      a.setEffectiveWeight(id === 'shoot' ? RECOIL_WEIGHT[stance] : 1);
      a.fadeIn(0.05).play();
      return;
    }
    // Override: fade the locomotion clip out and hold the body for the duration.
    const prev = current.current ? actions[current.current] : null;
    if (prev) prev.fadeOut(0.08);
    current.current = '';
    a.fadeIn(0.08).play();
    // DIVIDED BY timeScale. The lockout has to be how long the clip will
    // actually take, not how long it was authored to take — a clip sped up to
    // fit a 0.9s climb finishes in 0.9s, and holding locomotion down for its
    // full authored length leaves the body with NOTHING playing. That is a
    // T-pose, and it is exactly what appeared the moment clip scaling landed.
    const dur = (a.getClip().duration / (a.timeScale || 1)) * 1000;
    if (ACTION_HOLDS[id]) held.current = true;
    else overrideUntil.current = performance.now() + dur;
  };

  /**
   * Driven from the SHARED frame loop at a priority AFTER the controls, not
   * from useFrame.
   *
   * WHY: the controls publish the player's position and facing once per frame,
   * and R3F gave no guarantee this ran after them — so the body was drawing
   * last frame's pose. At walking speed that lag is invisible. At a run it is
   * around 13cm at 30fps, which is more than the 14cm the head sits behind the
   * camera, so the camera ended up back inside the head exactly when holding
   * shift. Same for a fast turn. Ordering it after the controls removes the
   * lag rather than compensating for it.
   */
  useEffect(() => frameLoop.register(`avatar-${actor}`, () => {
    const g = group.current;
    if (!g) return;

    getPosition(pos.current);
    g.position.copy(pos.current);
    g.rotation.y = getYaw();

    // A respawn releases the death hold. Checked before anything else, so the
    // body is animating again on the same frame the player is alive again.
    const rev = revivalCount(actor);
    if (rev !== seenRevival.current) {
      seenRevival.current = rev;
      held.current = false;
      overrideUntil.current = 0;
      current.current = '';
    }

    // Re-asserted every frame rather than set once: most of these clips carry
    // no scale track, but a stray one would otherwise restore the head
    // mid-animation and put it back across the screen. One assignment is
    // cheaper than being wrong about every clip in the library.
    if (headBone) {
      const k = hideHead ? 0.0001 : 1;
      if (headBone.scale.x !== k) headBone.scale.setScalar(k);
    }

    // ATTACH / SWAP THE WEAPON. Retried each frame until the hand bone's world
    // matrices are live — they are not on the first frame after a model loads,
    // which is why this is not a one-shot effect.
    if (attachedFor.current !== weaponItemNumber) {
      if (attached.current) {
        attached.current.wrap.removeFromParent();
        attached.current = null;
      }
      attachedFor.current = weaponItemNumber;
    }
    if (heldWeapon && !attached.current) {
      let hand: THREE.Object3D | undefined;
      cloned.traverse((o) => { if (o.name.endsWith('RightHand') || /(^|:|_)Hand_R$/i.test(o.name)) hand = o; });
      if (hand) {
        attached.current = attachWeapon(g, hand, gunScene, heldWeapon, c.name);
      }
    }
    if (attached.current) attached.current.wrap.visible = armed;

    const input = getInput();
    const now = performance.now();
    const airborne = air.current.update(input, performance.now());
    const state: MoveState = pickMovementState(input, airborne);

    // LANDING is derived here rather than pushed from gameplay: the animator
    // already knows the ground state, and the impact speed decides soft vs hard.
    // Remember the speed on the way down — by the frame we touch down, vy has
    // already been zeroed by the collision, so reading it then always says 0.
    if (!input.grounded && input.vy < 0) fallSpeed.current = input.vy;
    if (input.grounded && !wasGrounded.current) {
      const hard = fallSpeed.current < -12;
      // Coming down hard WHILE RUNNING rolls out of it. Needs real forward
      // momentum: the roll clip carries the body forward, so playing it from a
      // standing drop would slide the character across the ground.
      const rolling = hard && input.run && input.mf > 0 && c.rig !== 'root';
      const clip = rolling ? MIXAMO_DROP_ROLL
        : (hard && c.rig !== 'root' ? MIXAMO_HARD_LAND : actionSet.land);
      if (clip && actions[clip] && fallSpeed.current < -6) {
        playAction('land', clip, 'override');
      }
      fallSpeed.current = 0;
    }
    wasGrounded.current = input.grounded;

    // A queued one-shot from gameplay (shoot / reload / throw / hit / death).
    const queued = takeAction(actor);
    if (queued) {
      const clip = queued.id === 'land' && c.rig !== 'root' && fallSpeed.current < -12
        ? MIXAMO_HARD_LAND
        : actionSet[queued.id];
      if (clip && actions[clip]) playAction(queued.id, clip, ACTION_MODE[queued.id], queued.seconds);
      else if (!clip) warnMissingAction(c.rig, queued.id);
    }

    // While an override action owns the body, the locomotion selector stands
    // down — otherwise a death would be interrupted by the idle it fades into.
    if (held.current || now < overrideUntil.current) return;

    // The stance comes from the WEAPON, not from a boolean. Unregistered
    // weapons have no entry, and default to the rifle stance as before.
    const { set, name } = clipSetFor(c.rig, armed, stance);
    const want = resolveClip(set, state, available, name);
    if (!want || want === current.current) return;

    const next = actions[want];
    if (!next) return;

    const isJump = state === 'jump';
    const fade = isJump ? JUMP_FADE : CROSSFADE;
    const prev = current.current ? actions[current.current] : null;
    if (prev) prev.fadeOut(fade);

    next.reset();
    // Start past the crouch wind-up so the leap shows immediately.
    if (isJump) next.time = JUMP_OFFSET[want] ?? 0;
    next.setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, isJump ? 1 : Infinity);
    next.clampWhenFinished = isJump;
    next.timeScale = 1;
    next.fadeIn(fade).play();
    current.current = want;
  }, 40),
  // Re-registered when any of these change: the callback closes over them, and
  // a stale closure here means the body keeps animating the PREVIOUS character.
  [actor, actions, available, actionSet, armed, c, getInput, getPosition, getYaw, headBone, hideHead,
   heldWeapon, gunScene, cloned, weaponItemNumber]);

  return (
    <group ref={group} visible={visible}>
      {/* The animation mixer drives `inner`, so the scale and stand-up fix sit
          OUTSIDE it — a clip must never fight the transform that sizes the
          body. Group position is the FEET, which is what the caller supplies. */}
      <group scale={fit.scale} rotation-x={fit.rotX}>
        <group ref={inner}>
          <primitive object={cloned} />
        </group>
      </group>
    </group>
  );
};
