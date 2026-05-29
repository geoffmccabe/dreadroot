export {
  resolveBulletHit,
  BASE_BULLET_DAMAGE,
  type BulletHitInput,
  type BulletHitResult,
} from './resolveBulletHit';

export {
  resolveBlastHit,
  type BlastHitInput,
  type BlastHitResult,
} from './resolveBlastHit';

export {
  isPointInFlameCone,
  FLAME_HALF_ANGLE,
  flameDpsForTier,
  flameBurnSecondsForTier,
  type FlameCone,
} from './resolveFlameHit';

export {
  stepBulletPhysics,
  type BulletPhysicsState,
  type BulletPhysicsConstants,
} from './bulletPhysics';

export {
  stepGrenadePhysics,
  type GrenadePhysicsState,
  type GrenadePhysicsConstants,
  type VoxelCollider,
  type EnemyCylinder,
  type EnemyColliderSource,
} from './grenadePhysics';

export {
  stepEggPhysics,
  type EggPhysicsState,
  type EggPhysicsConstants,
  type EggPhysicsResult,
} from './eggPhysics';
