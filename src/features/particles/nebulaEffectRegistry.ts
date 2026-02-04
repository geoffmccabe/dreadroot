// In-memory registry for captured nebula effect configurations
// Codes follow pattern: #EF{n}-{seq} e.g. #EF1-3 = third capture of Fire

import type { NebulaEffectId, NebulaEditorParams, CapturedNebulaEffect } from './types';
import { NEBULA_EFFECT_CODES } from './types';

const registry = new Map<string, CapturedNebulaEffect>();
const counters: Record<string, number> = { EF1: 0, EF2: 0, EF3: 0, EF4: 0, EF5: 0 };

export function captureEffect(effectId: NebulaEffectId, params: NebulaEditorParams): string {
  const baseCode = NEBULA_EFFECT_CODES[effectId];
  counters[baseCode]++;
  const code = `#${baseCode}-${counters[baseCode]}`;

  registry.set(code, {
    code,
    effectId,
    params: { ...params },
    capturedAt: Date.now(),
  });

  return code;
}

export function getCapturedEffect(code: string): CapturedNebulaEffect | undefined {
  return registry.get(code);
}

export function getAllCapturedEffects(): CapturedNebulaEffect[] {
  return Array.from(registry.values());
}

export function clearRegistry(): void {
  registry.clear();
  for (const key of Object.keys(counters)) counters[key] = 0;
}
