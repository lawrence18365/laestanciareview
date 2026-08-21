ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "billing_provider" text;

CREATE TABLE IF NOT EXISTS "mercadopago_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "preapproval_id" text UNIQUE,
  "external_reference" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "plan" text NOT NULL DEFAULT 'pro',
  "amount" numeric(10,2) NOT NULL,
  "currency" text NOT NULL DEFAULT 'MXN',
  "payer_email" text,
  "next_payment_date" timestamptz,
  "last_payment_status" text,
  "last_payment_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mercadopago_subscriptions_restaurant_idx"
  ON "mercadopago_subscriptions" ("restaurant_id");

CREATE TABLE IF NOT EXISTS "processed_mercadopago_events" (
  "event_id" text PRIMARY KEY,
  "processed_at" timestamptz NOT NULL DEFAULT now()
);
