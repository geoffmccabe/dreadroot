# Sound that travels: speed-of-sound delay and mountain echoes, cheaply

Research answer to Geoff's question (2026-Jul-27): can sound arrive at the real speed of sound, and
bounce off the mountains, without paying for full acoustic simulation?

**Short answer: yes — but multi-bounce reverberation between peaks needs a different trick from
the single echoes, and it is worth being precise about which does which.**

- **Delay** (sound arriving late) is nearly free.
- **A single slap off one cliff** is cheap: first-order image-source.
- **Sound rattling between several mountains and decaying into a roll** is NOT more of the same
  trick. Doing it bounce-by-bounce explodes. It needs a *feedback delay network* whose decay is
  measured from the terrain — see section 3, which is the answer to the question actually asked.

This project has one unusual advantage throughout: the terrain is a *deterministic height
function*, so we can query it directly instead of ray-tracing scene geometry, which is what makes
real engines expensive.

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

### 3. Late reverberation — where multi-bounce echo actually comes from

**A correction to layer 2, because Geoff asked exactly the right question:** "if there's multiple
mountains then they need to bounce off each other and reverberate. Will your tricks do that?"

**First-order reflections alone will NOT do that.** They give one slap per cliff and stop. Sound
rattling between three peaks and decaying into a roll is *higher-order* reflection, and computing
it bounce-by-bounce is precisely the part that explodes: reflection paths multiply with every
order, which is why nobody does it that way past order two or three.

The resolution is not to compute more bounces. It is to **switch models at the point where bounces
stop being individually audible**, which is the standard decomposition and the reason it exists:

| | What it is | How to get it |
|---|---|---|
| **Early reflections** (first ~80 ms) | A handful of distinct echoes you can point at | Image-source, order 1–2. Directional and discrete. |
| **Late reverberation** (after that) | Thousands of overlapping bounces, none separable by ear | A **feedback delay network**. Synthesised, not computed. |

A feedback delay network feeds copies of the signal through several delay lines that feed back into
each other, with attenuation filters shaping the decay. Because the delay lines recirculate, it
produces an effectively infinite series of ever-denser reflections — which *is* sound bouncing
between surfaces, arriving at the right density and dying at the right rate. You do not trace it;
you get it for the cost of a few delay lines.

The ear cannot resolve individual reflections in a tail anyway. What it judges is how long the tail
lasts, how quickly it thickens, and how the high frequencies die relative to the low. Those are
exactly the FDN's parameters.

### The bit that makes it *our* mountains rather than a preset

Here is the technique worth taking, and it is what Steam Audio, Wwise and Meta's acoustic ray
tracing all do in some form:

> **Trace a small number of rays with MANY bounces, at a LOW rate, and use the result to set the
> reverb's parameters — not to generate audio.**

Concretely: a few hundred rays from the listener, each bounced 5–10 times, gathered into an
energy-versus-time histogram. From that curve you read the decay time (RT60) and the early/late
balance, and you feed those into the FDN. Trace a few times a second, not per frame, and
interpolate.

That is affordable because **the rays are measuring the space, not carrying the sound.** A few
hundred rays a few times a second is trivial; the same rays used to synthesise audio sample by
sample would not be.

And on this map it is cheaper still: our "ray trace" is marching over a deterministic height
function, not intersecting scene geometry. Standing in a cirque with peaks on three sides, the rays
come back short and numerous, RT60 goes long, the tail thickens — and it will genuinely sound
different from the same Kaiju on an open plain, because the number driving it was measured from the
terrain actually around you.

**Worth knowing about:** the *Scattering Delay Network* (Aalborg/De Sena, presented at AES and
written up explicitly for computer games) sits between the two — it renders early reflections
accurately *and* produces an RT60 consistent with the acoustic equations, in one structure. If the
early/late seam ever sounds like a seam, that is the thing to reach for.

### What NOT to do

Do **not** use a convolution reverb per source. `ConvolverNode` is high quality and expensive, and
the Web Audio performance guidance says plainly that a delay-line/all-pass/low-pass reverb achieves
a very convincing effect far more cheaply. One shared FDN for the scene, fed by distance, with its
parameters lerped as you move.

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
3. **One shared feedback-delay-network reverb**, its decay time and density set from a low-rate,
   many-bounce ray sweep of the terrain. THIS is what makes sound reverberate between mountains;
   the first-order echoes in step 2 only ever give one slap each.
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
- Room reverberation using parametrised feedback delay networks - https://projekter.aau.dk/projekter/files/334638099/dstrub18_Room_Reverberation_Simulation_using_Parametrised_FDNs.pdf
- Scattering Delay Network: an interactive reverberator for computer games - https://www.desena.org/sdn/AES_41_2011_SDN.pdf
- How ray-traced audio works, for reverb - https://lese.io/blog/how-raytraced-audio-works-for-reverb/
- Meta acoustic ray tracing - https://developers.meta.com/horizon/documentation/unreal/meta-xr-acoustic-ray-tracing-unreal-getting-started/
