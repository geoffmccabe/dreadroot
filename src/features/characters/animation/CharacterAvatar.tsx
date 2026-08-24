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
import {
  AirborneTracker, pickMovementState, type MoveInput, type MoveState,
} from './movementState';
import {
  clipSetFor, resolveClip, JUMP_OFFSET,
  RIFLE_LIBRARY, LOCO_LIBRARY, MISC_LIBRARY, ROOT_LIBRARY,
} from './clipSets';

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
}

const CROSSFADE = 0.2;
/** Jumps snap in — a slow fade plus the clip's own wind-up reads as no jump. */
const JUMP_FADE = 0.06;

function findCharacter(name: string): DreadrootCharacter {
  return DREADROOT_CHARACTERS.find((c) => c.name === name) ?? DREADROOT_CHARACTERS[0];
}

export const CharacterAvatar: React.FC<CharacterAvatarProps> = ({
  character, getInput, getPosition, getYaw,
  opacity = 1, visible = true, armed = false,
}) => {
  const c = findCharacter(character);
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);

  const { scene } = useGLTF(c.file, '/draco/');
  // Mixamo bodies pull from the shared libraries; root-rig bodies can only use
  // the clips inside Shi Yang's file, which is the whole vocabulary they have.
  const rifle = useGLTF(RIFLE_LIBRARY, '/draco/');
  const loco  = useGLTF(LOCO_LIBRARY, '/draco/');
  const misc  = useGLTF(MISC_LIBRARY, '/draco/');
  const root  = useGLTF(ROOT_LIBRARY, '/draco/');

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

  // Translucency has to be applied to CLONED materials — the source materials
  // are shared with every other body using this model, so editing them in place
  // would make everyone see-through.
  useEffect(() => {
    const dispose: THREE.Material[] = [];
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const src = Array.isArray(m.material) ? m.material : [m.material];
      const copies = src.map((mat) => {
        const cm = mat.clone();
        cm.transparent = opacity < 1;
        cm.opacity = opacity;
        cm.depthWrite = opacity >= 1;
        dispose.push(cm);
        return cm;
      });
      m.material = Array.isArray(m.material) ? copies : copies[0];
    });
    return () => { for (const m of dispose) m.dispose(); };
  }, [cloned, opacity]);

  const clips = useMemo(() => (
    c.rig === 'root'
      ? [...root.animations]
      : [...rifle.animations, ...loco.animations, ...misc.animations]
  ), [c.rig, root.animations, rifle.animations, loco.animations, misc.animations]);

  const { actions } = useAnimations(clips, inner);

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

  const air = useRef(new AirborneTracker());
  const current = useRef<string>('');
  const pos = useRef(new THREE.Vector3());

  useFrame(() => {
    const g = group.current;
    if (!g) return;

    getPosition(pos.current);
    g.position.copy(pos.current);
    g.rotation.y = getYaw();

    const input = getInput();
    const airborne = air.current.update(input, performance.now());
    const state: MoveState = pickMovementState(input, airborne);

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
