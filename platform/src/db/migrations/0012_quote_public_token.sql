-- Client-facing quote delivery. public_token is an unguessable share slug for
-- the read-only /q/[token] page; sent_at stamps the first WhatsApp send.
-- Both nullable: an unsent quote has neither. Idempotent: safe to re-run.
-- The unique index tolerates many NULLs (unsent quotes) in Postgres.

ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "public_token" text;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "sent_at" timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS "quotes_public_token_uniq"
  ON "quotes" ("public_token");
