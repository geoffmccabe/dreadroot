/**
 * Universal Player Tracking Service
 *
 * Central registry of all player states that any system can query.
 * Used by enemies, turrets, NPCs, and any game system that needs to know
 * where players are located.
 *
 * Features:
 * - Tracks position, velocity, direction for all players
 * - Spatial hash for O(1) range queries
 * - Velocity prediction for leading shots
 * - Multiplayer-ready (local + remote players)
 */

import * as THREE from 'three';

// Chunk size for spatial bucketing
const CHUNK_SIZE = 16;

// Position history size for velocity calculation
const POSITION_HISTORY_SIZE = 5;

// Pre-allocated vectors for calculations (zero GC)
const _tempVec = new THREE.Vector3();
const _tempVec2 = new THREE.Vector3();

export interface PlayerState {
  id: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  isMoving: boolean;
  lastUpdatedAt: number;
  chunkX: number;
  chunkZ: number;

  // Position history for velocity calculation
  positionHistory: Array<{ pos: THREE.Vector3; time: number }>;
}

/**
 * Predict where a player will be after deltaTime seconds
 */
export function predictPosition(player: PlayerState, deltaTime: number): THREE.Vector3 {
  return _tempVec
    .copy(player.position)
    .addScaledVector(player.velocity, deltaTime);
}

/**
 * Get chunk key for spatial hashing
 */
function getChunkKey(x: number, z: number): string {
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkZ = Math.floor(z / CHUNK_SIZE);
  return `${chunkX},${chunkZ}`;
}

/**
 * Calculate velocity from position history
 */
function calculateVelocity(history: PlayerState['positionHistory']): THREE.Vector3 {
  if (history.length < 2) {
    return new THREE.Vector3(0, 0, 0);
  }

  const oldest = history[0];
  const newest = history[history.length - 1];
  const deltaTime = (newest.time - oldest.time) / 1000; // Convert to seconds

  if (deltaTime < 0.001) {
    return new THREE.Vector3(0, 0, 0);
  }

  return new THREE.Vector3(
    (newest.pos.x - oldest.pos.x) / deltaTime,
    (newest.pos.y - oldest.pos.y) / deltaTime,
    (newest.pos.z - oldest.pos.z) / deltaTime
  );
}

/**
 * Player Tracker - Singleton service
 */
class PlayerTrackerService {
  private players: Map<string, PlayerState> = new Map();
  private spatialHash: Map<string, Set<string>> = new Map();

  /**
   * Register a new player
   */
  registerPlayer(id: string, position: THREE.Vector3, direction: THREE.Vector3): void {
    const now = performance.now();
    const chunkX = Math.floor(position.x / CHUNK_SIZE);
    const chunkZ = Math.floor(position.z / CHUNK_SIZE);

    const state: PlayerState = {
      id,
      position: position.clone(),
      velocity: new THREE.Vector3(0, 0, 0),
      direction: direction.clone().normalize(),
      speed: 0,
      isMoving: false,
      lastUpdatedAt: now,
      chunkX,
      chunkZ,
      positionHistory: [{ pos: position.clone(), time: now }],
    };

    this.players.set(id, state);
    this.addToSpatialHash(id, chunkX, chunkZ);
  }

  /**
   * Update a player's state
   */
  updatePlayer(id: string, position: THREE.Vector3, direction: THREE.Vector3): void {
    const player = this.players.get(id);
    if (!player) {
      // Auto-register if not found
      this.registerPlayer(id, position, direction);
      return;
    }

    const now = performance.now();
    const newChunkX = Math.floor(position.x / CHUNK_SIZE);
    const newChunkZ = Math.floor(position.z / CHUNK_SIZE);

    // Update spatial hash if chunk changed
    if (newChunkX !== player.chunkX || newChunkZ !== player.chunkZ) {
      this.removeFromSpatialHash(id, player.chunkX, player.chunkZ);
      this.addToSpatialHash(id, newChunkX, newChunkZ);
      player.chunkX = newChunkX;
      player.chunkZ = newChunkZ;
    }

    // Update position history
    player.positionHistory.push({ pos: position.clone(), time: now });
    if (player.positionHistory.length > POSITION_HISTORY_SIZE) {
      player.positionHistory.shift();
    }

    // Calculate velocity from history
    player.velocity.copy(calculateVelocity(player.positionHistory));
    player.speed = player.velocity.length();
    player.isMoving = player.speed > 0.1;

    // Update other fields
    player.position.copy(position);
    player.direction.copy(direction).normalize();
    player.lastUpdatedAt = now;
  }

  /**
   * Remove a player from tracking
   */
  unregisterPlayer(id: string): void {
    const player = this.players.get(id);
    if (player) {
      this.removeFromSpatialHash(id, player.chunkX, player.chunkZ);
      this.players.delete(id);
    }
  }

  /**
   * Get all tracked players
   */
  getAllPlayers(): PlayerState[] {
    return Array.from(this.players.values());
  }

  /**
   * Get a specific player by ID
   */
  getPlayerById(id: string): PlayerState | null {
    return this.players.get(id) || null;
  }

  /**
   * Get players within radius of a position
   */
  getPlayersInRange(position: THREE.Vector3, radius: number): PlayerState[] {
    const radiusSq = radius * radius;
    const result: PlayerState[] = [];

    // Calculate chunk range to check
    const minChunkX = Math.floor((position.x - radius) / CHUNK_SIZE);
    const maxChunkX = Math.floor((position.x + radius) / CHUNK_SIZE);
    const minChunkZ = Math.floor((position.z - radius) / CHUNK_SIZE);
    const maxChunkZ = Math.floor((position.z + radius) / CHUNK_SIZE);

    // Check all chunks in range
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const chunkKey = `${cx},${cz}`;
        const playerIds = this.spatialHash.get(chunkKey);
        if (!playerIds) continue;

        for (const id of playerIds) {
          const player = this.players.get(id);
          if (!player) continue;

          // Distance check
          _tempVec.copy(player.position).sub(position);
          const distSq = _tempVec.lengthSq();

          if (distSq <= radiusSq) {
            result.push(player);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get players in specific chunks
   */
  getPlayersInChunks(centerChunkX: number, centerChunkZ: number, chunkRadius: number): PlayerState[] {
    const result: PlayerState[] = [];

    for (let dx = -chunkRadius; dx <= chunkRadius; dx++) {
      for (let dz = -chunkRadius; dz <= chunkRadius; dz++) {
        const chunkKey = `${centerChunkX + dx},${centerChunkZ + dz}`;
        const playerIds = this.spatialHash.get(chunkKey);
        if (!playerIds) continue;

        for (const id of playerIds) {
          const player = this.players.get(id);
          if (player) result.push(player);
        }
      }
    }

    return result;
  }

  /**
   * Get nearest player to a position
   */
  getNearestPlayer(position: THREE.Vector3, maxDistance: number = Infinity): PlayerState | null {
    let nearest: PlayerState | null = null;
    let nearestDistSq = maxDistance * maxDistance;

    for (const player of this.players.values()) {
      _tempVec.copy(player.position).sub(position);
      const distSq = _tempVec.lengthSq();

      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = player;
      }
    }

    return nearest;
  }

  /**
   * Get direction from a point to a player
   */
  getDirectionToPlayer(fromPos: THREE.Vector3, playerId: string): THREE.Vector3 | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    return _tempVec2
      .copy(player.position)
      .sub(fromPos)
      .normalize();
  }

  /**
   * Get distance to a player
   */
  getDistanceToPlayer(fromPos: THREE.Vector3, playerId: string): number | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    return fromPos.distanceTo(player.position);
  }

  /**
   * Get player count
   */
  getPlayerCount(): number {
    return this.players.size;
  }

  /**
   * Clear all players (for world reset)
   */
  clear(): void {
    this.players.clear();
    this.spatialHash.clear();
  }

  // Spatial hash helpers
  private addToSpatialHash(id: string, chunkX: number, chunkZ: number): void {
    const key = `${chunkX},${chunkZ}`;
    let bucket = this.spatialHash.get(key);
    if (!bucket) {
      bucket = new Set();
      this.spatialHash.set(key, bucket);
    }
    bucket.add(id);
  }

  private removeFromSpatialHash(id: string, chunkX: number, chunkZ: number): void {
    const key = `${chunkX},${chunkZ}`;
    const bucket = this.spatialHash.get(key);
    if (bucket) {
      bucket.delete(id);
      if (bucket.size === 0) {
        this.spatialHash.delete(key);
      }
    }
  }
}

// Singleton instance
export const playerTracker = new PlayerTrackerService();

// Export types
export type { PlayerTrackerService };
