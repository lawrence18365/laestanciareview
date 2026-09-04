ALTER TABLE reviews ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

CREATE INDEX IF NOT EXISTS reviews_open_complaints_idx ON reviews (restaurant_id, created_at) WHERE feedback IS NOT NULL AND status <> 'resolved';
