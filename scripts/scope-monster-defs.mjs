// One-shot codemod: game-scope every monster-definition READ.
//
// The eight *_definitions tables live in the Supabase that DreadRoot, Pinkland
// and Siege Worlds share. Every client reads them unfiltered today, so all
// games see the same monsters. Now that the tables are UNIQUE(game, tier),
// each client must read only its own game's rows BEFORE any second game's rows
// are inserted - otherwise the other game suddenly shows duplicate monsters.
//
// It inserts `.eq('game', GAME_ID)` directly after the `.select(...)` that
// follows a `.from('<monster>_definitions')`, matching the indentation of the
// select it follows. Writes (upsert/update/insert/delete) are NOT touched -
// those need a `game` value in the payload and an onConflict change, which is
// a judgement call per call site, done by hand.
//
// Usage:  node scripts/scope-monster-defs.mjs <srcDir> [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TABLES = ['shombie', 'shtickman', 'shnake', 'shwarm', 'shroomer', 'vortax', 'shpider', 'walapa']
  .map((m) => `${m}_definitions`);

const root = process.argv[2];
const write = process.argv.includes('--write');
if (!root) { console.error('usage: node scripts/scope-monster-defs.mjs <srcDir> [--write]'); process.exit(1); }

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Index just past the matching ')' for the '(' at openIdx. */
function matchParen(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i + 1; }
    // skip string literals so a ')' inside one does not fool us
    else if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; }
    }
  }
  return -1;
}

let totalFiles = 0, totalEdits = 0, skipped = [];

for (const file of walk(root)) {
  let src = readFileSync(file, 'utf8');
  if (!TABLES.some((t) => src.includes(`'${t}'`))) continue;

  let edits = 0;
  let cursor = 0;
  let out = src;

  while (true) {
    // find the next .from('<monster>_definitions') at or after cursor
    // Both spellings appear in these repos: .from('x_definitions') and
    // .from('x_definitions' as any) where the generated DB types lag behind.
    let best = -1, bestTable = null, bestLen = 0;
    for (const t of TABLES) {
      for (const needle of [`.from('${t}')`, `.from('${t}' as any)`]) {
        const i = out.indexOf(needle, cursor);
        if (i !== -1 && (best === -1 || i < best)) { best = i; bestTable = t; bestLen = needle.length; }
      }
    }
    if (best === -1) break;

    const afterFrom = best + bestLen;
    // the chained call that follows: .select / .upsert / .update / .insert / .delete
    const rest = out.slice(afterFrom);
    const m = rest.match(/^\s*\.(select|upsert|update|insert|delete)\s*\(/);
    if (!m) {
      skipped.push(`${file}: .from('${bestTable}') not followed by a recognised call`);
      cursor = afterFrom;
      continue;
    }
    if (m[1] !== 'select') {
      skipped.push(`${file}: .${m[1]}() on ${bestTable} - left for manual edit`);
      cursor = afterFrom;
      continue;
    }

    const openIdx = afterFrom + m[0].length - 1;
    const closeIdx = matchParen(out, openIdx);
    if (closeIdx === -1) { cursor = afterFrom; continue; }

    // already scoped?
    if (/^\s*\.eq\(\s*'game'/.test(out.slice(closeIdx))) { cursor = closeIdx; continue; }

    // reuse the indentation of the .select line
    const lineStart = out.lastIndexOf('\n', openIdx) + 1;
    const indent = (out.slice(lineStart).match(/^[ \t]*/) || [''])[0];

    out = out.slice(0, closeIdx) + `\n${indent}.eq('game', GAME_ID)` + out.slice(closeIdx);
    edits++;
    cursor = closeIdx + 24;
  }

  if (edits > 0) {
    if (!/from '@\/config\/game'/.test(out)) {
      const lines = out.split('\n');
      let last = -1;
      for (let i = 0; i < Math.min(lines.length, 60); i++) if (/^import /.test(lines[i])) last = i;
      lines.splice(last + 1, 0, "import { GAME_ID } from '@/config/game';");
      out = lines.join('\n');
    }
    totalFiles++; totalEdits += edits;
    console.log(`${write ? 'WROTE' : 'would edit'}  ${file}  (+${edits})`);
    if (write) writeFileSync(file, out);
  }
}

console.log(`\n${totalEdits} read(s) scoped across ${totalFiles} file(s).`);
if (skipped.length) { console.log('\nLeft for manual review:'); for (const s of skipped) console.log('  ' + s); }
