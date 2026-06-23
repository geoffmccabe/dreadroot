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
    // spring upward into the glide pose (+3.0 m over 0.5 s)
    launch: { clip: 'Glide', loop: true, lift: 6.0, drift: 1.0, duration: 0.5, fade: 0.15, next: 'glide' },
    // hold the cloak-glide, drifting forward and sinking back to ~ground over 2.6 s
    glide:  { clip: 'Glide', loop: true, lift: -1.15, drift: 1.2, duration: 2.6, fade: 0.3, next: 'land' },
    // ending A: land on flat ground (Jumping Down has a landing crouch)
    land:   { clip: 'Jumping Down', loop: false, lift: 0, fade: 0.2 },
    // ending B: no flat ground → cling to a wall
    wall:   { clip: 'Climbing Up Wall', loop: false, lift: 0, fade: 0.2 },
  },
};
