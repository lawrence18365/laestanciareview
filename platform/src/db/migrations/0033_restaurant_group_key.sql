ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "group_key" text;

CREATE INDEX IF NOT EXISTS "restaurants_group_key_idx" ON "restaurants" ("group_key");

UPDATE "restaurants"
SET "group_key" = 'grupo-estancia'
WHERE "group_key" IS NULL
  AND ("brand" IS NOT NULL OR "is_owner" = true OR "is_regional" = true);

-- group_key scopes every owner/regional view, digest and escalation fan-out to
-- one restaurant group. NULL means "its own island": a NULL-group location is
-- never shown to, and never alerts, an owner or regional account, and an
-- owner/regional account with a NULL group_key sees nothing. NULL never
-- matches NULL.
--
-- Self-serve trials (api/signup/create-checkout -> signup-provisioning) keep
-- group_key NULL on purpose.
--
-- Backfill confirmed with a read-only SELECT against prod on 2026-10-13: the
-- WHERE clause above matches 16 rows =
--   12 locations (estancia-angelopolis, estancia-juarez, estancia-queretaro,
--     estancia-leon, estancia-veracruz, estancia-xalapa, harbors-angelopolis,
--     harbors-veracruz, la-silla-juarez, la-silla-huexotitla,
--     steakcompany-queretaro, regio-norte)
--   + 1 owner account (owner)
--   + 3 regional accounts (regional-queretaro, regional-veracruz,
--     regional-central).
-- The 3 rows it leaves NULL are the self-serve trials created 2026-10-13
-- (cocteles-chelita, mariscos-rio-valsas-de-caltzontzin,
-- metro-pizza-jardines-de-fatima). Every row created before 2026-10-11 matches.
--
-- The first line must stay a statement: scripts/apply-migration.ts drops a
-- leading comment chunk.
