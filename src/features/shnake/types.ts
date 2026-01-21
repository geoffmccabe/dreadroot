// Shnake System Types - Tree-dwelling segmented enemies
import * as THREE from 'three';

export interface ShnakeDefinitionRow {
  id: string;
  tier: number;
  name: string;
  head_texture_url: string | null;
  body_texture_url: string | null;
  face_texture_url: string | null;
  health_per_segment: number;
  damage_per_hit: number;
  knockback: number;
  armor: number;
  speed: number;
  spawn_chance_per_minute: number;
  max_spawn_per_tree: number;
  created_at: string | null;
  updated_at: string | null;
  /** AI behavior configuration (from database) */
  ai_config?: {
    behaviors?: string[];
    detectionRange?: number;
    attackRange?: number;
    angrySpeedMultiplier?: number;
    angryDurationMs?: number;
    attackCooldownMs?: number;
    custom?: Record<string, unknown>;
  } | null;
}

export interface ShnakeDefinition {
  id: string;
  tier: number;
  name: string;
  head_texture_url: string | null;
  body_texture_url: string | null;
  face_texture_url: string | null;
  health_per_segment: number;
  damage_per_hit: number;
  knockback: number;
  armor: number;
  speed: number;
  spawn_chance_per_minute: number;
  max_spawn_per_tree: number;
  created_at: string;
  updated_at: string;
  /** AI behavior configuration (from database) */
  ai_config?: {
    behaviors?: string[];
    detectionRange?: number;
    attackRange?: number;
    angrySpeedMultiplier?: number;
    angryDurationMs?: number;
    attackCooldownMs?: number;
    custom?: Record<string, unknown>;
  } | null;
}

export interface ShnakeSegment {
  /** Segment grid position (integer cell coords) */
  x: number;
  y: number;
  z: number;
}

export interface ShnakeInstance {
  id: string;
  treeId: string;
  tier: number;
  definition: ShnakeDefinition;
  /** segments[0] is head */
  segments: ShnakeSegment[];
  headHealth: number;
  /** unit direction of last move for head facing */
  headDir: THREE.Vector3;
  /** movement accumulator in "steps" */
  moveAcc: number;
  lastAttackAt: number;
  /** Collision boxes for each segment, same order as segments */
  colliders: THREE.Box3[];
  isActive: boolean;
}
