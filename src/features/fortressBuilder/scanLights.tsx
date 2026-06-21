// Scanning searchlights for the Fortress Builder preview.
//
// Places narrow, upward-pointing beams on the TOPS of OUTER-extruded blocks (the voxels
// the generator tags light===1). 4-8 per wall face, at random spots the user can't pick;
// if the design has left-right face symmetry the spots are placed in mirrored pairs. The
// beams sweep slowly back and forth to wash the side of the castle in the chosen colour
// (red/orange by default).
//
// Perf: every spot draws a cheap additive cone shaft (no lighting cost), but only a FIXED
// pool of real spotlights is ever rendered (constant count → no per-material shader
// recompiles / black-flash), with shadows OFF.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import type { FortressVoxel } from './imageToFortress';

export interface ScanAnchor {
  x: number; y: number; z: number;   // beam base (block-top centre, local to the preview group)
  inx: number; inz: number;          // inward unit (toward the wall) — base tilt so the beam grazes the wall
  sign: number;                      // sweep direction (+1/-1); mirrored pairs oppose for a symmetric scan
  phase: number;                     // per-beam phase so they don't sweep in unison
}

const SPOT_POOL = 8;     // real (illuminating) spotlights — constant count
const TILT = 0.5;        // base lean toward the wall (rad)
const SWEEP = 0.5;       // sweep amplitude (rad)
const SPEED = 0.5;       // sweep speed (rad/s) — slow
const SHAFT_LEN = 16;    // beam shaft length (blocks)
const SPOT_RANGE = 26;   // spotlight reach (blocks)

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Top cells of outer-extruded blocks (light===1 with no light===1 directly above), grouped
// by wall, then 4-8 picked per wall (mirrored pairs when symmetric).
export function computeScanAnchors(voxels: FortressVoxel[], F: number, seed: number, symmetric: boolean): ScanAnchor[] {
  const KEY = (x: number, y: number, z: number) => ((x + 1024) * 4096 + (y + 1024)) * 4096 + (z + 1024);
  const lit = new Set<number>();
  for (const v of voxels) if (v.light === 1) lit.add(KEY(v.x, v.y, v.z));
  if (lit.size === 0) return [];

  const half = Math.floor(F / 2);
  const frontZ = -half, backZ = (F - 1) - half, leftX = -half, rightX = (F - 1) - half;

  interface Cand { x: number; y: number; z: number; along: number; }
  const walls: Cand[][] = [[], [], [], []]; // 0 front 1 right 2 back 3 left
  for (const v of voxels) {
    if (v.light !== 1) continue;
    if (lit.has(KEY(v.x, v.y + 1, v.z))) continue; // not a top
    // Assign to the face it protrudes furthest beyond.
    const dF = frontZ - v.z, dB = v.z - backZ, dL = leftX - v.x, dR = v.x - rightX;
    const m = Math.max(dF, dB, dL, dR);
    if (m < 0) continue;
    if (m === dF) walls[0].push({ x: v.x, y: v.y, z: v.z, along: v.x });
    else if (m === dB) walls[2].push({ x: v.x, y: v.y, z: v.z, along: v.x });
    else if (m === dL) walls[3].push({ x: v.x, y: v.y, z: v.z, along: v.z });
    else walls[1].push({ x: v.x, y: v.y, z: v.z, along: v.z });
  }

  const rng = mulberry32(((seed || 1) * 2654435761) >>> 0 || 1);
  const shuffle = (arr: Cand[]) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } };
  const out: ScanAnchor[] = [];

  for (let w = 0; w < 4; w++) {
    const cands = walls[w];
    if (cands.length === 0) continue;
    const inx = w === 3 ? 1 : w === 1 ? -1 : 0;
    const inz = w === 0 ? 1 : w === 2 ? -1 : 0;
    const horiz = w === 0 || w === 2;                 // along axis is X (front/back) else Z
    const center = horiz ? (leftX + rightX) / 2 : (frontZ + backZ) / 2;
    const target = 4 + Math.floor(rng() * 5);         // 4..8 per face
    const add = (c: Cand, sign: number) => out.push({ x: c.x + 0.5, y: c.y + 1.0, z: c.z + 0.5, inx, inz, sign, phase: rng() * Math.PI * 2 });

    if (symmetric) {
      // Pick from one half, add each spot's mirror partner → mirrored pairs sweeping oppositely.
      const map = new Map<string, Cand>();
      for (const c of cands) map.set(`${c.along}_${c.y}`, c);
      const oneSide = cands.filter((c) => c.along <= center + 0.001);
      shuffle(oneSide);
      const used = new Set<string>();
      for (const c of oneSide) {
        if (countWall(out, w) >= target) break;
        const k = `${c.along}_${c.y}`;
        if (used.has(k)) continue;
        used.add(k);
        add(c, 1);
        const mAlong = Math.round(2 * center - c.along);
        const mk = `${mAlong}_${c.y}`;
        const mc = map.get(mk);
        if (mc && mc !== c && !used.has(mk) && countWall(out, w) < target) { used.add(mk); add(mc, -1); }
      }
    } else {
      shuffle(cands);
      for (let i = 0; i < cands.length && i < target; i++) add(cands[i], rng() < 0.5 ? -1 : 1);
    }
  }
  return out;
}

// Count anchors already emitted for a given wall (by matching inward dir) — small helper so
// the symmetric loop can respect the per-face target.
function countWall(out: ScanAnchor[], w: number): number {
  const inx = w === 3 ? 1 : w === 1 ? -1 : 0;
  const inz = w === 0 ? 1 : w === 2 ? -1 : 0;
  let n = 0;
  for (const a of out) if (a.inx === inx && a.inz === inz) n++;
  return n;
}

export function ScanLights({ anchors, color }: { anchors: ScanAnchor[]; color: string }) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const spotRefs = useRef<(THREE.SpotLight | null)[]>([]);
  const targetRefs = useRef<(THREE.Object3D | null)[]>([]);

  const geo = useMemo(() => new THREE.ConeGeometry(0.9, SHAFT_LEN, 14, 1, true), []);
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { beamMat.color = new THREE.Color(color); }, [color, beamMat]);
  useEffect(() => () => { geo.dispose(); beamMat.dispose(); }, [geo, beamMat]);

  useEffect(() => {
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const tanTilt = Math.tan(TILT);
    const unreg = frameLoop.register('fb-scan-lights', (_d, t) => {
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const sweep = SWEEP * Math.sin(t * SPEED + a.phase) * a.sign;
        dir.set(a.inx * tanTilt, 1, a.inz * tanTilt).normalize();
        const cs = Math.cos(sweep), sn = Math.sin(sweep);          // sweep = yaw about up
        dir.set(dir.x * cs - dir.z * sn, dir.y, dir.x * sn + dir.z * cs).normalize();
        const g = groupRefs.current[i];
        if (g) { q.setFromUnitVectors(up, dir); g.quaternion.copy(q); }
        if (i < SPOT_POOL) {
          const sp = spotRefs.current[i], tg = targetRefs.current[i];
          if (sp && tg) {
            if (sp.target !== tg) sp.target = tg;
            tg.position.set(a.x + dir.x * SPOT_RANGE, a.y + dir.y * SPOT_RANGE, a.z + dir.z * SPOT_RANGE);
            tg.updateMatrixWorld();
          }
        }
      }
    }, 36);
    return unreg;
  }, [anchors]);

  return (
    <>
      {anchors.map((a, i) => (
        <group key={i} position={[a.x, a.y, a.z]} ref={(el) => { groupRefs.current[i] = el; }}>
          {/* Narrow additive shaft: apex at the block top, widening upward along the beam. */}
          <mesh position={[0, SHAFT_LEN / 2, 0]} rotation={[Math.PI, 0, 0]} geometry={geo} material={beamMat} />
        </group>
      ))}
      {/* Fixed pool of real spotlights (constant count) that actually light the wall. */}
      {Array.from({ length: SPOT_POOL }).map((_, i) => {
        const a = anchors[i];
        return (
          <group key={`s${i}`}>
            <spotLight
              ref={(el) => { spotRefs.current[i] = el; }}
              position={a ? [a.x, a.y, a.z] : [0, -10000, 0]}
              color={color}
              intensity={a ? 6 : 0}
              angle={0.22}
              penumbra={0.7}
              distance={SPOT_RANGE + 4}
              decay={1}
              castShadow={false}
            />
            <object3D ref={(el) => { targetRefs.current[i] = el; }} />
          </group>
        );
      })}
    </>
  );
}
