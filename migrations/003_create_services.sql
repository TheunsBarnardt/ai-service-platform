CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  service_type TEXT NOT NULL CHECK (service_type IN ('rag_retrieval','inference','tool_execution','orchestration','eval_scoring')),
  description TEXT,
  input_schema JSONB,
  output_schema JSONB,
  system_prompt TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  price_cents INTEGER,
  cost_cents INTEGER,
  quality_score INTEGER NOT NULL DEFAULT 50 CHECK (quality_score BETWEEN 0 AND 100),
  latency_sla_ms INTEGER NOT NULL DEFAULT 5000,
  registry_status TEXT NOT NULL DEFAULT 'unlisted' CHECK (registry_status IN ('unlisted','listed','featured','deprecated')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
