// Types
export * from './types';

// Constants
export * from './constants';

// Components
export { ShwarmDesignPanel } from './components/ShwarmDesignPanel';
export { HealthBar, DeathOverlay } from './components/HealthBar';
export { ShwarmRenderer } from './components/ShwarmRenderer';
export type { ShwarmRendererHandle } from './components/ShwarmRenderer';

// Hooks
export { usePlayerHealth } from './hooks/usePlayerHealth';
export { calculateMaxHealthForLevel } from './hooks/usePlayerHealth';
export type { PlayerHealthState, RegenModifiers } from './hooks/usePlayerHealth';
export { useShwarmDefinitions, getDefinitionByTier } from './hooks/useShwarmDefinitions';
export { useShwarmSystem } from './hooks/useShwarmSystem';
export type { ShwarmInstance } from './hooks/useShwarmSystem';
export { useShwarmMovement } from './hooks/useShwarmMovement';
