CREATE TABLE eval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id),
  cycle_type TEXT NOT NULL CHECK (cycle_type IN ('daily','weekly','fine_tune_ab')),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  metrics JSONB,
  sample_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
