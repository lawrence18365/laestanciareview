ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "revoked_reason" text,
  ADD COLUMN IF NOT EXISTS "device_kind" text,
  ADD COLUMN IF NOT EXISTS "user_agent" text,
  ADD COLUMN IF NOT EXISTS "last_subscribed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "resubscribe_count" integer;

UPDATE "push_subscriptions"
SET "last_subscribed_at" = COALESCE("created_at", now())
WHERE "last_subscribed_at" IS NULL;

UPDATE "push_subscriptions"
SET "resubscribe_count" = 0
WHERE "resubscribe_count" IS NULL;

ALTER TABLE "push_subscriptions"
  ALTER COLUMN "last_subscribed_at" SET DEFAULT now(),
  ALTER COLUMN "last_subscribed_at" SET NOT NULL,
  ALTER COLUMN "resubscribe_count" SET DEFAULT 0,
  ALTER COLUMN "resubscribe_count" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'push_subs_revoked_reason_check'
      AND conrelid = 'push_subscriptions'::regclass
  ) THEN
    ALTER TABLE "push_subscriptions"
      ADD CONSTRAINT "push_subs_revoked_reason_check"
      CHECK (
        "revoked_reason" IS NULL
        OR "revoked_reason" IN (
          'user_unsubscribe',
          'endpoint_invalid',
          'permission_revoked',
          'unknown'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'push_subs_device_kind_check'
      AND conrelid = 'push_subscriptions'::regclass
  ) THEN
    ALTER TABLE "push_subscriptions"
      ADD CONSTRAINT "push_subs_device_kind_check"
      CHECK (
        "device_kind" IS NULL
        OR "device_kind" IN (
          'ios_pwa',
          'ios_safari',
          'android',
          'desktop',
          'unknown'
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "push_subs_restaurant_active_idx"
  ON "push_subscriptions" ("restaurant_id")
  WHERE "revoked_at" IS NULL;

UPDATE "push_subscriptions" AS ps
SET "role" = CASE
  WHEN r."is_owner" IS TRUE THEN 'owner'
  WHEN r."is_regional" IS TRUE THEN 'regional'
  ELSE 'gm'
END
FROM "restaurants" AS r
WHERE ps."restaurant_id" = r."id"
  AND ps."role" IS NULL;
