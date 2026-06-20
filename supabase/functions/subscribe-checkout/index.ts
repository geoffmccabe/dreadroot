// subscribe-checkout — start a supporter-tier subscription via Stripe or PayPal.
// POST { tier_id, provider: 'stripe' | 'paypal' }  (auth: the caller's Supabase JWT)
// -> { url }  — redirect the user there to pay. The webhook (stripe-webhook / paypal-webhook)
// activates the user_subscriptions row on payment. See docs/SUBSCRIPTION_PAYMENTS_SETUP.md.
//
// Required function secrets: STRIPE_SECRET_KEY, PAYPAL_CLIENT_ID, PAYPAL_SECRET,
// optional PAYPAL_API_BASE (default live), SITE_URL (default https://dreadroot.com).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Identify the caller from their JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return json({ error: 'not authenticated' }, 401)

  let body: { tier_id?: string; provider?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid body' }, 400) }
  const { tier_id, provider } = body
  if (!tier_id || !provider) return json({ error: 'tier_id and provider required' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: tier } = await admin.from('supporter_tiers').select('*').eq('id', tier_id).single()
  if (!tier) return json({ error: 'tier not found' }, 404)

  const SITE = Deno.env.get('SITE_URL') ?? 'https://dreadroot.com'
  const success = `${SITE}/?subscribed=${encodeURIComponent(tier.name)}`
  const cancel = `${SITE}/?subscribe_cancelled=1`

  if (provider === 'stripe') {
    if (!tier.stripe_price_id) return json({ error: 'tier has no stripe_price_id' }, 400)
    const p = new URLSearchParams()
    p.set('mode', 'subscription')
    p.set('line_items[0][price]', tier.stripe_price_id)
    p.set('line_items[0][quantity]', '1')
    p.set('success_url', success)
    p.set('cancel_url', cancel)
    p.set('client_reference_id', user.id)
    p.set('subscription_data[metadata][user_id]', user.id)
    p.set('subscription_data[metadata][tier_id]', tier_id)
    if (user.email) p.set('customer_email', user.email)
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: p.toString(),
    })
    const s = await r.json()
    if (!r.ok) return json({ error: s.error?.message ?? 'stripe error' }, 502)
    return json({ url: s.url })
  }

  if (provider === 'paypal') {
    if (!tier.paypal_plan_id) return json({ error: 'tier has no paypal_plan_id' }, 400)
    const base = Deno.env.get('PAYPAL_API_BASE') ?? 'https://api-m.paypal.com'
    const auth = btoa(`${Deno.env.get('PAYPAL_CLIENT_ID')}:${Deno.env.get('PAYPAL_SECRET')}`)
    const tok = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }).then((r) => r.json())
    if (!tok.access_token) return json({ error: 'paypal auth failed' }, 502)
    const r = await fetch(`${base}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: tier.paypal_plan_id,
        custom_id: `${user.id}:${tier_id}`,
        application_context: { return_url: success, cancel_url: cancel, user_action: 'SUBSCRIBE_NOW' },
      }),
    })
    const sub = await r.json()
    const approve = (sub.links ?? []).find((l: { rel: string; href: string }) => l.rel === 'approve')?.href
    if (!approve) return json({ error: sub.message ?? 'paypal error' }, 502)
    return json({ url: approve })
  }

  return json({ error: 'unknown provider' }, 400)
})
