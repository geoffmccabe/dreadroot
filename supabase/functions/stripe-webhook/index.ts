// stripe-webhook — receives Stripe subscription events, verifies the signature, and reconciles the
// user_subscriptions row. Deploy with --no-verify-jwt (Stripe is not a logged-in user). Register the
// endpoint URL in Stripe and put its signing secret in STRIPE_WEBHOOK_SECRET. See
// docs/SUBSCRIPTION_PAYMENTS_SETUP.md. Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
import Stripe from 'https://esm.sh/stripe@14.25.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

function mapStatus(s: string): string {
  if (s === 'active' || s === 'trialing') return 'active'
  if (s === 'canceled') return 'cancelled'
  return 'expired'
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature') ?? ''
  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!)
  } catch (e) {
    return new Response(`bad signature: ${(e as Error).message}`, { status: 400 })
  }

  try {
    if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.user_id
      const tierId = sub.metadata?.tier_id
      if (userId && tierId) {
        await admin.from('user_subscriptions').upsert({
          user_id: userId,
          tier_id: tierId,
          provider: 'stripe',
          provider_subscription_id: sub.id,
          provider_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
          status: mapStatus(sub.status),
          paid_until: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'provider_subscription_id' })
      }
    }
  } catch (e) {
    console.error('[stripe-webhook] handler error', e)
    return new Response('handler error', { status: 500 })
  }

  return new Response('ok')
})
