// Minimal Node ESM resolve hook so the round-trip/pipeline test scripts can run
// the app's `@/...` alias imports under `node --experimental-strip-types`
// (without pulling in Vite). Resolves `@/X` → <root>/src/X(.ts). Test-only.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as presolve, dirname, basename } from 'node:path';

const ROOT = presolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    let p = presolve(ROOT, 'src', specifier.slice(2));
    // Append .ts if no extension on the final segment.
    if (!/\.[a-z0-9]+$/i.test(basename(p))) p += '.ts';
    return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  return next(specifier, context);
}
