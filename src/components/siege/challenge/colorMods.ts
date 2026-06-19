// colorMods — the SHARED monster recolour shader, used by BOTH the Challenge Creator preview and the
// in-game MonsterEnemy so they look identical. Pipeline per fragment: hue-rotate (around the grey
// axis) → saturation (0 grey · 1 normal · 2 oversaturated) → tint via a selectable Photoshop-style
// BLEND MODE at `tintAmt` strength. Inject onto a cloned MeshStandardMaterial with injectRecolor()
// and drive it live with setRecolor().
import * as THREE from 'three';
import type { ColorMods } from './challengeTypes';

// Order defines the integer the shader switches on — keep in sync with the GLSL below.
export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'hard light', 'soft light', 'add', 'darken', 'lighten', 'difference',
] as const;
export type BlendMode = typeof BLEND_MODES[number];
export const blendIndex = (m?: string): number => { const i = BLEND_MODES.indexOf((m ?? 'normal') as BlendMode); return i < 0 ? 0 : i; };

export interface RecolorUniforms {
  uHue: { value: number }; uSat: { value: number }; uTint: { value: THREE.Color }; uTintAmt: { value: number }; uBlend: { value: number };
}
export const makeRecolorUniforms = (): RecolorUniforms => ({
  uHue: { value: 0 }, uSat: { value: 1 }, uTint: { value: new THREE.Color('#ffffff') }, uTintAmt: { value: 0 }, uBlend: { value: 0 },
});
/** Push a ColorMods into live uniforms (no recompile). */
export function setRecolor(u: RecolorUniforms, c: ColorMods): void {
  u.uHue.value = (c.hue * Math.PI) / 180;
  u.uSat.value = c.sat / 100;
  u.uTint.value.set(c.tint);
  u.uTintAmt.value = c.tintAmt / 100;
  u.uBlend.value = blendIndex(c.blend);
}

const BLEND_FUNC = `vec3 _cmBlend(vec3 b, vec3 t, int m){
  if(m==1) return b*t;                                                   // multiply
  if(m==2) return 1.0-(1.0-b)*(1.0-t);                                   // screen
  if(m==3) return mix(2.0*b*t, 1.0-2.0*(1.0-b)*(1.0-t), step(0.5,b));    // overlay
  if(m==4) return mix(2.0*b*t, 1.0-2.0*(1.0-b)*(1.0-t), step(0.5,t));    // hard light
  if(m==5){ vec3 d = mix(((16.0*b-12.0)*b+4.0)*b, sqrt(b), step(0.25,b));
            return mix(b-(1.0-2.0*t)*b*(1.0-b), b+(2.0*t-1.0)*(d-b), step(0.5,t)); } // soft light
  if(m==6) return min(b+t,1.0);                                         // add (linear dodge)
  if(m==7) return min(b,t);                                             // darken
  if(m==8) return max(b,t);                                             // lighten
  if(m==9) return abs(b-t);                                            // difference
  return t;                                                            // normal
}`;
const DECL = 'uniform float uHue;\nuniform float uSat;\nuniform vec3 uTint;\nuniform float uTintAmt;\nuniform int uBlend;\n' + BLEND_FUNC + '\n';
const BODY =
  '{ vec3 _c = gl_FragColor.rgb;'
  + ' if (uHue != 0.0) { vec3 _k = vec3(0.57735); float _cs = cos(uHue), _sn = sin(uHue); _c = _c*_cs + cross(_k,_c)*_sn + _k*dot(_k,_c)*(1.0-_cs); }'
  + ' float _l = dot(_c, vec3(0.299,0.587,0.114));'
  + ' _c = mix(vec3(_l), _c, uSat);'
  + ' _c = clamp(_c, 0.0, 1.0);'   // keep blend inputs in [0,1] — saturation>1 can push a channel negative, and soft-light sqrt(neg) = NaN
  + ' _c = mix(_c, _cmBlend(_c, uTint, uBlend), uTintAmt);'
  + ' gl_FragColor.rgb = clamp(_c, 0.0, 1.0); }';

/** Inject the recolour pipeline onto a material; returns the live uniforms to drive with setRecolor. */
export function injectRecolor(m: THREE.MeshStandardMaterial): RecolorUniforms {
  const u = makeRecolorUniforms();
  m.customProgramCacheKey = () => `cmcol_${m.map ? 1 : 0}_${m.emissiveMap ? 1 : 0}`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHue = u.uHue; shader.uniforms.uSat = u.uSat; shader.uniforms.uTint = u.uTint;
    shader.uniforms.uTintAmt = u.uTintAmt; shader.uniforms.uBlend = u.uBlend;
    shader.fragmentShader = DECL + shader.fragmentShader;
    if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + BODY);
    }
  };
  m.needsUpdate = true;
  return u;
}
