-- Security hardening: single-use password-reset tokens, validation-code expiry.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_restaurant_idx
  ON password_reset_tokens(restaurant_id);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
  ON password_reset_tokens(expires_at);

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS validation_code_expires_at timestamptz;

-- Backfill expiry for existing pending codes: 24h after capture.
UPDATE guests
SET validation_code_expires_at = captured_at + interval '24 hours'
WHERE validation_code IS NOT NULL
  AND validation_code_expires_at IS NULL
  AND status = 'pending_validation';
