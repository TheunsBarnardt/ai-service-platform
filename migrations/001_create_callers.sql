CREATE TABLE callers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_type TEXT NOT NULL CHECK (caller_type IN ('mcp_client','api_direct','agent_framework','other_platform')),
  name TEXT,
  metadata JSONB DEFAULT '{}',
  balance_cents BIGINT NOT NULL DEFAULT 0,
  total_calls BIGINT NOT NULL DEFAULT 0,
  reputation INTEGER NOT NULL DEFAULT 50 CHECK (reputation BETWEEN 0 AND 100),
  tier TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('free','standard','premium','trusted')),
  rate_limit_rpm INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
