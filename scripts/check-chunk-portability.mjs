#!/usr/bin/env node
// Track 3F: prove the pure chunk-data layer is portable to a non-browser
// environment (Node / Cloudflare Durable Object) — i.e. it pulls in NO
// React and NO Three.js anywhere in its local import graph.
//
// No test runner / tsx needed: this statically walks the import graph of the
// seed modules (following relative + '@/' imports), and fails if any reachable
// file has a VALUE import of react/three/@react-three. `import type` lines are
// ignored (TS erases them — no runtime dependency). Run:
//   node scripts/check-chunk-portability.mjs

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

// The pure chunk-data layer the DO must be able to import.
const SEEDS = [
  'src/lib/voxelKey.ts',
  'src/lib/chunkBuilder.ts',
  'src/lib/chunkDelta.ts',
  'src/lib/chunkBinary.ts',
];

const FORBIDDEN = [/^react$/, /^react-dom$/, /^three$/, /^@react-three\//];

function resolveModule(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(fromFile), spec);
  else return null; // bare package — not a local file; only react/three are flagged separately
  const cands = [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')];
  return cands.find(existsSync) ?? null;
}

// Matches `import ... from '<spec>'` and `export ... from '<spec>'`, capturing
// whether the statement is type-only (`import type` / `export type`).
const IMPORT_RE = /\b(import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s+)?['"]([^'"]+)['"]/g;

const visited = new Set();
const violations = [];

function walk(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const code = readFileSync(file, 'utf8');
  for (const m of code.matchAll(IMPORT_RE)) {
    const typeOnly = !!m[2];
    const spec = m[3];
    // `import type ...` is erased by the compiler — not a runtime dependency,
    // so it neither counts as a violation nor pulls the target into the graph.
    if (typeOnly) continue;
    if (FORBIDDEN.some((re) => re.test(spec))) {
      violations.push({ file: file.replace(ROOT + '/', ''), spec });
      continue; // don't try to resolve react/three as files
    }
    const resolved = resolveModule(spec, file);
    if (resolved) walk(resolved);
  }
}

for (const seed of SEEDS) {
  const p = join(ROOT, seed);
  if (!existsSync(p)) { console.error(`MISSING seed: ${seed}`); process.exit(2); }
  walk(p);
}

const localFiles = [...visited].map((f) => f.replace(ROOT + '/', '')).sort();
console.log(`Chunk-layer import graph (${localFiles.length} local files):`);
for (const f of localFiles) console.log(`  ${f}`);

if (violations.length) {
  console.error(`\n❌ NOT portable — React/Three.js value imports found:`);
  for (const v of violations) console.error(`  ${v.file}  imports  ${v.spec}`);
  process.exit(1);
}
console.log(`\n✅ Portable: no React/Three.js value imports in the chunk-data layer.`);
