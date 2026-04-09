CREATE TABLE improvement_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_number INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('weekly_optimize','fine_tune','new_service')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  actions_taken JSONB,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  quality_delta NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
