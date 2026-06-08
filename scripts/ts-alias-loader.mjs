// Minimal Node ESM resolve hook so the test scripts can run the app's TS under
// `node --experimental-strip-types` without Vite. Handles two things the app's
// bundler does but bare Node doesn't:
//   • `@/X`        → <root>/src/X(.ts)        (path alias)
//   • `./X`/`../X` → append `.ts` if extensionless (bundler-style resolution)
// Test-only.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as presolve, dirname, basename } from 'node:path';

const ROOT = presolve(dirname(fileURLToPath(import.meta.url)), '..');
const hasExt = (p) => /\.[a-z0-9]+$/i.test(basename(p));

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    let p = presolve(ROOT, 'src', specifier.slice(2));
    if (!hasExt(p)) p += '.ts';
    return { url: pathToFileURL(p).href, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !hasExt(specifier) && context.parentURL) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    return { url: pathToFileURL(presolve(parentDir, specifier) + '.ts').href, shortCircuit: true };
  }
  return next(specifier, context);
}
