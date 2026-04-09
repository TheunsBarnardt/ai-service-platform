import { pool } from '../db/pool.js';
import { getFundBalances } from '../db/queries/billing.js';
import { listServices } from '../db/queries/services.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Weekly optimization pass.
 * Checks if there's enough in the improvement fund, then analyzes service performance
 * and logs optimization recommendations. Actual changes are applied manually or in
 * future iterations as confidence grows.
 */
export async function runWeeklyOptimize(): Promise<void> {
  const log = logger.child({ job: 'weekly-optimize' });
  log.info('Starting weekly optimization');

  const balances = await getFundBalances();
  const improvementBalance = balances.improvement.balance_cents;
  const minRequired = config.billing.minImprovementFundCents;

  if (improvementBalance < minRequired) {
    log.info(
      { improvementBalance, minRequired },
      'Improvement fund below threshold — skipping optimization cycle',
    );
    return;
  }

  const services = await listServices({ isActive: true });
  const actions: string[] = [];

  for (const service of services) {
    // Fetch recent eval trend
    const evalTrend = await pool.query<{ quality_score: number; created_at: Date }>(
      `SELECT quality_score, created_at
       FROM eval_results
       WHERE service_id = $1
       ORDER BY created_at DESC
       LIMIT 4`,
      [service.id],
    );

    if (evalTrend.rows.length < 2) {
      log.info({ serviceName: service.name }, 'Not enough eval history — skipping');
      continue;
    }

    const scores = evalTrend.rows.map((r) => r.quality_score);
    const latest = scores[0];
    const previous = scores[1];
    const trend = latest - previous;

    if (latest < 60) {
      actions.push(`[${service.name}] Quality below 60 (${latest}) — recommend reviewing system prompt and model routing`);
    }

    if (trend < -10) {
      actions.push(`[${service.name}] Quality dropped by ${Math.abs(trend)} points — recommend investigating recent call failures`);
    }

    if (latest >= 90 && trend >= 0) {
      actions.push(`[${service.name}] High quality (${latest}) and stable — candidate for prompt variation testing to find further gains`);
    }
  }

  if (actions.length === 0) {
    actions.push('All services within normal parameters — no optimization actions needed');
  }

  // Record the improvement cycle
  await pool.query(
    `INSERT INTO improvement_cycles (cycle_type, actions_taken, fund_balance_before)
     VALUES ($1, $2, $3)`,
    ['weekly-optimize', JSON.stringify(actions), improvementBalance],
  );

  for (const action of actions) {
    log.info({ action }, 'Optimization recommendation');
  }

  log.info(
    { actionCount: actions.length, improvementBalance },
    'Weekly optimization complete',
  );
}
