// kaijuShouts — what the soldiers are yelling at the monster.
//
// Geoff: "add little word bubbles popping up from the soldiers... comic book style shapes called a
// squircle, with a long tail... 1 in 50 chance to appear... persist between 1-3 seconds and fade in
// and out with transparency for 0.25 seconds."
//
// The lines are his, with forty more written to sound like the famous monster-movie shouts without
// being any of them. Verbatim film dialogue is the one thing in a game that studios genuinely chase,
// and these hit the same beat while remaining his to keep.
//
// SIMULATION ONLY. Same rule as the gunfire: this decides nothing, damages nothing and draws from
// the cosmetic random stream, so an army that will not shut up cannot change who wins a fight.

import * as THREE from 'three';
import { fxRand as rand } from './kaijuRandom';

export const SHOUTS: string[] = [
  'LIGHT IT UP!',
  "THAT'S A BIG #$@%ING MONSTER.",
  'BACK IN THE OCEAN, UGLY!',
  'RELOADING! COVER ME!',
  "IT'S GOT A SOFT SPOT. FIND IT.",
  'AIM FOR THE KNEES! BIG THINGS FALL HARD!',
  'I DID NOT SIGN UP FOR THIS.',
  'HOLD THE LINE! HOLD THE @#$% LINE!',
  "SARGE, IT'S LOOKING AT ME. IT'S LOOKING AT ME.",
  'YOU PICKED THE WRONG CITY, PAL!',
  'FIRE IN THE HOLE!',
  'MOVE, MOVE, MOVE!',
  'FIFTY BUCKS SAYS I HIT IT IN THE EYE.',
  'GO HOME, FREAK SHOW!',
  'WE ARE NOT DYING TODAY!',
  'WE NEED A TANK! WE NEED TEN TANKS!',
  'FOR EVERYONE IT TOOK, GIVE IT EVERYTHING!',
  "ANYBODY ELSE SMELL SOMETHING BURNING? 'CAUSE I LOVE THAT SMELL.",
  'STAND YOUR GROUND! IT BLEEDS LIKE ANYTHING ELSE!',
  "IT'S SLOWING DOWN! WE'RE HURTING IT!",
  'SEMPER FI, MOTHAFUCKAAA!!!',
  'OORAAAH! GET SOME!',
  'EAT LEAD, YOU UGLY SACK OF GARBAGE!',
  "DEVIL DOGS DON'T RUN!",
  "YOU WANNA DANCE? LET'S DANCE, BIG BOY!",
  'THIS IS MY CITY, YOU OVERGROWN PIECE OF SHIT!',
  'IMPROVISE! ADAPT! BLOW ITS FACE OFF!',
  'SAY HELLO TO THE UNITED STATES MARINE CORPS!',
  'COME ON, YOU BIG UGLY! COME AND GET IT!',
  "GYRENES DON'T QUIT! GET UP AND SHOOT!",
  'NOBODY LIKES YOU! NOBODY INVITED YOU!',
  "YOU'RE ABOUT TO MEET GOD, AND HE'S GONNA LAUGH AT YOUR FACE!",
  'PUT SOME BASS IN IT, MARINE!',
  "I'VE SEEN WORSE ON LEAVE!",
  'THAT ALL YOU GOT, YOU SLOW, STUPID PILE OF WALKING MEAT?',
  'RAAAH! RIP AND TEAR, BOYS!',
  'SMOKE THAT UGLY SUMBITCH!',
  'HEY! UGLY! OVER HERE! YEAH, YOU!',
  'FIRST TO FIGHT! LAST TO QUIT!',
  'YOU CAME TO THE WRONG PLANET, DUMBASS!',
  "KEEP FEEDING IT! IT'S GOT AN APPETITE!",
  "IT AIN'T BULLETPROOF! I SAW IT FLINCH!",
  "SUCK IT UP, BUTTERCUP! THAT'S JUST A SCRATCH!",
  "TWO MORE MAGS AND I'M THROWING ROCKS!",
  "PAIN IS WEAKNESS LEAVING THE BODY! SO IS THAT THING'S FACE!",
  'GET UP! GET UP! YOU CAN CRY ABOUT IT LATER!',
  'SOMEBODY GET ME SOMETHING BIGGER!',
  "I'M GONNA NEED A BIGGER GUN. A LOT BIGGER.",
  "WHO'S THE BABY NOW, HUH? WHO'S CRYING NOW?",
  "DON'T YOU DARE FALL BACK! NOT ONE STEP!",
  "YOU HEAR THAT, UGLY? THAT'S THE SOUND OF EVERY GUN WE GOT!",
  "MAMA DIDN'T RAISE NO RUNNER!",
  "STAY ON HIM! DON'T LET HIM BREATHE!",
  'IF I DIE, TELL MY EX I STILL HATE HER!',
  'COVER FIRE! MAKE SOME NOISE!',
  "THAT'S IT, YOU DUMB BASTARD! FOLLOW ME!",
  "IT'S UGLY, IT'S SLOW, AND IT'S ABOUT TO BE DEAD!",
  'SOUND OFF LIKE YOU GOT A PAIR!',
  'NOT MY WATCH! NOT MY CITY! NOT TODAY!',
  'WE HOLD, OR NOBODY GOES HOME!',

  // --- the forty written to echo the famous ones without lifting them ---------------------------
  'COME AND GET SOME, THEN!',
  'GAME ON, BIG BOY!',
  'SAY GOODNIGHT, UGLY!',
  "THAT'S RIGHT! I'M TALKING TO YOU!",
  'NOBODY TOLD ME IT WAS THIS BIG!',
  'STAY FROSTY, PEOPLE!',
  'WE GOT A BAD FEELING ABOUT THIS ONE, SARGE!',
  'HOW DO YOU LIKE ME NOW?!',
  'GET AWAY FROM HER, YOU UGLY BASTARD!',
  'SHOW ME WHAT YOU GOT!',
  'IS THAT ALL YOU GOT?! IS THAT ALL?!',
  'WELCOME TO EARTH, JACKASS!',
  'I LOVE THIS JOB. I HATE THIS JOB.',
  'HERE COMES THE CAVALRY!',
  "YOU'RE GONNA NEED A BIGGER GRAVE.",
  'HIT IT AGAIN! HIT IT TILL IT STOPS MOVING!',
  'TODAY WE FIGHT! TOMORROW WE DRINK!',
  'GET TO THE CHOPPERS! ALL OF THEM!',
  'THIS IS WHERE IT ENDS. RIGHT HERE.',
  'YOU MESSED WITH THE WRONG PLANET, PAL!',
  'SOMEBODY WAKE UP THE BIG GUNS!',
  "I AIN'T GOT TIME TO BLEED!",
  "LOAD UP. IT'S HUNTING SEASON.",
  "THEY SAID IT COULDN'T BE KILLED. THEY LIED.",
  'IF IT BLEEDS, WE CAN KILL IT!',
  "HOLD ONTO SOMETHING! IT'S COMING BACK!",
  "THAT'S ONE UGLY SON OF A GUN!",
  'SIR, PERMISSION TO SCREAM, SIR!',
  "TELL 'EM ALL WE WENT DOWN SWINGING!",
  'I HAVE HAD IT WITH THIS THING!',
  'SEND IT BACK TO WHATEVER HOLE IT CRAWLED OUT OF!',
  "WE DON'T RETREAT. WE RELOAD.",
  "STAND UP, MARINE! WE'RE NOT DONE!",
  "ONE SHOT. THAT'S ALL I NEED.",
  'IT PICKED THE WRONG DAY, THE WRONG CITY, AND THE WRONG UNIT.',
  'SMILE, YOU BIG UGLY SON OF A GUN!',
  'WE ARE THE LAST LINE. THERE IS NOBODY BEHIND US.',
  "LET'S GIVE IT SOMETHING TO REMEMBER US BY!",
  "OPEN FIRE! EVERYTHING WE'VE GOT!",
  "IT'S GOING DOWN! IT'S ACTUALLY GOING DOWN!",
];

/** Chance that any given shot is accompanied by a shout. Geoff asked for 1 in 50. */
export const SHOUT_CHANCE = 1 / 50;
/** Fade in and fade out, in seconds. */
export const SHOUT_FADE = 0.25;

export interface Shout {
  /** The speaker's head, in world space. The bubble's tail points here. */
  anchor: THREE.Vector3;
  line: number;
  age: number;
  life: number;
  live: boolean;
}

/**
 * How many can be on screen at once.
 *
 * At 200 soldiers firing every 1-10 seconds, one shot in fifty shouts, so about one every one and a
 * half seconds. With a life of 1-3 s that is two or three visible — twelve is ample headroom and
 * each one costs a mesh, so there is no reason to go wider.
 */
const MAX_SHOUTS = 12;

const shouts: Shout[] = [];
for (let i = 0; i < MAX_SHOUTS; i++) {
  shouts.push({ anchor: new THREE.Vector3(), line: 0, age: 0, life: 0, live: false });
}
let cursor = 0;

export function getShouts(): Shout[] { return shouts; }
export function clearShouts(): void { for (const s of shouts) s.live = false; }

/**
 * Maybe say something, given that this soldier just fired.
 *
 * Rolls the dice here rather than at the call site so the odds live with the thing they govern.
 * Returns true if a bubble was spawned, which is only used by the check script.
 */
export function maybeShout(head: THREE.Vector3): boolean {
  if (rand() >= SHOUT_CHANCE) return false;
  const s = shouts[cursor];
  cursor = (cursor + 1) % MAX_SHOUTS;
  s.anchor.copy(head);
  s.line = Math.floor(rand() * SHOUTS.length) % SHOUTS.length;
  s.age = 0;
  // 1-3 seconds, as asked. Long enough to read up close, short enough that the field never fills
  // up with speech.
  s.life = 1 + rand() * 2;
  s.live = true;
  return true;
}

export function stepShouts(dt: number): void {
  for (const s of shouts) {
    if (!s.live) continue;
    s.age += dt;
    if (s.age > s.life) s.live = false;
  }
}

/**
 * Opacity of a bubble right now: fades in over a quarter second, holds, fades out over a quarter.
 *
 * Clamped so a bubble whose whole life is shorter than both fades still reaches full brightness
 * briefly rather than never appearing at all.
 */
export function shoutOpacity(s: Shout): number {
  const fade = Math.min(SHOUT_FADE, s.life * 0.4);
  if (s.age < fade) return s.age / fade;
  const left = s.life - s.age;
  if (left < fade) return Math.max(0, left / fade);
  return 1;
}
