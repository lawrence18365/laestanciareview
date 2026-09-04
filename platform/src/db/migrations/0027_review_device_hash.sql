ALTER TABLE reviews ADD COLUMN IF NOT EXISTS device_hash text;

CREATE INDEX IF NOT EXISTS reviews_device_hash_created_idx ON reviews (device_hash, created_at);
