ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "campaign_tag" text;

CREATE INDEX IF NOT EXISTS "quotes_restaurant_campaign_tag_idx" ON "quotes" ("restaurant_id", "campaign_tag");

-- Internal campaign tag (Posadas 2026 holiday campaign). Additive and nullable, no backfill.
--
--   campaign_tag  free-text label grouping quotes into a campaign, e.g.
--                 'Posadas 2026'. Typed by the hostess in the quote builder
--                 (Campaña) and used by /quotes to filter the pipeline and
--                 show per-campaign counts. Max 60 chars, validated in
--                 lib/validations.ts.
--
-- It is deliberately NOT stored in config_json: that blob is rendered on the
-- public /q/[token] page, and the campaign is internal. NULL means no campaign,
-- exactly as before this migration, so every existing quote renders and filters
-- identically.
