-- Review recovery loop: record how a complaint was opened and resolved.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewed_via text;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_reviewed_via_check;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewed_via_check CHECK (reviewed_via IN ('inbox', 'push_action', 'push_deeplink'));

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS resolution text;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_resolution_check;
ALTER TABLE reviews ADD CONSTRAINT reviews_resolution_check CHECK (resolution IN ('guest_recovered', 'compensation_given', 'guest_already_left', 'could_not_resolve', 'not_an_issue'));
