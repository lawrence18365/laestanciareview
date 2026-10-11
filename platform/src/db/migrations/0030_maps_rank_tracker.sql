CREATE TABLE IF NOT EXISTS maps_rank_keywords (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maps_rank_keywords_restaurant_keyword_unique UNIQUE (restaurant_id, keyword)
);

CREATE TABLE IF NOT EXISTS maps_rank_samples (
  id serial PRIMARY KEY,
  restaurant_id integer NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  grid_point smallint NOT NULL CHECK (grid_point BETWEEN 0 AND 8),
  run_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('found', 'not_returned', 'error')),
  rank smallint CHECK (rank BETWEEN 1 AND 20),
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maps_rank_samples_point_unique UNIQUE (restaurant_id, keyword, grid_point, run_date)
);

CREATE INDEX IF NOT EXISTS maps_rank_samples_restaurant_run_idx ON maps_rank_samples (restaurant_id, run_date);
