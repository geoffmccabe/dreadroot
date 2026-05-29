// PlayerCombatAdapter — register PLAYERS as valid targets in the
// EnemyCombatRegistry so weapons can damage them through the same
// contract used for monsters. PvP isn't enabled in gameplay yet, but
// the contract surface needs to exist before the L2 DO migration so
// the bullet/grenade/flame code paths can hit players uniformly.
//
// Currently a stub: getActiveEnemies returns just the local player
// (single-client multiplayer state is sparse), and applyDamage is a
// no-op that logs. After the L2 cutover this is where:
//   - getActiveEnemies returns all players in the local viewer's zone
//     (from the server snapshot)
//   - applyDamage forwards the damage event to the DO, which
//     authoritatively applies it to the target player

import { useEffect } from 'react';
import { enemyCombatRegistry, type EnemyCombatAdapter, type EnemyHitbox, type DamageInfo } from '@/features/enemies/combat/EnemyCombatRegistry';
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';

// PvP isn't wired up in gameplay yet. Adapter is defined here so the
// contract surface exists for the L2 migration but is NOT registered
// by default — that would cause grenades/flames/burns to enumerate
// the local player as a target and (even with a no-op applyDamage)
// trigger burn VFX, kill credit, etc. Flip this flag when the
// permission model + remote-player roster + apply-damage forwarding
// are all in place.
const PLAYER_PVP_ADAPTER_ENABLED = false;

interface PlayerTarget {
  /** Auth user id of the player. Local player = currentUserId. */
  id: string;
  /** Whether this player is the local player (drives the apply-damage
   *  path: local takes damage immediately, remote forwards to DO). */
  isLocal: boolean;
}

const PLAYER_HITBOX_HEIGHT = 1.8;  // ~6 ft
const PLAYER_HITBOX_RADIUS = 0.4;
const PLAYER_FOOT_OFFSET = 0.7;    // camera ≈ eye height; feet are below

/** Mount in FortressScene alongside the enemy systems. No-op unless
 *  PLAYER_PVP_ADAPTER_ENABLED is flipped on. The hook exists today so
 *  the call site is in place for the L2 migration; today it
 *  intentionally registers nothing. */
export function usePlayerCombatAdapter(currentUserId: string | null): void {
  useEffect(() => {
    if (!PLAYER_PVP_ADAPTER_ENABLED) return;
    if (!currentUserId) return;

    const adapter: EnemyCombatAdapter<PlayerTarget> = {
      type: 'player',
      // Pets shouldn't target players (yet) — friendly-fire safety
      // for the existing pet shpiders the user already owns.
      petAttackable: false,

      getActiveEnemies: () => {
        // STUB returns no targets so flipping the flag prematurely
        // can't damage the local player with their own weapons. The
        // L2 migration replaces this with a zone roster of REMOTE
        // players (self excluded — players never fire-on-self
        // through this adapter).
        return [];
      },

      getId: (p) => p.id,

      getHitbox: (p): EnemyHitbox | null => {
        if (!p.isLocal) return null;
        const snap = getLocalPlayerSnapshot();
        const bottomY = snap.y - PLAYER_FOOT_OFFSET;
        return {
          centerX: snap.x,
          centerZ: snap.z,
          bottomY,
          topY: bottomY + PLAYER_HITBOX_HEIGHT,
          radius: PLAYER_HITBOX_RADIUS,
        };
      },

      applyDamage: (_p, _info: DamageInfo): boolean => {
        // STUB. Doing nothing on purpose — PvP gameplay isn't wired
        // up. After L2 migration this becomes either a direct call to
        // takeDamage (for the local player) or a forwarded message to
        // the DO (for a remote player target).
        return false;
      },

      getHitSoundUrl: () => '/bullet_impact_1.mp3',
    };

    const unregister = enemyCombatRegistry.register(adapter);
    return unregister;
  }, [currentUserId]);
}
