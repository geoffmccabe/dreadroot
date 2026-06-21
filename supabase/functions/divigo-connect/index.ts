// divigo-connect — stores the caller's LW-SSO DiviGo bearer token after they authorize DreadRoot on
// the SSO consent screen (/wallet/divi/grant). The token (balance:read scope) lets sync-holdings read
// the player's authoritative custodial DIVI balance, which also proves wallet control (the SSO only
// mints it after a verified Telegram link). POST { app_token } | { disconnect: true }. Auth = JWT.
// Secrets: SUPABASE_*, DIVIGO_APP_SLUG, DIVIGO_APP_SECRET, optional SSO_BASE_URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'not authenticated' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const body = await req.json().catch(() => ({})) as { app_token?: string; disconnect?: boolean }

  if (body.disconnect) {
    await admin.from('user_divigo_links').delete().eq('user_id', user.id)
    return json({ ok: true, linked: false })
  }

  const token = (body.app_token ?? '').trim()
  if (!token) return json({ error: 'app_token required' }, 400)

  const SSO = (Deno.env.get('SSO_BASE_URL') ?? 'https://sso.lightningworks.io').replace(/\/$/, '')
  const slug = Deno.env.get('DIVIGO_APP_SLUG') ?? ''
  const secret = Deno.env.get('DIVIGO_APP_SECRET') ?? ''
  if (!slug || !secret) return json({ error: 'app not configured (DIVIGO_APP_SLUG/SECRET)' }, 503)

  // Validate the token actually resolves for our app before we store it.
  try {
    const r = await fetch(`${SSO}/api/oauth/divigo/status`, {
      headers: { 'X-LW-App-Slug': slug, 'X-LW-App-Secret': secret, Authorization: `Bearer ${token}` },
    })
    const s = await r.json().catch(() => ({}))
    if (!r.ok) return json({ error: s.error ?? `sso ${r.status}` }, 400)
    // status returns 200 even for an unbound token — a resolved balance:read scope is the real proof
    // the token is valid, bound to our app, and usable. (Granting requires a verified DiviGo link.)
    if (!Array.isArray(s.scopes) || !s.scopes.includes('balance:read')) {
      return json({ error: 'token not valid for this app, or balance access not granted', linked: false }, 400)
    }
  } catch (e) {
    return json({ error: `validate failed: ${(e as Error).message}` }, 502)
  }

  await admin.from('user_divigo_links').upsert({
    user_id: user.id, app_token: token, verified: true, source: 'oauth', updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  // Real re-certification: the user has now connected their own DiviGo, so drop any honorary
  // Siege Worlds 'sw-legacy' holdings — the next sync-holdings writes their live, verified values.
  await admin.from('user_external_holdings').delete().eq('user_id', user.id).eq('source', 'sw-legacy')
  await admin.from('user_nft_holdings').delete().eq('user_id', user.id).eq('source', 'sw-legacy')

  return json({ ok: true, linked: true })
})
