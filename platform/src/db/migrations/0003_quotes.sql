CREATE TABLE "quotes" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "quote_number" text,
  "status" text NOT NULL DEFAULT 'draft',
  "client_name" text NOT NULL,
  "client_phone" text,
  "client_email" text,
  "client_company" text,
  "event_date" text,
  "event_type" text,
  "guest_count" integer NOT NULL DEFAULT 1,
  "event_notes" text,
  "price_per_person" text NOT NULL DEFAULT '0',
  "service_charge_percent" text NOT NULL DEFAULT '10',
  "iva_percent" text NOT NULL DEFAULT '16',
  "package_name" text,
  "terms" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "quote_items" (
  "id" serial PRIMARY KEY,
  "quote_id" integer NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "name" text NOT NULL,
  "notes" text,
  "sort_order" integer NOT NULL DEFAULT 0
);

CREATE INDEX "quotes_restaurant_idx" ON "quotes"("restaurant_id");
CREATE INDEX "quotes_created_at_idx" ON "quotes"("created_at");
CREATE INDEX "quotes_status_idx" ON "quotes"("status");
CREATE INDEX "quote_items_quote_idx" ON "quote_items"("quote_id");
