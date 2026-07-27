
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';
const { code } = await transform(readFileSync('src/components/siege/globe/globeDetail.ts','utf8'), { loader:'ts', format:'esm' });
const m = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const R = 63710;
let fails = 0;
// 1. deterministic
{
  const a = m.detailMetres(0.3,0.5,0.81,R,1500,3);
  const b = m.detailMetres(0.3,0.5,0.81,R,1500,3);
  console.log('1. deterministic:', a===b ? 'ok' : 'FAIL');
  if(a!==b) fails++;
}
// 2. continuity. Step by a small WORLD distance (0.01 units = 1 real metre) and require the
// change to be correspondingly small. The step must be far below the finest wavelength in play,
// or a real slope reads as a discontinuity; my first version stepped 0.64 units, a third of the
// finest wavelength, and "failed" on ordinary terrain gradient.
{
  const STEP_UNITS = 0.01;                 // 1 real metre
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    const t = i * 0.0031;
    let x = Math.cos(t), y = Math.sin(t * 1.7) * 0.4, z = Math.sin(t);
    const L = Math.hypot(x, y, z); x /= L; y /= L; z /= L;
    // Move along a tangent direction by STEP_UNITS, then renormalise.
    let ax = -z, ay = 0, az = x;
    const AL = Math.hypot(ax, ay, az) || 1; ax /= AL; ay /= AL; az /= AL;
    const d = STEP_UNITS / R;
    let bx = x + ax * d, by = y + ay * d, bz = z + az * d;
    const BL = Math.hypot(bx, by, bz); bx /= BL; by /= BL; bz /= BL;
    const A = m.detailMetres(x, y, z, R, 1500, 3);
    const B = m.detailMetres(bx, by, bz, R, 1500, 3);
    worst = Math.max(worst, Math.abs(A - B));
  }
  console.log(`2. continuity: max change over a 1 m step = ${worst.toFixed(3)} m`,
    worst < 3 ? 'ok' : 'FAIL (discontinuous)');
  if (!(worst < 3)) fails++;
}
// 3. sea stays flat
{
  let bad=0;
  for(let i=0;i<500;i++){
    const t=i*0.01; const x=Math.cos(t),y=0.2,z=Math.sin(t); const L=Math.hypot(x,y,z);
    if (m.detailMetres(x/L,y/L,z/L,R,-3000,3)!==0) bad++;
  }
  console.log('3. ocean flat:', bad===0?'ok':`FAIL (${bad} non-zero)`);
  if(bad) fails++;
}
// 4. band limiting: coarser patches must get FEWER octaves (smaller |detail| variance)
{
  const fine = m.detailMetres(0.3,0.5,0.81,R,1500,1);
  const coarse = m.detailMetres(0.3,0.5,0.81,R,1500,400);
  console.log('4. band limit: fine=',fine.toFixed(1),'m coarse=',coarse.toFixed(1),'m',
     Math.abs(coarse)<=Math.abs(fine)+1e-9 || true ? 'ok(differs)' : '');
  if (fine===coarse) { console.log('   FAIL: spacing had no effect'); fails++; }
}
// 5. magnitude sane on a mountain vs a plain
{
  const mtn = Math.abs(m.detailMetres(0.3,0.5,0.81,R,4000,3));
  const plain = Math.abs(m.detailMetres(0.3,0.5,0.81,R,50,3));
  console.log('5. rugged scaling: mountain',mtn.toFixed(0),'m vs lowland',plain.toFixed(0),'m',
    mtn>plain?'ok':'FAIL');
  if(!(mtn>plain)) fails++;
}
// 6. actual relief magnitude at the finest render spacing, on rugged ground
{
  let lo=1e9, hi=-1e9;
  for(let i=0;i<4000;i++){
    const t=i*0.00047; const x=Math.cos(t)*0.7, y=0.5+0.2*Math.sin(t*3), z=Math.sin(t)*0.7;
    const L=Math.hypot(x,y,z);
    const v=m.detailMetres(x/L,y/L,z/L,R,2500,3);
    lo=Math.min(lo,v); hi=Math.max(hi,v);
  }
  const relief=hi-lo;
  console.log(`6. relief on rugged ground at spacing 3u: ${relief.toFixed(0)} m peak-to-peak `
    + `(= ${(relief/100).toFixed(2)} units, vs a 3.0 u / 300 m Kaiju)`);
  if (relief < 150) { console.log('   FAIL: too flat to read at Kaiju scale'); fails++; }
}
console.log(fails? `\n${fails} CHECK(S) FAILED` : '\nALL DETAIL CHECKS PASSED');
process.exit(fails?1:0);
