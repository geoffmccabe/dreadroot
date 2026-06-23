// animFSM — a tiny, reusable, DATA-DRIVEN animation state machine. You describe a sequence ONCE as
// a graph (states + which clip each plays + how they advance + optional root motion), and the FSM
// runs it: crossfades between clips, times each state, and reports a vertical/forward offset so the
// caller can move the character (for flight, jumps, etc.). It drives a pre-built actions map (from
// drei's useAnimations) — it does NOT own a mixer — so it composes with the normal lineup playback.
//
// This is the engine behind "I don't want to describe every transition": new sequences (rifle,
// parkour, combat) are just more graphs like FLIGHT_GRAPH, not new code.
import * as THREE from 'three';

export interface AnimStateDef {
  clip: string;          // clip name in the shared animation library
  loop?: boolean;        // loop while in this state (default false = play once)
  timeScale?: number;    // playback speed (default 1)
  lift?: number;         // metres/sec applied to root Y while in this state (+up / -down)
  drift?: number;        // metres/sec applied forward while in this state
  duration?: number;     // seconds before advancing (default = the clip's own length)
  fade?: number;         // crossfade seconds entering this state (default 0.25)
  next?: string;         // state to enter when this one finishes (omit = sequence ends)
}
export interface AnimGraph {
  initial: string;
  states: Record<string, AnimStateDef>;
}

type Actions = Record<string, THREE.AnimationAction | null>;
// Optional hook: when a state finishes, decide the next state (e.g. raycast → land vs wall-stick).
export type ForkResolver = (state: string) => string | null;

export class AnimFSM {
  private cur: string | null = null;
  private t = 0;
  offsetY = 0;
  offsetZ = 0;
  onDone?: () => void;

  constructor(private actions: Actions, private graph: AnimGraph, private fork?: ForkResolver) {}

  get active(): boolean { return this.cur !== null; }
  start(): void { this.offsetY = 0; this.offsetZ = 0; this.enter(this.graph.initial); }
  stop(): void { this.cur = null; }

  private enter(name: string): void {
    const def = this.graph.states[name];
    if (!def) { this.cur = null; this.onDone?.(); return; }
    const a = this.actions[def.clip];
    if (a) {
      const prevDef = this.cur ? this.graph.states[this.cur] : null;
      const prevA = prevDef ? this.actions[prevDef.clip] : null;
      a.reset();
      a.setLoop(def.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !def.loop;
      a.timeScale = def.timeScale ?? 1;
      a.enabled = true;
      if (prevA && prevA !== a) { a.crossFadeFrom(prevA, def.fade ?? 0.25, false); a.play(); }
      else a.fadeIn(def.fade ?? 0.2).play();
    }
    this.cur = name; this.t = 0;
  }

  tick(dt: number): void {
    if (!this.cur) return;
    const def = this.graph.states[this.cur];
    this.t += dt;
    if (def.lift) this.offsetY += def.lift * dt;
    if (def.drift) this.offsetZ += def.drift * dt;
    const dur = def.duration ?? (this.actions[def.clip]?.getClip().duration ?? 1);
    if (this.t >= dur) {
      const next = this.fork?.(this.cur) ?? def.next ?? null;
      if (next) this.enter(next); else { this.cur = null; this.onDone?.(); }
    }
  }
}
