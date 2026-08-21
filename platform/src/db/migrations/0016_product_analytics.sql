-- Product Analytics V1 (Phase 1): event capture + push delivery attribution

CREATE TABLE IF NOT EXISTS "product_events" (
  "id" bigserial PRIMARY KEY,
  "event_name" text NOT NULL,
  "restaurant_id" integer REFERENCES "restaurants"("id") ON DELETE SET NULL,
  "role" text,
  "staff_id" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "session_id" text,
  "path" text,
  "display_mode" text,
  "properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "product_events_name_created_idx"
  ON "product_events" ("event_name", "created_at");

CREATE INDEX IF NOT EXISTS "product_events_restaurant_created_idx"
  ON "product_events" ("restaurant_id", "created_at");

CREATE TABLE IF NOT EXISTS "push_notifications" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "subject_type" text,
  "subject_id" integer,
  "url" text NOT NULL,
  "subscriptions_targeted" integer NOT NULL DEFAULT 0,
  "accepted_count" integer NOT NULL DEFAULT 0,
  "failed_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "push_notifications_restaurant_created_idx"
  ON "push_notifications" ("restaurant_id", "created_at");

ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamptz;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz;

ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "role" text;
