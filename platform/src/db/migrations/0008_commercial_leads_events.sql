CREATE TABLE IF NOT EXISTS "commercial_leads" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text,
  "business_name" text NOT NULL,
  "email" text,
  "phone" text,
  "city" text,
  "source" text NOT NULL DEFAULT 'unknown',
  "landing_path" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_term" text,
  "utm_content" text,
  "offer" text NOT NULL DEFAULT 'unknown',
  "status" text NOT NULL DEFAULT 'new',
  "email_normalized" text,
  "phone_normalized" text,
  "business_name_normalized" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "commercial_leads_dedupe_key_uniq"
  ON "commercial_leads" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "commercial_leads_status_idx"
  ON "commercial_leads" ("status");
CREATE INDEX IF NOT EXISTS "commercial_leads_created_idx"
  ON "commercial_leads" ("created_at");
CREATE INDEX IF NOT EXISTS "commercial_leads_email_idx"
  ON "commercial_leads" ("email_normalized");
CREATE INDEX IF NOT EXISTS "commercial_leads_phone_idx"
  ON "commercial_leads" ("phone_normalized");

CREATE TABLE IF NOT EXISTS "commercial_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer REFERENCES "commercial_leads"("id") ON DELETE SET NULL,
  "restaurant_id" integer REFERENCES "restaurants"("id") ON DELETE SET NULL,
  "event_name" text NOT NULL,
  "source" text,
  "path" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commercial_events_lead_idx"
  ON "commercial_events" ("lead_id");
CREATE INDEX IF NOT EXISTS "commercial_events_restaurant_idx"
  ON "commercial_events" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "commercial_events_name_idx"
  ON "commercial_events" ("event_name");
CREATE INDEX IF NOT EXISTS "commercial_events_created_idx"
  ON "commercial_events" ("created_at");

ALTER TABLE "pending_signups"
  ADD COLUMN IF NOT EXISTS "lead_id" integer REFERENCES "commercial_leads"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "pending_signups_lead_idx"
  ON "pending_signups" ("lead_id");
