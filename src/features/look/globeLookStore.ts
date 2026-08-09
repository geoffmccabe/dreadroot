// globeLookStore — every Mini Earth lighting knob, live, persisted, and OFF by default.
//
// Geoff: "give me the power to turn them on/off and adjust them, so they don't kill the game, and we
// can see which is doing what, and try to adjust them. That makes the most sense to me."
//
// It does, and it is the direct answer to what went wrong last time. Six lighting changes shipped in
// one commit, every one of them affecting the whole screen — so when the screen came back white
// there were six suspects and no way to separate them except by guessing, which I did, four times,
// wrongly. A panel turns that into a ten second answer: switch things off until it is right, and
// whatever you just switched off is the culprit.
//
// TWO RULES HOLD THIS TOGETHER.
//
// EVERYTHING DEFAULTS TO OFF. Shipping this cannot change what anyone sees. There is no "improved
// lighting" being applied to the map today — there is a set of switches, all down. That is what
// makes it safe to land the whole batch at once, which is the opposite of last time for exactly the
// reason last time failed.
//
// NOTHING IS HARDCODED IN THE RENDERERS. Every value the lighting uses is read from here each
// frame. So there is no second copy of the truth to drift, and no change that needs a deploy to try.
//
// Same shape as lookStore (subscribe + getSnapshot for useSyncExternalStore, persisted to
// localStorage), because that pattern already works in this codebase and a second one would be a
// second thing to maintain.

import { useSyncExternalStore } from 'react';

export interface GlobeLookState {
  /** MASTER SWITCH. Off = the map renders exactly as it did before any of this existed. */
  enabled: boolean;

  // --- THE FLAT FILL ------------------------------------------------------------------------------
  // The globe is classed as a "blank" map, which adds a bright directionless fill on top of the
  // world's own ambient — over 1.0 in total. Directionless light cannot make a bright side and a
  // dark side, so nothing has form. This is the single biggest cause of "washed out", and it is a
  // slider rather than a deletion so the difference can be seen rather than argued about.
  fillAmbient: number;
  fillHemi: number;

  // --- THE SUN ------------------------------------------------------------------------------------
  sunOn: boolean;
  sunIntensity: number;
  /** Degrees above the local horizon. Low is golden hour: long shadows, raking light. */
  sunElevation: number;
  /** Compass bearing, 0 = north. Which way the light comes from where you are standing. */
  sunBearing: number;
  /** 0 = white, 1 = deep orange. A low sun is warm because the blue has been scattered out of it. */
  sunWarmth: number;
  /** Sky bounce. What lights the shadow side of anything outdoors, and why that side reads blue. */
  skyBounce: number;

  // --- SHADOWS ------------------------------------------------------------------------------------
  shadowsOn: boolean;
  /** How many metres across the shadow map covers. Smaller = sharper but a smaller area. */
  shadowSpanM: number;
  /** Soft edges cost a few extra taps and are the difference between a shadow and a stain. */
  shadowSoft: boolean;

  // --- HAZE ---------------------------------------------------------------------------------------
  hazeOn: boolean;
  /** Visibility at sea level, in km. Aerial perspective is what makes a landscape feel vast. */
  hazeVisibilityKm: number;
  /** Above this altitude there is no haze at all. Get this wrong and the planet fogs white. */
  hazeCeilingKm: number;

  // --- THE GRADE ----------------------------------------------------------------------------------
  gradeOn: boolean;
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;

  // --- THE GROUND ---------------------------------------------------------------------------------
  /**
   * Swap MeshLambertMaterial for an extended MeshStandardMaterial.
   *
   * The single biggest visual change and the single biggest risk, kept on its own switch. Standard
   * responds to scene.environment, which Lambert largely ignores, so turning this on brightens
   * everything by itself — expect to retune the sun after it, not before.
   */
  terrainPbr: boolean;
  /** Procedural detail strength. 0 = flat vertex colour, as it is today. */
  terrainDetail: number;
  /** Fake surface relief. The thing that makes light rake across rock instead of sliding over it. */
  terrainNormal: number;
  /** Horizontal rock banding on steep ground. What makes a canyon read as a canyon. */
  terrainStrata: number;
  /** Metres per sedimentary band. */
  terrainStrataM: number;
  /** Cavity darkening — ambient occlusion, in world space, from the noise field itself. */
  terrainCavity: number;
  /**
   * How much of the scene's environment map lights the ground.
   *
   * THE PRIME SUSPECT FOR "PBR MAKES EVERYTHING WHITE", and the one thing MeshStandardMaterial does
   * that MeshLambertMaterial never did. EnvironmentIBL puts a pre-filtered RoomEnvironment — a
   * brightly lit white box — into scene.environment. Lambert ignores environment maps entirely, so
   * it has always been free; Standard does not, so swapping the material silently adds a large flat
   * white ambient across the entire ground with nothing on the panel to explain it.
   *
   * Defaults to 0, so turning PBR on changes the SURFACE and nothing else. Raise it if the ground
   * looks too dark in shadow — that is what it is for — but it is the first thing to check if the
   * screen goes white.
   */
  terrainEnv: number;
  /** Straight brightness multiplier on the ground's albedo. The blunt instrument, deliberately. */
  terrainBrightness: number;

  // --- CLOUDS -------------------------------------------------------------------------------------
  /**
   * Known to be broken, and left switchable so that can be SEEN rather than taken on trust.
   *
   * The camera's near plane can be 3 cm while its far plane is hundreds of thousands of units, and a
   * depth buffer spanning that has almost no precision past a few hundred units — so a transparent
   * shell at planetary distance wins depth tests it should lose and paints over the world.
   */
  cloudsOn: boolean;
  cloudCoverage: number;
  cloudOpacity: number;

  // --- RESOLUTION ---------------------------------------------------------------------------------
  /**
   * The Canvas is created at dpr 1 with antialiasing off, so on a Retina display the game draws at
   * half the screen's resolution and stretches it up. That is a blur filter over everything, before
   * any lighting question. 1 = as shipped; 2 = native, at four times the pixels.
   */
  dpr: number;
}

/**
 * DEFAULTS ARE "EXACTLY AS IT IS TODAY".
 *
 * fillAmbient 0.7 and fillHemi 0.6 are the values the blank-map fill actually uses, so the sliders
 * start where the game is rather than at some neutral position — moving one is then a change you can
 * see and undo, not a jump.
 */
export const GLOBE_LOOK_DEFAULTS: GlobeLookState = {
  enabled: false,

  fillAmbient: 0.7,
  fillHemi: 0.6,

  sunOn: true,
  sunIntensity: 2.4,
  sunElevation: 14,
  sunBearing: 205,
  sunWarmth: 0.55,
  skyBounce: 0.55,

  shadowsOn: true,
  shadowSpanM: 3000,
  shadowSoft: true,

  hazeOn: true,
  hazeVisibilityKm: 160,
  hazeCeilingKm: 8,

  gradeOn: true,
  exposure: 0.92,
  contrast: 0.16,
  saturation: -0.10,
  vignette: 0.62,

  terrainPbr: false,
  terrainDetail: 0.5,
  terrainNormal: 0.8,
  terrainStrata: 0.85,
  terrainStrataM: 55,
  terrainCavity: 0.34,
  terrainEnv: 0,
  terrainBrightness: 1,

  cloudsOn: false,
  cloudCoverage: 0.42,
  cloudOpacity: 0.85,

  dpr: 1,
};

const KEY = 'dreadroot.globelook.v1';

function load(): GlobeLookState {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(KEY);
    // Spread the defaults UNDER the saved values: a stored blob from an older build is missing any
    // key added since, and without this those come back undefined and land in a shader as NaN.
    if (raw) return { ...GLOBE_LOOK_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* corrupt or blocked storage is not worth failing over */ }
  return { ...GLOBE_LOOK_DEFAULTS };
}

let state: GlobeLookState = load();
const listeners = new Set<() => void>();

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export const globeLookStore = {
  get: (): GlobeLookState => state,
  set: <K extends keyof GlobeLookState>(key: K, value: GlobeLookState[K]) => {
    if (state[key] === value) return;
    state = { ...state, [key]: value };
    persist();
    listeners.forEach((l) => l());
  },
  reset: () => {
    state = { ...GLOBE_LOOK_DEFAULTS };
    persist();
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function useGlobeLook(): GlobeLookState {
  return useSyncExternalStore(globeLookStore.subscribe, globeLookStore.get, globeLookStore.get);
}

/**
 * Read the live values WITHOUT subscribing.
 *
 * For frame loops. A useFrame callback that re-rendered its component on every slider change would
 * be paying React for something it can simply read, and this is called sixty times a second.
 */
export const globeLook = (): GlobeLookState => state;
