// EnemyCombatRegistry — the universal handshake between weapons and
// monsters. Every enemy type registers ONE adapter at startup that
// exposes:
//   • how to enumerate its active instances
//   • how to read each instance's cylinder hitbox in world space
//   • how to apply incoming damage (with knockback / source info)
//   • optional metadata (hit sound URL, headshot-zone fraction)
//
// Every weapon (bullets, flamethrower, future explosions) consumes
// the registry instead of switching on entity type. Adding a new
// monster = write one adapter, register it, done. Existing weapons
// automatically work against it.
//
// Goals:
//   1. Zero-allocation per frame (one reusable RaycastHit buffer).
//   2. No assumptions about how an enemy stores its state — each
//      adapter is generic on the underlying instance type.
//   3. Decoupled lifetime: the registry doesn't hold strong refs to
//      enemies; getActiveEnemies() is called fresh each query.

export interface EnemyHitbox {
  /** Cylinder XZ center (world). */
  centerX: number;
  centerZ: number;
  /** Cylinder vertical extent. Most enemies use position.y as the
   *  bottom, position.y + height as the top. */
  bottomY: number;
  topY: number;
  /** Horizontal radius. */
  radius: number;
}

export type DamageSource = 'bullet' | 'flame' | 'explosion' | 'melee';

export interface DamageInfo {
  damage: number;
  /** Direction the impulse should push the enemy (unit, horizontal). */
  knockbackDirX: number;
  knockbackDirY: number;
  knockbackDirZ: number;
  /** Bullet projectile speed in m/s (0 for non-bullet sources). */
  bulletSpeed: number;
  /** World-space point of impact (for fire spawning / blood / etc). */
  hitX: number;
  hitY: number;
  hitZ: number;
  /** True if the bullet landed in the enemy's upper-most ~25% (headshot). */
  isHeadshot: boolean;
  source: DamageSource;
}

/**
 * One flame anchor on an enemy's body. The burn system spawns a
 * particle plume at (entity.position + offset) and uses size/height
 * to scale the particle radius/length. Allows multi-body monsters
 * (shpider, shtickman, etc.) to have multiple flame points so the
 * fire visually engulfs them instead of being a single point.
 */
export interface FlameAttachPoint {
  /** World-space delta from the entity's reported position. */
  xOffset?: number;
  yOffset: number;
  zOffset?: number;
  size: number;
  height: number;
  particles: number;
}

export interface EnemyCombatAdapter<TEnemy = unknown> {
  /** Unique stable id, e.g. 'shombie' / 'shpider' / 'walapa'. */
  type: string;

  /** Latest snapshot of active enemies. Called once per hit query. */
  getActiveEnemies: () => readonly TEnemy[];

  /** Unique id of an enemy instance. */
  getId: (enemy: TEnemy) => string;

  /** Cylinder hitbox in world coordinates, or null if not currently
   *  targetable (mid-spawn, mid-death, etc.). */
  getHitbox: (enemy: TEnemy) => EnemyHitbox | null;

  /** Apply damage. Returns true if the enemy died as a result. */
  applyDamage: (enemy: TEnemy, info: DamageInfo) => boolean;

  /** Optional: which audio URL plays for impact feedback. Falls back
   *  to a generic flesh thud if omitted. */
  getHitSoundUrl?: (enemy: TEnemy) => string | null;

  /**
   * Optional: where flames anchor on this enemy when it's on fire.
   * Enemies made of multiple parts (a body+head spider, a stack of
   * blocks, etc.) return one entry per visible chunk so the flame
   * VFX wraps the whole shape rather than appearing at a single
   * point. Returns null/empty → the burn system falls back to a
   * single flame at the hitbox center.
   */
  getFlameAttachPoints?: (enemy: TEnemy) => FlameAttachPoint[] | null;
}

// ------------------------------------------------------------------
//  Registry singleton
// ------------------------------------------------------------------
class CombatRegistry {
  private adapters: Map<string, EnemyCombatAdapter<unknown>> = new Map();

  /** Register an adapter. Returns an unregister function. */
  register<T>(adapter: EnemyCombatAdapter<T>): () => void {
    this.adapters.set(adapter.type, adapter as EnemyCombatAdapter<unknown>);
    return () => {
      if (this.adapters.get(adapter.type) === (adapter as EnemyCombatAdapter<unknown>)) {
        this.adapters.delete(adapter.type);
      }
    };
  }

  /** All currently-registered adapters. Iteration order = insertion. */
  getAdapters(): readonly EnemyCombatAdapter<unknown>[] {
    return Array.from(this.adapters.values());
  }

  /** Look up by type if a weapon needs to dispatch to a specific one. */
  getAdapter(type: string): EnemyCombatAdapter<unknown> | undefined {
    return this.adapters.get(type);
  }

  /**
   * Ray-cylinder hit test against every registered enemy. Returns the
   * earliest hit along the ray segment (prev → current bullet pos).
   *
   * The caller is responsible for actually applying damage afterwards
   * via `adapter.applyDamage(enemy, info)` — this function is read-only
   * so it can be used in projection / preview contexts too.
   */
  raycastBullet(
    prevX: number, prevY: number, prevZ: number,
    bx: number, by: number, bz: number,
    out: RaycastResult,
  ): boolean {
    const rayDx = bx - prevX;
    const rayDy = by - prevY;
    const rayDz = bz - prevZ;
    const rayLen = Math.sqrt(rayDx * rayDx + rayDy * rayDy + rayDz * rayDz);

    let bestT = Infinity;
    let bestAdapter: EnemyCombatAdapter<unknown> | null = null;
    let bestEnemy: unknown = null;
    let bestY = 0;
    let bestX = 0;
    let bestZ = 0;

    for (const adapter of this.adapters.values()) {
      const list = adapter.getActiveEnemies();
      for (const enemy of list) {
        const hb = adapter.getHitbox(enemy);
        if (!hb) continue;
        const hit = raycastCylinder(prevX, prevY, prevZ, rayDx, rayDy, rayDz, rayLen, hb);
        if (hit.t < bestT) {
          bestT = hit.t;
          bestAdapter = adapter;
          bestEnemy = enemy;
          bestY = hit.y;
          bestX = prevX + hit.t * rayDx;
          bestZ = prevZ + hit.t * rayDz;
        }
      }
    }

    if (bestAdapter === null) return false;
    out.adapter = bestAdapter;
    out.enemy = bestEnemy;
    out.t = bestT;
    out.hitX = bestX;
    out.hitY = bestY;
    out.hitZ = bestZ;
    return true;
  }
}

export interface RaycastResult {
  adapter: EnemyCombatAdapter<unknown> | null;
  enemy: unknown;
  t: number;
  hitX: number;
  hitY: number;
  hitZ: number;
}

// ------------------------------------------------------------------
//  Ray-cylinder math (reusable, zero-allocation)
// ------------------------------------------------------------------
interface CylinderHit { t: number; y: number; }
const _cylHit: CylinderHit = { t: Infinity, y: 0 };
function raycastCylinder(
  prevX: number, prevY: number, prevZ: number,
  rayDx: number, rayDy: number, rayDz: number,
  rayLen: number,
  hb: EnemyHitbox,
): CylinderHit {
  _cylHit.t = Infinity;
  _cylHit.y = 0;

  const r2 = hb.radius * hb.radius;

  // Quick AABB reject in Y.
  const minBy = Math.min(prevY, prevY + rayDy);
  const maxBy = Math.max(prevY, prevY + rayDy);
  if (maxBy < hb.bottomY - 0.5 || minBy > hb.topY + 0.5) return _cylHit;

  // Quick XZ bail.
  const xzdx = prevX + rayDx - hb.centerX;
  const xzdz = prevZ + rayDz - hb.centerZ;
  const bail = hb.radius + rayLen + 0.5;
  if (xzdx * xzdx + xzdz * xzdz > bail * bail) return _cylHit;

  // Zero-length ray = point check.
  if (rayLen < 0.001) {
    const dx = prevX - hb.centerX;
    const dz = prevZ - hb.centerZ;
    if (dx * dx + dz * dz < r2 && prevY >= hb.bottomY && prevY <= hb.topY) {
      _cylHit.t = 0;
      _cylHit.y = prevY;
    }
    return _cylHit;
  }

  // Side intersection: |prevXZ + t·rayXZ - centerXZ|² = radius².
  const ox = prevX - hb.centerX;
  const oz = prevZ - hb.centerZ;
  const a = rayDx * rayDx + rayDz * rayDz;
  const b = 2 * (ox * rayDx + oz * rayDz);
  const c = ox * ox + oz * oz - r2;
  const disc = b * b - 4 * a * c;
  if (disc >= 0 && a > 0.0001) {
    const sqrtD = Math.sqrt(disc);
    for (const t of [(-b - sqrtD) / (2 * a), (-b + sqrtD) / (2 * a)]) {
      if (t >= 0 && t <= 1) {
        const iy = prevY + t * rayDy;
        if (iy >= hb.bottomY && iy <= hb.topY) {
          if (t < _cylHit.t) { _cylHit.t = t; _cylHit.y = iy; }
          break;
        }
      }
    }
  }
  // Cap intersections (top/bottom face).
  if (rayDy !== 0) {
    for (const [tCand, capY] of [
      [(hb.bottomY - prevY) / rayDy, hb.bottomY],
      [(hb.topY - prevY)    / rayDy, hb.topY],
    ] as const) {
      if (tCand >= 0 && tCand <= 1) {
        const capX = prevX + tCand * rayDx - hb.centerX;
        const capZ = prevZ + tCand * rayDz - hb.centerZ;
        if (capX * capX + capZ * capZ < r2 && tCand < _cylHit.t) {
          _cylHit.t = tCand;
          _cylHit.y = capY;
        }
      }
    }
  }

  return _cylHit;
}

export const enemyCombatRegistry = new CombatRegistry();
