// Shpider hop AI — IDLE / HOPPING state machine driven by the
// per-tier hop_* config columns from shpider_definitions.
//
// Motion: linear in X/Z, Y follows
//   Y(t) = lerp(startY, endY, t) + arcHeight × sin(π × t)
// so the path peaks at the midpoint and lands at endY — the parabolic
// arc the user specified.

import * as THREE from 'three';
import type { ShpiderInstance } from '../types';

const _toPlayer = new THREE.Vector3();

interface StepDeps {
  /** Player world position (we bias hops toward the player). */
  playerX: number;
  playerZ: number;
  /** Now, in ms. */
  now: number;
}

/**
 * Advance one shpider for the current frame. Mutates instance fields.
 */
export function stepShpiderHopAI(s: ShpiderInstance, deps: StepDeps): void {
  const { now, playerX, playerZ } = deps;
  const def = s.definition;

  if (s.hop.phase === 'idle') {
    // Time to launch?
    if (now < s.hop.nextHopAt) return;

    // Pick a target. 70% biased toward the player, 30% random angle.
    const biasPlayer = Math.random() < 0.7;
    let dirX: number;
    let dirZ: number;
    if (biasPlayer) {
      _toPlayer.set(playerX - s.position.x, 0, playerZ - s.position.z);
      const len = _toPlayer.length();
      if (len > 0.001) {
        _toPlayer.divideScalar(len);
        // Small random jitter so groups don't pile on the player.
        const jitterAngle = (Math.random() - 0.5) * 0.6;
        const c = Math.cos(jitterAngle);
        const sn = Math.sin(jitterAngle);
        dirX = _toPlayer.x * c - _toPlayer.z * sn;
        dirZ = _toPlayer.x * sn + _toPlayer.z * c;
      } else {
        const angle = Math.random() * Math.PI * 2;
        dirX = Math.cos(angle);
        dirZ = Math.sin(angle);
      }
    } else {
      const angle = Math.random() * Math.PI * 2;
      dirX = Math.cos(angle);
      dirZ = Math.sin(angle);
    }

    const dist = def.hop_distance_min + Math.random() * (def.hop_distance_max - def.hop_distance_min);
    const endX = s.position.x + dirX * dist;
    const endZ = s.position.z + dirZ * dist;

    s.hop.phase = 'hopping';
    s.hop.hopStartAt = now;
    s.hop.hopDurationMs = def.hop_duration_ms;
    s.hop.startX = s.position.x;
    s.hop.startY = s.position.y;
    s.hop.startZ = s.position.z;
    s.hop.endX = endX;
    s.hop.endY = s.position.y;       // Phase 4 = flat ground; Phase 5 adds Y targets
    s.hop.endZ = endZ;
    s.hop.arcHeight = dist * def.hop_arc_factor;

    // Face the hop direction so legs orient correctly.
    s.rotation = Math.atan2(dirX, dirZ);
    return;
  }

  // Phase: 'hopping'
  const t = Math.min(1, (now - s.hop.hopStartAt) / s.hop.hopDurationMs);
  s.position.x = s.hop.startX + (s.hop.endX - s.hop.startX) * t;
  s.position.z = s.hop.startZ + (s.hop.endZ - s.hop.startZ) * t;
  s.position.y = s.hop.startY + (s.hop.endY - s.hop.startY) * t
                + s.hop.arcHeight * Math.sin(Math.PI * t);

  if (t >= 1) {
    // Land. Snap to end position, schedule next idle window.
    s.position.x = s.hop.endX;
    s.position.y = s.hop.endY;
    s.position.z = s.hop.endZ;
    s.hop.phase = 'idle';
    s.hop.nextHopAt = now + def.hop_interval_min_ms
                    + Math.random() * (def.hop_interval_max_ms - def.hop_interval_min_ms);
  }
}

/** Returns hop progress 0..1 if hopping, or null if idle. */
export function getHopProgress(s: ShpiderInstance, now: number): number | null {
  if (s.hop.phase !== 'hopping') return null;
  return Math.min(1, (now - s.hop.hopStartAt) / s.hop.hopDurationMs);
}
