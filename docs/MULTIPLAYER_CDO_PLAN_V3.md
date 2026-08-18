# DreadRoot Shared-World Multiplayer: Plan v3

Written 2026-Aug-14. Supersedes the L123 Architecture Plan v2 sequencing
(Track 0 to 9). This version is written AFTER a full forensic audit of the
code, and it corrects several assumptions in v2 that turned out to be wrong.

Goal, in the user's words: "have the Dreadroot game working on multiplayer
so we can see each other and see the same monsters."

---

## 1. What the audit changed

The v2 plan and the progress notes described this system as nearly finished.
That was too optimistic. The pure libraries are real, tested and correct.
The system around them is not connected, and several pieces that look
finished cannot actually function as built.

### 1.1 The single most important reframe

**DreadRoot already has working player-visible multiplayer, and it does not
use the Cloudflare server at all.**

`src/hooks/useMultiplayer.ts` opens a Supabase Realtime channel and
broadcasts player transforms at 10 Hz. `src/components/MultiplayerPlayers.tsx`
renders other players as cloned skinned meshes, smoothed with a fixed
per-frame lerp factor of 0.3. This is mounted and live today.

Consequences for the plan:

- "See each other" is already solved, just at low quality. The Cloudflare
  Durable Object does not unlock it. What the DO adds is authority, higher
  rate, binary bandwidth, area-of-interest culling, and proper time-based
  interpolation.
- "See the same monsters" is the part that genuinely does not exist, and it
  is the harder half. It is where the real work is.
- There are now two parallel multiplayer systems in the codebase that do not
  know about each other. Ending up with one is itself a goal.

### 1.2 Blockers found that v2 did not know about

These are the things that must be built, not just wired. Each was verified
in the code.

**A. The server never tells a client who it is, and never acknowledges input.**
`GameInstanceCore.ackSeqFor()` exists and is never called by the Durable
Object. The snapshot format has no field for an acknowledged sequence number,
and there is no message that assigns a client its own entity id. Client
prediction and reconciliation are therefore not merely unwired, they are
inert: `PredictedPlayer.reconcile()` needs an acknowledged sequence and the
authoritative state of the local player, and the wire can deliver neither.
This requires a protocol change, not a wiring change.

**B. The server's player simulation is a toy that does not match the game.**
`src/features/netcode/playerSim.ts` moves a player on X and Z only. There is
no Y axis at all: no gravity, no jump, no collision, no step-up, no crouch,
swim, glide, boost, or knockback. Its speed constant is 6, while the real
game walks at 4.0 and sprints at 8.0. The real controller is roughly 1,400
lines inside `src/components/fortress/FortressControls.tsx`, runs at variable
timestep off the render loop, treats the THREE camera position as the
authoritative player position, and collides against a spatial hash of Box3
colliders. Server-authoritative player movement means porting that into a
pure fixed-step module and giving the server a collision world. This is the
single largest piece of work in the whole project and it should be recognised
as such.

**C. There is a client-trusted teleport channel that bypasses all anti-cheat.**
The wire protocol has two frame types. Frame type 1 (INPUT) is simulated by
the server and correctly clamped. Frame type 2 (STATE) is a client-reported
position that the server accepts verbatim. It bypasses every clamp in
`playerSim.ts`. Worse, each client's area-of-interest centre follows its
entity position, so a client can set its own STATE position anywhere and
receive snapshots for any part of the world. As long as frame type 2 is
accepted unconditionally, none of the movement anti-cheat means anything.

**D. The input queue silently drops inputs.** The tick loop stores at most
one input per client per tick, last write wins, and clears the whole queue
after the first step of a catch-up burst. A client sending faster than 20 Hz
has inputs dropped. Catch-up ticks simulate players as if all keys were
released. Dropped inputs are never acknowledged yet would be discarded from
the client's pending list on the next acknowledgement, which is permanent
divergence rather than the self-healing kind.

**E. The server has no world.** No chunk data, no collision grid, no
pathfinding surface. Enemies cannot navigate and players cannot collide
server-side until this exists. Track 3 built a portable chunk layer on the
client for exactly this purpose, but nothing loads it into the Durable Object.

**F. Snapshots are full frames, every tick, per client.** The `baseTick`
field is written and read but every producer sets it equal to `tick`. There
is no delta encoding, no per-client baseline, and no flag bit to mark a delta
frame. The client-side diffing is a CPU optimisation for the game thread, not
a bandwidth optimisation. Bandwidth scales with entity count, not with how
much actually changed. At 22 bytes per entity, 20 Hz, and 50 visible
entities, that is about 22 KB/s down per client, and it grows linearly.

**G. Area-of-interest has no hysteresis and cannot express "left" versus
"died".** The filter is a plain squared horizontal distance against one
radius, run once per client per tick as a linear scan over all entities. An
entity hovering at exactly the radius oscillates in and out every tick. More
importantly there are no enter and leave events, so a client cannot tell the
difference between an entity that walked out of range, an entity that died,
and an entity dropped because the server restarted. All three arrive as the
same removal. Any death effect hooked to removal will fire on every boundary
crossing.

**H. A server restart permanently stalls every connected client.** The
netcode worker discards any snapshot whose tick is less than or equal to the
last one it saw. A Durable Object eviction resets the tick counter to zero,
so every subsequent snapshot is discarded forever, with no timeout, no
resync, and no error surfaced. Entity ids also restart at 1, so keys collide
across restarts.

**I. There is no reconnect logic at all.** No backoff, no heartbeat, no
round-trip-time measurement, no clock sync, no send queue while connecting.
A dropped socket is permanent.

**J. Lag compensation is a write-only buffer.** Positions are recorded every
tick into a one-second ring. Nothing ever reads it, because there is no
"I shot at tick N" message type in the protocol. The wall-occlusion pass its
own comments promise does not exist, and the voxel raycast function it names
has zero callers anywhere in the repo.

**K. The enemy AI is not pure, and not deterministic.** The behaviour-tree
files are genuinely clean. The modules they dispatch into are not:
`src/features/shpider/lib/hopAI.ts` and
`src/features/shtickman/lib/patrolAI.ts` both import THREE at runtime, call
audio side effects inside the decision path, and, critically, use unseeded
`Math.random()` to make actual decisions. `patrolAI.ts` also calls an async
worker-backed pathfinding service from inside the decision path.

**L. Monster spawning is per-client, unseeded, and relative to each player.**
Every creature has its own interval loop that rolls `Math.random()` against
the local player's own chunk, and generates entity ids from a timestamp plus
a random suffix. Two players today do not merely see monsters in different
places, they see different monsters with ids that cannot be reconciled.

**M. Two toolchain traps that make the test suite lie.** The default Node on
this machine is v20, which does not support the flag every netcode check
script uses. Every one of them fails instantly with a bad-option error, and
`npm run` masks it by reporting exit code 0. Separately, the root
`tsconfig.json` is a solution-style file with an empty file list, so the
obvious `npx tsc --noEmit` checks zero files and exits clean. Run properly
against the app config it reports 341 errors across 68 files, three of which
are inside the netcode module itself.

### 1.3 Security findings that are live right now, independent of multiplayer

These were found while auditing the trust boundary. They are not multiplayer
work, they are already exploitable in production, and given that the game has
a token economy they should be treated as more urgent than any of the
multiplayer phases below.

- `spawn_coin_drop`: the client passes both the currency type and the amount.
  The only validation is that the amount is greater than zero. There is no
  upper bound. The dropped coin is then credited for real on pickup. Verified
  directly in `supabase/migrations/20260618120000_siege_spawn_coin_drop.sql`.
- `buy_block`: the client passes the price. The server range-checks it
  between 0 and 1,000,000 but never looks up the block's actual price, and a
  cost of zero is explicitly permitted. Verified in
  `supabase/migrations/20260530240000_phase_d7_currency.sql`.
- `user_fruits` is directly insertable by any authenticated user under row
  level security, and fruits are sellable on the peer-to-peer marketplace for
  DIVI. Mint, list, sell. This is a complete exploit chain.
- `forge_fruits`: the client passes the output tier and it is never validated
  against the inputs. It is also the only security-definer function in the
  repo with no search path set, and it has no grant statement so it defaults
  to executable by everyone.
- `spawn_pet_egg` checks that the caller is authenticated but never compares
  the caller to the owner parameter, so eggs can be minted into another
  player's account.
- `place_block` upserts ownership, so any player can seize any other player's
  block at any coordinate. There is also no possession check and no reach
  check.
- `pickup_world_drop` has no proximity and no ownership check, so any drop in
  the world can be taken by id from any distance.
- `record_kill` has no rate limit, no deduplication, and a free-form enemy
  type string. The rate cap its own header defers to "Track 6A" was never
  written; that migration does not exist.
- `user_combat_stats` is client-writable, so kill counts are arbitrary.
- `pathfinding_configs` has a policy of `USING (true) WITH CHECK (true)`, so
  any user can rewrite the AI pathfinding configuration.
- No rate limiting exists anywhere in any of the 262 migrations.
- The live Cloudflare server has no join secret set. Verified by request: a
  bogus token and no token both return the same WebSocket-upgrade response
  rather than a rejection. Blast radius is currently low because the server
  holds no real game state, but it accepts anyone.
- Sessions are stored in localStorage, so any cross-site scripting is full
  session theft. The SSO exchange endpoint is public and keys identity on
  email rather than the provider's user id, which is an account-takeover
  vector if email reuse is ever possible upstream.
- Five economy-relevant database functions exist only in the live database
  and not in the repo, including the coin-drop roll and the prize chest, so
  the money path cannot be fully audited from the repo. This should be fixed
  by pulling them into migrations.

---

## 2. Strategy

### 2.1 The key insight for sequencing

**Monsters are easier to make server-authoritative than players.**

A player needs prediction and reconciliation, because a player must respond
to their own input instantly or the game feels broken. That requires the
acknowledgement channel, a real input queue, and a server-side port of the
entire movement and collision model.

A monster needs none of that. Nobody predicts a monster locally. The server
owns it, sends its position, and every client renders it interpolated
slightly in the past. That is exactly what the existing snapshot,
area-of-interest and interpolation code already does well.

So the ordering that gets the user's stated goal fastest, and that front-loads
the parts with the best value-to-risk ratio, is: fix the visible transport,
then take monsters server-side, then take the money-adjacent events
server-side, and only then attempt player movement authority.

This inverts the instinct to "do players first because players are simpler."

### 2.2 The authority ladder

Each rung is independently shippable and independently valuable.

1. Client-reported positions relayed by the server. Same trust as today,
   better quality. One system instead of two.
2. Server-owned monsters. Everyone sees the same monsters doing the same
   things. Monsters become uncheatable.
3. Server-owned combat outcomes and drops. The money path stops trusting the
   client's claim that a kill happened.
4. Server-owned player movement. Full anti-cheat. The largest single piece.

### 2.3 What we are deliberately not doing yet

- Not attempting player movement authority before monsters work. It is the
  biggest lift and it is not what the user asked for.
- Not building user-hosted servers, content overlays, or the coordinate-scale
  lift. Those stay deferred exactly as in v2.
- Not porting to Siege Worlds until DreadRoot is proven. See the hazard note
  in section 5.

---

## 3. The phases

Each phase lists what to build, how it is proven, and what could go wrong.
Phases 0 and 1 are prerequisites. Phase 2 is the headline deliverable.

### Phase 0: Hygiene and safety. No multiplayer work.

Small, fast, and it removes traps that would otherwise waste days later or
cost real money.

0.1 **Fix the toolchain lies.** Pin the check scripts to Node 22 (already
installed at `/usr/local/bin/node`) or add an engines guard, so a failing
test cannot report success. Add a real typecheck script pointing at
`tsconfig.app.json` and at `worker/tsconfig.json`.

0.2 **Set the join secret on the live worker** so the deployed server is not
open. One command. This is a stopgap that Phase 3 replaces with real
per-user tokens.

0.3 **Close the live economy holes** listed in section 1.3. At minimum
`spawn_coin_drop`, `buy_block`, `forge_fruits`, `spawn_pet_egg`,
`pickup_world_drop`, and the `user_fruits` insert policy. These are small
SQL changes with large consequences and they do not depend on any
multiplayer work.

0.4 **Pull the five missing database functions into migrations** so the money
path is auditable from the repo.

0.5 **Untrack `worker/.wrangler/`**, which currently commits the Cloudflare
account id.

0.6 Fix the three real type errors inside the netcode module.

0.7 **Check where authorization claims live.** Supabase lets users modify
their own user metadata, and Supabase's own documentation warns against
writing access rules against it. If any policy or gate in this project reads
authorization-relevant claims from user metadata rather than app metadata,
that is a live privilege-escalation path. Worth a grep before anything else
is built on top of it.

0.8 **Diarise the Supabase key migration.** The legacy anon and service-role
key formats deprecate around the end of 2026, roughly four months out, and
any use of the service-role key in a bearer header breaks. This does not
block multiplayer, but it will break things if it arrives unplanned, and the
worker work in Phase 3 should be built against the new format rather than
migrated twice.

Proven by: check scripts genuinely running and passing under Node 22; a
tokenless request to the server returning a rejection; each closed hole
demonstrated as rejected.

Risk: low. The economy fixes touch live behaviour, so each needs a quick
check that legitimate paths still work.

### Phase 1: One transport. Replace Supabase presence with the Durable Object.

Goal: players see each other through the Cloudflare server instead of
Supabase Realtime, at higher quality, with no change to who is trusted.

1.1 **Protocol additions.** Add a server-to-client "hello" carrying the
client's own entity id, the server tick, and the tick rate. Add an
acknowledged-sequence field to the snapshot header. These are the two things
whose absence makes prediction inert, and they are cheap to add now even
though nothing uses them until Phase 4. Bump the wire version and make the
decoder reject mismatches loudly.

1.2 **Connection robustness.** Reconnect with backoff, a heartbeat, a send
queue while connecting, and round-trip-time measurement. Replace the
"discard any older tick" rule with a session/epoch check so a server restart
triggers a clean resync instead of a permanent stall. This is mandatory, not
optional: every Cloudflare code deploy resets every live object, so without
it a routine deploy permanently freezes everyone connected.

Also in this phase, because the protocol is already being versioned:

- **Batched input sending, now a decided design (see 4.1a).** Send every
  second tick with the last two or three inputs packed in. This is required to
  stay under the per-object message-rate limit at 100 players, and the same
  mechanism gives loss resilience on a transport where we cannot avoid
  head-of-line blocking.
- **A real per-tick input queue** that accepts several inputs per message,
  applies them in sequence order, and deduplicates by sequence number.
  Batching makes duplicates routine by design, so the current last-write-wins
  queue cannot survive this phase. This moves earlier than originally planned.
- **Adaptive interpolation delay** driven by measured jitter rather than a
  fixed 100 ms.

1.3 **Area-of-interest semantics.** Add explicit enter and leave versus
destroy, and add a hysteresis band so entities at the boundary do not
oscillate. Without this, death effects will fire wrongly the moment anything
visual is hooked to entity removal.

1.4 **Wire the client.** Instantiate the netcode worker the same way the mesh
and pathfinding workers are instantiated. Feed the local player's transform
in, and render remote players from `remoteEntities.ts` sampling, hooked into
the existing `frameLoop` registry at the same priority the current
multiplayer renderer uses. Delete the Supabase broadcast path once the new
one is proven, behind a flag for one release.

1.5 **Keep positions client-reported for now**, but restrict the client-trusted
frame so it can only move a player within a plausible distance per tick, and
decouple the area-of-interest centre from client-settable position. This
removes the "see the whole world" hole without waiting for Phase 4.

1.6 **Start recording aim telemetry server-side now.** Log yaw and pitch per
player per tick from the moment the server sees players at all. It costs
almost nothing today, and it is the baseline that every future aim-assist and
aimbot detector is measured against. This data is unrecoverable after the
fact: if we do not start collecting it now, the first time we need it we will
have to wait months to gather it. This is the cheapest high-value item in the
entire plan.

Note that the current input frame carries no pitch at all, so this rides
along with the protocol version bump in 1.1.

Proven by: two browsers, each seeing the other move smoothly; a deliberate
server restart recovering without a reload; a deliberate network drop
recovering; the D-Flow panel showing no frame-time regression.

Risk: moderate. The interpolation path is better than what it replaces, so
visible quality should improve. The main risk is the render hook interacting
badly with the existing frame loop ordering.

### Phase 2: Server-owned monsters. The headline deliverable.

Goal: every player sees the same monsters, in the same places, doing the same
things, and a monster killed by one player is dead for everyone.

Scope deliberately narrow: **one creature type first.** Shombie is the
strongest candidate because it already runs on the universal manager and
shared behaviour tree rather than a bespoke hook, so its decision layer is
closest to portable. Shpider and shtickman follow, and they need more work
because their decision modules import THREE and call audio directly.

2.1 **Give the server a world.** Load the portable chunk layer into the
Durable Object so it can answer "is this voxel solid" and provide a ground
height. This is the prerequisite for any monster that walks. Track 3 already
built the pure pieces; this is about getting chunk data into the server and
keeping it fresh when blocks change.

2.2 **Make the decision layer genuinely pure and deterministic.** Replace
every `Math.random()` in the AI and spawn paths with an injected seeded
generator. Move audio out of the decision path and into the render layer,
driven by state changes in the snapshot. Remove the runtime THREE dependency
from the modules that need to run server-side.

2.3 **Extend the entity model.** The tick loop's entity record currently
carries only position, yaw, velocity and 16 opaque state bits. Monsters need
health and a behaviour blackboard. Add a proper side structure the simulation
owns, and decide what subset is replicated. Health must be replicated
because clients draw health bars.

2.4 **Move spawning to the server.** One authority decides what exists,
where, and with what id. This kills the per-client interval loops for the
migrated creature type. Entity ids become server-assigned and globally
consistent.

2.5 **Plug the AI into the simulation slot.** The tick loop already accepts a
pluggable simulation function. Note the trap: overriding it replaces the
default rather than composing with it, so the replacement must still step
players and still set the acknowledgement, or players freeze.

2.6 **Render monsters from the snapshot.** Clients stop simulating the
migrated creature type locally and instead interpolate it from the server
stream, exactly like remote players.

2.7 **Bandwidth and visibility work, needed at this point and not before.**

Correction to an earlier assumption: **delta compression is not the right
first move and should be deferred.** The measured budget is roughly 5 KB/s
down per client for 20 visible entities, against something like 60 KB/s for a
shipping battle-royale. Bandwidth is not the bottleneck yet. Building
per-client baselines and acknowledgement tracking now would add real
complexity for a problem we do not have.

Do instead, in order:

- **Quantise and bit-pack the snapshot fields.** Tighter position encoding,
  16-bit yaw, 12-bit pitch, chunk id plus offset rather than absolute
  coordinates. This is roughly a 75 percent reduction on its own and it is
  far simpler than delta baselines.
- **Field-level dirty flags**, so unchanged fields cost nothing.
- **A per-client entity budget and priority ordering**, so a dense area
  degrades gracefully instead of blowing the frame budget.
- **Replace the linear area-of-interest scan with a spatial index.**

Only if measurement then shows we are over budget, add delta encoding. When
that happens, the reliable ordered transport means it can be the simple form:
always delta against the previous frame with periodic staggered keyframes,
one baseline per client, no acknowledgement ring.

**Replace plain-radius filtering with server-side visibility culling.** In a
voxel world, precomputing which regions can see which others is unusually
tractable, and filtering by actual visibility rather than distance means a
client is never sent the position of an enemy it cannot see. This kills
wallhacks and radar cheats at the source rather than trying to detect them,
and it cuts bandwidth at the same time. Doing this here rather than later
matters, because it changes what data leaves the server, and retrofitting it
after clients have come to depend on seeing everything in radius is harder.

2.8 **Decide the sharding story.** The practical ceiling is near 100 sockets
per object, below the 200-player north-star target. Even if the first shared
world never reaches that, the zone-handoff design should be sketched now so
that entity ids, world coordinates and join routing do not bake in a
single-object assumption. Build it later; design for it now.

Proven by: two browsers side by side seeing identical monster positions and
identical deaths; a scripted soak with many simulated monsters measuring
bandwidth per client and server tick time; the automated performance harness
showing no client frame-time regression. Note that the harness hardcodes the
diagnostics metric stride, so adding netcode metrics requires updating it in
lockstep or it will silently corrupt results.

Risk: high, and this is where the schedule risk lives. The determinism work
and the server-side world are both larger than they look. Recommend proving
the whole chain with one creature before touching a second.

### Phase 3: Trust the server for money-adjacent events.

Goal: the token economy stops depending on the client's word.

3.1 **Real join tokens.** Nothing currently issues a verifiable token. The
material to build one from is the Supabase session already in the browser.
Add an endpoint that mints a short-lived signed token binding a user id to a
world and instance, and have the worker verify it. This replaces the single
shared secret from Phase 0 and gives every connection a real identity instead
of a sequential client number.

3.2 **Signed server-to-database writes, structured so no master key exists in
Cloudflare at all.** The Durable Object currently cannot write to the
database. The recommended shape goes further than "sign the requests": the
public game worker holds zero database credentials and reaches the database
only through a service binding to a private, route-less worker exposing a few
narrow verbs. That private worker uses a purpose-built low-privilege database
role with no bypass rights, no schema rights, column-level grants, and
mutations only through functions that enforce the economy rules. This makes
the key leak structurally impossible rather than merely unlikely, which
matters given the earlier service-role leak. Note this is mostly a database
control, not a Cloudflare feature.

3.2b **Server-side randomness with an audit trail.** Once the server rolls
loot and drops, the roll needs to be both unpredictable and provable. Use a
cryptographic generator inside the object, commit to a per-epoch seed and
reveal it afterwards, and keep a hash-chained log of rolls. Rule to enforce
in design: no cancels, no re-rolls, and no player action accepted after a
request is made. This is what stops the classic "roll, see the result,
disconnect" exploit.

3.3 **Server-side damage and death for migrated creatures.** Once the server
owns monster health, the server decides when one dies and who killed it. Kill
credit and drops become a signed server write rather than a client claim.
This is the point at which `record_kill` and the drop rolls stop being
forgeable, and it is the main security payoff of the whole project.

3.4 **Add a shot message type and turn on lag compensation.** The rewind
buffer already exists and is correct; it has never had an input. This is also
where the wall-occlusion check gets built, using the voxel raycast that is
currently dead code.

3.5 **Rate limiting and replay protection** on the server-to-database path,
which is the thing that was deferred to "Track 6A" and never built. Note that
Cloudflare's own rate limiting does not apply here: it filters the connection
handshake, not the frames that follow. Everything per-frame is ours to write.

3.6 **Durable local storage in the object.** The object declares a SQLite
class but makes zero storage calls, so all state is in memory. Combined with
the fact that every code deploy resets every live object, this means monster
state, positions and anything else are wiped on each deploy. Writing the
authoritative state to the object's own storage and restoring on start makes
routine deploys and evictions survivable. Until this exists, accept that
Phase 2's monsters reset whenever the worker is redeployed.

Proven by: a modified client claiming an impossible kill and being rejected;
kills surviving a server restart; a rate-limit trip logged.

Risk: moderate to high. This is where correctness bugs cost real currency, so
it wants careful review rather than speed.

### Phase 4: Player movement authority.

Goal: the server, not the client, decides where players are.

This is the largest single piece of work in the plan. It requires porting the
movement and collision model out of the 1,400-line controller into a pure
fixed-step module both sides run, giving the server a collision world,
replacing the last-write-wins input queue with a real per-tick queue, and
turning on the prediction and reconciliation code that Phase 1 made possible.
It also requires removing the client-trusted position frame entirely.

Three design decisions worth locking in now, from the research:

- **One movement module, run identically in both places.** This is the long-
  established pattern from the Quake lineage. Not two implementations kept in
  sync by discipline.
- **Two-tier validation rather than full re-simulation every tick.** Cheap
  constant-time invariant checks on every tick, full re-simulation only on
  ticks that carry value (a kill, a pickup, a trade) plus a random audit
  sample. Re-simulating everything is the thing that makes server-authority
  expensive, and it is not necessary.
- **Set back, do not ban.** When validation fails, correct the player's
  position rather than kicking them. Bans on movement validation punish
  players with bad connections, and the false-positive cost is high.

One protocol rule to adopt at the same time, because it is free and it
deletes a whole class of ambiguity: **forbid packet suppression.** A client
that stops sending is treated as a fault rather than as a player standing
still. This is the uncertainty that other games spend enormous effort
handling after the fact.

The honest assessment: this is worth doing, and it is not worth doing before
Phases 1 to 3. It should be planned separately once those are real, because
what we learn in Phase 2 about the server-side world will change how it is
approached.

### Phase 4b: Before tokens carry real value.

Not multiplayer work, but it belongs in this document because the multiplayer
authority work is what makes it possible, and because the economy design
choices are cheaper to make now than to retrofit.

- **Make earned rewards non-transferable by default**, with a deliberately
  gated, rate-limited conversion path rather than free transfer from the
  start. Free transferability is what turns a bug into a cash-out.
- **Per-account earning caps per time window.**
- **An audited withdrawal queue with a delay**, and an alarm that fires
  during the delay window rather than after it.
- **Sybil clustering** on both the wallet funding graph and in-game
  behaviour. The research suggests budgeting for 20 to 25 percent Sybil
  accounts in an unprotected reward pool, which is high enough to change the
  economics of any reward scheme designed without it.

The existing closed-loop decision recorded in the Dread Points plan (no
out-ramp before the banking phase) remains the right call and this section
does not change it.

### Phase 5: Siege Worlds.

Only after DreadRoot is proven. See the hazard below.

---

## 4. What the platform research settled

### 4.1 Answers

**20 Hz is a defensible server tick.** Shipping shooters run at or below it
(Apex, Warzone, Tarkov). The tick rate is not the thing to spend on. Three
cheaper upgrades buy most of what a higher tick would:

- **Sub-tick input timestamps.** Carry when the input actually happened
  rather than snapping it to a tick boundary. This is the single biggest
  responsiveness win available at a fixed tick rate.
- **Decouple simulation rate from send rate.** Simulate at 40 to 60 Hz and
  send snapshots at 20 Hz. Movement quality improves without multiplying
  bandwidth.
- **Adaptive interpolation buffer.** The current fixed 100 ms should become
  a percentile-tracked window that grows under jitter and shrinks when the
  connection is clean.

**The concurrent-player ceiling per Durable Object is the real constraint,
and it is lower than the north-star target.** The continuous timer that
drives the game loop permanently blocks the hibernation API. Non-hibernated
WebSockets hold their memory inside the object's 128 MB isolate, which puts
the practical ceiling somewhere near 100 sockets per instance, not 200.

**A second and possibly tighter ceiling: the per-object request rate.**
Incoming WebSocket messages are billed and counted as invocations, and there
is a soft limit around 1,000 per second per object. Fifty players sending
input at 20 Hz lands exactly on that limit. Cloudflare never states
explicitly whether socket messages count against it, so this needs
measuring, but if it holds it binds before the memory ceiling does.

### 4.1a DECIDED: design for 100 concurrent players per world

Geoff's call, 2026-Aug-14: assume 100, do not block on the memory experiment.

This makes the message-rate limit the **binding constraint**, not memory. One
hundred players each sending an input every tick is 2,000 messages per second
into a single object, roughly double the soft limit.

**Therefore: batch the input path.** The client sends every second tick (10
times per second) with the last two or three inputs packed into each message.
That halves the message count to about 1,000 per second at 100 players while
losing no input fidelity, because the server still receives every 20 Hz input,
just slightly later and in pairs.

This is a genuinely fortunate overlap, because it is the same mechanism the
transport section already wanted for a different reason. Since we are stuck on
TCP and cannot escape head-of-line blocking, carrying the last few inputs in
every message means a single delayed packet does not stall the player: the
next message already contains the input that was in the delayed one. One
change buys both the rate headroom and the loss resilience.

Consequences to carry:

- The added input latency is half a tick on average, about 25 ms. Acceptable
  at 20 Hz and far cheaper than the alternatives.
- The server's input queue must accept several inputs per message and apply
  them in sequence order. This reinforces that the current last-write-wins
  queue has to be replaced with a real per-tick queue, which was already on
  the Phase 4 list. It moves earlier because batching makes it mandatory.
- Duplicate inputs will arrive routinely by design, so the queue must
  deduplicate on sequence number rather than assuming each arrives once.

The memory experiment (item 1 in section 4.2) is still worth running because
it is cheap and would relax the ceiling substantially, but nothing in the plan
now waits on it. Zone sharding remains the growth path beyond 100 and stays
designed-for, built-later.

This has a direct architectural consequence: **"one shared world for
everyone" probably cannot be one Durable Object at the stated scale.** It
likely needs sharding by zone, with objects handing players off at
boundaries. That is a significant design item that did not appear in v2 at
all, and it should be designed for early even if it is built late, because
retrofitting a handoff is far worse than planning for one.

The highest-value experiment on the whole list is testing whether the
hibernation-style socket acceptance still offloads socket memory while a
timer is running. If it does, the ceiling moves substantially and sharding
gets easier. This should be measured before Phase 2 scope is fixed.

**There is no escape from TCP.** WebTransport now ships in all browsers, but
Cloudflare Workers do not support it and a Cloudflare maintainer stated in
July 2026 that it is not on the roadmap. WebSocket over TCP is the only
option on this stack, so head-of-line blocking is a permanent design
constraint rather than a temporary one. Practically that means: keep messages
small, and build redundancy into the input path (each input frame carries the
last few inputs) so a single delayed packet does not stall the player.

**Cost is not a blocker.** Roughly 12 to 16 US dollars per month per
always-on 20-player instance, with egress free.

**But every code deploy resets every live Durable Object** and drops all
in-memory state. Given the current server keeps everything in memory, this
means today a deploy would disconnect and reset every player mid-session.
This raises the priority of persistence: it is not just a crash-recovery
nicety, it is what makes routine deploys survivable. It also makes the
resync-after-restart work in Phase 1.2 mandatory rather than optional.

**Every Cloudflare security product stops at the WebSocket handshake.** The
firewall, rate limiting and bot management all operate on the HTTP request
that upgrades the connection. Once the socket is open, every frame is
unfiltered. All per-frame abuse control is code we write inside the object.
With tokens at stake this is worth stating plainly: Cloudflare provides no
in-band protection for the thing that matters.

**Server-side visibility culling is both a security and a bandwidth win.**
Precomputing which voxel regions can see which others, and filtering
snapshots by actual visibility rather than by plain radius, defeats the
entire class of wallhack and radar cheats at the source: the client is never
sent the position of an enemy it should not be able to see. Riot's published
implementation runs at under 2 percent of frame time. For a voxel world this
is unusually tractable because the geometry is already a grid. This should
replace the plain-radius area-of-interest filter in Phase 2.7 rather than
being a later optimisation, because it changes what data leaves the server.

### 4.2 Still to verify empirically

The research flagged nine items where the documentation is silent or sources
conflict. These are measurements to take, not facts to cite. In order of how
much they change the architecture:

1. **Does the hibernation-style socket acceptance still offload socket memory
   when a timer is running?** Cloudflare's own documents are compatible with
   either answer. This single question decides whether one instance holds
   roughly 100 players or roughly 32,000. It is the highest-value experiment
   in the entire plan and should be run before Phase 2 scope is fixed.
2. **Maximum simultaneous sockets per object.** Cloudflare publishes no
   number. Their own tooling project says 100 without hibernation and 32,000
   with; Cloudflare's docs vaguely say "thousands". Neither is a commitment.
3. **Whether socket messages count against the roughly 1,000 per second
   per-object limit.** At 50 players sending at 20 Hz we sit exactly on it.
4. **Whether a timer tick alone can exhaust the per-invocation CPU budget in
   a room where clients are connected but silent.** Incoming messages reset
   the budget; a timer callback may not.
5. **Whether compression is negotiated on the socket and whether it can be
   turned off.** This affects both bandwidth measurement and exposure to the
   2026 compression-bomb vulnerability cluster.
6. **Whether the no-delay TCP option is set on both Cloudflare's path and
   Chromium's socket stack.** If not, delayed acknowledgement can add 40 to
   200 ms at 20 Hz.
7. **Server tick time with realistic player and monster counts.** Nobody
   publishes this figure for Durable Objects. The available estimate is
   extrapolated from a different language and a harder simulation. Benchmark
   before committing to a player count.
8. **Whether Supabase can be made to trust a worker-minted token**, which
   affects how join tokens are designed in Phase 3.
9. **The real socket idle timeout.** The widely-quoted 100 seconds appears in
   none of Cloudflare's own pages. Treat as folklore.

Two corrections to assumptions worth recording: the maximum socket message
size was raised to 32 MiB in late 2025, so anything citing 1 MiB is stale;
and Durable Objects still bill wall-clock duration at the allocated memory
size, so any cost planning based on the newer active-CPU billing model is
wrong, because that change applies only to Containers and Sandboxes.

---

## 4c. Anti-cheat and anti-bot track

Elevated to its own track at Geoff's direction, 2026-Aug-14: do everything we
reasonably can. This cuts across the phases rather than sitting in one, so it
is collected here with a note on when each piece lands.

### Governing assumptions

- **The client is fully hostile and the wire protocol is public.** Assume
  someone writes a headless client that speaks our binary format directly and
  never runs our rendering code at all. Every defence that depends on our
  JavaScript running is worth zero against that. This is why client-side
  obfuscation is explicitly not on the list: it costs real frame rate, which
  is a stated priority, and it buys only delay.
- **Prevention beats detection.** Data we never send cannot be cheated with.
  This is the single highest-leverage idea in the whole track.
- **Cloudflare protects nothing here.** Their firewall, bot management and
  rate limiting all act on the HTTP request that opens the socket. After the
  handshake, every frame is unfiltered. All per-frame control is our code.

### Layer 1: do not send it (prevention)

Lands in Phase 2.7.

- **Server-side visibility culling using precomputed voxel visibility.**
  Filter snapshots by what a player can actually see, not by radius. A client
  is never told the position of an enemy behind a wall, which kills wallhacks
  and radar cheats at the source rather than trying to spot them afterwards.
  A voxel world makes this unusually tractable because the geometry is already
  a grid. Published implementations run under 2 percent of frame time, and it
  reduces bandwidth rather than adding cost.
  Budget for the known follow-on work: animations need restarting or
  fast-forwarding when something re-enters view, and audio still has to play
  for entities that were never sent.
- **Never replicate what the client has no legitimate use for**: other
  players' inventories and exact health, monster spawn tables, drop tables.

### Layer 2: do not trust it (authority)

Phases 2 to 4, and it is the main point of the whole project.

- Server owns monster existence, position, health and death (Phase 2).
- Server owns combat outcomes, kill credit and drops (Phase 3).
- Server owns randomness, with a cryptographic generator, per-epoch commit
  and reveal, and a hash-chained audit log. No cancels, no re-rolls, and no
  player action accepted after a roll is requested (Phase 3).
- Two-tier movement validation: constant-time invariants every tick, full
  re-simulation only on value-bearing ticks plus a random audit sample
  (Phase 4).
- **Set back, do not ban** on movement failures.
- **Forbid packet suppression.** A client that goes quiet is a fault, not a
  player standing still. Free to adopt, and it deletes an entire class of
  ambiguity that other games spend enormous effort handling.

### Layer 3: do not let them in (access)

Phase 0 for the stopgap, Phase 3 for the real thing.

- Short-lived, single-use, per-user signed join tokens binding a user to a
  world and instance. Replaces the current single shared secret, and replaces
  sequential anonymous client numbers with real identity.
- **Origin allowlist on the handshake.** Cheap, and it is one of the few
  places where acting at the HTTP layer does help.
- **Turnstile at account creation and at value-bearing moments.** Cloudflare
  native, low friction, and directly aimed at automated account farming.
  Deliberately not on every join, because it would tax legitimate players.
- Account age and activity gates before an account can earn anything of
  value.

### Layer 4: rate limit everything (abuse)

Phase 1 for the basics, Phase 3 for the economy paths.

- **Per-opcode token buckets inside the server object**, since Cloudflare's
  own rate limiting cannot see past the handshake. Nothing off the shelf does
  this; it is ours to write.
- **A distinct close code per failure class.** This costs nothing and gives
  free telemetry on exactly who is probing which part of the parser.
- Per-account earning caps per time window (Phase 4b).
- Rate limits on the server-to-database path, the thing deferred to
  "Track 6A" and never built.

### Layer 5: detect (telemetry)

**Starts in Phase 1 and this is the urgent part**, because telemetry not
collected is unrecoverable.

- **Aim telemetry: yaw and pitch per player per tick, from day one.** The
  baseline every future aimbot detector is measured against. Note the current
  input frame carries no pitch at all, so this rides on the Phase 1 protocol
  version bump.
- **Input timing entropy.** Humans jitter; scripts do not. Recording the
  timing distribution costs almost nothing and is one of the better bot
  signals available without touching the client.
- **Session shape**: length, regularity, breaks. A 24-hour perfectly regular
  session is the clearest farming signal there is.
- **Sybil clustering** on both the wallet funding graph and in-game
  behaviour. Budget for 20 to 25 percent Sybil accounts in an unprotected
  reward pool, which is high enough to change the economics of any reward
  design that ignores it.

### Layer 6: harden the parser (the server is now attack surface)

Phase 1, alongside the protocol changes.

- **Unknown frame types are currently swallowed silently** with no error and
  no disconnect. That is a free parser-probing harness for an attacker.
  Reject loudly, count it, and disconnect on repetition.
- The snapshot decoder does no length validation and throws a raw range error
  on a truncated buffer. Validate properly.
- **Fuzz the binary decoder**, one target per message type plus a raw-bytes
  dispatcher, seeded with our own opcode constants. Add property tests for
  encode and decode round-tripping and for never throwing on arbitrary input.
- The entity count field silently wraps above 65,535 rather than erroring.
  Guard it.

### The economics defence, which beats all of the above

From Phase 4b, restated here because it is the real answer to botting: **make
earned rewards non-transferable by default.** A bot farm exists to convert
game value into money. If that path is gated, rate-limited, delayed and
audited, most of the incentive disappears and every technical measure above
only has to handle the remainder. Detection is a tax on attackers;
non-transferability removes the business case.

## 5. Hazards to carry forward

- **The Siege Worlds worker will overwrite DreadRoot's live server.** The
  copy at `/Users/geoffreymccabe/dreadroot-sww/worker/wrangler.toml` still
  declares the worker name `dreadroot-l2` and the custom domain
  `server.dreadroot.com`. Deploying from that directory would replace the
  DreadRoot game server. Rename it before anyone runs a deploy there.
- **The performance harness is coupled to the diagnostics metric layout.**
  Adding netcode metrics without updating the harness silently corrupts its
  output. This has bitten before.
- **Every hardened database function still has a fallback to the old
  unvalidated direct write.** That fallback is why row level security cannot
  simply be tightened on those tables: doing so breaks the shipped client's
  own fallback path. Removing the fallbacks is a prerequisite for real
  lockdown, and it needs a forced client refresh.
- **Two Claude instances share this repo** on branch `claude1-recovery`, with
  a single shared version number. Fetch before pushing.
- **The dead adapter trap.** There are fully implemented adapter files for
  walapa and shtickman that are imported but never registered, and their sync
  functions are no-ops. Anyone inventorying "what runs on the universal AI"
  by reading that directory will get the wrong answer.

---

## 6. Decisions locked in (2026-Aug-14)

- **Target 100 concurrent players per world.** Do not block on the memory
  experiment. Consequence: message rate, not memory, is the binding limit, so
  input batching (section 4.1a) is now a required part of Phase 1.
- **Anti-cheat and anti-bot are a first-class track** (section 4c), not a late
  phase. The telemetry parts start in Phase 1 because data not collected is
  unrecoverable.
- Monsters before player-movement authority.
- Delta compression deferred; pack the numbers tighter first.

## 7. Recommended immediate next step

Phase 0 in full, because it is small, it removes traps, and it closes live
money holes that exist regardless of whether multiplayer ever ships. Then
Phase 1, which is mostly wiring and produces a visible result.

Phase 2 is the one to plan carefully once Phase 1 is real.
