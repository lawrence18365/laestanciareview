-- Event leads: qualified leads from the Manychat WhatsApp bot + future
-- sources (audit page form, cotizador callback). Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "event_leads" (
  "id" serial PRIMARY KEY,
  "restaurant_id" integer NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "source" text NOT NULL,
  "phone" text NOT NULL,
  "name" text,
  "tipo_evento" text,
  "pax" integer,
  "fecha_tentativa" text,
  "presupuesto_pp" text,
  "prioridad" text,
  "notas_extra" text,
  "urgente" boolean NOT NULL DEFAULT false,
  "raw_conversation" text,
  "status" text NOT NULL DEFAULT 'new',
  "claimed_by" integer REFERENCES "staff"("id") ON DELETE SET NULL,
  "claimed_at" timestamptz,
  "external_created_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "event_leads_restaurant_idx"
  ON "event_leads" ("restaurant_id");
CREATE INDEX IF NOT EXISTS "event_leads_status_idx"
  ON "event_leads" ("status");
CREATE INDEX IF NOT EXISTS "event_leads_restaurant_status_created_idx"
  ON "event_leads" ("restaurant_id", "status", "created_at" DESC);

-- Dedup against Manychat retries. The (source, phone, external_created_at)
-- triple is the realistic uniqueness window — Manychat retries within seconds
-- carry the same `created_at` ISO timestamp from the bot's clock. Partial
-- index so legitimate manual entries with NULL external_created_at aren't
-- blocked.
CREATE UNIQUE INDEX IF NOT EXISTS "event_leads_dedup_uniq"
  ON "event_leads" ("source", "phone", "external_created_at")
  WHERE "external_created_at" IS NOT NULL;
