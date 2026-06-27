// Global "look" mount point (kept here so FortressScene's tree is untouched).
//
// Phase 1 of the render-mood system:
//   * EnvironmentIBL — subtle image-based ambient for PBR materials (runs once).
//   * LookComposer   — tiered Bloom + AgX tone mapping (desktop full pass; mobile keeps
//                      the base AgX renderer with no extra full-screen passes).
//
// The previous mipmapBlur bloom here caused full-screen black flashing while moving;
// LookComposer replaces it with a flash-proof kernel bloom. Tunables live in
// src/features/look/lookConfig.ts.
import { EnvironmentIBL } from '../../features/look/EnvironmentIBL';
import { LookComposer } from '../../features/look/LookComposer';
import { LookSync } from '../../features/look/LookSync';

export function FortressPostFX() {
  return (
    <>
      <LookSync />
      <EnvironmentIBL />
      <LookComposer />
    </>
  );
}
