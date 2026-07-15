-- Event-revenue campaigns: a consent-safe audience, honest outreach state,
-- and a reconciled booking ledger for performance pricing.
-- Idempotent so the same migration can be verified/re-run safely.

CREATE TABLE IF NOT EXISTS "event_campaigns" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "campaign_type" text NOT NULL DEFAULT 'house_event',
  "audience_rule" text NOT NULL DEFAULT 'all_consented',
  "status" text NOT NULL DEFAULT 'draft',
  "event_date" date NOT NULL,
  "event_time" text,
  "offer_name" text NOT NULL,
  "message_text" text NOT NULL,
  "price_per_person" numeric(12,2) NOT NULL DEFAULT 0,
  "capacity" integer NOT NULL DEFAULT 1,
  "minimum_seats" integer NOT NULL DEFAULT 0,
  "baseline_seats" integer NOT NULL DEFAULT 0,
  "attribution_days" integer NOT NULL DEFAULT 30,
  "fee_percent" numeric(5,2) NOT NULL DEFAULT 12,
  "audience_seeded_at" timestamptz,
  "launched_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "event_campaigns_type_check"
    CHECK ("campaign_type" IN ('house_event', 'private_pipeline')),
  CONSTRAINT "event_campaigns_audience_check"
    CHECK ("audience_rule" IN ('all_consented', 'wine', 'vip')),
  CONSTRAINT "event_campaigns_status_check"
    CHECK ("status" IN ('draft', 'ready', 'active', 'paused', 'completed', 'cancelled')),
  CONSTRAINT "event_campaigns_capacity_check"
    CHECK ("capacity" > 0 AND "minimum_seats" >= 0 AND "baseline_seats" >= 0),
  CONSTRAINT "event_campaigns_attribution_check"
    CHECK ("attribution_days" BETWEEN 1 AND 180),
  CONSTRAINT "event_campaigns_fee_check"
    CHECK ("fee_percent" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_campaigns_restaurant_slug_uniq"
  ON "event_campaigns" ("restaurant_id", "slug");
CREATE INDEX IF NOT EXISTS "event_campaigns_restaurant_status_idx"
  ON "event_campaigns" ("restaurant_id", "status", "event_date");

CREATE TABLE IF NOT EXISTS "campaign_contacts" (
  "id" serial PRIMARY KEY,
  "campaign_id" integer NOT NULL REFERENCES "event_campaigns"("id") ON DELETE CASCADE,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "guest_id" integer NOT NULL REFERENCES "guests"("id") ON DELETE CASCADE,
  "segment" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 100,
  "status" text NOT NULL DEFAULT 'queued',
  "opened_at" timestamptz,
  "sent_at" timestamptz,
  "replied_at" timestamptz,
  "opted_out_at" timestamptz,
  "last_action_at" timestamptz,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "campaign_contacts_status_check"
    CHECK ("status" IN ('queued', 'opened', 'sent', 'replied', 'interested', 'deposit_pending', 'booked', 'declined', 'opted_out'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_contacts_campaign_guest_uniq"
  ON "campaign_contacts" ("campaign_id", "guest_id");
CREATE INDEX IF NOT EXISTS "campaign_contacts_campaign_status_idx"
  ON "campaign_contacts" ("campaign_id", "status", "priority");
CREATE INDEX IF NOT EXISTS "campaign_contacts_restaurant_idx"
  ON "campaign_contacts" ("restaurant_id");

CREATE TABLE IF NOT EXISTS "campaign_bookings" (
  "id" serial PRIMARY KEY,
  "campaign_id" integer NOT NULL REFERENCES "event_campaigns"("id") ON DELETE CASCADE,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "contact_id" integer REFERENCES "campaign_contacts"("id") ON DELETE SET NULL,
  "guest_id" integer REFERENCES "guests"("id") ON DELETE SET NULL,
  "quote_id" integer REFERENCES "quotes"("id") ON DELETE SET NULL,
  "event_lead_id" integer REFERENCES "event_leads"("id") ON DELETE SET NULL,
  "client_name" text NOT NULL,
  "client_phone" text,
  "party_size" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'inquiry',
  "attribution_source" text NOT NULL DEFAULT 'direct',
  "attribution_evidence" text,
  "booked_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "deposit_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "collected_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "refunded_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "iva_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "service_charge_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "gratuity_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "eligible_revenue" numeric(12,2) NOT NULL DEFAULT 0,
  "fee_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "deposit_received_at" timestamptz,
  "booked_at" timestamptz,
  "attended_at" timestamptz,
  "cancelled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "campaign_bookings_party_size_check" CHECK ("party_size" > 0),
  CONSTRAINT "campaign_bookings_status_check"
    CHECK ("status" IN ('inquiry', 'quoted', 'deposit_pending', 'booked', 'attended', 'cancelled', 'refunded')),
  CONSTRAINT "campaign_bookings_attribution_check"
    CHECK ("attribution_source" IN ('direct', 'matched', 'assisted', 'organic')),
  CONSTRAINT "campaign_bookings_money_check"
    CHECK (
      "booked_amount" >= 0 AND "deposit_amount" >= 0 AND
      "collected_amount" >= 0 AND "refunded_amount" >= 0 AND
      "iva_amount" >= 0 AND "service_charge_amount" >= 0 AND
      "gratuity_amount" >= 0 AND "eligible_revenue" >= 0 AND
      "fee_amount" >= 0
    )
);

CREATE INDEX IF NOT EXISTS "campaign_bookings_campaign_status_idx"
  ON "campaign_bookings" ("campaign_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "campaign_bookings_restaurant_idx"
  ON "campaign_bookings" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "campaign_bookings_contact_idx"
  ON "campaign_bookings" ("contact_id");
