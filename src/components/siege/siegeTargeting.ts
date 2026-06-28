// siegeTargeting — THE SENSES SEAM. See docs/COBUILD_SENSES_OWNERSHIP.md.
//
// acquireTarget() answers the one question all monster behaviour routes through: "do I have a target,
// where is it, and how sure am I?" The SENSES window owns this function's INSIDES — it will later
// replace the body to delegate to perception.ts (sight / hearing / smell + a rising/decaying awareness
// meter + per-character camo/stealth/scent vs per-monster sensor scores + wind/light). Behaviour code
// (movement / pathfinding / attack / flee) consumes the RESULT and must not read the player's position
// directly for the chase decision. Every call site is marked `// SENSES-SEAM` so it's easy to find.
//
// TODAY this is a thin STUB that reproduces the pre-seam behaviour exactly: the player is a target when
// ALIVE and within `aggro` (horizontal distance). state is then 'alert' (awareness 1), else null → the
// monster wanders. When the senses window fills in the real logic (returning 'suspicious' + a
// last-known position, etc.), the CALLERS DO NOT CHANGE — only this body does.

export type AwarenessState = 'unaware' | 'suspicious' | 'alert';

export interface SenseTarget {
  pos: { x: number; y: number; z: number };   // where to HEAD: the live player now; last-known later
  state: AwarenessState;
  awareness: number;                           // 0..1 (how sure the monster is)
}

export interface AcquireArgs {
  self: { x: number; y: number; z: number };   // the monster's position
  player: { x: number; y: number; z: number }; // the live player (the senses window also reads stimuli)
  aggro: number;                               // horizontal aggro radius (use Infinity for always-aware)
  playerDead: boolean;                         // dead player = no target (everyone wanders off)
}

// SENSES-SEAM — STUB. Senses window: replace this body (delegate to perception.ts); keep the signature
// so call sites never change.
export function acquireTarget({ self, player, aggro, playerDead }: AcquireArgs): SenseTarget | null {
  if (playerDead) return null;
  const dx = player.x - self.x, dz = player.z - self.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= aggro) return null;                                   // out of range → wander (matches old `dist < aggro`)
  return { pos: { x: player.x, y: player.y, z: player.z }, state: 'alert', awareness: 1 };
}
