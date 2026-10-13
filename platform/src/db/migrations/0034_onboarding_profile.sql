ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "team_mode" text
  CONSTRAINT "restaurants_team_mode_check" CHECK ("team_mode" IN ('solo', 'team'));

ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "locations_band" text
  CONSTRAINT "restaurants_locations_band_check" CHECK ("locations_band" IN ('1', '2-5', '6+'));

ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "google_profile" jsonb;

-- Self-serve onboarding profile (US-14). Additive and nullable, no backfill.
--
--   team_mode       'solo' (owner only) or 'team' (has waiters). Answered on
--                   /contacto. Every UI/message branch for the solo experience
--                   keys off team_mode = 'solo'.
--   locations_band  '1', '2-5' or '6+'. '6+' routes the lead to a call.
--   google_profile  Places v1 snapshot taken at signup (primary type,
--                   takeout/delivery/dine-in flags, location, top-3 nearby
--                   competitors by review count). Parsed by
--                   lib/onboarding-profile.ts parseGoogleProfile().
--
-- NULL means legacy behavior, exactly as before. Every existing restaurant,
-- including all 12 Grupo Estancia locations, keeps NULL in all three columns
-- and must render and message identically. CHECK constraints pass on NULL.
--
-- The first line must stay a statement: scripts/apply-migration.ts drops a
-- leading comment chunk.
