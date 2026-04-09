import { Worker } from 'bullmq';
import { bullConnection } from './connection.js';
import { logger } from '../utils/logger.js';
import { runDailyEval } from '../improvement/daily-eval.js';
import { runWeeklyOptimize } from '../improvement/weekly-optimize.js';
import { runGapAnalysis } from '../improvement/gap-analyzer.js';
import { runPricingOptimizer } from '../improvement/pricing-optimizer.js';
import { checkAndRunFineTune } from '../improvement/fine-tune/job-manager.js';

const workers: Worker[] = [];

export function startWorkers(): void {
  const workerOpts = { connection: bullConnection };

  const evalWorker = new Worker(
    'eval',
    async (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Starting eval job');
      await runDailyEval();
    },
    workerOpts,
  );

  const improveWorker = new Worker(
    'improve',
    async (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Starting improve job');
      if (job.name === 'weekly-optimize') {
        await runWeeklyOptimize();
      } else if (job.name === 'daily-payout-check') {
        await runPricingOptimizer();
      }
    },
    workerOpts,
  );

  const fineTuneWorker = new Worker(
    'fine-tune',
    async (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Starting fine-tune job');
      await checkAndRunFineTune();
    },
    workerOpts,
  );

  const payoutWorker = new Worker(
    'payout',
    async (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Starting payout check job');
      await runPricingOptimizer();
    },
    workerOpts,
  );

  const gapWorker = new Worker(
    'gap-analysis',
    async (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Starting gap analysis job');
      await runGapAnalysis();
    },
    workerOpts,
  );

  for (const w of [evalWorker, improveWorker, fineTuneWorker, payoutWorker, gapWorker]) {
    w.on('completed', (job) => {
      logger.info({ jobId: job?.id, queue: w.name }, 'Job completed');
    });
    w.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, queue: w.name, err }, 'Job failed');
    });
    workers.push(w);
  }

  logger.info({ workerCount: workers.length }, 'All BullMQ workers started');
}

export async function stopWorkers(): Promise<void> {
  logger.info('Shutting down BullMQ workers...');
  await Promise.all(workers.map((w) => w.close()));
  logger.info('All BullMQ workers stopped');
}
