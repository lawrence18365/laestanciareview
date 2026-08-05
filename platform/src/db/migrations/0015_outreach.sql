-- Outreach email engine infrastructure (Phase 1)

CREATE TABLE IF NOT EXISTS "outreach_prospects" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "kind" text NOT NULL CHECK ("kind" IN ('leon', 'group')),
  "place_id" text,
  "phone" text,
  "city" text,
  "rating" numeric,
  "source_url" text,
  "confidence" text,
  "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'in_sequence', 'finished', 'replied', 'opted_out')),
  "touches_sent" integer NOT NULL DEFAULT 0,
  "last_touch_at" timestamptz,
  "next_touch_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "outreach_prospects_status_idx"
  ON "outreach_prospects" ("status");

CREATE INDEX IF NOT EXISTS "outreach_prospects_kind_idx"
  ON "outreach_prospects" ("kind");

CREATE INDEX IF NOT EXISTS "outreach_prospects_next_touch_idx"
  ON "outreach_prospects" ("next_touch_at")
  WHERE "next_touch_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "outreach_prospects_email_idx"
  ON "outreach_prospects" ("email");

CREATE TABLE IF NOT EXISTS "outreach_events" (
  "id" serial PRIMARY KEY,
  "prospect_id" integer NOT NULL REFERENCES "outreach_prospects"("id") ON DELETE CASCADE,
  "type" text NOT NULL CHECK ("type" IN ('sent', 'failed', 'unsubscribed', 'audit_viewed', 'alerted')),
  "touch_number" integer,
  "meta" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "outreach_events_prospect_idx"
  ON "outreach_events" ("prospect_id");

CREATE INDEX IF NOT EXISTS "outreach_events_type_idx"
  ON "outreach_events" ("type");

CREATE INDEX IF NOT EXISTS "outreach_events_created_idx"
  ON "outreach_events" ("created_at");
