ALTER TABLE "mercadopago_subscriptions"
  ADD COLUMN IF NOT EXISTS "base_amount" numeric(10,2),
  ADD COLUMN IF NOT EXISTS "processing_charge_amount" numeric(10,2),
  ADD COLUMN IF NOT EXISTS "tax_amount" numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_amount" numeric(10,2),
  ADD COLUMN IF NOT EXISTS "billing_starts_at" timestamptz;
