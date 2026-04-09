import { evalQueue, improveQueue, fineTuneQueue, payoutQueue, gapAnalysisQueue } from '../queue/queues.js';
import { logger } from '../utils/logger.js';

/**
 * Schedule all repeatable BullMQ jobs.
 * BullMQ deduplicates by job name + repeat key, so calling this multiple times is safe.
 */
export async function scheduleAllJobs(): Promise<void> {
  await evalQueue.upsertJobScheduler(
    'daily-eval',
    { pattern: '0 3 * * *' },
    { name: 'daily-eval', data: {} },
  );
  logger.info('Scheduled daily-eval: every day at 03:00 UTC');

  await improveQueue.upsertJobScheduler(
    'weekly-optimize',
    { pattern: '0 2 * * 0' },
    { name: 'weekly-optimize', data: {} },
  );
  logger.info('Scheduled weekly-optimize: Sundays at 02:00 UTC');

  await payoutQueue.upsertJobScheduler(
    'daily-payout-check',
    { pattern: '0 6 * * *' },
    { name: 'daily-payout-check', data: {} },
  );
  logger.info('Scheduled daily-payout-check: every day at 06:00 UTC');

  await fineTuneQueue.upsertJobScheduler(
    'fine-tune-check',
    { pattern: '0 5 * * 1' },
    { name: 'fine-tune-check', data: {} },
  );
  logger.info('Scheduled fine-tune-check: Mondays at 05:00 UTC');

  await gapAnalysisQueue.upsertJobScheduler(
    'daily-gap-analysis',
    { pattern: '0 4 * * *' },
    { name: 'daily-gap-analysis', data: {} },
  );
  logger.info('Scheduled daily-gap-analysis: every day at 04:00 UTC');

  logger.info('All improvement jobs scheduled');
}
