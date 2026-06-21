// sw-vip-backfill — admin-only. One-time Siege Worlds VIP backfill. For each archived SW player who
// linked DiviGo (sw_player_snapshot.telegram_id, telegram_confirmed=1), it asks the SSO partner endpoint
// for their REAL DIVI balance + whether they hold the LightningWorks Portal NFT, records it on the
// snapshot (the VIP outreach list), and — if that email already has a Dreadroot account — writes the
// holdings as source='sw-legacy' so the existing supporter-tier logic grants their VIP immediately.
// DIVI is never copied as spendable; these are gating-only mirrors, replaced when the user re-certifies.
//
// POST { limit?, recheck? }  (auth: an admin/superadmin JWT)
// Uses the EXISTING Dreadroot↔SSO app credentials (DIVIGO_APP_SLUG/SECRET) — no new secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', user.id).in('role', ['admin', 'superadmin'])
  if (!roles || roles.length === 0) return json({ error: 'admin only' }, 403)

  const SSO = (Deno.env.get('SSO_BASE_URL') ?? 'https://sso.lightningworks.io').replace(/\/$/, '')
  const appSlug = Deno.env.get('DIVIGO_APP_SLUG') ?? '', appSecret = Deno.env.get('DIVIGO_APP_SECRET') ?? ''
  if (!appSlug || !appSecret) return json({ error: 'DiviGo app credentials not set (DIVIGO_APP_SLUG/SECRET)' }, 503)

  const body = await req.json().catch(() => ({})) as { limit?: number; recheck?: boolean }
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 200)

  // The DIVI token theme + the Portal requirement (Ethereum NFT) the admin configured.
  const { data: diviTheme } = await admin.from('token_themes').select('id').eq('name', 'divi').maybeSingle()
  const diviThemeId = (diviTheme as { id?: string } | null)?.id ?? null
  const { data: nftReqs } = await admin.from('supporter_requirements')
    .select('nft_collection, nft_chain, nft_schema, nft_template_id').eq('gate_kind', 'nft')
  const portalReq = ((nftReqs as { nft_collection: string; nft_chain: string | null; nft_schema: string | null; nft_template_id: number | null }[]) ?? [])
    .find((r) => (r.nft_chain ?? '').toLowerCase() === 'ethereum' && r.nft_collection)
  const portalContract = portalReq?.nft_collection ?? ''

  // Candidates: linked + confirmed, not yet checked (unless recheck).
  let q = admin.from('sw_player_snapshot')
    .select('sw_id, email, telegram_id, telegram_confirmed')
    .not('telegram_id', 'is', null).eq('telegram_confirmed', 1).limit(limit)
  if (!body.recheck) q = q.is('holdings_checked_at', null)
  const { data: rows } = await q
  const candidates = (rows as { sw_id: string; email: string | null; telegram_id: string; telegram_confirmed: number }[]) ?? []

  // Build an email -> user_id map once (admin job; a few pages of users).
  const emailToId = new Map<string, string>()
  for (let page = 1; page <= 50; page++) {
    const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    const users = list?.users ?? []
    for (const u of users) if (u.email) emailToId.set(u.email.toLowerCase(), u.id)
    if (users.length < 1000) break
  }

  const nowIso = new Date().toISOString()
  let checked = 0, withDivi = 0, withPortal = 0, matched = 0, applied = 0

  for (const row of candidates) {
    let divi = 0, hasPortal = false
    try {
      const r = await fetch(`${SSO}/api/divigo/partner-holdings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-LW-App-Slug': appSlug, 'X-LW-App-Secret': appSecret },
        body: JSON.stringify({ number: row.telegram_id, route: 'telegram', portalContract }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { divi = Number(d.divi) || 0; hasPortal = !!d.hasPortal }
    } catch (_e) { /* leave zeros; row still marked checked so we can retry via recheck */ }

    checked++
    if (divi > 0) withDivi++
    if (hasPortal) withPortal++

    const matchedId = row.email ? emailToId.get(row.email.toLowerCase()) ?? null : null
    if (matchedId) matched++

    const patch: Record<string, unknown> = {
      divi_live: divi, has_portal: hasPortal, holdings_checked_at: nowIso, matched_user_id: matchedId,
    }

    // If this SW user already has a Dreadroot account, apply the VIP holdings now.
    if (matchedId) {
      await admin.from('user_divigo_links').upsert({
        user_id: matchedId, divigo_number: row.telegram_id, divigo_route: 'telegram', source: 'sw-legacy', updated_at: nowIso,
      }, { onConflict: 'user_id' })

      if (diviThemeId && divi > 0) {
        await admin.from('user_external_holdings').delete()
          .eq('user_id', matchedId).eq('token_theme_id', diviThemeId).eq('account', 'sw-legacy')
        await admin.from('user_external_holdings').insert({
          user_id: matchedId, token_theme_id: diviThemeId, chain: 'divi', account: 'sw-legacy',
          amount: divi, source: 'sw-legacy', updated_at: nowIso,
        })
      }
      if (hasPortal && portalReq) {
        await admin.from('user_nft_holdings').delete()
          .eq('user_id', matchedId).eq('collection', portalReq.nft_collection).eq('source', 'sw-legacy')
        await admin.from('user_nft_holdings').insert({
          user_id: matchedId, collection: portalReq.nft_collection, schema_name: portalReq.nft_schema ?? '',
          template_id: portalReq.nft_template_id ?? 0, asset_count: 1, source: 'sw-legacy', updated_at: nowIso,
        })
      }
      patch.vip_applied_at = nowIso
      applied++
    }

    await admin.from('sw_player_snapshot').update(patch).eq('sw_id', row.sw_id)
    await sleep(250) // be gentle on the DiviGo gateway
  }

  return json({
    ok: true, processed: checked, withDivi, withPortal, matchedToAccounts: matched, vipApplied: applied,
    portalContract: portalContract || null, note: candidates.length === limit ? 'more rows remain — call again' : 'batch drained',
  })
})
