var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../src/features/netcode/snapshotDiff.ts
function entityKey(origin, id) {
  return origin * 4294967296 + (id >>> 0);
}
__name(entityKey, "entityKey");

// ../src/features/netcode/server/tickLoop.ts
var TICK_HZ = 20;
var TICK_MS = 1e3 / TICK_HZ;
var MAX_CATCHUP_MS = 250;
var TickLoop = class {
  static {
    __name(this, "TickLoop");
  }
  tick = 0;
  accumulator = 0;
  lastTime = null;
  entities = /* @__PURE__ */ new Map();
  inputs = /* @__PURE__ */ new Map();
  simulate;
  constructor(simulate) {
    this.simulate = simulate;
  }
  addEntity(e) {
    this.entities.set(entityKey(e.registryOrigin, e.id), e);
  }
  removeEntity(origin, id) {
    this.entities.delete(entityKey(origin, id));
  }
  getEntities() {
    return this.entities;
  }
  /** Queue a client's input for the NEXT tick (latest wins within a tick). */
  queueInput(clientId, input) {
    this.inputs.set(clientId, input);
  }
  /**
   * Advance the fixed-step loop to wall-clock `nowMs`. Runs 0+ 50 ms steps;
   * each applies the queued inputs + `simulate`, then clears inputs and bumps
   * the tick. Returns the number of ticks stepped.
   */
  advance(nowMs) {
    if (this.lastTime === null) {
      this.lastTime = nowMs;
      return 0;
    }
    this.accumulator += nowMs - this.lastTime;
    this.lastTime = nowMs;
    if (this.accumulator > MAX_CATCHUP_MS) this.accumulator = MAX_CATCHUP_MS;
    let stepped = 0;
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.simulate(this.entities, this.inputs, TICK_MS, this.tick);
      this.inputs.clear();
      this.tick++;
      stepped++;
    }
    return stepped;
  }
  /** Full snapshot of the current authoritative state (wire fields only). */
  buildSnapshot(worldId, zoneId, out) {
    const entities = out ?? [];
    entities.length = 0;
    for (const e of this.entities.values()) {
      entities.push({
        registryOrigin: e.registryOrigin,
        entityType: e.entityType,
        id: e.id,
        x: e.x,
        y: e.y,
        z: e.z,
        yaw: e.yaw,
        stateBits: e.stateBits
      });
    }
    return { tick: this.tick, baseTick: this.tick, worldId, zoneId, entities };
  }
};

// ../src/features/netcode/server/aoi.ts
function filterAoI(entities, cx, cz, radius, out) {
  out.length = 0;
  const r2 = radius * radius;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const dx = e.x - cx, dz = e.z - cz;
    if (dx * dx + dz * dz <= r2) out.push(e);
  }
  return out;
}
__name(filterAoI, "filterAoI");

// ../src/features/netcode/server/lagCompensation.ts
var LagCompensationBuffer = class {
  static {
    __name(this, "LagCompensationBuffer");
  }
  history = [];
  maxTicks;
  /** @param maxTicks how far back rewinds can reach (20 ≈ 1 s at 20 Hz — covers
   *  worst-case interp-delay + RTT). */
  constructor(maxTicks = 20) {
    this.maxTicks = maxTicks;
  }
  /** Snapshot entity positions at `tick` (called once per server tick). */
  record(tick, entities) {
    const pos = /* @__PURE__ */ new Map();
    for (const [k, e] of entities) pos.set(k, { x: e.x, y: e.y, z: e.z });
    this.history.push({ tick, pos });
    while (this.history.length > this.maxTicks) this.history.shift();
  }
  /** Positions at `tick` (clamped to the buffer; interpolated between recorded
   *  ticks for sub-tick accuracy) into `out`. Called per shot (infrequent). */
  rewind(tick, out) {
    out.clear();
    const h = this.history;
    if (h.length === 0) return;
    if (tick <= h[0].tick) {
      for (const [k, p] of h[0].pos) out.set(k, { ...p });
      return;
    }
    const newest = h[h.length - 1];
    if (tick >= newest.tick) {
      for (const [k, p] of newest.pos) out.set(k, { ...p });
      return;
    }
    let i = 0;
    while (i < h.length - 1 && h[i + 1].tick <= tick) i++;
    const a = h[i], b = h[i + 1];
    const span = b.tick - a.tick;
    const t = span > 0 ? (tick - a.tick) / span : 0;
    for (const [k, pb] of b.pos) {
      const pa = a.pos.get(k);
      if (!pa) {
        out.set(k, { ...pb });
        continue;
      }
      out.set(k, { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: pa.z + (pb.z - pa.z) * t });
    }
  }
  /** Oldest / newest ticks currently rewindable (for clamping client claims). */
  range() {
    if (this.history.length === 0) return null;
    return { oldest: this.history[0].tick, newest: this.history[this.history.length - 1].tick };
  }
};

// ../src/lib/snapshotBinary.ts
var SNAPSHOT_MAGIC = 1146243923;
var SNAPSHOT_VERSION = 1;
var POS_SCALE = 16;
var YAW_SCALE = 65536 / (Math.PI * 2);
var ORIGIN_L1 = 0;
var HEADER_BYTES = 22;
var ENTITY_BYTES = 22;
function quantPos(v) {
  const q = Math.round(v * POS_SCALE);
  return q | 0;
}
__name(quantPos, "quantPos");
function encodeSnapshot(snap) {
  const n = snap.entities.length;
  const buf = new ArrayBuffer(HEADER_BYTES + n * ENTITY_BYTES);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint32(o, SNAPSHOT_MAGIC);
  o += 4;
  dv.setUint8(o, SNAPSHOT_VERSION);
  o += 1;
  dv.setUint8(o, 0);
  o += 1;
  dv.setUint16(o, snap.zoneId & 65535);
  o += 2;
  dv.setUint32(o, snap.tick >>> 0);
  o += 4;
  dv.setUint32(o, snap.baseTick >>> 0);
  o += 4;
  dv.setUint32(o, snap.worldId >>> 0);
  o += 4;
  dv.setUint16(o, n & 65535);
  o += 2;
  for (let i = 0; i < n; i++) {
    const e = snap.entities[i];
    dv.setUint8(o, e.registryOrigin & 255);
    o += 1;
    dv.setUint8(o, e.entityType & 255);
    o += 1;
    dv.setUint32(o, e.id >>> 0);
    o += 4;
    dv.setInt32(o, quantPos(e.x));
    o += 4;
    dv.setInt32(o, quantPos(e.y));
    o += 4;
    dv.setInt32(o, quantPos(e.z));
    o += 4;
    let yaw = e.yaw % (Math.PI * 2);
    if (yaw < 0) yaw += Math.PI * 2;
    dv.setUint16(o, Math.round(yaw * YAW_SCALE) & 65535);
    o += 2;
    dv.setUint16(o, e.stateBits & 65535);
    o += 2;
  }
  return buf;
}
__name(encodeSnapshot, "encodeSnapshot");

// ../src/features/netcode/playerSim.ts
var PLAYER_SPEED = 6;
function stepPlayer(s, cmd, speed = PLAYER_SPEED) {
  const dt = cmd.dtMs / 1e3;
  s.x += cmd.moveX * speed * dt;
  s.z += cmd.moveZ * speed * dt;
  s.yaw = cmd.yaw;
}
__name(stepPlayer, "stepPlayer");

// ../src/features/netcode/inputBinary.ts
var MOVE_SCALE = 1e4;
var YAW_SCALE2 = 65536 / (Math.PI * 2);
function decodeInput(buf) {
  const dv = new DataView(buf);
  return {
    seq: dv.getUint32(0),
    moveX: dv.getInt16(4) / MOVE_SCALE,
    moveZ: dv.getInt16(6) / MOVE_SCALE,
    yaw: dv.getUint16(8) / YAW_SCALE2,
    dtMs: dv.getUint16(10)
  };
}
__name(decodeInput, "decodeInput");

// ../src/features/netcode/server/gameInstanceCore.ts
var ENTITY_PLAYER = 0;
var PLAYER_SPAWN = { x: 0, y: 64, z: 0 };
var GameInstanceCore = class {
  static {
    __name(this, "GameInstanceCore");
  }
  loop;
  lagComp = new LagCompensationBuffer();
  players = /* @__PURE__ */ new Map();
  centers = /* @__PURE__ */ new Map();
  lastSeq = /* @__PURE__ */ new Map();
  nextId = 1;
  filtered = [];
  cfg;
  constructor(cfg) {
    this.cfg = cfg;
    this.loop = new TickLoop(cfg.simulate ?? this.defaultSimulate);
  }
  /** Spawn a player entity for a newly-connected client. Returns its entity id. */
  addPlayer(clientId) {
    const id = this.nextId++;
    const key = entityKey(ORIGIN_L1, id);
    this.players.set(clientId, { id, key });
    this.centers.set(clientId, { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z });
    this.loop.addEntity({
      registryOrigin: ORIGIN_L1,
      entityType: ENTITY_PLAYER,
      id,
      x: PLAYER_SPAWN.x,
      y: PLAYER_SPAWN.y,
      z: PLAYER_SPAWN.z,
      yaw: 0,
      stateBits: 0,
      vx: 0,
      vy: 0,
      vz: 0
    });
    return id;
  }
  removePlayer(clientId) {
    const p = this.players.get(clientId);
    if (!p) return;
    this.loop.removeEntity(ORIGIN_L1, p.id);
    this.players.delete(clientId);
    this.centers.delete(clientId);
    this.lastSeq.delete(clientId);
  }
  /** Decode + queue a raw input frame for the next tick. Unknown clients are
   *  ignored (defensive against a stray message after disconnect). */
  applyInput(clientId, frame) {
    const p = this.players.get(clientId);
    if (!p) return;
    this.loop.queueInput(clientId, { playerKey: p.key, cmd: decodeInput(frame) });
  }
  defaultSimulate = /* @__PURE__ */ __name((entities, inputs) => {
    for (const [clientId, inp] of inputs) {
      const e = entities.get(inp.playerKey);
      if (e) {
        stepPlayer(e, inp.cmd, PLAYER_SPEED);
        this.lastSeq.set(clientId, inp.cmd.seq);
      }
    }
  }, "defaultSimulate");
  /**
   * Advance the loop to `nowMs`. If any ticks ran, fill `out` with each client's
   * AoI-filtered, encoded snapshot (clientId → ArrayBuffer) and return true.
   */
  tick(nowMs, out) {
    out.clear();
    if (this.loop.advance(nowMs) === 0) return false;
    const ents = this.loop.getEntities();
    for (const [clientId, p] of this.players) {
      const e = ents.get(p.key);
      const c = this.centers.get(clientId);
      if (e && c) {
        c.x = e.x;
        c.z = e.z;
      }
    }
    this.lagComp.record(this.loop.tick, ents);
    const full = this.loop.buildSnapshot(this.cfg.worldId, this.cfg.zoneId);
    for (const [clientId, c] of this.centers) {
      filterAoI(full.entities, c.x, c.z, this.cfg.aoiRadius, this.filtered);
      out.set(clientId, encodeSnapshot({ ...full, entities: this.filtered }));
    }
    return true;
  }
  /** Last input seq processed for a client (server→client reconciliation ack). */
  ackSeqFor(clientId) {
    return this.lastSeq.get(clientId) ?? 0;
  }
  get tickNumber() {
    return this.loop.tick;
  }
  playerCount() {
    return this.players.size;
  }
  getLagComp() {
    return this.lagComp;
  }
};

// gameInstanceDO.ts
var AOI_RADIUS = 80;
var GameInstanceDO = class {
  static {
    __name(this, "GameInstanceDO");
  }
  core;
  conns = /* @__PURE__ */ new Map();
  // ws → clientId
  interval = null;
  nextClient = 1;
  outBuffers = /* @__PURE__ */ new Map();
  constructor(_state, _env) {
    this.core = new GameInstanceCore({ worldId: 1, zoneId: 0, aoiRadius: AOI_RADIUS });
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a WebSocket upgrade", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    try {
      server.binaryType = "arraybuffer";
    } catch {
    }
    this.onConnect(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  onConnect(ws) {
    const clientId = `c${this.nextClient++}`;
    this.conns.set(ws, clientId);
    this.core.addPlayer(clientId);
    ws.addEventListener("message", (ev) => {
      const d = ev.data;
      if (d instanceof ArrayBuffer) {
        this.core.applyInput(clientId, d);
      } else if (ArrayBuffer.isView(d)) {
        const v = d;
        this.core.applyInput(clientId, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
      } else if (d && typeof d.arrayBuffer === "function") {
        d.arrayBuffer().then((b) => this.core.applyInput(clientId, b)).catch(() => {
        });
      }
    });
    const drop = /* @__PURE__ */ __name(() => this.onClose(ws), "drop");
    ws.addEventListener("close", drop);
    ws.addEventListener("error", drop);
    this.ensureTicking();
  }
  onClose(ws) {
    const clientId = this.conns.get(ws);
    if (clientId === void 0) return;
    this.core.removePlayer(clientId);
    this.conns.delete(ws);
    if (this.conns.size === 0) this.stopTicking();
  }
  ensureTicking() {
    if (this.interval === null) this.interval = setInterval(() => this.onTick(), TICK_MS);
  }
  stopTicking() {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
  onTick() {
    if (!this.core.tick(Date.now(), this.outBuffers)) return;
    for (const [ws, clientId] of this.conns) {
      const buf = this.outBuffers.get(clientId);
      if (buf) {
        try {
          ws.send(buf);
        } catch {
          this.onClose(ws);
        }
      }
    }
  }
};

// index.ts
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const instance = url.searchParams.get("instance") ?? url.pathname.split("/").filter(Boolean).pop() ?? "default";
    const stub = env.GAME_INSTANCE.get(env.GAME_INSTANCE.idFromName(instance));
    return stub.fetch(request);
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-N8jF4X/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-N8jF4X/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  GameInstanceDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
