// locomotionClips — maps abstract MOVEMENT STATES to concrete clip names, per "clip set". The
// locomotion controller + parkour graphs reference these slots, never raw clip names, so the SAME
// movement logic drives a rifle-armed character today and an unarmed one later — you just swap the
// clip set. A null slot = "we don't have that animation yet" (a deliberate space to fill); the
// controller skips gracefully to the nearest available clip instead of breaking.
//
// Slots are the common-sense locomotion vocabulary: stand, move in 8 directions at two speeds, turn
// in place, plus the AIR/parkour set (takeoff, falling, land, vault-over, climb-onto, crawl).

export interface LocomotionClipSet {
  idle: string | null;
  walkF: string | null; walkB: string | null;
  runF: string | null;  runB: string | null;
  strafeL: string | null; strafeR: string | null;       // walk-speed sidestep
  runStrafeL: string | null; runStrafeR: string | null; // run-speed sidestep
  turnL: string | null; turnR: string | null;           // turn in place
  // air / parkour
  jumpUp: string | null;   // takeoff / jump up onto
  fall: string | null;     // falling idle (mid-air hold)  ← OFTEN MISSING, placeholder
  land: string | null;     // landing recovery, then resume
  vault: string | null;    // clear a low+thin obstacle (parkour over)
  climbUp: string | null;  // mantle onto a tall obstacle   ← OFTEN MISSING, placeholder
  crawl: string | null;
}

// RIFLE: a COMPLETE locomotion set — used for the working demo. (Clip names = the rifle library's,
// derived from the Mixamo filenames.) A couple of slots reuse the closest available motion until a
// dedicated clip exists: `fall` borrows the descent of Jump_Down; `vault` uses the dive-roll (a clean
// parkour-over); `climbUp` has no rifle clip yet → null placeholder.
export const RIFLE_LOCOMOTION: LocomotionClipSet = {
  idle:       'Anim_Rifle_Idle_NoSkin',
  walkF:      'Anim_Rifle_Walk_Not_Aiming_NoSkin',
  walkB:      'Anim_Rifle_Backward_Run_NoSkin',   // no walk-back clip; reuse the backward run slowed
  runF:       'Anim_Rifle_Run_NoSkin',
  runB:       'Anim_Rifle_Backward_Run_NoSkin',
  strafeL:    'Anim_Rifle_Strafe_Left_NoSkin',
  strafeR:    'Anim_Rifle_Strafe_Right_NoSkin',
  runStrafeL: 'Anim_Rifle_Run_Left_NoSkin',
  runStrafeR: 'Anim_Rifle_Run_Right_NoSkin',
  turnL:      'Anim_Rifle_Turn_Around_Counter-Clockwise_NoSkin',
  turnR:      'Anim_Rifle_Turn_Around_Clockwise_NoSkin',
  jumpUp:     'Anim_Rifle_Jump_Up_NoSkin',
  fall:       null,                               // ← SPACE: no pure falling-idle rifle clip yet
  land:       'Anim_Rifle_Jump_Down_NoSkin',
  vault:      'Anim_Rifle_Dive_Forward_Roll_NoSkin',
  climbUp:    null,                               // ← SPACE: no rifle mantle clip yet
  crawl:      'Anim_Rifle_Crawl_Backwards_NoSkin',
};

// UNARMED — now backed by the male/female locomotion packs. Ground locomotion is COMPLETE (idle /
// walk / run / strafe at both speeds / turn / jump). Remaining SPACES = backward walk+run, falling
// idle, landing, vault, and dedicated parkour clips — see the gap list the user is filling.
// Falling/landing/backward/crawl are gender-neutral clips shared by both sets. Ground locomotion +
// air recovery are now COMPLETE; `vault`/`climbUp` here stay null because parkour is its own richer
// system (see PARKOUR below) rather than a single slot.
export const UNARMED_MALE: LocomotionClipSet = {
  idle:       'Loco_M_idle',
  walkF:      'Loco_M_walking',
  walkB:      'Anim_Walking_Backward_NoSkin',
  runF:       'Loco_M_running',
  runB:       'Anim_Run_Backward_NoSkin',
  strafeL:    'Loco_M_left_strafe_walking',  strafeR:    'Loco_M_right_strafe_walking',
  runStrafeL: 'Loco_M_left_strafe',          runStrafeR: 'Loco_M_right_strafe',
  turnL:      'Loco_M_left_turn',            turnR:      'Loco_M_right_turn',
  jumpUp:     'Loco_M_jump',
  fall:       'Anim_Idle_Falling_NoSkin',
  land:       'Anim_Hit_Falling_To_Landing_NoSkin',
  vault:      null,                       // parkour handled by PARKOUR (height-aware), not one slot
  climbUp:    'Climbing Up Wall',
  crawl:      'Anim_Crawl_Low_Forward_NoSkin',
};

export const UNARMED_FEMALE: LocomotionClipSet = {
  idle:       'Loco_F_idle',
  walkF:      'Loco_F_walking',
  walkB:      'Anim_Walking_Backward_NoSkin',
  runF:       'Loco_F_running',
  runB:       'Anim_Run_Backward_NoSkin',
  strafeL:    'Loco_F_left_strafe_walk',  strafeR:    'Loco_F_right_strafe_walk',
  runStrafeL: 'Loco_F_left_strafe',       runStrafeR: 'Loco_F_right_strafe',
  turnL:      'Loco_F_left_turn',         turnR:      'Loco_F_right_turn',
  jumpUp:     'Loco_F_jump',
  fall:       'Anim_Idle_Falling_NoSkin',
  land:       'Anim_Hit_Falling_To_Landing_NoSkin',
  vault:      null,
  climbUp:    'Climbing Up Wall',
  crawl:      'Anim_Crawl_Low_Forward_NoSkin',
};

// PARKOUR — height/method-aware clip map for the obstacle detector. The detector measures the
// obstacle ahead (height + depth + whether there's a gap/overhead/ledge) and picks the matching move.
// Clip names carry their meaning (…_Over_1m_Object, …_Over_2m_Object, …_Under_1m…), so the size
// thresholds in the detector line up with the clips we actually have.
export interface ParkourClips {
  vaultLow: string[];   // clear a ~1m obstacle (pick a variety for flavour)
  vaultHigh: string;    // dive over a ~2m obstacle
  slideUnder: string;   // slide under a low overhead (gap below ~1m)
  dropRoll: string;     // drop off a ledge + roll out
  wallRun: string;      // run along a tall wall (too high to vault)
  flourish: string[];   // showy variants (front flips) for open ground
}
export const PARKOUR: ParkourClips = {
  vaultLow: [
    'Anim_Parkour_Run_To_Kick-Jump_Over_1m_Object_NoSkin',
    'Anim_Parkour_Side_Jump_Over_1m_Object_NoSkin',
    'Anim_Parkour_SideFlip_Jump_Over_1m_Object_NoSkin',
  ],
  vaultHigh:  'Anim_Parkour_Run_To_Dive_Over_2m_Object_NoSkin',
  slideUnder: 'Anim_Parkour_Run_To_Backslide_Under_1m_Object_NoSkin',
  dropRoll:   'Anim_Parkour_Jump_Down_To_Roll_NoSkin',
  wallRun:    'Anim_Parkour_Wall_Run_With_Right_Turn_NoSkin',
  flourish: [
    'Anim_Parkour_Run_To_Front_FlipTuck_NoSkin',
    'Anim_Parkour_Run_To_Front_FlipWith_Twist_NoSkin',
  ],
};
