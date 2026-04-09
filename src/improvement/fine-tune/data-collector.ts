import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

interface CollectionResult {
  serviceType: string;
  availableExamples: number;
  isReady: boolean;
}

const FINE_TUNE_THRESHOLD = 5000;

/**
 * Collect and count available training data for a service type.
 * If there are enough successful call logs (>= 5000), marks the service type as ready
 * for fine-tuning.
 */
export async function collectTrainingData(serviceType: string): Promise<CollectionResult> {
  const log = logger.child({ job: 'data-collector', serviceType });
  log.info('Collecting training data count');

  const countResult = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM call_logs cl
     JOIN services s ON s.id = cl.service_id
     WHERE s.service_type = $1
       AND cl.status = 'success'
       AND cl.request_body IS NOT NULL
       AND cl.response_body IS NOT NULL`,
    [serviceType],
  );

  const availableExamples = Number(countResult.rows[0].cnt);
  const isReady = availableExamples >= FINE_TUNE_THRESHOLD;

  if (isReady) {
    // Update fine_tune_status for services of this type
    await pool.query(
      `UPDATE services
       SET config = jsonb_set(COALESCE(config::jsonb, '{}'::jsonb), '{fine_tune_status}', '"ready"')
       WHERE service_type = $1 AND is_active = true`,
      [serviceType],
    );
    log.info({ availableExamples }, 'Training data threshold met — marked as ready');
  } else {
    log.info(
      { availableExamples, threshold: FINE_TUNE_THRESHOLD },
      'Not enough training data yet',
    );
  }

  return { serviceType, availableExamples, isReady };
}
