-- Harden public checkout status and private feedback submission.

CREATE TABLE IF NOT EXISTS "pending_signups" (
  "id" text PRIMARY KEY,
  "status_token_hash" text NOT NULL,
  "checkout_session_id" text UNIQUE,
  "stripe_subscription_id" text,
  "stripe_customer_id" text,
  "restaurant_id" integer REFERENCES "restaurants"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'checkout_started',
  "business_name" text NOT NULL,
  "contact_name" text,
  "email" text NOT NULL,
  "phone" text,
  "city" text,
  "google_place_id" text,
  "password_hash" text NOT NULL,
  "shipping_address" text,
  "expires_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pending_signups_checkout_idx"
  ON "pending_signups" ("checkout_session_id");
CREATE INDEX IF NOT EXISTS "pending_signups_expires_idx"
  ON "pending_signups" ("expires_at");
CREATE INDEX IF NOT EXISTS "pending_signups_restaurant_idx"
  ON "pending_signups" ("restaurant_id");

ALTER TABLE "reviews"
  ADD COLUMN IF NOT EXISTS "feedback_token_hash" text;
