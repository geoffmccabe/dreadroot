# DreadRoot L2 — Cloudflare Durable Object game server

The live server half of the L1/L2/L3 architecture. A thin Durable Object
(`gameInstanceDO.ts`) drives the fully-tested, Cloudflare-free
`GameInstanceCore` (`src/features/netcode/server/`) at 20 Hz and streams
AoI-filtered binary snapshots to connected clients.

## What it does today
- One DO per `instance` id (`/?instance=<id>`). Each is an independent world tick.
- Client connects over WebSocket → spawns a player entity.
- Client sends 12-byte input frames (`inputBinary`) → applied on the next tick.
- Every 50 ms: advance the sim, AoI-filter per client, send each a snapshot
  (`snapshotBinary`). The netcode worker on the client decodes + diffs it.
- Last client leaves → the tick stops (DO goes idle). State is in memory only.

## Not yet (deliberately deferred)
- **Auth** — the join `token` isn't validated yet (Track 5/6).
- **Persistence/drain to L1 (Supabase)** — Track 5. State resets if the DO evicts.
- **Real enemy AI** — the sim currently only moves players (`integrateVelocity`
  default for non-players). Port the AI into `GameInstanceCore`'s `simulate`.
- **Reconciliation ack + HMAC L2→L1** — `core.ackSeqFor()` is ready to wire.

## Deploy (your infra step)
```
npm i -D wrangler @cloudflare/workers-types
cd worker
wrangler login
wrangler dev      # local test at ws://127.0.0.1:8787/?instance=test
wrangler deploy   # production
```

## Connect a client
The client already has the transport — point it at the deployed URL:
`netcodeClient.connectToInstance(id, token, 'websocket', 'wss://<host>/?instance=<id>')`
and send inputs with `netcodeClient.sendInput(encodeInput(cmd))`.

## Why this file is thin
All game logic is in `GameInstanceCore`, covered by `npm run check:game-instance`
(+ the tick/AoI/prediction/lag-comp/snapshot suites). This DO is only WebSocket
glue + a timer, so the untested-here surface is minimal.
