// cinematicGrade — which map wants the film grade and the ambient occlusion.
//
// A tiny switch rather than a store, because it is read during render by LookComposer and set by
// whichever scene owns the look. The Mini Earth turns it on while it is mounted.
//
// It exists at all because the grade is TUNED FOR ONE THING: a single strong sun over open
// landscape. The same contrast curve and vignette over a voxel fortress interior, lit from a dozen
// torches, would be a regression there — and a global "make it cinematic" flag that quietly degrades
// every other map is how a look system starts being switched off by the people using it.

let on = false;

export function setCinematicGrade(v: boolean): void { on = v; }
export function isCinematicGrade(): boolean { return on; }
