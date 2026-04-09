CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id UUID REFERENCES callers(id),
  type TEXT NOT NULL CHECK (type IN ('fund','charge','refund','payout','allocation')),
  amount_cents BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reference_id UUID,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_caller_created ON transactions (caller_id, created_at);
