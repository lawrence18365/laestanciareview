ALTER TABLE "commercial_leads"
  ADD COLUMN IF NOT EXISTS "next_action" text,
  ADD COLUMN IF NOT EXISTS "contacted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "lost_reason" text,
  ADD COLUMN IF NOT EXISTS "won_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "lost_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "commercial_leads_contacted_idx"
  ON "commercial_leads" ("contacted_at");
