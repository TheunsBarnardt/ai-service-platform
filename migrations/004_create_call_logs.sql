CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id UUID NOT NULL REFERENCES callers(id),
  service_id UUID NOT NULL REFERENCES services(id),
  idempotency_key TEXT UNIQUE,
  request_body JSONB,
  response_body JSONB,
  status TEXT NOT NULL CHECK (status IN ('pending','success','error','timeout')),
  latency_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_cents INTEGER,
  revenue_cents INTEGER,
  discount_pct INTEGER NOT NULL DEFAULT 0,
  provider_used TEXT,
  model_used TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_logs_caller_created ON call_logs (caller_id, created_at);
CREATE INDEX idx_call_logs_service_created ON call_logs (service_id, created_at);
CREATE INDEX idx_call_logs_idempotency ON call_logs (idempotency_key);
