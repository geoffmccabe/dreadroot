// check-undeclared — no code may reference a name that does not exist.
//
// This is the check that would have saved several days.
//
// `CULL_UNITS` was used twice in the crowd's frame loop and declared nowhere. Reading an undeclared
// name throws ReferenceError, and a throw inside a requestAnimationFrame callback kills
// react-three-fiber's ENTIRE loop — so the camera stopped, the Kaiju stopped, and the terrain
// stopped, none of which is the crowd. It read as "the controls are broken" for three rounds of
// bug reports.
//
// AND THE PROJECT'S TYPE CHECK COULD NOT SEE IT. The root tsconfig.json is a solution file:
// `"files": []` with references to sub-projects. So `tsc --noEmit`, which is what everyone
// (including me, all session) had been running, compiles ZERO files and exits 0. Every "typecheck
// clean" reported here was vacuous. The real check needs the app project named explicitly.
//
// Only TS2304 is fatal here. The codebase carries 300-odd older type errors, mostly Supabase row
// shapes in admin panels, and a gate that fails on all of them would simply be switched off. An
// undeclared NAME is different in kind: it is not a type opinion, it is a crash.
//
// Run: npm run check:undeclared

import { execSync } from 'node:child_process';

/**
 * Files allowed to keep undeclared names.
 *
 * Only genuinely dead code, and the name has to say so. ` - old.ts` files are superseded copies
 * kept for reference and imported by nothing.
 */
const DEAD = [' - old.ts', ' - origl.tsx'];

let out = '';
try {
  out = execSync('npx tsc -p tsconfig.app.json --noEmit', { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}

const bad = out.split('\n')
  .filter((l) => l.includes('error TS2304'))
  .filter((l) => !DEAD.some((d) => l.includes(d)));

console.log('\n== Every name a file uses must exist ==\n');
if (bad.length === 0) {
  console.log('  PASS  no undeclared names in live code\n');
  console.log('NO UNDECLARED NAMES\n');
  process.exit(0);
}
for (const l of bad) console.log(`  FAIL  ${l.trim()}`);
console.log(`\n${bad.length} UNDECLARED NAME(S) — each one throws ReferenceError when reached.\n`);
process.exit(1);
