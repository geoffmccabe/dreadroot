// assetCode — a stable, short, content-derived code for every Synty asset, plus a lazy global
// index so the user can type a code and pull ANY asset (from any pack) into the builder.
//
// WHY content-derived (not a sequential number): the code is a hash of the asset's stable id
// (e.g. "kingdom_SM_Bld_Tower_02"), so it NEVER shifts even if packs gain/lose models — the same
// asset always gets the same code. We show/type the first 8 hex chars; typing fewer (6-8) does a
// PREFIX match and, if that's ambiguous (rare), the UI lists the few candidates.

// cyrb53 — a tiny, fast, well-distributed 53-bit string hash. Deterministic across all clients, so
// every browser computes the same code for the same id. (Identical output to the canonical cyrb53.)
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The stable 8-char hex code for an asset id (id = catalog id, i.e. file without ".gltf"). */
export function assetCode(id: string): string {
  return cyrb53(id).toString(16).padStart(14, '0').slice(0, 8);
}

/** id from a sampler/catalog file name ("kingdom_SM_Bld_Tower_02.gltf" → "kingdom_SM_Bld_Tower_02"). */
export function idFromFile(file: string): string {
  return file.replace(/\.gltf$/i, '');
}

/** Short display name from an id/file: drop the "<set>_" prefix ("kingdom_SM_Bld_Tower_02" → "SM_Bld_Tower_02"). */
export function shortName(idOrFile: string): string {
  return idFromFile(idOrFile).replace(/^[^_]+_/, '');
}

// The 21 converted asset packs (catalogs at /siege/scifi/_catalog_<set>.json). Kept here so the
// global code lookup can scan every pack without depending on the builder panel's own list.
export const ASSET_SETS = [
  'city', 'cyber', 'mech', 'space', 'worlds', 'apoc', 'dark',
  'nature', 'alpine', 'desert', 'meadow', 'swamp', 'jungle',
  'adventure', 'ancient', 'dungeon', 'elven', 'enchanted', 'kingdom', 'samurai', 'mining',
];

export interface AssetEntry {
  code: string; id: string; name: string; set: string; file: string;
  category?: string; w?: number; h?: number; d?: number;
}

interface CatRow { id?: string; name?: string; set?: string; file: string; category?: string; w?: number; h?: number; d?: number; }

// Cache the flattened global index so the first code-lookup fetches the 21 catalogs once, then all
// later lookups are instant. Reuses the same JSON the builder palette already fetches per set.
let indexPromise: Promise<AssetEntry[]> | null = null;

async function fetchSet(base: string, set: string): Promise<AssetEntry[]> {
  try {
    const res = await fetch(`${base}/siege/scifi/_catalog_${set}.json`);
    const data = await res.json() as { items?: CatRow[] };
    return (data.items ?? []).filter((r) => r.file).map((r) => {
      const id = r.id ?? idFromFile(r.file);
      return { code: assetCode(id), id, name: r.name ?? shortName(id), set: r.set ?? set, file: r.file,
        category: r.category, w: r.w, h: r.h, d: r.d };
    });
  } catch { return []; }
}

/** Load (once) and return the flat index of every asset in every pack, each with its code. */
export function loadAllAssets(assetBase: string): Promise<AssetEntry[]> {
  if (!indexPromise) {
    indexPromise = Promise.all(ASSET_SETS.map((s) => fetchSet(assetBase, s)))
      .then((lists) => lists.flat());
  }
  return indexPromise;
}

/** Resolve a typed code (6-8+ chars) to matching assets by case-insensitive PREFIX. */
export function resolveCode(query: string, all: AssetEntry[]): AssetEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  return all.filter((a) => a.code.startsWith(q)).slice(0, 12);
}
