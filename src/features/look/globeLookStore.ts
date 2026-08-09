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

  /**
   * SCALES EVERY LIGHT ON THE MAP THAT IS NOT MINE.
   *
   * Geoff: "it's supposed to be a night scene but it's very bright... You added a sun but even when
   * I turn it off everything is too bright. I tried all the settings but there's no way to make it
   * look like a night scene."
   *
   * Because the panel did not control the lights that were doing it. SiegeWorldScene adds an
   * ambient at 0.35, a hemisphere at 0.6 and a directional at 1.1 to EVERY world, and none of them
   * were on the panel — so switching my sun off left the map lit by somebody else's midday.
   *
   * 1 = untouched, 0 = they contribute nothing. Same technique NightDimmer already uses on the
   * SciFi City map, which is the proof it works here.
   */
  worldLights: number;

  /**
   * The sky dome and the background colour.
   *
   * SiegeWorldScene also paints a light blue background and a drei <Sky> configured for midday, at
   * 45,000 units. No amount of dimming the LIGHTS touches either: they are not lit, they ARE the
   * brightness. A night scene has to switch them off, which is what 'night' does — dark background,
   * day dome hidden, and the starfield finally visible for what it is.
   */
  skyMode: 'default' | 'night';

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

  worldLights: 1,
  skyMode: 'default',

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
    //
    // `enabled` IS DELIBERATELY NOT RESTORED. Geoff: "Now the Kaijus startup with the kaiju and the
    // planet and the space, is all ruined... and I didn't ask you to fuck that up."
    //
    // He is right, and this is the structural answer rather than another guess at a value. Every
    // TUNING value persists, so a look survives a reload and can be shared — but the master switch
    // starts DOWN every session. That makes one thing true and keeps it true: loading the game gives
    // you the game exactly as it has always been, whatever was left switched on last time, whatever
    // a preset once wrote, whatever I get wrong next. Nothing in this feature can reach a fresh
    // start-up any more.
    if (raw) return { ...GLOBE_LOOK_DEFAULTS, ...JSON.parse(raw), enabled: false };
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

/**
 * WHOLE LOOKS, IN ONE CLICK.
 *
 * Fifteen sliders is the right amount of control and the wrong amount of work to reach a starting
 * point. Each of these is a complete, coherent set — the thing to do is pick the nearest one and
 * then adjust, rather than build a look from defaults every time.
 */
export const GLOBE_LOOK_PRESETS: { key: string; label: string; values: Partial<GlobeLookState> }[] = [
  {
    key: 'night',
    label: 'Night',
    values: {
      // The world's own lights nearly off — this is the setting that makes night POSSIBLE, and
      // nothing else on the panel can substitute for it.
      worldLights: 0.06,
      skyMode: 'night',
      fillAmbient: 0.02,
      fillHemi: 0.04,
      // MOONLIGHT. A real moon is about a 400,000th of the sun and reads cool because the eye's
      // colour response falls away in the dark, not because moonlight is actually blue — but on a
      // screen, cool IS how night reads, so the convention is worth keeping.
      // THE KEY LIGHT IS THE MOON. Geoff: "I have to leave the sun on for it to work. If I turn
      // the sun off then the tops of the buildings turn white." Both halves make sense: with the
      // key off the only thing left is hemisphere light, which comes from straight overhead — so it
      // lands squarely on every roof and nowhere else, and blows the tops out while the walls stay
      // black. A night scene still needs a key; it is just a dim, cool, high one.
      sunOn: true,
      sunIntensity: 0.28,
      sunElevation: 52,
      sunWarmth: 0,
      // Very low, for the reason above: hemisphere light is what whitens roofs.
      skyBounce: 0.03,
      shadowsOn: true,
      // Long, soft shadows are most of what makes a night exterior look expensive.
      shadowSoft: true,
      hazeOn: true,
      hazeVisibilityKm: 90,
      gradeOn: true,
      // Exposure LOW: the whole point is that the lit windows are the brightest thing on screen,
      // and they cannot be if the sky is competing with them.
      exposure: 0.55,
      contrast: 0.22,
      saturation: -0.05,
      vignette: 0.75,
    },
  },
  {
    key: 'twilight',
    label: 'Twilight',
    values: {
      worldLights: 0.18,
      skyMode: 'night',
      fillAmbient: 0.06,
      fillHemi: 0.14,
      sunOn: true,
      sunIntensity: 0.9,
      sunElevation: -2,
      sunBearing: 285,
      sunWarmth: 1,
      skyBounce: 0.22,
      shadowsOn: true,
      shadowSoft: true,
      hazeOn: true,
      hazeVisibilityKm: 70,
      gradeOn: true,
      exposure: 0.7,
      contrast: 0.2,
      saturation: 0.05,
      vignette: 0.7,
    },
  },
  {
    key: 'golden',
    label: 'Golden hour',
    values: {
      worldLights: 0.12,
      skyMode: 'default',
      fillAmbient: 0.05,
      fillHemi: 0.2,
      sunOn: true,
      sunIntensity: 2.6,
      sunElevation: 9,
      sunWarmth: 0.85,
      skyBounce: 0.35,
      shadowsOn: true,
      shadowSoft: true,
      hazeOn: true,
      hazeVisibilityKm: 120,
      gradeOn: true,
      exposure: 0.9,
      contrast: 0.18,
      saturation: -0.05,
      vignette: 0.6,
    },
  },
  {
    key: 'day',
    label: 'Midday',
    values: {
      worldLights: 0.25,
      skyMode: 'default',
      fillAmbient: 0.1,
      fillHemi: 0.35,
      sunOn: true,
      sunIntensity: 3.2,
      sunElevation: 62,
      sunWarmth: 0.15,
      skyBounce: 0.5,
      shadowsOn: true,
      shadowSoft: true,
      hazeOn: true,
      hazeVisibilityKm: 200,
      gradeOn: true,
      exposure: 1.0,
      contrast: 0.12,
      saturation: -0.05,
      vignette: 0.45,
    },
  },
];

/**
 * Apply a preset's VALUES. Never switches the master on by itself.
 *
 * It used to, which is how pressing B3 for Dubai silently turned the whole system on and then kept
 * it on for every session afterwards. Setting sliders is a different act from taking over the
 * lighting, and only one of those is something to do without being asked.
 */
export function applyGlobePreset(key: string): void {
  const p = GLOBE_LOOK_PRESETS.find((x) => x.key === key);
  if (!p) return;
  state = { ...state, ...p.values };
  persist();
  listeners.forEach((l) => l());
}

/**
 * The current settings as JSON, for pasting into a conversation.
 *
 * Geoff: "I need a COPY button for all the settings, so that if I get some setting I like then I
 * can paste them to you so that you can define that as a preset."
 *
 * Exactly the right ask, and the panel's existing Copy button does not do it — that one belongs to
 * the old fog and day/night section and copies fogStartPct, visualDistance and the cycle state. It
 * has no idea the Mini Earth settings exist, which is why a copied "look" came back describing
 * something else entirely.
 *
 * Formatted as the literal preset object, so a good look can be pasted straight into
 * GLOBE_LOOK_PRESETS with no translation step and nothing lost between the two.
 */
export function globeLookToJson(): string {
  const { enabled: _enabled, ...values } = state;
  return JSON.stringify({ globeLook: values }, null, 2);
}

/** Apply a pasted settings blob. Unknown or missing keys keep their current value. */
export function globeLookFromJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    const values = (parsed?.globeLook ?? parsed) as Partial<GlobeLookState>;
    if (!values || typeof values !== 'object') return false;
    // Only take keys that exist, so a blob from the OTHER copy button cannot half-apply itself and
    // leave the panel in a state nothing produced.
    const next: Partial<GlobeLookState> = {};
    for (const k of Object.keys(GLOBE_LOOK_DEFAULTS) as (keyof GlobeLookState)[]) {
      if (k in values && typeof values[k] === typeof GLOBE_LOOK_DEFAULTS[k]) {
        (next as Record<string, unknown>)[k] = values[k];
      }
    }
    if (Object.keys(next).length === 0) return false;
    state = { ...state, ...next };
    persist();
    listeners.forEach((l) => l());
    return true;
  } catch { return false; }
}

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
