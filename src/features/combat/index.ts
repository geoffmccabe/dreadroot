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
