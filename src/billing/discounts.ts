/**
 * Volume-based discount tiers by monthly call count.
 */
const DISCOUNT_TIERS: ReadonlyArray<{ minCalls: number; discountPct: number }> = [
  { minCalls: 10000, discountPct: 50 },
  { minCalls: 1000, discountPct: 30 },
  { minCalls: 100, discountPct: 15 },
  { minCalls: 0, discountPct: 0 },
];

/**
 * Returns the discount percentage (0, 15, 30, or 50) based on
 * the caller's total monthly call volume.
 */
export function calculateDiscount(callerTotalCalls: number): number {
  for (const tier of DISCOUNT_TIERS) {
    if (callerTotalCalls >= tier.minCalls) {
      return tier.discountPct;
    }
  }
  return 0;
}

/**
 * Applies a percentage discount to a price and returns the
 * discounted price as an integer (cents). Always rounds down
 * so callers are never undercharged.
 */
export function applyDiscount(priceCents: number, discountPct: number): number {
  if (discountPct <= 0) return priceCents;
  if (discountPct >= 100) return 0;
  return Math.floor(priceCents * (1 - discountPct / 100));
}
