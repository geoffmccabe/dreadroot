# Sound that travels: speed-of-sound delay and mountain echoes, cheaply

Research answer to Geoff's question (2026-Jul-27): can sound arrive at the real speed of sound, and
bounce off the mountains, without paying for full acoustic simulation?

**Short answer: yes, and the most dramatic 80% of it is nearly free.** The expensive part of
acoustics is not delay or echo — it is diffraction and late reverberation. Those are the parts to
approximate or skip. And this project has an unusual advantage: the terrain is a *deterministic
height function*, so we can query it directly instead of ray-tracing scene geometry, which is what
makes real engines expensive.

---

## Why this matters more here than in a normal game

At 1 unit = 100 metres, this map is enormous, and sound delay stops being a subtlety:

| Distance | Delay at 343 m/s |
|---|---|
| 300 m (one Kaiju length) | 0.9 s |
| 1 km | 2.9 s |
| 3 km | 8.7 s |
| 10 km | 29 s |

A Kaiju two kilometres away steps, and you hear it **six seconds later**. That is not a detail —
it is a *mechanic*. It tells you how far away something is, it makes distant fights feel distant,
and it produces the single most cinematic thing in any kaiju film: the flash of an impact, silence,
then the sound rolling over you.

In a normal shooter, 20 ms of delay across a room is imperceptible and everyone skips it. Here it
is seconds, and skipping it is what makes the world feel small.

---

## The three layers, cheapest first

### 1. Propagation delay — essentially free, do it first

Schedule each sound to *start playing* at `now + distance / speedOfSound` instead of immediately.
Web Audio's `start(when)` takes an absolute time, so this is one subtraction and no extra nodes.

Two refinements worth having, both trivial:

- **Air absorption.** High frequencies die first over distance, which is why distant thunder is a
  rumble and near thunder is a crack. One `BiquadFilterNode` low-pass whose cutoff falls with
  distance. This does more for the sense of distance than volume alone.
- **Doppler.** Only worth it for fast-moving things; Kaiju are slow, so skip it until something
  fast exists.

**Caveat to design around:** a sound triggered by an event that has already resolved will arrive
after the event is over. That is correct and desirable — but it means the audio system must be able
to schedule sounds at positions in the *past*, not read the emitter's current position at playback
time. Get that wrong and distant sounds pan from where the creature has since walked to.

### 2. A discrete mountain echo — cheap, and it is the thing being asked for

For "it bounces off the mountains", the useful approximation is the **image-source method** limited
to *first order only*: for each big reflecting surface, pretend there is a mirrored copy of the
sound source behind it, and play a delayed, quieter, duller copy from that direction.

Full image-source is expensive because the count explodes with reflection order and surface count.
First order against a handful of surfaces is a few extra scheduled sounds — nothing.

And here is where our terrain helps. Instead of tracing rays against scene geometry, we can sample
the height field directly (`sampleGlobeElevation`, already used for the LOD and the ground):

1. Cast 8–16 rays outward from the listener in a ring, marching along each in coarse steps.
2. For each, find where the terrain rises steeply enough to count as a wall, and how far away.
3. Keep the two or three strongest, and schedule one delayed copy per hit, delayed by the
   *reflected path length* (listener → wall → source), attenuated and low-passed.

That is 8–16 cheap height lookups a few times per second, not per frame. The result is a genuine
slapback off a cliff that changes as you walk — which is exactly the effect worth having, and it is
strongest in precisely the places that look most dramatic: canyons, valleys, cirques.

### 3. Late reverberation — approximate, never simulate

Do **not** use a convolution reverb per source. `ConvolverNode` is high quality and expensive, and
the Web Audio guidance is explicit that a delay-line/all-pass/low-pass reverb gets a convincing
effect far more cheaply.

Drive **one shared reverb send** from a terrain-derived "how enclosed am I" number, computed from
the same ring of rays as the echoes:

- open plain → almost no wet signal, long pre-delay
- valley floor → moderate wet, medium decay
- deep canyon → high wet, long decay

One reverb for the whole scene, its parameters lerped as you move. Sources feed it by distance.
This is the standard approach and it is convincing because *changes* in reverb read as changes in
space, even when the reverb itself is not physically derived.

---

## What the industry does, and what applies

| Approach | What it is | Applies to us? |
|---|---|---|
| **Steam Audio** (Valve, open source) | Real-time ray-traced propagation, occlusion, reflections, HRTF | Not directly — it is a native SDK for Unity/Unreal/FMOD, not the browser. Its *structure* (direct / early reflections / late reverb) is exactly the right decomposition to copy. |
| **Project Acoustics** (Microsoft) | Bakes a full wave simulation offline into a compact lookup; runtime is a table read | The right idea in spirit, but baking assumes static scenes and a bounded world. Our world is a planet. |
| **Google Resonance Audio** | Open-source spatial audio with room models | Archived, and its room model is shoebox-shaped, which a mountain is not. |
| **Web Audio `PannerNode`** | HRTF or equal-power panning, distance attenuation | Already in use here (`src/lib/spatialAudio.ts`). HRTF is convolution-based and costly on mobile; equal-power plus a short reverb is the documented cheaper substitute. |

Valve's own documentation is candid that simulating many sources or tracing millions of rays
produces noticeable lag between moving and the acoustics catching up — from the people who built
the best real-time implementation. That is the strongest argument for approximating here rather
than reaching for simulation.

---

## Recommended build order

1. **Propagation delay + distance low-pass.** Largest effect, smallest cost, and it changes how the
   scale reads immediately. Schedule from the emitter's position *at emission time*.
2. **First-order terrain echo**, 8–16 height-field rays a few times a second, two or three delayed
   copies. This is "bounces off the mountains".
3. **One shared delay-line reverb**, its wet/decay driven by the enclosure number the same rays
   already produce.
4. Only if it is ever missed: diffraction (sound bending around a ridge you are behind). It is the
   expensive one and the least noticed.

Steps 1 and 2 are perhaps a couple of hundred lines against the existing `spatialAudio.ts`, and
neither needs a library.

## One honest warning

Delay this long changes gameplay, not just atmosphere. If a Kaiju's footstep arrives six seconds
late, audio stops being a reliable cue for "something is behind me" — it becomes a cue for
"something *was* over there". That is realistic and it is dramatic, and it may also be
disorienting. Worth keeping a scale factor on the speed of sound (1.0 = real, 3.0 = compressed) so
it can be tuned by feel rather than by physics, the same way film does.

## Sources

- Steam Audio - https://valvesoftware.github.io/steam-audio/
- Steam Audio user guide, on real-time cost and lag - https://valvesoftware.github.io/steam-audio/doc/unity/guide.html
- Web Audio API performance notes (cheap reverb vs convolution, HRTF cost) - https://padenot.github.io/web-audio-perf/
- ConvolverNode - https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode
- Web Audio convolution architecture - https://webaudio.github.io/web-audio-api/convolution.html
- Fast algorithm for moving sound sources (2025) - https://arxiv.org/pdf/2508.03065
- Learning acoustic scattering fields for dynamic sound propagation - https://arxiv.org/pdf/2010.04865
