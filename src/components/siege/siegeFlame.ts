// Bridge to the scene's UniversalFlameRenderer for siege monsters. The renderer handle is a
// plain ref in FortressScene (not a context), so FortressScene publishes the ref here once and
// any in-Canvas siege code (e.g. the Dark Lord's body flames) reads the live handle on demand.
import type { RefObject } from 'react';
import type { UniversalFlameRendererHandle } from '@/components/fortress/UniversalFlameRenderer';

let flameRef: RefObject<UniversalFlameRendererHandle | null> | null = null;
export function setSiegeFlameRef(r: RefObject<UniversalFlameRendererHandle | null>) { flameRef = r; }
export function getSiegeFlame(): UniversalFlameRendererHandle | null { return flameRef?.current ?? null; }
