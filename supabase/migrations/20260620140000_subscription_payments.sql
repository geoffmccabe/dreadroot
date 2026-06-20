-- Subscription payment provisions for Stripe + PayPal. Per-tier provider product/plan ids, and the
-- subscription record gains provider linkage so webhooks can reconcile. Webhooks write via the
-- service role (bypass RLS); the client only reads its own. See docs/SUBSCRIPTION_PAYMENTS_SETUP.md.

-- Per-tier provider product ids (set these after you create the products in Stripe/PayPal).
alter table public.supporter_tiers
  add column if not exists stripe_price_id text,   -- Stripe recurring Price id (price_…)
  add column if not exists paypal_plan_id  text;   -- PayPal Billing Plan id (P-…)

-- Subscription record ↔ provider linkage.
alter table public.user_subscriptions
  add column if not exists provider                text,   -- 'stripe' | 'paypal'
  add column if not exists provider_subscription_id text,  -- sub_… / I-…
  add column if not exists provider_customer_id     text;

-- One row per provider subscription (webhooks upsert on this). Nullable → many manual rows still ok.
create unique index if not exists user_subscriptions_provider_sub_uidx
  on public.user_subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;
