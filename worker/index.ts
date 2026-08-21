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

/**
 * Origins allowed to open a game socket. Cloudflare's own protections stop at
 * the HTTP 101 handshake, so this is the one layer where acting on the request
 * itself still helps: it keeps casual scanners and other sites from opening
 * connections that spin up Durable Objects (which cost money and hold memory).
 *
 * It is NOT an authentication mechanism — Origin is trivially forged by a
 * non-browser client. Real per-user join tokens are Phase 3. This is a cheap
 * lid, not a lock.
 */
const ALLOWED_ORIGIN_HOSTS = [
  'dreadroot.com',
  'www.dreadroot.com',
  'localhost',
  '127.0.0.1',
];

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  // No Origin at all = a non-browser caller (curl, smoke tests, wrangler dev).
  // Permitted, because blocking it buys nothing against a real attacker while
  // breaking our own tooling.
  if (origin === null) return true;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_ORIGIN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Instance names this worker will route to.
 *   shadow        the shared world used while server monsters are being tested
 *   world-<uuid>  a real world, one server each (the eventual shape)
 *   smoke-<n>     throwaway instances for the automated live test
 */
const INSTANCE_PATTERN = /^(shadow|world-[0-9a-f-]{36}|smoke-[a-z0-9-]{1,32})$/i;

function isAllowedInstance(name: string): boolean {
  return name.length <= 64 && INSTANCE_PATTERN.test(name);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!originAllowed(request)) {
      return new Response('forbidden origin', { status: 403 });
    }
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

    // Only known instance shapes may be addressed. Previously ANY string
    // created a Durable Object, so anyone could spin up unlimited live game
    // servers just by inventing names — each one billable while connected.
    // This does not replace authentication (still Phase 3); it reduces an
    // unbounded namespace to a small, predictable one.
    if (!isAllowedInstance(instance)) {
      return new Response('unknown instance', { status: 400 });
    }
    const stub = env.GAME_INSTANCE.get(env.GAME_INSTANCE.idFromName(instance));
    return stub.fetch(request);
  },
};
