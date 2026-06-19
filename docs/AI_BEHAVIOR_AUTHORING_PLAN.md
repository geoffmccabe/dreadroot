# AI Behavior Authoring for the Challenge Creator — Implementation Plan

Status: PLAN (not yet built). Owner: Challenge Creator track.
Goal: let challenge creators describe monster behavior + spawn setup in plain English
("make the skeleton shy — it hides behind giant mushrooms and stalls to waste my time";
"spawn 100 in a circle around the player, radius 20m"), have an AI turn that into a
**validated behavior config** attached to that wave's monster, and **test-play that one wave
instantly** — all without ever letting the prompt or its output touch money, scores, the
database, other players, or anything outside a fixed, safe vocabulary.

---

## 0. The one principle everything hangs on: generate DATA, not CODE

Two ways to build this:

- **AI generates runnable code** (JavaScript that executes in the game). Rejected. Generated
  code can do anything; "scan the code for jailbreaks" is an unwinnable game.
- **AI generates a constrained config** (a fixed menu of pre-built behaviors with numbers,
  emitted as validated JSON). Adopted. The AI's only job is translation: English → a list of
  behaviors the engine already knows how to run.

**Why this is the whole security story:** the worst a malicious prompt can produce is a
weird-moving monster. There is no field in the vocabulary for "give me money" or "set my score,"
so it cannot be expressed, no matter how the prompt is phrased. **The vocabulary is the sandbox.**
We remove the attack surface instead of trying to guard it.

---

## 1. Architecture overview

```
Creator types prompt ──▶ server-side "behavior compiler" (Claude API)
                              │  (system prompt + JSON schema of the vocabulary)
                              ▼
                    candidate BehaviorConfig (JSON)
                              │
                    ┌─────────┴──────────┐
                    │ schema validation   │  reject unknown fields, clamp ranges (fail-closed)
                    │ + range clamping    │
                    └─────────┬──────────┘
                              ▼
              BehaviorConfig stored on the monster-drop (challenges.data)
                              │
                              ▼
        Behavior INTERPRETER in the game (walled off: no economy / DB / network)
                              │
                              ▼
              Instant single-wave TEST PLAY (no leaderboard write)
```

Key point: the **Claude API runs server-side** (Supabase Edge Function or Cloudflare Worker),
never in the browser. The API key stays server-side. "Claude Code" builds this system; the
Claude **API** powers the in-game feature.

---

## 2. Security model — four layers, defense in depth

1. **The vocabulary (the real wall).** The AI may only emit behaviors from a whitelist of
   pre-built primitives. Nothing else is representable.
2. **Schema validation + clamping.** Every emitted config is checked against a strict JSON
   schema; unknown fields are rejected, numbers are clamped to safe ranges (count, radius,
   speed, etc.). Fail-closed: if it doesn't validate, it doesn't save.
3. **Walled-off interpreter.** The runtime that executes a behavior can only read the monster's
   local world (its transform, the player, the navmesh, cover points, animation). It has no
   reference to currency, scores, the prize pool, RPCs, the database, the DOM, the network, or
   other players — by construction.
4. **Optional prompt screen (belt-and-suspenders).** A cheap first pass can flag obviously
   out-of-scope asks and respond "that's not something challenge behavior can do." Not
   load-bearing — layers 1–3 already make such asks harmless.

Prerequisite: **server-authoritative scoring/rewards.** As long as score and payouts are
validated server-side, no behavior can farm money even in principle. (Ties into the Divi
economy + layered-architecture work.)

---

## 3. The behavior vocabulary — what CAN and CAN'T be controlled

### CAN (whitelisted, grows over time)

**Spawn / formation**
- count (clamped, e.g. ≤ ~300 per drop for perf)
- formation: circle | arc | line | grid | scatter | clustered
- radius / spacing, facing, height (ground / drop-from-sky)
- stagger (one every N ms), arrival timing within the wave

**Movement / AI (built on the existing behavior-tree + steering primitives)**
- posture: chase | flee | keep-distance (kite) | orbit | patrol | ambush | hold-position
- cover-seeking: hide behind cover of type X (e.g. mushroom caps), keep a line-of-sight
  blocker between self and player, flee when exposed
- target selection: nearest player | the player | lowest-HP ally to protect
- goal: kill | survive | stall (waste the player's time) | guard a point
- reactions: flee at low HP, enrage at low HP, call nearby allies, scatter when grouped
- speed / aggression / detection-range — **as multipliers within clamped bounds**

**Combat tuning (within clamped ranges; some already exist as boss mods)**
- attack range, attack cadence, damage range, knockback — all bounded

### CANNOT (not in the vocabulary — cannot be expressed)
- anything touching currency, score, prize pool, rewards, payouts
- database writes, RPC calls, network requests, reading/affecting other players
- DOM / page / navigation / URLs / storage
- spawning non-monster entities, unbounded counts, or perf bombs
- changing rules outside the single wave's monsters

The "shy skeleton" example decomposes to: `seek-cover(coverType: mushroom)` +
`maintain-LoS-blocker` + `flee-when-exposed` + `goal: stall`. All in-vocabulary.

---

## 4. Data / storage model

Behavior is just more **data** on the existing challenge object — no new execution surface.

- Add `behavior?: BehaviorConfig` to a `MonsterDrop` (or to a wave's monster slot).
- `BehaviorConfig` = `{ spawn?: SpawnConfig, ai?: AiConfig, prompt?: string, version: number }`
  - `prompt` keeps the original English for re-editing / display.
  - `version` lets us migrate the schema later.
- Saves with the challenge in `challenges.data` (jsonb). Validated again on save (server-side)
  so a hand-edited row can't smuggle anything in.

---

## 5. The AI translation endpoint ("behavior compiler")

- Server-side function (Edge Function / Worker). Inputs: the creator's prompt + the current
  drop context (monster type, wave) + the **schema of the vocabulary**. Output: a candidate
  `BehaviorConfig`.
- The model is told: emit ONLY valid config against this schema; if the request asks for
  something outside it, return `{unsupported: "<short reason>"}` instead.
- The server then **validates + clamps** the output before returning it. The client never
  trusts raw model output.
- Controls: auth (only the challenge owner), per-user rate limit + small cost budget,
  log prompts+outputs for review.
- The generated config is shown back in the Creator as editable dropdowns/sliders — the AI
  produces a starting point; the human can fine-tune. (This also means the feature degrades
  gracefully: even with the AI off, creators can author behavior by hand.)

---

## 6. Instant single-wave test play

Mostly independent of the AI part.

- Add a "Test this wave" action in the Creator (per wave).
- The runner gains a "jump to wave N in test mode" entry: teleport the player to the arena,
  spawn ONLY that wave's drops with the authored behavior, run until cleared/failed.
- Test runs **do not** record to the leaderboard and don't charge cost-to-play.
- Lets a creator iterate on wave 8 without replaying waves 1–7.

---

## 7. Phased implementation

**Phase 0 — Schema + interpreter + test mode (no AI yet).**
- Define `BehaviorConfig` (spawn + a starter set of AI behaviors built on the existing
  behavior-tree / EMS primitives).
- Build the interpreter that applies a config to a spawned monster (walled off).
- Wire `behavior` onto `MonsterDrop` + save/load.
- Add "Test this wave" instant play.
- Author behavior via plain dropdowns/sliders. This proves the safe core end-to-end.

**Phase 1 — AI translation layer.**
- Server-side behavior-compiler endpoint (Claude API) with schema validation + clamping.
- Prompt box in the Creator; AI output populates the Phase-0 dropdowns for review/edit.
- Rate limiting, auth, logging, optional prompt-screen pass.

**Phase 2 — Grow the vocabulary.**
- Cover-seeking (requires the world to expose "cover points" / LoS queries), richer
  formations, multi-monster coordination, reactions. Bounded by what the engine supports.

---

## 8. Prerequisites, dependencies, and honest risks

- **The real work is the vocabulary + interpreter, not the AI.** The AI is a thin translation
  layer; depth comes from how many interesting primitives the engine supports. This is the
  "authoring" layer of the master-plan sequence and rides on the EMS / behavior-tree system
  being solid first.
- **Engine-bounded:** behaviors like cover-seeking need supporting systems (cover-point /
  line-of-sight queries) that may not exist yet. Start with what the behavior-tree system
  already does and expand.
- **Performance:** behaviors run for many monsters (100 in a circle). Primitives must be cheap
  and LOD-aware; counts and complexity are clamped. Reuse the existing LOD throttling.
- **Server-authoritative scoring** must be in place so behavior can never be a money/score vector
  (ties to Divi economy + L1/L2 architecture).
- **Cost/abuse of the AI endpoint:** rate-limit per user, cap tokens, log everything.
- **Do NOT ever accept free-form code.** If that's ever proposed, stop — scanning generated code
  for jailbreaks is not a real defense. Stay declarative.

---

## 9. One-line summary

Yes, it's buildable and safe — provided the AI fills a **constrained, validated menu of
pre-built behaviors** rather than writing code. The vocabulary is the sandbox; validation +
a walled-off interpreter + server-side scoring are the guardrails; instant single-wave test
and per-drop storage are straightforward. The bulk of the effort is the behavior vocabulary,
which is exactly the engine's existing data-driven AI direction.
