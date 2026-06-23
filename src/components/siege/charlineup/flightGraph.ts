// flightGraph — the flight sequence as DATA (the proof for the data-driven FSM). Jump up → settle
// into the cloak glide → then a decision fork: land on flat ground, or stick to a wall. The fork
// resolver (in the lineup) picks LAND vs WALL; in the demo we expose both so you can see each.
//
// This whole behaviour is ~25 lines of data. Adding "rifle aim/fire/reload" or "parkour vault" later
// is another graph just like this — no new engine code.
import { AnimGraph } from './animFSM';

export const FLIGHT_GRAPH: AnimGraph = {
  initial: 'launch',
  states: {
    // run off the edge + jump out (real Mixamo clip, plays once); FSM adds the up+forward arc
    launch: { clip: 'Jump_Out_To_Glide', loop: false, lift: 4.0, drift: 2.4, fade: 0.15, next: 'glide' },
    // crossfade (fade:0.35) smoothly interpolates every bone from the jump's end pose into the
    // glide pose — that's the "transition" between them, no hand-posing needed. Then hold the glide.
    glide:  { clip: 'Gliding', loop: true, lift: -0.8, drift: 2.4, duration: 3.0, fade: 0.35, next: 'land' },
    // ending A: land on flat ground (Jumping Down has a landing crouch)
    land:   { clip: 'Jumping Down', loop: false, lift: 0, fade: 0.25 },
    // ending B: no flat ground → cling to a wall
    wall:   { clip: 'Climbing Up Wall', loop: false, lift: 0, fade: 0.25 },
  },
};
