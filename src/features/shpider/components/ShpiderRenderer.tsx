// ShpiderRenderer — Phase 4 (animated).
// Renders all active shpiders as InstancedMesh groups for body, head,
// leg segments, eyelashes, and mandibles. Drives the hop AI tick in
// the same useFrame so we only iterate the active list once.
//
// Animations covered here:
//   - Hop: linear X/Z + parabolic Y arc, Y(t) = sin(π t) × arcHeight.
//   - Head slide: oscillates forward/back along shpider facing by
//     ±headSize/2 (full headSize peak-to-peak), each shpider on its
//     own random phase.
//   - Legs: idle subtle bob + tuck-in / splay-out during the hop.
//   - Mandibles: per-shpider random click schedule, two cones snap
//     inward then back to rest.
//   - Eyelashes: static; 12 curved lashes arranged in an arc on the
//     head's front face. They don't move but they rotate with the
//     head (which is itself sliding).

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { ShpiderDefinition, ShpiderInstance } from '../types';
import { LEGS_PER_SHPIDER, SEGMENTS_PER_LEG, LEG_SEGMENT_THICKNESS } from '../constants';
import { stepShpiderHopAI, getHopProgress, getCrawlProgress } from '../lib/hopAI';
import { getSegmentEndpoints } from '../lib/legGeometry';
import { enemyCombatRegistry } from '@/features/enemies/combat/EnemyCombatRegistry';
import { shpiderSpatialGrid } from '../lib/shpiderSpatialGrid';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';
import {
  EYELASH_GEOMETRY,
  MANDIBLE_GEOMETRY,
  MANDIBLE_OPEN_ANGLE,
  MANDIBLE_CLICK_DURATION_MS,
  MANDIBLE_MIN_CLICK_INTERVAL_MS,
  MANDIBLE_MAX_CLICK_INTERVAL_MS,
} from '../lib/shpiderGeometry';
import { stepDeathFragments, type DeathFragment } from '../lib/deathFragments';

const NUM_TIERS = 10;
const MAX_PER_TIER = 64;
const MAX_LEG_PER_TIER = MAX_PER_TIER * LEGS_PER_SHPIDER * SEGMENTS_PER_LEG;

// Total shpider cap across all tiers. Per-tier meshes each hold up to
// MAX_PER_TIER (defined above the imports) so we never overflow a tier
// even if 10 tiers are unevenly populated.
const TOTAL_SHARED_INSTANCES = NUM_TIERS * MAX_PER_TIER;
const RENDER_DISTANCE = 80;
const RENDER_DISTANCE_SQ = RENDER_DISTANCE * RENDER_DISTANCE;

const MAX_MANDIBLE_INSTANCES = TOTAL_SHARED_INSTANCES * 2;
// Eye: 3 instances per shpider — black outline, white body, black pupil.
const MAX_EYE_INSTANCES = TOTAL_SHARED_INSTANCES * 3;

// Football-shaped (horizontal ellipse) cyclops eye on the head's front
// face. Dimensions are in head-radius units.
const EYE_WIDTH         = 0.55;   // wider than tall = football
const EYE_HEIGHT        = 0.30;
const EYE_OUTLINE       = 0.06;   // outline thickness (each side)
const EYE_PUPIL_RADIUS  = 0.08;
const EYE_LOCAL_Y       = 0.10;   // 20% of head ABOVE center (was -0.10)
const EYE_TRACK_RANGE   = 40;
const EYE_PUPIL_LERP    = 4.0;    // per second
const EYE_RANDOM_LOOK_INTERVAL_MS = 2200;

// Head slide: ~1 Hz oscillator. Amplitude = headSize / 2, so peak to
// peak = full head width — matches the user's spec.
const HEAD_SLIDE_HZ = 1.1;

// Reused scratch.
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _surfaceQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _legDir = new THREE.Vector3();
const _segStart = new THREE.Vector3();
const _segEnd = new THREE.Vector3();
const _segMid = new THREE.Vector3();
const _worldRot = new THREE.Quaternion();
// Scratch for the mandible splay rotation; one per process, NOT one
// per shpider per frame (the original code did `new Quaternion()`
// inside the mandible loop = 2 allocs per shpider per frame, =
// ~12k allocs/sec with 100 spiders. Pure GC churn).
const _mandibleYawQ = new THREE.Quaternion();
const _localPoint = new THREE.Vector3();

/** Triangle wave 0→1→0 over duration. */
function clickTriangle(t01: number): number {
  return t01 < 0.5 ? t01 * 2 : (1 - t01) * 2;
}

// getSegmentEndpoints moved to ../lib/legGeometry.ts so the egg
// renderer can use the same leg pose math at smaller scale.

interface ShpiderRendererProps {
  shpidersRef: React.RefObject<ShpiderInstance[]>;
  fragmentsRef: React.RefObject<DeathFragment[]>;
  cameraRef: React.RefObject<THREE.Camera | null>;
  definitions: ShpiderDefinition[];
  /**
   * Fired when a shpider touches the local player (player center
   * within ATTACK_RANGE). Damage and knockback scale with shpider
   * tier. direction is unit-length from shpider toward player.
   */
  onPlayerHit?: (
    damage: number,
    knockback: number,
    direction: THREE.Vector3,
  ) => void;
  /** Local auth user id. Pet shpiders skip touch damage on their
   *  owner and pets owned by this user are also targeted-as-friendly
   *  by other pets. */
  localUserId?: string | null;
}

// Touch-attack tuning. Player center is approximately the camera, so
// "within 1m" means the shpider body is essentially touching the
// player. Cooldown prevents per-frame melee spam.
// Base reach beyond the shpider's body radius. Actual attack
// range = body_size × scale × 0.5 + this base. Earlier this was a
// flat 1.0m which the shpider body itself easily occupies — the
// center never got that close so touch-attacks rarely fired.
const SHPIDER_ATTACK_REACH = 1.2;
const SHPIDER_ATTACK_COOLDOWN_MS = 800;
// Reusable direction scratch for the onPlayerHit callback.
const _hitDirScratch = new THREE.Vector3();

export function ShpiderRenderer({ shpidersRef, fragmentsRef, cameraRef, definitions, onPlayerHit, localUserId }: ShpiderRendererProps) {
  // ── Per-tier texture loading. One material per tier per part-type,
  // so each tier renders with its own admin-uploaded textures. Tier
  // rows missing a texture fall back to the bamboo placeholder.
  const fallback = '/Bamboo_Seamless_t1.webp';
  const defsByTier = useMemo(() => {
    const arr: (ShpiderDefinition | null)[] = new Array(NUM_TIERS + 1).fill(null);
    for (const d of definitions) {
      if (d.tier >= 1 && d.tier <= NUM_TIERS) arr[d.tier] = d;
    }
    return arr;
  }, [definitions]);

  const bodyUrls = useMemo(() => {
    const arr: string[] = [];
    for (let t = 1; t <= NUM_TIERS; t++) arr.push(defsByTier[t]?.body_texture_url || fallback);
    return arr;
  }, [defsByTier]);
  const legUrls = useMemo(() => {
    const arr: string[] = [];
    for (let t = 1; t <= NUM_TIERS; t++) arr.push(defsByTier[t]?.leg_texture_url || fallback);
    return arr;
  }, [defsByTier]);

  const bodyTexs = useLoader(THREE.TextureLoader, bodyUrls);
  const legTexs  = useLoader(THREE.TextureLoader, legUrls);

  useEffect(() => {
    [...bodyTexs, ...legTexs].forEach(t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearMipMapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    });
  }, [bodyTexs, legTexs]);

  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const headGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const legGeo  = useMemo(
    () => new THREE.BoxGeometry(LEG_SEGMENT_THICKNESS, 1, LEG_SEGMENT_THICKNESS),
    []
  );

  // Per-tier materials. Body + head share the same body texture.
  const bodyMats = useMemo(
    () => bodyTexs.map(tex => new THREE.MeshLambertMaterial({ map: tex })),
    [bodyTexs]
  );
  const legMats = useMemo(
    () => legTexs.map(tex => new THREE.MeshLambertMaterial({ map: tex })),
    [legTexs]
  );
  // Eyelashes + mandibles share a dark non-textured chitin colour.
  const chitinMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1a1a1f'),
    roughness: 0.55,
    metalness: 0.15,
  }), []);

  // 1-indexed arrays of per-tier mesh refs + per-tier counters.
  const bodyMeshRefs = useRef<(THREE.InstancedMesh | null)[]>(new Array(NUM_TIERS + 1).fill(null));
  const headMeshRefs = useRef<(THREE.InstancedMesh | null)[]>(new Array(NUM_TIERS + 1).fill(null));
  const legMeshRefs  = useRef<(THREE.InstancedMesh | null)[]>(new Array(NUM_TIERS + 1).fill(null));
  const bodyCounts = useRef<Int32Array>(new Int32Array(NUM_TIERS + 1));
  const headCounts = useRef<Int32Array>(new Int32Array(NUM_TIERS + 1));
  const legCounts  = useRef<Int32Array>(new Int32Array(NUM_TIERS + 1));

  const eyelashMeshRef  = useRef<THREE.InstancedMesh>(null);
  const mandibleMeshRef = useRef<THREE.InstancedMesh>(null);
  const eyeMeshRef      = useRef<THREE.InstancedMesh>(null);

  // Single quad — scaled non-uniformly per instance for the football.
  const eyeGeo = useMemo(() => new THREE.CircleGeometry(0.5, 24), []);
  // VertexColors-style material — each instance picks its own color
  // via setColorAt (outline = black, body = white, pupil = black).
  const eyeMat = useMemo(() => new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    toneMapped: false,
  }), []);
  const _eyeColorBlack = useMemo(() => new THREE.Color(0x000000), []);
  const _eyeColorWhite = useMemo(() => new THREE.Color(0xffffff), []);

  const epScratch = useMemo(() => ({ start: new THREE.Vector3(), end: new THREE.Vector3() }), []);

  useFrame(({ clock }, delta) => {
    const list = shpidersRef.current;
    const camera = cameraRef.current;
    if (!list || !camera) return;
    const eyelashMesh  = eyelashMeshRef.current;
    const mandibleMesh = mandibleMeshRef.current;
    if (!eyelashMesh || !mandibleMesh) return;

    const now = Date.now();
    const t = clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    // AI target: where to chase. Comes from the canonical player
    // snapshot so the source can be swapped to the L2 DO later.
    // Camera-position reads further down stay as-is — those are
    // per-client LOD / culling decisions.
    const _localPlayer = getLocalPlayerSnapshot();
    const playerX = _localPlayer.x;
    const playerY = _localPlayer.y;
    const playerZ = _localPlayer.z;

    // Per-tier counters — reset every frame so we re-pack densely.
    bodyCounts.current.fill(0);
    headCounts.current.fill(0);
    legCounts.current.fill(0);
    let eyelashCount  = 0;
    let mandibleCount = 0;
    let eyeCount = 0;

    for (const s of list) {
      if (!s.isActive) continue;

      // === Target selection — bound at spawn time (wild = chase
      //     player; pet = nearest huntable enemy, fallback owner).
      //     No per-frame branching on instance type.
      const target = s.targetProvider
        ? s.targetProvider(s)
        : { x: playerX, y: playerY, z: playerZ };

      // === AI tick. Mutates position/rotation/surfaceNormal. ===
      stepShpiderHopAI(s, { now, dt, playerX: target.x, playerY: target.y, playerZ: target.z, others: list });

      // Sync the spatial grid to the post-AI position so the NEXT
      // shpider's crowd-check this frame sees up-to-date data.
      shpiderSpatialGrid.move(s.id, s.position.x, s.position.y, s.position.z);

      // === Touch attack. If the shpider's center is within
      //     SHPIDER_ATTACK_RANGE of the player (3D distance) and the
      //     attack cooldown has elapsed, fire the onPlayerHit callback
      //     with tier-scaled damage and knockback. Damage comes from
      //     the definition row (admin-tunable per tier). Knockback
      //     also scales — T1 small bump, T10 strong push — using
      //     definition.damage_per_hit as the scaling factor (no extra
      //     stat needed; can be split out later if tuning demands).
      //     PETS skip touch damage on their owner (the local player).
      const isPet = s.petOwnerUserId != null;
      const skipPlayerTouch = isPet && s.petOwnerUserId === localUserId;
      const bodyRadius = (s.definition.body_size ?? 1) * s.scale * 0.5;

      if (onPlayerHit && !skipPlayerTouch) {
        const attackDX = playerX - s.position.x;
        const attackDY = playerY - s.position.y;
        const attackDZ = playerZ - s.position.z;
        const attackDistSq = attackDX*attackDX + attackDY*attackDY + attackDZ*attackDZ;
        // Scale the touch range with the shpider's body so big spiders
        // hit at a bigger radius than tiny ones. body_size × scale ×
        // 0.5 is the shpider's body radius; SHPIDER_ATTACK_REACH adds
        // a little reach for the legs/mandibles.
        const range = bodyRadius + SHPIDER_ATTACK_REACH;
        if (attackDistSq < range * range && now - s.lastAttackAt >= SHPIDER_ATTACK_COOLDOWN_MS) {
          s.lastAttackAt = now;
          const attackDist = Math.sqrt(attackDistSq) || 1;
          _hitDirScratch.set(attackDX / attackDist, 0, attackDZ / attackDist);
          const damage = s.definition.damage_per_hit;
          // Knockback in m/s. Min 4 m/s so T1 still bumps; cap nothing
          // since high tiers should yeet the player.
          const knockback = Math.max(4, damage);
          onPlayerHit(damage, knockback, _hitDirScratch);
        }
      }

      // === Pet touch attack on hostile enemies ===
      // Pets damage any nearby huntable enemy on contact. Same cooldown
      // and damage formula as the player touch — adapter.applyDamage
      // handles the per-enemy logic (HP loss, knockback, death VFX).
      if (isPet && now - s.lastAttackAt >= SHPIDER_ATTACK_COOLDOWN_MS) {
        const attackRange = bodyRadius + SHPIDER_ATTACK_REACH;
        outerEnemyLoop: for (const adapter of enemyCombatRegistry.getAdapters()) {
          if (adapter.petAttackable === false) continue;
          const enemies = adapter.getActiveEnemies();
          for (const enemy of enemies) {
            // No friendly fire among shpiders (own pets and other pets).
            if (adapter.type === 'shpider') {
              if ((enemy as any).id === s.id) continue;
              if ((enemy as any).petOwnerUserId != null) continue;
            }
            const hb = adapter.getHitbox(enemy);
            if (!hb) continue;
            const eCenterY = (hb.bottomY + hb.topY) * 0.5;
            const edx = hb.centerX - s.position.x;
            const edy = eCenterY - s.position.y;
            const edz = hb.centerZ - s.position.z;
            const edistSq = edx*edx + edy*edy + edz*edz;
            const er = attackRange + hb.radius;
            if (edistSq > er * er) continue;
            // Hit! Apply damage with knockback away from the pet.
            const ed = Math.sqrt(edistSq) || 1;
            adapter.applyDamage(enemy, {
              damage: s.definition.damage_per_hit,
              knockbackDirX: edx / ed,
              knockbackDirY: 0,
              knockbackDirZ: edz / ed,
              bulletSpeed: 60, // makes knockback formula resolve to "normal" magnitude
              hitX: hb.centerX,
              hitY: eCenterY,
              hitZ: hb.centerZ,
              isHeadshot: false,
              source: 'melee',
            });
            s.lastAttackAt = now;
            break outerEnemyLoop;
          }
        }
      }

      const dx = s.position.x - playerX;
      const dz = s.position.z - playerZ;
      if (dx * dx + dz * dz > RENDER_DISTANCE_SQ) continue;

      const def = s.definition;
      const tier = Math.max(1, Math.min(NUM_TIERS, def.tier));
      const bodyMesh = bodyMeshRefs.current[tier];
      const headMesh = headMeshRefs.current[tier];
      const legMesh  = legMeshRefs.current[tier];
      if (!bodyMesh || !headMesh || !legMesh) continue;
      if (bodyCounts.current[tier] >= MAX_PER_TIER) continue;
      const bodySize = def.body_size * s.scale;
      const headSize = def.head_size * s.scale;
      const halfBody = bodySize * 0.5;

      // === Build the shpider's world transform once per shpider. ===
      // surfaceNormal becomes the body's local +Y; `rotation` is yaw
      // around that local +Y. Combined quaternion = align × yaw.
      _surfaceQuat.setFromUnitVectors(_yAxis, s.surfaceNormal);
      _yawQuat.setFromAxisAngle(_yAxis, s.rotation);
      _quat.copy(_surfaceQuat).multiply(_yawQuat);

      // === Body ===
      // Body center sits half-body-distance ABOVE the surface (along
      // local +Y in world space = surfaceNormal direction).
      _localPoint.set(0, halfBody, 0).applyQuaternion(_quat);
      _pos.set(
        s.position.x + _localPoint.x,
        s.position.y + _localPoint.y,
        s.position.z + _localPoint.z,
      );
      _scale.set(bodySize, bodySize, bodySize);
      _mat.compose(_pos, _quat, _scale);
      bodyMesh.setMatrixAt(bodyCounts.current[tier]++, _mat);

      // === Head ===
      const slide = Math.sin(t * Math.PI * 2 * HEAD_SLIDE_HZ + s.headSlidePhase) * (headSize * 0.5);
      const headForwardBase = bodySize * 0.45;
      const headForward = headForwardBase + slide;
      const headLocalY = bodySize + headSize * 0.5;

      _localPoint.set(0, headLocalY, headForward).applyQuaternion(_quat);
      _pos.set(
        s.position.x + _localPoint.x,
        s.position.y + _localPoint.y,
        s.position.z + _localPoint.z,
      );
      _scale.set(headSize, headSize, headSize);
      _mat.compose(_pos, _quat, _scale);
      headMesh.setMatrixAt(headCounts.current[tier]++, _mat);

      // === Eye (cyclops football, tracks the camera = local player) ===
      const eyeMesh = eyeMeshRef.current;
      if (eyeMesh) {
        // Eye anchor in shpider-local space (head front face, slightly
        // below the eyelash row).
        const eyeLocalY = headLocalY + EYE_LOCAL_Y * headSize;
        const eyeLocalZ = headForward + headSize * 0.5 + 0.002;
        _localPoint.set(0, eyeLocalY, eyeLocalZ).applyQuaternion(_quat);
        const eyeCx = s.position.x + _localPoint.x;
        const eyeCy = s.position.y + _localPoint.y;
        const eyeCz = s.position.z + _localPoint.z;

        // Track the camera (local player).
        const dxp = playerX - eyeCx;
        const dyp = playerY - eyeCy;
        const dzp = playerZ - eyeCz;
        const distSq = dxp * dxp + dyp * dyp + dzp * dzp;
        const trackingRangeSq = EYE_TRACK_RANGE * EYE_TRACK_RANGE;
        if (distSq < trackingRangeSq && distSq > 0.01) {
          // Project into head-local frame to get yaw/pitch toward player.
          // headQuat inverse rotates world → local.
          const dist = Math.sqrt(distSq);
          // Yaw angle relative to head's forward axis.
          const headFwdX = Math.sin(s.rotation);
          const headFwdZ = Math.cos(s.rotation);
          const headRightX =  Math.cos(s.rotation);
          const headRightZ = -Math.sin(s.rotation);
          const localFwd  = (dxp * headFwdX  + dzp * headFwdZ)  / dist;
          const localRight = (dxp * headRightX + dzp * headRightZ) / dist;
          const localUp = dyp / dist;
          const yaw   = Math.atan2(localRight, Math.max(0.01, localFwd));
          const pitch = Math.atan2(localUp, Math.max(0.01, localFwd));
          const limit = Math.PI / 2.2;
          s.eyeTargetX = Math.max(-1, Math.min(1, yaw / limit));
          s.eyeTargetY = Math.max(-1, Math.min(1, pitch / limit));
        } else {
          if (now - s.eyeLastRandomLookAt > EYE_RANDOM_LOOK_INTERVAL_MS) {
            s.eyeTargetX = (Math.random() * 2 - 1) * 0.6;
            s.eyeTargetY = (Math.random() * 2 - 1) * 0.3;
            s.eyeLastRandomLookAt = now;
          }
        }
        const lf = Math.min(1, EYE_PUPIL_LERP * dt);
        s.eyePupilX += (s.eyeTargetX - s.eyePupilX) * lf;
        s.eyePupilY += (s.eyeTargetY - s.eyePupilY) * lf;

        const eyeW = EYE_WIDTH  * headSize;
        const eyeH = EYE_HEIGHT * headSize;
        const outW = EYE_OUTLINE * headSize;
        const pupilR = EYE_PUPIL_RADIUS * headSize;
        const rangeX = (eyeW - pupilR * 2) * 0.5;
        const rangeY = (eyeH - pupilR * 2) * 0.5;

        // All three sub-instances share the body's _quat orientation.
        // Outline (slightly behind, slightly larger).
        _localPoint.set(0, eyeLocalY, eyeLocalZ - 0.001).applyQuaternion(_quat);
        _pos.set(s.position.x + _localPoint.x, s.position.y + _localPoint.y, s.position.z + _localPoint.z);
        _scale.set(eyeW + outW * 2, eyeH + outW * 2, 1);
        _mat.compose(_pos, _quat, _scale);
        eyeMesh.setMatrixAt(eyeCount, _mat);
        eyeMesh.setColorAt(eyeCount, _eyeColorBlack);
        eyeCount++;

        // White body.
        _localPoint.set(0, eyeLocalY, eyeLocalZ).applyQuaternion(_quat);
        _pos.set(s.position.x + _localPoint.x, s.position.y + _localPoint.y, s.position.z + _localPoint.z);
        _scale.set(eyeW, eyeH, 1);
        _mat.compose(_pos, _quat, _scale);
        eyeMesh.setMatrixAt(eyeCount, _mat);
        eyeMesh.setColorAt(eyeCount, _eyeColorWhite);
        eyeCount++;

        // Pupil (small black circle, slightly in front, offset by track).
        const pupilLX = s.eyePupilX * rangeX;
        const pupilLY = s.eyePupilY * rangeY;
        _localPoint.set(pupilLX, eyeLocalY + pupilLY, eyeLocalZ + 0.001).applyQuaternion(_quat);
        _pos.set(s.position.x + _localPoint.x, s.position.y + _localPoint.y, s.position.z + _localPoint.z);
        _scale.set(pupilR * 2, pupilR * 2, 1);
        _mat.compose(_pos, _quat, _scale);
        eyeMesh.setMatrixAt(eyeCount, _mat);
        eyeMesh.setColorAt(eyeCount, _eyeColorBlack);
        eyeCount++;
      }
      // === Eyelashes ===
      // Anchor a hair forward of the head's front face.
      const eyelashOffset = headSize * 0.5 + 0.005;
      // Eyelashes moved up by 20% of head height so the eyebrow line
      // sits high on the forehead (was at head center).
      const eyelashLocalY = headLocalY + 0.20 * headSize;
      _localPoint.set(0, eyelashLocalY, headForward + eyelashOffset).applyQuaternion(_quat);
      _pos.set(
        s.position.x + _localPoint.x,
        s.position.y + _localPoint.y,
        s.position.z + _localPoint.z,
      );
      _scale.set(headSize, headSize, headSize);
      _mat.compose(_pos, _quat, _scale);
      eyelashMesh.setMatrixAt(eyelashCount++, _mat);

      // === Mandibles ===
      if (s.mandibleClickStartedAt === 0 && now >= s.nextMandibleClickAt) {
        s.mandibleClickStartedAt = now;
      }
      let clickPhase = 0;
      if (s.mandibleClickStartedAt > 0) {
        const elapsed = now - s.mandibleClickStartedAt;
        if (elapsed >= MANDIBLE_CLICK_DURATION_MS) {
          s.mandibleClickStartedAt = 0;
          s.nextMandibleClickAt = now + MANDIBLE_MIN_CLICK_INTERVAL_MS
            + Math.random() * (MANDIBLE_MAX_CLICK_INTERVAL_MS - MANDIBLE_MIN_CLICK_INTERVAL_MS);
        } else {
          clickPhase = clickTriangle(elapsed / MANDIBLE_CLICK_DURATION_MS);
        }
      }
      const splay = MANDIBLE_OPEN_ANGLE * (1 - clickPhase);

      // Mandibles attach to the front-center of the face and point
      // outward (+Z forward in local frame). They fan left/right by
      // rotating around the local +Y (up) axis; click animation
      // collapses that splay to 0 so the two cones meet.
      const mandibleLocalY = headLocalY - headSize * 0.25;
      const mandibleLocalZ = headForward + headSize * 0.5;
      _localPoint.set(0, mandibleLocalY, mandibleLocalZ).applyQuaternion(_quat);
      _pos.set(
        s.position.x + _localPoint.x,
        s.position.y + _localPoint.y,
        s.position.z + _localPoint.z,
      );

      for (let side = 0; side < 2; side++) {
        if (mandibleCount >= MAX_MANDIBLE_INSTANCES) break;
        const sideSign = side === 0 ? -1 : 1;

        // Splay around local +Y axis so mandibles fan to either side.
        _worldRot.copy(_quat);
        _mandibleYawQ.setFromAxisAngle(_yAxis, sideSign * splay);
        _worldRot.multiply(_mandibleYawQ);

        // Mirror the right mandible's geometry (which is authored
        // bending toward +X) by flipping its X scale.
        _scale.set(sideSign === -1 ? headSize : -headSize, headSize, headSize);
        _mat.compose(_pos, _worldRot, _scale);
        mandibleMesh.setMatrixAt(mandibleCount++, _mat);
      }

      // === Legs ===
      const hopT = getHopProgress(s, now);
      const crawlT = getCrawlProgress(s, now);
      for (let leg = 0; leg < LEGS_PER_SHPIDER; leg++) {
        for (let seg = 0; seg < SEGMENTS_PER_LEG; seg++) {
          if (legCounts.current[tier] >= MAX_LEG_PER_TIER) break;

          getSegmentEndpoints(
            leg, seg, bodySize,
            hopT, crawlT,
            s.legPhaseOffsets[leg],
            s.legFrequencies[leg],
            s.legLiftAmplitudes[leg],
            t, epScratch,
          );

          _segStart.copy(epScratch.start).applyQuaternion(_quat);
          _segStart.x += s.position.x;
          _segStart.y += s.position.y + halfBody;
          _segStart.z += s.position.z;

          _segEnd.copy(epScratch.end).applyQuaternion(_quat);
          _segEnd.x += s.position.x;
          _segEnd.y += s.position.y + halfBody;
          _segEnd.z += s.position.z;

          _segMid.addVectors(_segStart, _segEnd).multiplyScalar(0.5);
          _legDir.subVectors(_segEnd, _segStart);
          const segLength = _legDir.length();
          if (segLength < 0.0001) continue;
          _legDir.normalize();

          _worldRot.setFromUnitVectors(_yAxis, _legDir);
          _scale.set(1, segLength, 1);
          _mat.compose(_segMid, _worldRot, _scale);
          legMesh.setMatrixAt(legCounts.current[tier]++, _mat);
        }
      }
    }

    // === Death-explosion fragments ===
    // Physics step, then write each surviving fragment's matrix onto
    // the per-tier mesh that matches its source shpider.
    const fragments = fragmentsRef.current;
    if (fragments && fragments.length > 0) {
      const updated = stepDeathFragments(fragments, dt, now);
      // Re-bind in place so the ref array is always the live list.
      fragments.length = 0;
      for (const f of updated) fragments.push(f);

      // One-time debug log when fragments first appear / change count.
      if ((window as any).__shpiderLastFragCount !== updated.length) {
        (window as any).__shpiderLastFragCount = updated.length;
        console.log(`[Shpider] fragments active: ${updated.length}`);
      }

      let drawnFrags = 0;
      let skippedFrags = 0;
      for (const f of updated) {
        const tier = Math.max(1, Math.min(NUM_TIERS, f.shpiderTier));
        let mesh: THREE.InstancedMesh | null = null;
        let count = 0;
        let cap = MAX_PER_TIER;
        if (f.type === 'body') {
          mesh = bodyMeshRefs.current[tier];
          count = bodyCounts.current[tier];
        } else if (f.type === 'head') {
          mesh = headMeshRefs.current[tier];
          count = headCounts.current[tier];
        } else {
          mesh = legMeshRefs.current[tier];
          count = legCounts.current[tier];
          cap = MAX_LEG_PER_TIER;
        }
        if (!mesh || count >= cap) { skippedFrags++; continue; }

        _mat.compose(f.position, f.rotation, f.scale);
        mesh.setMatrixAt(count, _mat);
        if (f.type === 'body')      bodyCounts.current[tier]++;
        else if (f.type === 'head') headCounts.current[tier]++;
        else                        legCounts.current[tier]++;
        drawnFrags++;
      }

      // Log once when drawing state changes appreciably.
      if (drawnFrags > 0 && (window as any).__shpiderLastDrawn !== drawnFrags) {
        (window as any).__shpiderLastDrawn = drawnFrags;
        console.log(`[Shpider] frags drawn: ${drawnFrags}, skipped: ${skippedFrags}`);
      }
    }

    // Per-tier flush.
    for (let tier = 1; tier <= NUM_TIERS; tier++) {
      const bm = bodyMeshRefs.current[tier];
      const hm = headMeshRefs.current[tier];
      const lm = legMeshRefs.current[tier];
      const bc = bodyCounts.current[tier];
      const hc = headCounts.current[tier];
      const lc = legCounts.current[tier];
      if (bm) {
        bm.count = bc;
        bm.instanceMatrix.needsUpdate = true;
        bm.visible = bc > 0;
      }
      if (hm) {
        hm.count = hc;
        hm.instanceMatrix.needsUpdate = true;
        hm.visible = hc > 0;
      }
      if (lm) {
        lm.count = lc;
        lm.instanceMatrix.needsUpdate = true;
        lm.visible = lc > 0;
      }
    }

    eyelashMesh.count = eyelashCount;
    mandibleMesh.count = mandibleCount;
    eyelashMesh.instanceMatrix.needsUpdate = true;
    mandibleMesh.instanceMatrix.needsUpdate = true;
    eyelashMesh.visible = eyelashCount > 0;
    mandibleMesh.visible = mandibleCount > 0;

    const eyeMesh = eyeMeshRef.current;
    if (eyeMesh) {
      eyeMesh.count = eyeCount;
      eyeMesh.instanceMatrix.needsUpdate = true;
      if (eyeMesh.instanceColor) eyeMesh.instanceColor.needsUpdate = true;
      eyeMesh.visible = eyeCount > 0;
    }
  });

  return (
    <>
      {Array.from({ length: NUM_TIERS }).map((_, idx) => {
        const tier = idx + 1;
        return (
          <React.Fragment key={tier}>
            <instancedMesh
              ref={(el) => { bodyMeshRefs.current[tier] = el; }}
              args={[bodyGeo, bodyMats[idx], MAX_PER_TIER]}
              frustumCulled={false}
            />
            <instancedMesh
              ref={(el) => { headMeshRefs.current[tier] = el; }}
              args={[headGeo, bodyMats[idx], MAX_PER_TIER]}
              frustumCulled={false}
            />
            <instancedMesh
              ref={(el) => { legMeshRefs.current[tier] = el; }}
              args={[legGeo, legMats[idx], MAX_LEG_PER_TIER]}
              frustumCulled={false}
            />
          </React.Fragment>
        );
      })}
      <instancedMesh
        ref={eyelashMeshRef}
        args={[EYELASH_GEOMETRY, chitinMat, TOTAL_SHARED_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={mandibleMeshRef}
        args={[MANDIBLE_GEOMETRY, chitinMat, MAX_MANDIBLE_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={eyeMeshRef}
        args={[eyeGeo, eyeMat, MAX_EYE_INSTANCES]}
        frustumCulled={false}
      />
    </>
  );
}
