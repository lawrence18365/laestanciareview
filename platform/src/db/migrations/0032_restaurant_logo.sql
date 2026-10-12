ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "logo_data_url" text;

-- Restaurant-owned logo, uploaded from Ajustes by the GM of a self-serve
-- account. Stored inline as a data URL because there is no object store wired
-- up: the browser already scales the image to <= 512 px and re-encodes it
-- (PNG when the source has transparency, JPEG q=0.85 otherwise) before the
-- /api/auth/settings PATCH accepts it, so a row stays small (<= 280 KB of
-- base64, <= 200 KB of image). Served back by GET /api/logo/[slug].
--
-- The first line must stay a statement: scripts/apply-migration.ts drops a
-- leading comment chunk.
