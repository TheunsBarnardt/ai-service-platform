CREATE TABLE funds (
  id TEXT PRIMARY KEY,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  total_in_cents BIGINT NOT NULL DEFAULT 0,
  total_out_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO funds (id) VALUES
  ('owner'),
  ('improvement'),
  ('compute'),
  ('reserve');
