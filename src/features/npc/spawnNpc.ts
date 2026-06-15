/**
 * Spawn an EMS NPC a few blocks in front of the local player, facing them.
 * Shared by the `@` command and the NPC panel's Spawn button.
 */
import { getLocalPlayerSnapshot } from '@/hooks/usePlayerSnapshot';
import { npcManager } from './NpcManager';

const PLAYER_EYE_HEIGHT = 1.6;
const SPAWN_DIST = 4;

export function spawnNpcInFrontOfPlayer(slug: string) {
  const pl = getLocalPlayerSnapshot();
  const fx = -Math.sin(pl.yaw);
  const fz = -Math.cos(pl.yaw);
  const x = pl.x + fx * SPAWN_DIST;
  const z = pl.z + fz * SPAWN_DIST;
  const y = Math.max(0, pl.y - PLAYER_EYE_HEIGHT); // feet level, never below ground
  const yaw = Math.atan2(pl.x - x, pl.z - z); // face back toward the player
  return npcManager.spawn(slug, x, y, z, yaw);
}
