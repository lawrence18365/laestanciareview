-- Review recovery loop: record how a complaint was opened and resolved.
ALTER TABLE reviews ADD COLUMN reviewed_via text;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewed_via_check CHECK (reviewed_via IN ('inbox', 'push_action', 'push_deeplink'));

ALTER TABLE reviews ADD COLUMN resolution text;
ALTER TABLE reviews ADD CONSTRAINT reviews_resolution_check CHECK (resolution IN ('guest_recovered', 'compensation_given', 'guest_already_left', 'could_not_resolve', 'not_an_issue'));
