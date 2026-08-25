/**
 * One animated character body, used for BOTH the local player and everyone
 * else. Same component, same clip sets, same selector — so a remote player is
 * never a different, poorer thing than you are.
 *
 * The caller owns position and facing (the local avatar follows the camera,
 * remote ones follow the network). This only owns the body and its animation.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { DREADROOT_CHARACTERS, type DreadrootCharacter } from '../dreadrootCharacters';
import { charGlbUrl } from '@/components/siege/charadmin/characterStats';
import {
  AirborneTracker, pickMovementState, type MoveInput, type MoveState,
} from './movementState';
import {
  clipSetFor, resolveClip, JUMP_OFFSET, actionClipSetFor, MIXAMO_HARD_LAND, prepareRootRigClips,
  RIFLE_LIBRARY, LOCO_LIBRARY, MISC_LIBRARY, ROOT_LIBRARY,
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
      : [...rifle.animations, ...loco.animations, ...misc.animations]
  ), [c.rig, root.animations, rifle.animations, loco.animations, misc.animations]);

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
      : [...rifle.animations, ...loco.animations, ...misc.animations];
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
  const actionSet = useMemo(() => actionClipSetFor(c.rig), [c.rig]);
  /** An override action owns the whole body until this time. */
  const overrideUntil = useRef(0);
  /** Death holds forever; nothing releases it but a respawn. */
  const held = useRef(false);
  /** Last revival tick we acted on, so a respawn releases the death pose exactly once. */
  const seenRevival = useRef(revivalCount(actor));
  const wasGrounded = useRef(true);
  const fallSpeed = useRef(0);

  const air = useRef(new AirborneTracker());
  const current = useRef<string>('');
  const pos = useRef(new THREE.Vector3());

  /** Play one action. Additive rides on top of locomotion; override takes over. */
  const playAction = (id: ActionId, clip: string, mode: 'additive' | 'override') => {
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
    a.timeScale = 1;
    if (useMode === 'additive') {
      a.blendMode = THREE.AdditiveAnimationBlendMode;
      a.setEffectiveWeight(1);
      a.fadeIn(0.05).play();
      return;
    }
    // Override: fade the locomotion clip out and hold the body for the duration.
    const prev = current.current ? actions[current.current] : null;
    if (prev) prev.fadeOut(0.08);
    current.current = '';
    a.fadeIn(0.08).play();
    const dur = a.getClip().duration * 1000;
    if (ACTION_HOLDS[id]) held.current = true;
    else overrideUntil.current = performance.now() + dur;
  };

  useFrame(() => {
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
      const clip = hard && c.rig !== 'root' ? MIXAMO_HARD_LAND : actionSet.land;
      if (clip && actions[clip] && fallSpeed.current < -6) {
        playAction('land', clip, 'override');
      }
      fallSpeed.current = 0;
    }
    wasGrounded.current = input.grounded;

    // A queued one-shot from gameplay (shoot / reload / throw / hit / death).
    const queued = takeAction(actor);
    if (queued) {
      const clip = queued === 'land' && c.rig !== 'root' && fallSpeed.current < -12
        ? MIXAMO_HARD_LAND
        : actionSet[queued];
      if (clip && actions[clip]) playAction(queued, clip, ACTION_MODE[queued]);
      else if (!clip) warnMissingAction(c.rig, queued);
    }

    // While an override action owns the body, the locomotion selector stands
    // down — otherwise a death would be interrupted by the idle it fades into.
    if (held.current || now < overrideUntil.current) return;

    const { set, name } = clipSetFor(c.rig, armed);
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
  });

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
