/**
 * Worker entry — routes an incoming WebSocket request to the right L2 game
 * instance (one Durable Object per `instance` id). The client connects to
 *   wss://<worker-host>/?instance=<id>&token=<jwt>
 * which the netcode WebSocketTransport already builds.
 *
 * Auth (validating the join token) + L2 lifecycle (Track 5) land here later;
 * for now any id spins up / joins its DO.
 */
import { GameInstanceDO, type Env } from './gameInstanceDO';

export { GameInstanceDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Join gate: if a shared secret is configured, the connection must present it
    // as ?token=. No secret set → open (local/dev). This is a placeholder for
    // per-user signed tokens issued by L1 (Track 5/6); it at least stops random
    // scanners + gives a single point to swap in real auth.
    if (env.JOIN_SECRET && url.searchParams.get('token') !== env.JOIN_SECRET) {
      return new Response('unauthorized', { status: 403 });
    }
    const instance = url.searchParams.get('instance')
      ?? url.pathname.split('/').filter(Boolean).pop()
      ?? 'default';
    const stub = env.GAME_INSTANCE.get(env.GAME_INSTANCE.idFromName(instance));
    return stub.fetch(request);
  },
};
