// paypal-webhook — receives PayPal Billing Subscription events, verifies them against PayPal, and
// reconciles the user_subscriptions row. Deploy with --no-verify-jwt. Register the endpoint URL as a
// PayPal webhook and put its id in PAYPAL_WEBHOOK_ID. See docs/SUBSCRIPTION_PAYMENTS_SETUP.md.
// Required secrets: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_WEBHOOK_ID, optional PAYPAL_API_BASE.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const BASE = Deno.env.get('PAYPAL_API_BASE') ?? 'https://api-m.paypal.com'

async function token(): Promise<string> {
  const auth = btoa(`${Deno.env.get('PAYPAL_CLIENT_ID')}:${Deno.env.get('PAYPAL_SECRET')}`)
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  }).then((r) => r.json())
  return r.access_token
}

function mapStatus(s: string): string {
  const u = (s || '').toUpperCase()
  if (u === 'ACTIVE') return 'active'
  if (u === 'CANCELLED' || u === 'SUSPENDED') return 'cancelled'
  return 'expired'
}

Deno.serve(async (req) => {
  const raw = await req.text()
  let event: Record<string, unknown>
  try { event = JSON.parse(raw) } catch { return new Response('bad json', { status: 400 }) }

  // Verify the event came from PayPal.
  try {
    const access = await token()
    const verify = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: req.headers.get('paypal-auth-algo'),
        cert_url: req.headers.get('paypal-cert-url'),
        transmission_id: req.headers.get('paypal-transmission-id'),
        transmission_sig: req.headers.get('paypal-transmission-sig'),
        transmission_time: req.headers.get('paypal-transmission-time'),
        webhook_id: Deno.env.get('PAYPAL_WEBHOOK_ID'),
        webhook_event: event,
      }),
    }).then((r) => r.json())
    if (verify.verification_status !== 'SUCCESS') return new Response('verification failed', { status: 400 })
  } catch (e) {
    return new Response(`verify error: ${(e as Error).message}`, { status: 400 })
  }

  try {
    const type = String(event.event_type || '')
    if (type.startsWith('BILLING.SUBSCRIPTION.')) {
      const r = event.resource as Record<string, unknown>
      const custom = String(r.custom_id ?? '')          // "<user_id>:<tier_id>"
      const [userId, tierId] = custom.split(':')
      if (userId && tierId) {
        const nextBilling = (r.billing_info as { next_billing_time?: string } | undefined)?.next_billing_time ?? null
        await admin.from('user_subscriptions').upsert({
          user_id: userId,
          tier_id: tierId,
          provider: 'paypal',
          provider_subscription_id: String(r.id ?? ''),
          status: mapStatus(String(r.status ?? '')),
          paid_until: nextBilling,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'provider_subscription_id' })
      }
    }
  } catch (e) {
    console.error('[paypal-webhook] handler error', e)
    return new Response('handler error', { status: 500 })
  }

  return new Response('ok')
})
