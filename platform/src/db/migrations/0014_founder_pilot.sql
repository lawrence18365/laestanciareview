ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "pilot" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "restaurants_pilot_idx"
  ON "restaurants" ("pilot")
  WHERE "pilot" = true;

-- Serialize pilot inserts before counting so simultaneous requests cannot
-- overrun the five-redemption cap. The application also checks the count to
-- return a friendly response; this trigger is the concurrency backstop.
CREATE OR REPLACE FUNCTION enforce_restaurants_pilot_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."pilot" = true THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD."pilot" = true THEN
        RETURN NEW;
      END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(72401501);

    IF (SELECT count(*) FROM "restaurants" WHERE "pilot" = true) >= 5 THEN
      RAISE EXCEPTION 'pilot_signup_limit_reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "restaurants_pilot_limit" ON "restaurants";
CREATE TRIGGER "restaurants_pilot_limit"
  BEFORE INSERT OR UPDATE ON "restaurants"
  FOR EACH ROW
  WHEN (NEW."pilot" = true)
  EXECUTE FUNCTION enforce_restaurants_pilot_limit();
