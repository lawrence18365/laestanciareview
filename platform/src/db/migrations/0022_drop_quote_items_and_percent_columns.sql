DROP TABLE IF EXISTS "quote_items";
ALTER TABLE "quotes" DROP COLUMN IF EXISTS "service_charge_percent", DROP COLUMN IF EXISTS "iva_percent";
