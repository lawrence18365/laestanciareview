ALTER TABLE "commercial_leads"
  ADD COLUMN IF NOT EXISTS "next_action_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "commercial_leads_next_action_idx"
  ON "commercial_leads" ("next_action_at");

ALTER TABLE "prospect_queue"
  ADD COLUMN IF NOT EXISTS "commercial_lead_id" integer REFERENCES "commercial_leads"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "delivery_status" text,
  ADD COLUMN IF NOT EXISTS "provider" text,
  ADD COLUMN IF NOT EXISTS "provider_message_id" text,
  ADD COLUMN IF NOT EXISTS "viewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_outreach_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_follow_up_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "next_action_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "follow_up_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reply_text" text,
  ADD COLUMN IF NOT EXISTS "booked_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "won_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "lost_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();

ALTER TABLE "prospect_queue"
  ALTER COLUMN "status" SET DEFAULT 'identified';

UPDATE "prospect_queue"
  SET "status" = 'identified'
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "prospect_queue_commercial_lead_idx"
  ON "prospect_queue" ("commercial_lead_id");
CREATE INDEX IF NOT EXISTS "prospect_queue_status_idx"
  ON "prospect_queue" ("status");
CREATE INDEX IF NOT EXISTS "prospect_queue_next_action_idx"
  ON "prospect_queue" ("next_action_at");
CREATE INDEX IF NOT EXISTS "prospect_queue_provider_message_idx"
  ON "prospect_queue" ("provider_message_id");

CREATE TABLE IF NOT EXISTS "prospect_outreach_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "place_id" text REFERENCES "prospect_queue"("place_id") ON DELETE SET NULL,
  "commercial_lead_id" integer REFERENCES "commercial_leads"("id") ON DELETE SET NULL,
  "event_name" text NOT NULL,
  "provider" text,
  "provider_message_id" text,
  "status" text,
  "payload" jsonb,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "prospect_outreach_events_place_idx"
  ON "prospect_outreach_events" ("place_id");
CREATE INDEX IF NOT EXISTS "prospect_outreach_events_lead_idx"
  ON "prospect_outreach_events" ("commercial_lead_id");
CREATE INDEX IF NOT EXISTS "prospect_outreach_events_name_idx"
  ON "prospect_outreach_events" ("event_name");
CREATE INDEX IF NOT EXISTS "prospect_outreach_events_created_idx"
  ON "prospect_outreach_events" ("created_at");

ALTER TABLE "prospect_views"
  ADD COLUMN IF NOT EXISTS "last_follow_up_at" timestamp with time zone;
