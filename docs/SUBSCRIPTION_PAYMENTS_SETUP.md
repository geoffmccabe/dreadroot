# Supporter Subscription Payments — Setup (Stripe + PayPal)

Everything is built and deployed; this is the checklist to turn it ON once you have accounts. No code
changes needed — you only paste keys and product ids.

## What's already in the codebase

- **Migration** `supabase/migrations/20260620140000_subscription_payments.sql` — adds
  `supporter_tiers.stripe_price_id` / `.paypal_plan_id` and `user_subscriptions.provider` /
  `.provider_subscription_id` / `.provider_customer_id`.
- **Edge functions** (`supabase/functions/`):
  - `subscribe-checkout` — client calls it; returns the pay URL to redirect to.
  - `stripe-webhook` — Stripe calls it on payment; activates the subscription.
  - `paypal-webhook` — PayPal calls it on payment; activates the subscription.
- **UI** — Admin → Users → Supporters: each tier has **Stripe price** / **PayPal plan** id fields.
  User Panel → Support Level: each locked paid tier shows **Card** and **PayPal** subscribe buttons.

The webhooks reconcile `user_subscriptions` (status + paid_until). `useSupporterStatus` already treats
an `active` subscription as unlocking the tier, so benefits/effective level update automatically.

## 1. Apply the migration

Paste `20260620140000_subscription_payments.sql` in the Supabase SQL editor (or push via CLI).

## 2. Stripe

1. Create a **recurring Product + Price** per paid tier (monthly, USD). Copy each Price id (`price_…`).
2. Paste it into Admin → Users → Supporters → that tier → **Stripe price**.
3. Add a webhook endpoint → `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`,
   events: `customer.subscription.created`, `.updated`, `.deleted`. Copy its **Signing secret**.
4. Set function secrets (Supabase → Edge Functions → Secrets):
   - `STRIPE_SECRET_KEY` = `sk_live_…`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_…`

## 3. PayPal

1. Create a **Subscription Plan** per paid tier (monthly, USD). Copy each Plan id (`P-…`).
2. Paste it into Admin → Users → Supporters → that tier → **PayPal plan**.
3. Create an app → copy **Client ID** + **Secret**. Add a webhook →
   `https://<project-ref>.supabase.co/functions/v1/paypal-webhook`, events:
   `BILLING.SUBSCRIPTION.ACTIVATED`, `.CANCELLED`, `.EXPIRED`, `.SUSPENDED`. Copy its **Webhook ID**.
4. Set function secrets:
   - `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`
   - `PAYPAL_API_BASE` = `https://api-m.sandbox.paypal.com` for testing (omit for live).

## 4. Shared secrets / deploy

- `SITE_URL` = `https://dreadroot.com` (success/cancel redirect base; defaults to that).
- Deploy the three functions. The two **webhooks must be deployed `--no-verify-jwt`** (Stripe/PayPal
  aren't logged-in users): `supabase functions deploy stripe-webhook --no-verify-jwt` (same for paypal).
  `subscribe-checkout` keeps JWT verification (it identifies the player).

## 5. Test

Locked paid tier → **Card**/**PayPal** → pay in test mode → webhook flips the row to `active` → the
tier shows **subscribed** and benefits apply. Wiring those benefits into gameplay is Phase 5 (separate).
