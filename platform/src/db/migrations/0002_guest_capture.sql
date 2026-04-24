-- Guest Capture CRM module: adds brand column + guests/guest_visits tables.
-- Idempotent: safe to re-run.

ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "brand" text;
CREATE INDEX IF NOT EXISTS "restaurants_brand_idx" ON "restaurants" ("brand");

-- Backfill brand from slug prefix (mirrors the lookup in lib/brands.ts).
-- Skips owner/regional rows since they aren't single-brand.
UPDATE "restaurants" SET "brand" = CASE
  WHEN "slug" LIKE 'estancia%'     THEN 'estancia'
  WHEN "slug" LIKE 'harbors%'      THEN 'harbors'
  WHEN "slug" LIKE 'la-silla%'     THEN 'la-silla'
  WHEN "slug" LIKE 'steakcompany%' THEN 'steakcompany'
  WHEN "slug" LIKE 'real%'         THEN 'real'
  WHEN "slug" LIKE 'regio%'        THEN 'regio'
  ELSE NULL
END
WHERE "brand" IS NULL
  AND "is_owner"    = false
  AND "is_regional" = false;

DO $$ BEGIN
  CREATE TYPE "guest_status" AS ENUM ('pending_validation', 'validated', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "redemption_type" AS ENUM ('copa_vino', 'postre', 'otro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "guests" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "brand" text NOT NULL,
  "name" text NOT NULL,
  "whatsapp" text NOT NULL,
  "birthday_mmdd" text,
  "preferences" text[],
  "marketing_consent" boolean NOT NULL DEFAULT false,
  "validation_code" text,
  "status" guest_status NOT NULL DEFAULT 'pending_validation',
  "validated_at" timestamp with time zone,
  "validated_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "redemption_type" redemption_type,
  "promo_type" text,
  "captured_at" timestamp with time zone NOT NULL DEFAULT now(),
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "notes" text,
  "metadata" jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS "guests_whatsapp_brand_uniq" ON "guests" ("whatsapp", "brand");
CREATE INDEX IF NOT EXISTS "guests_birthday_idx"    ON "guests" ("birthday_mmdd");
CREATE INDEX IF NOT EXISTS "guests_restaurant_idx"  ON "guests" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "guests_status_idx"      ON "guests" ("status");
CREATE INDEX IF NOT EXISTS "guests_brand_idx"       ON "guests" ("brand");

CREATE TABLE IF NOT EXISTS "guest_visits" (
  "id" serial PRIMARY KEY,
  "guest_id" integer NOT NULL REFERENCES "guests"("id") ON DELETE CASCADE,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "visit_date" timestamp with time zone NOT NULL DEFAULT now(),
  "notes" text,
  "logged_by" integer REFERENCES "staff"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "guest_visits_guest_idx"      ON "guest_visits" ("guest_id");
CREATE INDEX IF NOT EXISTS "guest_visits_restaurant_idx" ON "guest_visits" ("restaurant_id");
