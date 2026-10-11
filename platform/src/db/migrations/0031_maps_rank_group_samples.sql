CREATE TABLE IF NOT EXISTS maps_rank_group_samples (
  id serial PRIMARY KEY,
  city text NOT NULL,
  keyword text NOT NULL,
  grid_point smallint NOT NULL CHECK (grid_point BETWEEN 0 AND 8),
  run_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  group_top3 smallint NOT NULL DEFAULT 0 CHECK (group_top3 BETWEEN 0 AND 3),
  holder_ids integer[] NOT NULL DEFAULT '{}',
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maps_rank_group_samples_point_unique UNIQUE (city, keyword, grid_point, run_date)
);

CREATE INDEX IF NOT EXISTS maps_rank_group_samples_city_run_idx ON maps_rank_group_samples (city, run_date);
