import * as THREE from 'three';

/**
 * Vortax definition from database - admin-configurable enemy.
 * Cloned from ShroomerDefinition (identical shape). Reads `vortax_definitions`.
 * Vortax is TIER 1 ONLY.
 */
export interface VortaxDefinition {
  id: string;
  tier: number;
  name: string;
  texture_url: string | null;
  texture_url_ktx2?: string | null;
  texture_tier?: 'standard' | 'premium';
  speed: number; // blocks per second
  health: number;
  damage_per_hit: number;
  knockback_received: number;
  spawn_chance_per_minute: number;
  created_at: string;
  updated_at: string;
  ai_config?: {
    behaviors?: string[];
    detectionRange?: number;
    attackRange?: number;
    attackCooldownMs?: number;
    custom?: Record<string, unknown>;
  } | null;
}

/**
 * Body part definition (same layout as the shroomer).
 */
export interface VortaxPart {
  name: string;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  parent?: string;
}

/**
 * Twitchiness state for a single body part
 */
export interface PartTwitch {
  frequency: number;
  amplitude: number;
  phaseOffset: number;
  twitchType: 'vertical' | 'horizontal' | 'rotate' | 'scale' | 'shake';
}

export type HeadMovementType = 'slide' | 'bob' | 'circle';

/**
 * Fire effect attached to a body part
 */
export interface VortaxBodyFire {
  partName: string;
  startTime: number;
  duration: number; // ms
  colors: string[];
}

/**
 * One orbiting sphere in a Vortax body-part's particle cloud.
 *
 * THE NOVEL PART: every solid shroomer body part is replaced by a CLOUD of
 * these spheres swirling around where the solid part center would be. Each
 * sphere's orbit params are generated ONCE on spawn (deterministic) and stored
 * here — the renderer recomputes only the per-frame angle from `speed * t`.
 */
export interface VortaxSphere {
  /** Which logical body part this sphere belongs to (head / torso / arm / leg / cap). */
  partName: string;
  /** Sphere diameter in part-local units (10–30% of the part's max width). */
  diameter: number;
  /** Local offset of the orbit CENTER from the part center (lets the cloud fill the volume). */
  centerX: number;
  centerY: number;
  centerZ: number;
  /** Orbit radius in part-local units. */
  orbitRadius: number;
  /** Unit orbit axis (random). */
  axisX: number;
  axisY: number;
  axisZ: number;
  /** Angular speed (rad/s, random sign + magnitude). */
  angularSpeed: number;
  /** Initial phase (rad). */
  phase: number;
  /** A fixed point on the orbit circle (unit vector perpendicular to axis) — the
   *  position at angle 0; the renderer rotates this around `axis` by the angle. */
  baseX: number;
  baseY: number;
  baseZ: number;
  /** Self-spin: the sphere rotates about its own (random) axis as it orbits. */
  spinAxisX: number;
  spinAxisY: number;
  spinAxisZ: number;
  spinSpeed: number; // rad/s, random sign + magnitude
  spinPhase: number;
  /** Destroyed by a bullet/flame hit → never rendered again, never respawns. */
  destroyed: boolean;
}

/**
 * Runtime state for an active vortax instance
 */
export interface VortaxInstance {
  id: string;
  definition: VortaxDefinition;
  position: THREE.Vector3;
  rotation: number; // Y rotation in radians
  currentHealth: number;
  maxHealth: number;
  isActive: boolean;
  spawnedAt: number;
  velocity: THREE.Vector3;
  animationPhase: number;
  lastAttackAt: number;
  lastDamagedAt: number;
  spawnChunkX: number;
  spawnChunkZ: number;
  /** Base scale factor (~10 for a 20m-tall vortax) with ±20% variation. */
  scale: number;
  emergenceProgress: number;
  partTwitches: Record<string, PartTwitch>;
  targetPosition?: THREE.Vector3;
  isChasing: boolean;
  headMovementType: HeadMovementType;
  isKnockedDown: boolean;
  knockdownDirection?: THREE.Vector3;
  knockdownProgress: number;
  knockdownStartTime: number;
  knockdownSlideDistance?: number;
  stunUntil?: number;
  bodyFires: VortaxBodyFire[];
  /** The sphere-cloud descriptors (generated once on spawn). */
  spheres: VortaxSphere[];
  /** Count of spheres not yet destroyed (cached so we don't scan every hit). */
  liveSphereCount: number;
}

/**
 * Vortax body structure — SAME layout as the shroomer.
 */
export const VORTAX_BODY_PARTS: VortaxPart[] = [
  { name: 'head', offsetX: 0, offsetY: 1.7, offsetZ: 0, scaleX: 0.5, scaleY: 0.5, scaleZ: 0.5 },
  { name: 'torso', offsetX: 0, offsetY: 1.0, offsetZ: 0, scaleX: 0.6, scaleY: 0.7, scaleZ: 0.4 },

  { name: 'leftUpperArm', offsetX: -0.45, offsetY: 1.25, offsetZ: 0, scaleX: 0.18, scaleY: 0.35, scaleZ: 0.18, parent: 'torso' },
  { name: 'leftLowerArm', offsetX: -0.45, offsetY: 0.9, offsetZ: 0, scaleX: 0.15, scaleY: 0.35, scaleZ: 0.15, parent: 'leftUpperArm' },

  { name: 'rightUpperArm', offsetX: 0.45, offsetY: 1.25, offsetZ: 0, scaleX: 0.18, scaleY: 0.35, scaleZ: 0.18, parent: 'torso' },
  { name: 'rightLowerArm', offsetX: 0.45, offsetY: 0.9, offsetZ: 0, scaleX: 0.15, scaleY: 0.35, scaleZ: 0.15, parent: 'rightUpperArm' },

  { name: 'leftUpperLeg', offsetX: -0.15, offsetY: 0.5, offsetZ: 0, scaleX: 0.22, scaleY: 0.4, scaleZ: 0.22, parent: 'torso' },
  { name: 'leftLowerLeg', offsetX: -0.15, offsetY: 0.15, offsetZ: 0, scaleX: 0.2, scaleY: 0.35, scaleZ: 0.2, parent: 'leftUpperLeg' },

  { name: 'rightUpperLeg', offsetX: 0.15, offsetY: 0.5, offsetZ: 0, scaleX: 0.22, scaleY: 0.4, scaleZ: 0.22, parent: 'torso' },
  { name: 'rightLowerLeg', offsetX: 0.15, offsetY: 0.15, offsetZ: 0, scaleX: 0.2, scaleY: 0.35, scaleZ: 0.2, parent: 'rightUpperLeg' },
];

export const PARTS_PER_VORTAX = VORTAX_BODY_PARTS.length;

/**
 * Generate random twitchiness for a new vortax
 */
export function generatePartTwitches(): Record<string, PartTwitch> {
  const twitchTypes: PartTwitch['twitchType'][] = ['vertical', 'horizontal', 'rotate', 'scale', 'shake'];
  const twitches: Record<string, PartTwitch> = {};

  for (const part of VORTAX_BODY_PARTS) {
    twitches[part.name] = {
      frequency: 0.5 + Math.random() * 3,
      amplitude: 0.02 + Math.random() * 0.08,
      phaseOffset: Math.random() * Math.PI * 2,
      twitchType: twitchTypes[Math.floor(Math.random() * twitchTypes.length)],
    };
  }

  return twitches;
}

// ── Sphere-cloud generation ────────────────────────────────────────────────
// Each "logical" part (the cap + each whole arm/leg, summed over upper+lower)
// gets a fixed sphere budget. Spheres orbit the part center, filling its volume.
//
// Per-part counts (doubled): head=10, cap=40, each arm=20, each leg=20, torso=40.
export const SPHERE_COUNTS: Record<string, number> = {
  head: 10,
  torso: 40,
  cap: 40,
  // Each whole arm/leg = 20 spheres, split across its upper + lower sub-parts (10 each).
  leftUpperArm: 10, leftLowerArm: 10,
  rightUpperArm: 10, rightLowerArm: 10,
  leftUpperLeg: 10, leftLowerLeg: 10,
  rightUpperLeg: 10, rightLowerLeg: 10,
};

/** The mushroom cap is a virtual part — no entry in VORTAX_BODY_PARTS, so we
 *  describe its bounds here (sits above the head; diameter == body height). */
function computeBodyHeight(): number {
  let minY = Infinity, maxY = -Infinity;
  for (const p of VORTAX_BODY_PARTS) {
    const top = p.offsetY + p.scaleY / 2;
    const bottom = p.offsetY - p.scaleY / 2;
    if (top > maxY) maxY = top;
    if (bottom < minY) minY = bottom;
  }
  return maxY - minY;
}
export const VORTAX_BODY_HEIGHT = computeBodyHeight();

function randUnitAxis(): { x: number; y: number; z: number } {
  // Uniform-ish random direction.
  let x = Math.random() * 2 - 1;
  let y = Math.random() * 2 - 1;
  let z = Math.random() * 2 - 1;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/** A unit vector perpendicular to `axis` — the orbit's angle-0 point. */
function perpUnit(ax: number, ay: number, az: number): { x: number; y: number; z: number } {
  // Cross axis with an arbitrary non-parallel vector.
  let rx = 0, ry = 1, rz = 0;
  if (Math.abs(ay) > 0.9) { rx = 1; ry = 0; rz = 0; }
  // p = axis × r
  let px = ay * rz - az * ry;
  let py = az * rx - ax * rz;
  let pz = ax * ry - ay * rx;
  const len = Math.hypot(px, py, pz) || 1;
  return { x: px / len, y: py / len, z: pz / len };
}

/**
 * Build the full sphere-cloud descriptor list for a fresh vortax.
 * Deterministic-per-instance (generated once); diameters/orbits are in
 * part-LOCAL units (the renderer multiplies by the instance scale).
 */
export function generateVortaxSpheres(): VortaxSphere[] {
  const spheres: VortaxSphere[] = [];
  const capRadius = VORTAX_BODY_HEIGHT / 2;

  const pushCloud = (
    partName: string,
    count: number,
    cx: number, cy: number, cz: number,
    extentX: number, extentY: number, extentZ: number,
    maxWidth: number,
    diamFrac?: number, // fixed diameter fraction of maxWidth; else random 10–30%
  ) => {
    for (let i = 0; i < count; i++) {
      const axis = randUnitAxis();
      const base = perpUnit(axis.x, axis.y, axis.z);
      const spin = randUnitAxis();
      // Orbit center jittered within the part's extent so the cloud fills volume.
      const ox = cx + (Math.random() * 2 - 1) * extentX * 0.5;
      const oy = cy + (Math.random() * 2 - 1) * extentY * 0.5;
      const oz = cz + (Math.random() * 2 - 1) * extentZ * 0.5;
      const orbitRadius = Math.random() * Math.max(extentX, extentY, extentZ) * 0.5;
      // Fixed fraction (cap = 1/9) or random 10–30% of the part's max width.
      const diameter = diamFrac != null
        ? maxWidth * diamFrac
        : maxWidth * (0.1 + Math.random() * 0.2);
      spheres.push({
        partName,
        diameter,
        centerX: ox, centerY: oy, centerZ: oz,
        orbitRadius,
        axisX: axis.x, axisY: axis.y, axisZ: axis.z,
        angularSpeed: (Math.random() * 2 - 1) * 12.5, // ±12.5 rad/s (5× faster)
        phase: Math.random() * Math.PI * 2,
        baseX: base.x, baseY: base.y, baseZ: base.z,
        spinAxisX: spin.x, spinAxisY: spin.y, spinAxisZ: spin.z,
        spinSpeed: (Math.random() * 2 - 1) * 4, // ±4 rad/s self-spin
        spinPhase: Math.random() * Math.PI * 2,
        destroyed: false,
      });
    }
  };

  for (const part of VORTAX_BODY_PARTS) {
    const count = SPHERE_COUNTS[part.name] ?? 0;
    if (count <= 0) continue;
    const maxWidth = Math.max(part.scaleX, part.scaleY, part.scaleZ);
    pushCloud(
      part.name,
      count,
      part.offsetX, part.offsetY, part.offsetZ,
      part.scaleX, part.scaleY, part.scaleZ,
      maxWidth,
    );
  }

  // Cap cloud — virtual part above the head; diameter == body height (flat-ish).
  const head = VORTAX_BODY_PARTS[0];
  pushCloud(
    'cap',
    SPHERE_COUNTS.cap,
    head.offsetX, head.offsetY + head.scaleY * 0.6, head.offsetZ,
    capRadius * 2, capRadius * 0.6, capRadius * 2,
    capRadius * 2,
    1 / 9, // each cap sphere = 1/9 the cap diameter
  );

  return spheres;
}
