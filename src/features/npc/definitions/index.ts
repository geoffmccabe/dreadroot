/**
 * Built-in EMS NPC definitions — the first data configs of the new system, used
 * to prove the engine end-to-end (spawn via `@`, edit in the Ctrl-N panel). Each
 * is pure DATA; later these come from the registry/DB and the AI author.
 */
import type { EMSDefinition } from '../ems/types';
import { npcManager } from '../NpcManager';

/** Bouncy blob friend — sphere body, googly eyes, a wobbling cone spike. */
const BLORB: EMSDefinition = {
  slug: 'blorb',
  name: 'Blorb',
  faction: 'friend',
  skeleton: 'blob',
  nodes: [
    { id: 'body', shape: 'sphere', offset: [0, 1, 0], size: [1.4, 1.4, 1.4], parent: null, bond: 'rigid', color: '#5fae5f' },
    { id: 'eyeL', shape: 'sphere', offset: [-0.35, 0.3, 0.6], size: [0.35, 0.35, 0.35], parent: 'body', bond: 'rigid', color: '#ffffff' },
    { id: 'eyeR', shape: 'sphere', offset: [0.35, 0.3, 0.6], size: [0.35, 0.35, 0.35], parent: 'body', bond: 'rigid', color: '#ffffff' },
    { id: 'spike', shape: 'cone', offset: [0, 0.9, 0], size: [0.4, 0.8, 0.4], parent: 'body', bond: 'spring', spring: { stiffness: 120, damping: 8 }, color: '#e0c020' },
  ],
  locomotion: 'hop',
  moveSpeed: 3,
  scale: 1,
  behaviorTreeId: null,
  health: 100,
  damagePerHit: 0,
};

/** Hopper — the rabbit example: cylinder ears spring-bonded to the head so they
 *  bend and lag when it hops. */
const HOPPER: EMSDefinition = {
  slug: 'hopper',
  name: 'Hopper',
  faction: 'friend',
  skeleton: 'hopper',
  nodes: [
    { id: 'body', shape: 'capsule', offset: [0, 1, 0], size: [1, 1.4, 1], parent: null, bond: 'rigid', color: '#c8a0c8' },
    { id: 'head', shape: 'sphere', offset: [0, 1, 0.1], size: [0.9, 0.9, 0.9], parent: 'body', bond: 'rigid', color: '#d8b0d8' },
    { id: 'earL', shape: 'cylinder', offset: [-0.25, 0.7, 0], size: [0.18, 1.1, 0.18], parent: 'head', bond: 'spring', spring: { stiffness: 90, damping: 5 }, color: '#d8b0d8' },
    { id: 'earR', shape: 'cylinder', offset: [0.25, 0.7, 0], size: [0.18, 1.1, 0.18], parent: 'head', bond: 'spring', spring: { stiffness: 90, damping: 5 }, color: '#d8b0d8' },
    { id: 'eyeL', shape: 'sphere', offset: [-0.25, 0.1, 0.5], size: [0.22, 0.22, 0.22], parent: 'head', bond: 'rigid', color: '#202020' },
    { id: 'eyeR', shape: 'sphere', offset: [0.25, 0.1, 0.5], size: [0.22, 0.22, 0.22], parent: 'head', bond: 'rigid', color: '#202020' },
  ],
  locomotion: 'hop',
  moveSpeed: 4,
  scale: 1,
  behaviorTreeId: null,
  health: 80,
  damagePerHit: 0,
};

/** Cubeling — a hostile box creature with a wobbling head. */
const CUBELING: EMSDefinition = {
  slug: 'cubeling',
  name: 'Cubeling',
  faction: 'enemy',
  skeleton: 'cube',
  nodes: [
    { id: 'body', shape: 'box', offset: [0, 0.8, 0], size: [1.2, 1.0, 1.2], parent: null, bond: 'rigid', color: '#b04040' },
    { id: 'head', shape: 'box', offset: [0, 0.9, 0], size: [0.9, 0.9, 0.9], parent: 'body', bond: 'spring', spring: { stiffness: 110, damping: 7 }, color: '#c05050' },
    { id: 'eyeL', shape: 'box', offset: [-0.2, 0.1, 0.5], size: [0.18, 0.18, 0.1], parent: 'head', bond: 'rigid', color: '#ffff00' },
    { id: 'eyeR', shape: 'box', offset: [0.2, 0.1, 0.5], size: [0.18, 0.18, 0.1], parent: 'head', bond: 'rigid', color: '#ffff00' },
  ],
  locomotion: 'walk',
  moveSpeed: 2.5,
  scale: 1,
  behaviorTreeId: null,
  health: 120,
  damagePerHit: 8,
};

export const BUILTIN_NPCS: EMSDefinition[] = [BLORB, HOPPER, CUBELING];

let registered = false;
/** Register the built-in NPCs with the manager (idempotent). */
export function registerBuiltinNpcs(): void {
  if (registered) return;
  registered = true;
  for (const def of BUILTIN_NPCS) npcManager.registerDefinition(def);
}
