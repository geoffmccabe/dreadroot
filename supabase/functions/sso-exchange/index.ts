import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

// Lightningworks SSO → DreadRoot session bridge.
//
// Token-handoff model: the client captures the SSO access_token from the
// callback URL fragment and POSTs it here. We verify it server-side with the
// SSO, then map the SSO-verified EMAIL (1:1) to a DreadRoot Supabase auth
// user (find-or-create), and hand back a magiclink token_hash the client
// exchanges via supabase.auth.verifyOtp() for a real DreadRoot session.
// RLS / auth.uid() / existing world data are untouched — it's a normal user.
//
// SECURITY: the email is taken ONLY from the SSO /api/verify response, never
// from client input. The client can only supply the opaque SSO access_token.
//
// Deploy with verify_jwt DISABLED (the caller is not yet authenticated):
//   supabase functions deploy sso-exchange --no-verify-jwt
// Set the SSO base URL secret (SUPABASE_* are auto-injected):
//   supabase secrets set SSO_BASE_URL=https://sso.lightningworks.io

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SSO_BASE_URL = (Deno.env.get('SSO_BASE_URL') ?? 'https://sso.lightningworks.io').replace(/\/$/, '')

  let accessToken: string | null = null
  try {
    const body = await req.json()
    accessToken = body?.access_token ?? null
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!accessToken || typeof accessToken !== 'string') {
    return json({ error: 'Missing access_token' }, 400)
  }

  // 1. Verify the SSO token server-to-server. Email comes ONLY from here.
  let profile: { email?: string; username?: string; display_name?: string } = {}
  try {
    const vr = await fetch(`${SSO_BASE_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken }),
    })
    if (!vr.ok) return json({ error: 'SSO token invalid' }, 401)
    const data = await vr.json()
    if (!data?.valid || !data?.user?.email) return json({ error: 'SSO token not valid' }, 401)
    profile = data.user
  } catch (e) {
    return json({ error: `SSO verify failed: ${(e as Error).message}` }, 502)
  }

  const email = String(profile.email).trim().toLowerCase()
  if (!email) return json({ error: 'SSO returned no email' }, 401)

  // 2. Admin client (service role is auto-injected for edge functions).
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // 3. Find-or-create the DreadRoot auth user BY EMAIL (1:1 mapping —
  //    existing accounts keep their world; new SSO users auto-provision).
  //    This runs on EVERY login, so "user already exists" is the NORMAL
  //    case and must never 500. We also don't hard-fail on other createUser
  //    problems: step 4's generateLink(magiclink) creates a missing user
  //    anyway, so generateLink is the only legitimate login blocker.
  //    (Detect "exists" by status/code/message — supabase-js error shapes
  //    vary by version; the old single-regex check was the bug.)
  const looksLikeUserExists = (
    msg?: string | null,
    code?: string | null,
    status?: number | null,
  ): boolean =>
    status === 422 ||
    code === 'email_exists' ||
    (!!msg && /already.*(regist|been|exist)|email.*exist|exists/i.test(msg))

  try {
    const { error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        sso: 'lightningworks',
        username: profile.username ?? null,
        display_name: profile.display_name ?? null,
      },
    })
    if (
      error &&
      !looksLikeUserExists(error.message, (error as { code?: string }).code, (error as { status?: number }).status)
    ) {
      // Unexpected — but generateLink below creates the user if missing,
      // so log and continue rather than block a legitimate login.
      console.warn('[sso-exchange] createUser non-fatal error:', error.message)
    }
  } catch (e) {
    const err = e as { message?: string; code?: string; status?: number }
    if (!looksLikeUserExists(err.message, err.code, err.status)) {
      console.warn('[sso-exchange] createUser threw (non-fatal):', err.message)
    }
  }

  // 4. Mint a real DreadRoot session: generate a magiclink and return its
  //    token_hash for the client to complete via verifyOtp().
  try {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (error || !data?.properties?.hashed_token) {
      return json({ error: `Session mint failed: ${error?.message ?? 'no token'}` }, 500)
    }
    return json({ token_hash: data.properties.hashed_token, email })
  } catch (e) {
    return json({ error: `Session mint error: ${(e as Error).message}` }, 500)
  }
})
