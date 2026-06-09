// Minimal Node ESM resolve hook so the test scripts can run the app's TS under
// `node --experimental-strip-types` without Vite. Handles what the app's bundler
// does but bare Node doesn't:
//   • `@/X`        → <root>/src/X            (path alias)
//   • `./X`/`../X` → append `.ts`, or fall back to `X/index.ts` for a folder
// Test-only.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as presolve, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = presolve(dirname(fileURLToPath(import.meta.url)), '..');
const hasExt = (p) => /\.[a-z0-9]+$/i.test(basename(p));

// Resolve an extensionless path to either <p>.ts or <p>/index.ts.
const toTs = (p) => {
  const asFile = `${p}.ts`;
  return existsSync(asFile) ? asFile : presolve(p, 'index.ts');
};

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const p = presolve(ROOT, 'src', specifier.slice(2));
    return { url: pathToFileURL(hasExt(p) ? p : toTs(p)).href, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !hasExt(specifier) && context.parentURL) {
    const p = presolve(dirname(fileURLToPath(context.parentURL)), specifier);
    return { url: pathToFileURL(toTs(p)).href, shortCircuit: true };
  }
  return next(specifier, context);
}
