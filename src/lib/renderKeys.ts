// src/lib/renderKeys.ts
// Stable render key utilities to prevent instanced mesh remount churn

/**
 * Fast 32-bit FNV-1a hash for string inputs
 * Used for generating stable, collision-resistant signatures
 */
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Canonicalize texture URL by stripping query params and hash
 * This prevents signed URL churn from causing cache misses
 */
export function canonicalizeTextureUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '';
  const q = url.split('#')[0].split('?')[0];
  try {
    const u = new URL(q, window.location.origin);
    return u.pathname;
  } catch {
    return q;
  }
}

/**
 * Get stable material variant ID for grouping blocks
 * Combines block type with canonical texture path hash
 */
export function getMaterialVariantId(blockType: string, textureUrl?: string | null): string {
  const canon = canonicalizeTextureUrl(textureUrl);
  if (!canon) return `${blockType}:default`;
  return `${blockType}:tx:${fnv1a32(canon)}`;
}
