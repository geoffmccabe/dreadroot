// sync-holdings — mirror the caller's REAL on-chain holdings (across ALL their linked chains) into the
// gating mirrors so supporter-tier requirements + token gates evaluate them. Chain-agnostic: it reads
// every row in user_wallet_links for the user and, per chain, asks the SSO for holdings:
//   wax                      -> /api/wax-holdings?account=
//   ethereum | base | polygon-> /api/evm-holdings?address=&chain=
//   divi                     -> /api/divi-holdings?address=
// then writes:
//   - NFTs  -> user_nft_holdings       (count per collection/schema/template; EVM keyed by contract)
//   - tokens-> user_external_holdings  (amount per matched token_theme — NOT spendable balance)
// POST, auth = caller's JWT. Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
// optional SSO_BASE_URL. See docs/SUPPORTER_TIERS_PLAN.md.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const EVM_CHAINS = new Set(['ethereum', 'base', 'polygon'])

interface ThemeRow { id: string; ticker_symbol: string | null; blockchain: string | null; contract_address: string | null }
interface ReqRow { gate_kind: string; nft_chain: string | null; nft_collection: string | null; nft_schema: string | null; nft_template_id: number | null }
interface NftAcc { user_id: string; collection: string; schema_name: string; template_id: number; asset_count: number; updated_at: string }
interface ExtAcc { user_id: string; token_theme_id: string; chain: string; account: string; amount: number; updated_at: string }

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

  const [linkRes, themeRes, reqRes] = await Promise.all([
    admin.from('user_wallet_links').select('chain, account').eq('user_id', user.id),
    admin.from('token_themes').select('id, ticker_symbol, blockchain, contract_address'),
    admin.from('supporter_requirements').select('gate_kind, nft_chain, nft_collection, nft_schema, nft_template_id'),
  ])
  const links = ((linkRes.data as { chain: string; account: string }[]) ?? []).filter((l) => l.account)
  if (!links.length) return json({ error: 'no linked wallets', tokens: 0, nfts: 0 }, 400)
  const themes = (themeRes.data as ThemeRow[]) ?? []
  const reqs = (reqRes.data as ReqRow[]) ?? []

  const norm = (s: string | null) => (s ?? '').trim().toLowerCase()
  // token_theme lookup: match by chain + (contract, else ticker). Divi falls back to ticker only.
  const findTheme = (chain: string, symbol: string, contract: string | null): string | null => {
    const sym = symbol.toUpperCase(), con = contract ? contract.toLowerCase() : null;
    for (const t of themes) {
      if (norm(t.blockchain) !== chain) continue;
      if (con && t.contract_address && t.contract_address.toLowerCase() === con) return t.id;
      if (!con && (t.ticker_symbol ?? '').toUpperCase() === sym) return t.id;
    }
    // ticker-only fallback (covers themes with no/zero blockchain field, e.g. Divi)
    for (const t of themes) if ((t.ticker_symbol ?? '').toUpperCase() === sym) return t.id;
    return null;
  }

  const SSO = (Deno.env.get('SSO_BASE_URL') ?? 'https://sso.lightningworks.io').replace(/\/$/, '')
  const nowIso = new Date().toISOString()
  const nftAcc: NftAcc[] = []
  const extByKey = new Map<string, ExtAcc>() // key = token_theme_id (keep the largest amount seen)
  const pushExt = (themeId: string | null, chain: string, account: string, amount: number) => {
    if (!themeId) return;
    const prev = extByKey.get(themeId);
    if (!prev || amount > prev.amount) extByKey.set(themeId, { user_id: user.id, token_theme_id: themeId, chain, account, amount, updated_at: nowIso });
  }

  for (const link of links) {
    const chain = norm(link.chain), account = link.account;
    try {
      if (chain === 'wax') {
        const d = await fetch(`${SSO}/api/wax-holdings?account=${encodeURIComponent(account)}`).then((r) => r.json())
        for (const t of (d.tokens ?? [])) pushExt(findTheme('wax', t.symbol ?? '', t.contract ?? null), 'wax', account, t.amount ?? 0)
        for (const n of (d.nfts ?? [])) if (n.collection && (n.count ?? 0) > 0)
          nftAcc.push({ user_id: user.id, collection: n.collection, schema_name: n.schema ?? '', template_id: n.template_id ?? 0, asset_count: n.count, updated_at: nowIso })
      } else if (EVM_CHAINS.has(chain)) {
        const d = await fetch(`${SSO}/api/evm-holdings?address=${encodeURIComponent(account)}&chain=${chain}`).then((r) => r.json())
        for (const t of (d.tokens ?? [])) pushExt(findTheme(chain, t.symbol ?? '', t.contract ?? null), chain, account, t.amount ?? 0)
        // NFTs: only mirror contracts that a requirement actually gates on, keyed by the requirement's
        // exact nft_collection string so the client's strict collection match succeeds.
        const byContract = new Map<string, number>()
        for (const n of (d.nfts ?? [])) if (n.contract) byContract.set(String(n.contract).toLowerCase(), n.count ?? 0)
        for (const r of reqs) {
          if (r.gate_kind !== 'nft' || norm(r.nft_chain) !== chain || !r.nft_collection) continue;
          const count = byContract.get(r.nft_collection.toLowerCase()) ?? 0;
          if (count > 0) nftAcc.push({ user_id: user.id, collection: r.nft_collection, schema_name: r.nft_schema ?? '', template_id: r.nft_template_id ?? 0, asset_count: count, updated_at: nowIso })
        }
      } else if (chain === 'divi') {
        const d = await fetch(`${SSO}/api/divi-holdings?address=${encodeURIComponent(account)}`).then((r) => r.json())
        for (const t of (d.tokens ?? [])) pushExt(findTheme('divi', t.symbol ?? 'DIVI', null), 'divi', account, t.amount ?? 0)
      }
    } catch (e) {
      console.error(`[sync-holdings] ${chain} fetch failed`, (e as Error).message)
    }
  }

  // Replace both mirrors for this user (so sold-off assets drop out).
  await admin.from('user_nft_holdings').delete().eq('user_id', user.id)
  if (nftAcc.length) await admin.from('user_nft_holdings').insert(nftAcc)
  await admin.from('user_external_holdings').delete().eq('user_id', user.id)
  const extRows = Array.from(extByKey.values())
  if (extRows.length) await admin.from('user_external_holdings').insert(extRows)

  return json({ ok: true, chains: links.map((l) => l.chain), tokens: extRows.length, nfts: nftAcc.length })
})
