import { pool } from '../db/pool.js';
import { listServices, updateServiceQualityScore } from '../db/queries/services.js';
import { logger } from '../utils/logger.js';

interface CallLogStats {
  avg_latency_ms: number;
  avg_cost_cents: number;
  success_count: number;
  total_count: number;
}

/**
 * Daily evaluation: score every active service based on recent performance.
 * Quality score (0-100) is a weighted composite of latency, cost efficiency, and success rate.
 */
export async function runDailyEval(): Promise<void> {
  const log = logger.child({ job: 'daily-eval' });
  log.info('Starting daily evaluation');

  const services = await listServices({ isActive: true });

  if (services.length === 0) {
    log.info('No active services to evaluate');
    return;
  }

  let evaluated = 0;

  for (const service of services) {
    try {
      const statsResult = await pool.query<CallLogStats>(
        `SELECT
           COALESCE(AVG(latency_ms), 0)::numeric AS avg_latency_ms,
           COALESCE(AVG(cost_cents), 0)::numeric AS avg_cost_cents,
           COUNT(*) FILTER (WHERE status = 'success') AS success_count,
           COUNT(*) AS total_count
         FROM (
           SELECT latency_ms, cost_cents, status
           FROM call_logs
           WHERE service_id = $1
           ORDER BY created_at DESC
           LIMIT 100
         ) recent`,
        [service.id],
      );

      const stats = statsResult.rows[0];

      if (stats.total_count === 0) {
        log.info({ serviceId: service.id, serviceName: service.name }, 'No call logs — skipping');
        continue;
      }

      const successRate = stats.success_count / stats.total_count;
      const latencyMs = Number(stats.avg_latency_ms);
      const avgCost = Number(stats.avg_cost_cents);

      // Score components (each 0-100):
      // 1. Success rate: direct percentage (weight: 50%)
      const successScore = successRate * 100;

      // 2. Latency score: under 500ms = 100, over 10s = 0, linear between (weight: 30%)
      const latencyScore = Math.max(0, Math.min(100, 100 - ((latencyMs - 500) / 9500) * 100));

      // 3. Cost efficiency: under 1 cent = 100, over 50 cents = 0 (weight: 20%)
      const costScore = Math.max(0, Math.min(100, 100 - ((avgCost - 1) / 49) * 100));

      const qualityScore = Math.round(
        successScore * 0.5 + latencyScore * 0.3 + costScore * 0.2,
      );

      await updateServiceQualityScore(service.id, qualityScore);

      // Record eval result
      await pool.query(
        `INSERT INTO eval_results (service_id, quality_score, success_rate, avg_latency_ms, avg_cost_cents, sample_size)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [service.id, qualityScore, successRate, latencyMs, avgCost, stats.total_count],
      );

      log.info(
        {
          serviceId: service.id,
          serviceName: service.name,
          qualityScore,
          successRate: (successRate * 100).toFixed(1) + '%',
          avgLatencyMs: latencyMs.toFixed(0),
          avgCostCents: avgCost.toFixed(2),
          sampleSize: stats.total_count,
        },
        'Service evaluated',
      );

      evaluated++;
    } catch (err) {
      log.error({ serviceId: service.id, err }, 'Failed to evaluate service');
    }
  }

  log.info({ evaluatedCount: evaluated, totalServices: services.length }, 'Daily evaluation complete');
}
