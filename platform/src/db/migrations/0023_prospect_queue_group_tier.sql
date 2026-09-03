ALTER TABLE prospect_queue ADD COLUMN IF NOT EXISTS tier text, ADD COLUMN IF NOT EXISTS locations integer, ADD COLUMN IF NOT EXISTS owner_name text;
CREATE INDEX IF NOT EXISTS prospect_queue_tier_idx ON prospect_queue (tier);
