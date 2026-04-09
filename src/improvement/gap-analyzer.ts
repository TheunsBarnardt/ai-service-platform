import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

interface ErrorGroup {
  error_pattern: string;
  occurrence_count: number;
  affected_services: string[];
}

/**
 * Daily gap analysis: identify the most common failure patterns across all services.
 * Groups errors, counts occurrences, and stores a report in improvement_cycles.
 */
export async function runGapAnalysis(): Promise<void> {
  const log = logger.child({ job: 'gap-analysis' });
  log.info('Starting gap analysis');

  // Query recent failures from the last 24 hours
  const failuresResult = await pool.query<{
    error_message: string;
    service_name: string;
    cnt: number;
  }>(
    `SELECT
       cl.error_message,
       s.name AS service_name,
       COUNT(*) AS cnt
     FROM call_logs cl
     JOIN services s ON s.id = cl.service_id
     WHERE cl.status = 'error'
       AND cl.created_at >= NOW() - INTERVAL '24 hours'
       AND cl.error_message IS NOT NULL
     GROUP BY cl.error_message, s.name
     ORDER BY cnt DESC
     LIMIT 50`,
  );

  if (failuresResult.rows.length === 0) {
    log.info('No failures in the last 24 hours — nothing to analyze');
    return;
  }

  // Group by error pattern
  const patternMap = new Map<string, ErrorGroup>();

  for (const row of failuresResult.rows) {
    // Normalize error messages: strip variable parts (IDs, timestamps)
    const pattern = normalizeErrorPattern(row.error_message);
    const existing = patternMap.get(pattern);

    if (existing) {
      existing.occurrence_count += Number(row.cnt);
      if (!existing.affected_services.includes(row.service_name)) {
        existing.affected_services.push(row.service_name);
      }
    } else {
      patternMap.set(pattern, {
        error_pattern: pattern,
        occurrence_count: Number(row.cnt),
        affected_services: [row.service_name],
      });
    }
  }

  const groups = Array.from(patternMap.values()).sort(
    (a, b) => b.occurrence_count - a.occurrence_count,
  );

  const totalFailures = groups.reduce((sum, g) => sum + g.occurrence_count, 0);

  const report = {
    analyzed_at: new Date().toISOString(),
    total_failures_24h: totalFailures,
    unique_patterns: groups.length,
    top_patterns: groups.slice(0, 10).map((g) => ({
      pattern: g.error_pattern,
      count: g.occurrence_count,
      pct_of_total: ((g.occurrence_count / totalFailures) * 100).toFixed(1) + '%',
      services: g.affected_services,
    })),
  };

  // Store report as improvement cycle
  await pool.query(
    `INSERT INTO improvement_cycles (cycle_type, actions_taken, fund_balance_before)
     VALUES ($1, $2, 0)`,
    ['gap-analysis', JSON.stringify(report)],
  );

  for (const pattern of report.top_patterns) {
    log.warn(
      {
        pattern: pattern.pattern,
        count: pattern.count,
        pct: pattern.pct_of_total,
        services: pattern.services,
      },
      'Common failure pattern detected',
    );
  }

  log.info(
    { totalFailures, uniquePatterns: groups.length },
    'Gap analysis complete',
  );
}

/**
 * Normalize error messages by replacing variable parts (UUIDs, numbers, timestamps)
 * with placeholders so similar errors get grouped together.
 */
function normalizeErrorPattern(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b\d{10,}\b/g, '<TIMESTAMP>')
    .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '<IP>')
    .replace(/\b\d{4,}\b/g, '<NUM>')
    .trim();
}
