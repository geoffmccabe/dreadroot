// Universal effects module — shared types.
//
// An EffectRecipe is pure DATA (it can come from the DB or a hardcoded
// fallback). It describes one variant of smoke / steam / glitter / gas. The
// renderer (a backend) interprets it. See docs/EFFECTS_MODULE_*.md.

export type QualityTier = 'low' | 'med' | 'high';

export interface EffectRecipe {
  /** Stable slug, e.g. 'fire-smoke'. */
  code: string;
  /** smoke | steam | glitter | gas | spark | mist — informational grouping. */
  family: string;
  /** Which renderer backend draws it. Phase 1: only 'billboard'. */
  backend: 'billboard';
  /** 'alpha' (thick smoke) or 'additive' (glitter / bright steam, no sort). */
  blend: 'alpha' | 'additive';

  // ── Lifecycle ──
  /** Seconds a puff lives (persistence). */
  lifetime: number;
  /** Puffs/sec emitted by a continuous emitter. */
  spawnRate: number;
  /** Initial scatter radius (m) around the spawn point. */
  spread: number;

  // ── Motion ──
  /** Upward speed (m/s). */
  rise: number;
  /** Downward pull (m/s²). +sinks (heavy gas), 0 = pure rise. */
  gravity: number;
  /** Global horizontal drift (m/s), [x, z]. */
  wind: [number, number];
  /** Turbulence amplitude (m) and frequency (Hz-ish). */
  flutterAmp: number;
  flutterFreq: number;
  /** Per-particle rotation rate (rad/s). */
  spin: number;

  // ── Look ──
  /** Start/end size (m); smoke grows as it rises. */
  size0: number;
  size1: number;
  /** Start/end opacity (0..1). */
  opacity0: number;
  opacity1: number;
  /** Start/end tint (hex). */
  color0: string;
  color1: string;

  // ── Culling / budget ──
  /** Beyond this (m) nothing emits or renders. */
  cullDistance: number;
  /** Distance fade band (m). */
  fadeStart: number;
  fadeEnd: number;
  /** Significance weight (0..1) for emitter eviction under budget. */
  importance: number;
  /** Optional per-recipe instance cap override (else engine default). */
  maxInstances?: number;

  // ── Spiral add-on (toggle layer) ──
  // A second, sparser layer of larger spinning inward-spirals laid on top of the
  // soft puffs, slightly lighter than the base grey, fading with the smoke.
  /** Enable the spiral layer. */
  spiral?: boolean;
  /** Spirals/sec (sparser than the body puffs). */
  spiralRate?: number;
  /** Spiral puff start/end size (m) — bigger than body puffs so the spiral reads. */
  spiralSize0?: number;
  spiralSize1?: number;
  /** Peak spiral opacity (fades to 0 with life). */
  spiralOpacity?: number;
  /** How much lighter than the base grey the spiral arm is (0..1 added). */
  spiralLighten?: number;
  /** Number of revolutions the spiral winds inward. */
  spiralTurns?: number;
  /** Spin period range (seconds per revolution), randomized per spiral. */
  spiralSpinMinSec?: number;
  spiralSpinMaxSec?: number;
}

/** Handle to a running continuous emitter (e.g. attached to a burning enemy). */
export interface EffectEmitter {
  stop(): void;
}

/** Public API exposed by EffectsRoot via ref. */
export interface EffectsHandle {
  /** One fire-and-forget puff at a world point. */
  emitPuff(code: string, pos: import('three').Vector3): void;
  /** N puffs at once (explosion poof, glitter pop). */
  emitBurst(code: string, pos: import('three').Vector3, count: number): void;
  /** A source that drops puffs at its current position until stopped.
   *  getPos writes the live world position into `out`, returns false if the
   *  source is momentarily gone (skips that frame, keeps the emitter). */
  createEmitter(
    code: string,
    getPos: (out: import('three').Vector3) => boolean,
    importance?: number,
  ): EffectEmitter;
  /** Global quality tier (caps + spawn-rate scale). */
  setQuality(q: QualityTier): void;
  /** Live-update an already-running pool's look from an edited recipe (admin
   *  panel preview). No-op if that recipe has no live pool yet. */
  updateRecipe(recipe: EffectRecipe): void;
  /** Show/hide a live preview cloud in front of the camera (admin panel). Pass a
   *  recipe to show + live-edit it, or null to stop the preview. */
  setPreview(recipe: EffectRecipe | null): void;
}
