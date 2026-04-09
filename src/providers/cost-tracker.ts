interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-haiku-4-5-20251001': { inputPerMillion: 0.80, outputPerMillion: 4.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.0 },
  'text-embedding-3-small': { inputPerMillion: 0.02, outputPerMillion: 0 },
};

/**
 * Calculate cost in cents for a given model invocation.
 * Returns the cost rounded up to the nearest cent.
 */
export function calculateCostCents(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const pricing = PRICING[model];
  if (!pricing) {
    // Unknown model — return 0 rather than crashing; callers can log a warning
    return 0;
  }

  const inputCostDollars = (tokensIn / 1_000_000) * pricing.inputPerMillion;
  const outputCostDollars = (tokensOut / 1_000_000) * pricing.outputPerMillion;
  const totalCents = (inputCostDollars + outputCostDollars) * 100;

  return Math.ceil(totalCents);
}
