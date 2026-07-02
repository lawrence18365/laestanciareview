-- Link a quote back to the event lead it was created from (/quotes/new?leadId).
-- Nullable so direct/manual quotes with no originating lead stay valid.
-- ON DELETE SET NULL keeps the quote if the lead is purged. Idempotent:
-- safe to re-run.

ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "lead_id" integer
  REFERENCES "event_leads" ("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "quotes_lead_idx" ON "quotes" ("lead_id");
