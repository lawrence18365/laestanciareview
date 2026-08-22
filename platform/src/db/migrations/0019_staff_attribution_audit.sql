CREATE TABLE IF NOT EXISTS "staff_attribution_backfill" (
  "id" bigserial PRIMARY KEY,
  "review_id" integer NOT NULL REFERENCES "reviews"("id") ON DELETE CASCADE,
  "restaurant_id" integer NOT NULL,
  "old_staff_id" integer,
  "old_staff_name" text,
  "new_staff_id" integer NOT NULL,
  "new_staff_name" text NOT NULL,
  "matched_code" text NOT NULL,
  "original_staff_code" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "staff_attribution_backfill_review_idx"
  ON "staff_attribution_backfill" ("review_id");

CREATE INDEX IF NOT EXISTS "staff_attribution_backfill_restaurant_applied_idx"
  ON "staff_attribution_backfill" ("restaurant_id", "applied_at");
