// sync-wax-holdings — mirror the caller's REAL on-chain WAX holdings into the gating mirrors so
// supporter-tier requirements and token gates can evaluate them. Reads the player's linked WAX account
// (user_wallet_links, chain='wax'), asks the SSO for holdings, then:
//   - NFTs  -> user_nft_holdings        (count per collection/schema/template)
//   - tokens-> user_external_holdings    (amount per matched token_theme — NOT spendable balance)
// Tokens are matched to token_themes by blockchain='wax' + ticker_symbol. POST, auth = caller's JWT.
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, optional SSO_BASE_URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

interface WaxToken { symbol: string; contract: string | null; amount: number; decimals: number }
interface WaxNft { collection: string; schema: string; template_id: number; count: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Identify the caller.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'not authenticated' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // The player's linked WAX account.
  const { data: link } = await admin.from('user_wallet_links').select('account').eq('user_id', user.id).eq('chain', 'wax').maybeSingle()
  const account = (link as { account?: string } | null)?.account
  if (!account) return json({ error: 'no linked wax account', tokens: 0, nfts: 0 }, 400)

  // Pull holdings from the SSO.
  const SSO = (Deno.env.get('SSO_BASE_URL') ?? 'https://sso.lightningworks.io').replace(/\/$/, '')
  let holdings: { tokens: WaxToken[]; nfts: WaxNft[] }
  try {
    const r = await fetch(`${SSO}/api/wax-holdings?account=${encodeURIComponent(account)}`)
    if (!r.ok) return json({ error: `sso ${r.status}` }, 502)
    holdings = await r.json()
  } catch (e) {
    return json({ error: `sso fetch failed: ${(e as Error).message}` }, 502)
  }
  const tokens = holdings.tokens ?? []
  const nfts = holdings.nfts ?? []

  // Map WAX tokens -> token_themes (blockchain='wax', by ticker_symbol, case-insensitive).
  const { data: themeRows } = await admin.from('token_themes').select('id, ticker_symbol').eq('blockchain', 'wax')
  const themeBySym = new Map<string, string>()
  for (const t of (themeRows as { id: string; ticker_symbol: string | null }[] ?? [])) {
    if (t.ticker_symbol) themeBySym.set(t.ticker_symbol.toUpperCase(), t.id)
  }

  const nowIso = new Date().toISOString()
  const extRows = tokens
    .map((t) => ({ themeId: themeBySym.get((t.symbol ?? '').toUpperCase()), amount: t.amount }))
    .filter((x): x is { themeId: string; amount: number } => !!x.themeId)
    .map((x) => ({ user_id: user.id, token_theme_id: x.themeId, chain: 'wax', account, amount: x.amount, updated_at: nowIso }))

  // Replace this account's external token mirror (so sold-off balances drop to 0/absent).
  await admin.from('user_external_holdings').delete().eq('user_id', user.id).eq('account', account)
  if (extRows.length) await admin.from('user_external_holdings').insert(extRows)

  // Replace this user's NFT mirror (user_nft_holdings is purely an external gating mirror).
  const nftRows = nfts
    .filter((n) => n.collection && n.count > 0)
    .map((n) => ({
      user_id: user.id,
      collection: n.collection,
      schema_name: n.schema ?? '',
      template_id: n.template_id ?? 0,
      asset_count: n.count,
      updated_at: nowIso,
    }))
  await admin.from('user_nft_holdings').delete().eq('user_id', user.id)
  if (nftRows.length) await admin.from('user_nft_holdings').insert(nftRows)

  return json({ ok: true, account, tokens: extRows.length, nfts: nftRows.length })
})
