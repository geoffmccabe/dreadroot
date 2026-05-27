export type { GrenadeInstance } from './types';
export { useGrenadeSystem } from './hooks/useGrenadeSystem';
export type { ExplosionResult } from './hooks/useGrenadeSystem';
export { GrenadeRenderer } from './components/GrenadeRenderer';
export { ExplosionFX, type ExplosionFXHandle } from './components/ExplosionFX';
export {
  GRENADE_FUSE_SEC,
  grenadeDamage,
  grenadeRadius,
  grenadeColors,
} from './constants';
