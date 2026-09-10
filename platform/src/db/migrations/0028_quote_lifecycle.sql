-- Quote lifecycle: close the loop from "sent" to "money in the till".
--
-- Until now every quote ever written sat in one undifferentiated list with
-- status draft | sent, and nothing recorded what happened next. That makes the
-- one number worth having — quotes sent, events won, pesos collected —
-- impossible to compute.
--
-- Nothing is deleted. The 33 existing quotes are the only conversion data
-- RateTap has, and dropping them would destroy the denominator. They keep their
-- current status and simply become part of the history.
--
-- status now takes: draft | sent | won | declined | expired
--   draft     still being written
--   sent      delivered to the client, awaiting an answer
--   won       the event happened (Ganada)
--   declined  the client said no (Declinada)
--   expired   the quote aged out with no answer (Vencida)
--
-- The collected amount is recorded by hand rather than derived from
-- config_json. The quote total is a builder-computed estimate; what actually
-- landed is a real-world figure the GM knows. Since this number is meant to go
-- in front of the owner and outside prospects, it has to be the real one.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS outcome_amount_mxn integer,
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_note text;

COMMENT ON COLUMN quotes.outcome_amount_mxn IS
  'Pesos actually collected for a won quote. Entered by hand, not derived from config_json.';
COMMENT ON COLUMN quotes.outcome_at IS
  'When the quote reached a terminal status (won/declined/expired).';
COMMENT ON COLUMN quotes.status IS
  'draft | sent | won | declined | expired. Active view shows draft + sent.';

-- Terminal statuses are what the conversion readout groups by, and the active
-- list filters on status, so both paths want an index that already exists
-- (quotes_status_idx). Add one for outcome_at so a period readout can range
-- scan instead of sorting the whole table.
CREATE INDEX IF NOT EXISTS quotes_outcome_at_idx ON quotes (outcome_at);

-- Guard rail: a won quote should carry an amount and a date. Enforced as a
-- CHECK rather than NOT NULL so the existing rows stay valid.
ALTER TABLE quotes
  DROP CONSTRAINT IF EXISTS quotes_won_needs_outcome;
ALTER TABLE quotes
  ADD CONSTRAINT quotes_won_needs_outcome
  CHECK (status <> 'won' OR (outcome_amount_mxn IS NOT NULL AND outcome_at IS NOT NULL));
