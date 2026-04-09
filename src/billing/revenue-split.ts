import pg from 'pg';
import { config } from '../config/index.js';
import { creditFund } from '../db/queries/billing.js';
import { logger } from '../utils/logger.js';

export interface RevenueSplit {
  ownerCents: number;
  improvementCents: number;
  computeCents: number;
  reserveCents: number;
}

/**
 * Splits revenue into 4 funds using configured percentages.
 * All values are integers (cents). Any rounding remainder goes to
 * the improvement fund so total always equals revenueCents.
 */
export function calculateRevenueSplit(revenueCents: number): RevenueSplit {
  const { ownerSplitPct, improvementSplitPct, computeSplitPct, reserveSplitPct } = config.billing;

  const ownerCents = Math.floor((revenueCents * ownerSplitPct) / 100);
  const computeCents = Math.floor((revenueCents * computeSplitPct) / 100);
  const reserveCents = Math.floor((revenueCents * reserveSplitPct) / 100);

  // Improvement fund gets its share plus any rounding remainder
  const improvementCents = revenueCents - ownerCents - computeCents - reserveCents;

  logger.debug(
    { revenueCents, ownerCents, improvementCents, computeCents, reserveCents },
    'Revenue split calculated',
  );

  return { ownerCents, improvementCents, computeCents, reserveCents };
}

/**
 * Calculates the revenue split and credits each fund within
 * the provided PG transaction client.
 */
export async function allocateRevenue(
  revenueCents: number,
  client: pg.PoolClient,
): Promise<RevenueSplit> {
  const split = calculateRevenueSplit(revenueCents);

  await Promise.all([
    creditFund('owner', split.ownerCents, client),
    creditFund('improvement', split.improvementCents, client),
    creditFund('compute', split.computeCents, client),
    creditFund('reserve', split.reserveCents, client),
  ]);

  logger.info({ revenueCents, split }, 'Revenue allocated to funds');
  return split;
}
