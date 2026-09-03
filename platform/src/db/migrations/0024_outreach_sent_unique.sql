CREATE UNIQUE INDEX IF NOT EXISTS outreach_events_sent_once_idx ON outreach_events (prospect_id, touch_number) WHERE type = 'sent';
