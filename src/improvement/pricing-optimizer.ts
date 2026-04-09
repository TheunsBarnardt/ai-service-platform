import { pool } from '../db/pool.js';
import { listServices } from '../db/queries/services.js';
import { logger } from '../utils/logger.js';

interface PricingSuggestion {
  serviceName: string;
  currentPriceCents: number;
  avgCostCents: number;
  marginPct: number;
  suggestion: string;
  suggestedPriceCents: number | null;
}

/**
 * Pricing optimizer: analyze each service's actual cost vs price and suggest adjustments.
 * Does NOT auto-change prices — logs suggestions for review.
 */
export async function runPricingOptimizer(): Promise<void> {
  const log = logger.child({ job: 'pricing-optimizer' });
  log.info('Starting pricing optimization analysis');

  const services = await listServices({ isActive: true });
  const suggestions: PricingSuggestion[] = [];

  for (const service of services) {
    if (!service.price_cents || service.price_cents === 0) {
      log.debug({ serviceName: service.name }, 'No price set — skipping');
      continue;
    }

    // Calculate actual average cost from recent calls
    const costResult = await pool.query<{ avg_cost: number; call_count: number }>(
      `SELECT
         COALESCE(AVG(cost_cents), 0)::numeric AS avg_cost,
         COUNT(*) AS call_count
       FROM (
         SELECT cost_cents
         FROM call_logs
         WHERE service_id = $1 AND status = 'success'
         ORDER BY created_at DESC
         LIMIT 200
       ) recent`,
      [service.id],
    );

    const { avg_cost, call_count } = costResult.rows[0];

    if (call_count === 0) {
      log.debug({ serviceName: service.name }, 'No successful calls — skipping');
      continue;
    }

    const avgCost = Number(avg_cost);
    const price = service.price_cents;

    if (avgCost === 0) {
      log.debug({ serviceName: service.name }, 'Zero cost — skipping margin calculation');
      continue;
    }

    const marginPct = ((price - avgCost) / price) * 100;

    if (marginPct < 50) {
      // Margin too thin — suggest price increase
      const suggestedPrice = Math.ceil(avgCost * 2.5); // target ~60% margin
      suggestions.push({
        serviceName: service.name,
        currentPriceCents: price,
        avgCostCents: avgCost,
        marginPct,
        suggestion: 'INCREASE — margin below 50%',
        suggestedPriceCents: suggestedPrice,
      });
    } else if (marginPct > 95) {
      // Margin very high — could lower price to attract more callers
      const suggestedPrice = Math.ceil(avgCost * 4); // target ~75% margin
      suggestions.push({
        serviceName: service.name,
        currentPriceCents: price,
        avgCostCents: avgCost,
        marginPct,
        suggestion: 'DECREASE — margin over 95%, price may be uncompetitive',
        suggestedPriceCents: suggestedPrice,
      });
    } else {
      suggestions.push({
        serviceName: service.name,
        currentPriceCents: price,
        avgCostCents: avgCost,
        marginPct,
        suggestion: 'OK — margin within healthy range',
        suggestedPriceCents: null,
      });
    }
  }

  for (const s of suggestions) {
    const level = s.suggestedPriceCents ? 'warn' : 'info';
    log[level](
      {
        service: s.serviceName,
        priceCents: s.currentPriceCents,
        avgCostCents: Number(s.avgCostCents.toFixed(2)),
        marginPct: Number(s.marginPct.toFixed(1)),
        suggestion: s.suggestion,
        suggestedPriceCents: s.suggestedPriceCents,
      },
      'Pricing analysis',
    );
  }

  log.info(
    {
      servicesAnalyzed: suggestions.length,
      adjustmentsRecommended: suggestions.filter((s) => s.suggestedPriceCents !== null).length,
    },
    'Pricing optimization complete',
  );
}
