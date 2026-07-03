import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { MongoClient } from 'npm:mongodb@6.3.0'

// Siege Worlds legacy ITEM claim — Mongo → DreadRoot/SWW Vault, on login.
//
// MongoDB is the source of truth for SW items. On every login the client calls
// this function with the player's session. We take the SSO-verified EMAIL from
// the JWT (never from client input), look the player up in Mongo by that email,
// and re-sync their items into the Vault (user_slots, region='vault').
//
// RE-SYNC MODEL (idempotent): every Vault row this function writes is tagged
// source='sw-legacy'. On each run we DELETE this user's existing sw-legacy rows
// and re-insert fresh from Mongo. Native DreadRoot/SWW items (source IS NULL)
// are never touched. So re-running can't duplicate, and Mongo stays the truth.
//
// SWAPPABLE SOURCE: the Mongo connection is one secret, SW_MONGO_URI. When the
// new unified MongoDB is ready, change that secret only — no code change. The
// Phase-2 back-fill (native items → Mongo) bolts onto the same source tag.
//
// FAIL-SAFE: this must NEVER block login. Any Mongo/lookup failure returns 200
// with { claimed:false, reason } so the game loads regardless.
//
// Deploy (dashboard): create function 'sw-claim-items', paste this file.
//   Secret:  SW_MONGO_URI = <mongodb+srv URI of the mirror / new DB>
//   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected.)
//   Atlas → Network Access must allow the function's egress (0.0.0.0/0 for
//   Supabase Edge, or use the new DB's allow-list).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Ownership = inventory + bank + equipment + forge (NOT action_bar = layout ptr).
const FIELDS: [string, string | null][] = [
  ['inventory_item_ids', 'inventory_item_counts'],
  ['bank_item_ids', 'bank_item_counts'],
  ['equipment_item_ids', 'equipment_item_counts'],
  ['forge_item_ids', null],
]
const MAXQ = 10000      // max quantity per Vault slot (stacks split beyond this)
const MAX_PAGES = 32    // user_slots.page CHECK is 0..31
const MONGO_DB = 'siege_worlds'
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const MONGO_URI = Deno.env.get('SW_MONGO_URI') ?? ''

  // 1. Identify the caller from their JWT. Email comes ONLY from the verified token.
  const authHeader = req.headers.get('Authorization') ?? ''
  const authed = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData, error: authErr } = await authed.auth.getUser()
  const user = userData?.user
  if (authErr || !user?.id) return json({ claimed: false, reason: 'not authenticated' }, 401)
  const email = (user.email ?? '').trim().toLowerCase()
  if (!email) return json({ claimed: false, reason: 'no email on account' })

  if (!MONGO_URI) return json({ claimed: false, reason: 'source not configured' })

  // Service-role client for all reads/writes below.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 2. Read the player's holdings from Mongo (source of truth). Fail-safe.
  let owned: Map<number, number>
  let swUsername = ''
  const mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 })
  try {
    await mongo.connect()
    const players = mongo.db(MONGO_DB).collection('players')
    // One email can map to multiple SW accounts (a real one + empties); pick the
    // account holding the most items. The live SW DB keys email on `email_address`;
    // the snapshot/new DB may use `email` — match either.
    const rx = { $regex: `^${escapeRx(email)}$`, $options: 'i' }
    const docs = await players
      .find({ $or: [{ email_address: rx }, { email: rx }] })
      .toArray()
    if (docs.length === 0) return json({ claimed: false, reason: 'no legacy account for this email' })

    const sumOwned = (p: Record<string, unknown>): Map<number, number> => {
      const m = new Map<number, number>()
      for (const [idF, cF] of FIELDS) {
        const ids = p[idF]
        if (!Array.isArray(ids)) continue
        const counts = cF ? (p[cF] as unknown[]) : null
        ids.forEach((id: unknown, i: number) => {
          if (typeof id === 'number' && id >= 0) {
            const q = counts && typeof counts[i] === 'number' ? (counts[i] as number) : 1
            if (q > 0) m.set(id, (m.get(id) ?? 0) + q)
          }
        })
      }
      return m
    }
    const totalOf = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0)
    let best: Map<number, number> = new Map()
    for (const p of docs) {
      const m = sumOwned(p as Record<string, unknown>)
      if (totalOf(m) >= totalOf(best)) { best = m; swUsername = String((p as { username?: string }).username ?? '') }
    }
    owned = best
  } catch (e) {
    console.error('[sw-claim-items] Mongo read failed (non-fatal):', (e as Error).message)
    return json({ claimed: false, reason: 'source unavailable' })
  } finally {
    await mongo.close().catch(() => {})
  }

  if (owned.size === 0) return json({ claimed: false, reason: 'legacy account has no items', swUsername })

  // 3. Map SW int item id -> items.id (UUID) from the items table.
  const { data: itemRows, error: itemErr } = await admin
    .from('items').select('id, item_number').not('item_number', 'is', null)
  if (itemErr) { console.error('[sw-claim-items] items map failed:', itemErr.message); return json({ claimed: false, reason: 'item map error' }) }
  const swToUuid = new Map<number, string>()
  for (const r of itemRows ?? []) swToUuid.set(r.item_number as number, r.id as string)

  // 4. Vault grid config (UI shows cols*rows slots PER PAGE; we must page to match).
  const { data: cfgRows } = await admin
    .from('user_vault_config').select('page_count, cols, rows').eq('user_id', user.id).limit(1)
  let pageCount = cfgRows?.[0]?.page_count ?? 4
  const cols = cfgRows?.[0]?.cols ?? 5
  const gridRows = cfgRows?.[0]?.rows ?? 5
  const perPage = cols * gridRows

  // 5. Existing vault slots. Native rows (source IS NULL) are sacred and keep
  //    their slots; our previous sw-legacy rows get cleared and rebuilt.
  const { data: existing } = await admin
    .from('user_slots').select('page, slot, source').eq('user_id', user.id).eq('region', 'vault')
  const nativeUsed = new Set<string>()
  for (const s of existing ?? []) if (s.source !== 'sw-legacy') nativeUsed.add(`${s.page}:${s.slot}`)

  // 6. Clear this user's previous sw-legacy rows across ALL regions (idempotent
  //    re-sync). Region-agnostic so a legacy item the player moved out of the
  //    vault (into inventory/quickslot/equip) can't survive and then duplicate
  //    when we re-place it from Mongo below. Native rows (source NULL) untouched.
  await admin.from('user_slots').delete().eq('user_id', user.id).eq('source', 'sw-legacy')

  // 7. Count rows needed (quantity-split) and expand page_count if required.
  let neededRows = 0
  const skipped: number[] = []
  for (const [swInt, qty] of owned) {
    if (!swToUuid.has(swInt)) { skipped.push(swInt); continue }
    neededRows += Math.ceil(qty / MAXQ)
  }
  const requiredPages = Math.ceil((nativeUsed.size + neededRows) / perPage)
  if (requiredPages > pageCount) {
    const newCount = Math.min(MAX_PAGES, requiredPages)
    await admin.from('user_vault_config').update({ page_count: newCount }).eq('user_id', user.id)
    pageCount = newCount
  }

  // 8. Place into free slots (skipping native-occupied) and build rows.
  function* freeSlots() {
    for (let pg = 0; pg < pageCount; pg++)
      for (let s = 0; s < perPage; s++) {
        const k = `${pg}:${s}`
        if (!nativeUsed.has(k)) { nativeUsed.add(k); yield { page: pg, slot: s } }
      }
  }
  const gen = freeSlots()
  const rows: Record<string, unknown>[] = []
  let truncated = false
  for (const [swInt, qty] of [...owned.entries()].sort((a, b) => a[0] - b[0])) {
    const uuid = swToUuid.get(swInt)
    if (!uuid) continue
    let remaining = qty
    while (remaining > 0) {
      const chunk = Math.min(remaining, MAXQ)
      remaining -= chunk
      const sl = gen.next().value
      if (!sl) { truncated = true; break }
      rows.push({ user_id: user.id, region: 'vault', page: sl.page, slot: sl.slot, item_id: uuid, quantity: chunk, source: 'sw-legacy' })
    }
    if (truncated) break
  }

  // 9. Insert in batches.
  let written = 0
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const { error } = await admin.from('user_slots').insert(batch)
    if (error) { console.error('[sw-claim-items] insert failed:', error.message); return json({ claimed: false, reason: 'write error', written }) }
    written += batch.length
  }

  return json({
    claimed: true,
    swUsername,
    distinctItems: owned.size,
    rowsWritten: written,
    skippedUnmapped: skipped,
    vaultFullTruncated: truncated,
  })
})
