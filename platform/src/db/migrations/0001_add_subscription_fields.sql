-- Adds self-serve signup + Stripe trial fields. Apply via `npm run db:push` or manually.
-- Idempotent: safe to re-run.

ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "contact_name" text;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "subscription_status" text NOT NULL DEFAULT 'active';
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "shipping_address" text;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "nfc_cards_shipped_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "processed_stripe_events" (
  "event_id" text PRIMARY KEY,
  "processed_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "restaurants_stripe_customer_id_uniq"
  ON "restaurants" ("stripe_customer_id") WHERE "stripe_customer_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "restaurants_stripe_subscription_id_uniq"
  ON "restaurants" ("stripe_subscription_id") WHERE "stripe_subscription_id" IS NOT NULL;
