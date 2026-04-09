import dotenv from 'dotenv';
dotenv.config();

import { logger } from './utils/logger.js';
import { startWorkers, stopWorkers } from './queue/workers.js';
import { scheduleAllJobs } from './improvement/scheduler.js';
import { bullConnection } from './queue/connection.js';

async function main(): Promise<void> {
  logger.info('Starting background worker process');

  // Start all BullMQ workers
  startWorkers();

  // Schedule all repeatable jobs
  await scheduleAllJobs();

  logger.info('Background worker process ready');
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal');

  try {
    await stopWorkers();
    await bullConnection.quit();
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection in worker');
});

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
