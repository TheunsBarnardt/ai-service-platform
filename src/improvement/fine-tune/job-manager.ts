import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import OpenAI from 'openai';
import { config } from '../../config/index.js';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { listServices } from '../../db/queries/services.js';
import { collectTrainingData } from './data-collector.js';
import { buildDataset } from './dataset-builder.js';

const openai = new OpenAI({ apiKey: config.providers.openai.apiKey });

/**
 * Submit a fine-tuning job to OpenAI.
 * Uploads the training file, then creates a fine-tuning job.
 */
export async function submitFineTuneJob(datasetPath: string): Promise<string> {
  const log = logger.child({ job: 'fine-tune-submit' });

  log.info({ datasetPath }, 'Uploading training file to OpenAI');

  const file = await openai.files.create({
    file: createReadStream(datasetPath),
    purpose: 'fine-tune',
  });

  log.info({ fileId: file.id, filename: basename(datasetPath) }, 'Training file uploaded');

  const fineTune = await openai.fineTuning.jobs.create({
    training_file: file.id,
    model: 'gpt-4o-mini-2024-07-18',
  });

  log.info({ jobId: fineTune.id, model: fineTune.model }, 'Fine-tuning job created');

  return fineTune.id;
}

/**
 * Check the status of an existing fine-tuning job.
 */
export async function checkFineTuneStatus(
  jobId: string,
): Promise<{ status: string; fineTunedModel: string | null }> {
  const log = logger.child({ job: 'fine-tune-status', jobId });

  const job = await openai.fineTuning.jobs.retrieve(jobId);

  log.info(
    {
      status: job.status,
      fineTunedModel: job.fine_tuned_model,
      trainedTokens: job.trained_tokens,
    },
    'Fine-tune job status',
  );

  return {
    status: job.status,
    fineTunedModel: job.fine_tuned_model,
  };
}

/**
 * High-level: check all service types for fine-tune readiness, submit jobs where appropriate.
 * Called by the weekly fine-tune-check scheduler.
 */
export async function checkAndRunFineTune(): Promise<void> {
  const log = logger.child({ job: 'fine-tune-check' });
  log.info('Starting fine-tune check');

  if (!config.providers.openai.apiKey) {
    log.warn('OpenAI API key not configured — skipping fine-tune check');
    return;
  }

  // Check for any in-progress fine-tune jobs first
  const pendingJobs = await pool.query<{ id: string; job_id: string; service_type: string }>(
    `SELECT id, job_id, service_type
     FROM fine_tune_jobs
     WHERE status IN ('pending', 'running', 'validating_files')
     ORDER BY created_at DESC`,
  );

  for (const pending of pendingJobs.rows) {
    try {
      const result = await checkFineTuneStatus(pending.job_id);
      await pool.query(
        `UPDATE fine_tune_jobs SET status = $1, fine_tuned_model = $2, updated_at = NOW() WHERE id = $3`,
        [result.status, result.fineTunedModel, pending.id],
      );
      log.info(
        { serviceType: pending.service_type, status: result.status },
        'Updated pending fine-tune job status',
      );
    } catch (err) {
      log.error({ jobId: pending.job_id, err }, 'Failed to check fine-tune job status');
    }
  }

  // Get distinct service types
  const services = await listServices({ isActive: true });
  const serviceTypes = [...new Set(services.map((s) => s.service_type))];

  for (const serviceType of serviceTypes) {
    try {
      // Check if there's already a recent job for this type
      const recentJob = await pool.query(
        `SELECT id FROM fine_tune_jobs
         WHERE service_type = $1 AND created_at > NOW() - INTERVAL '7 days'
         LIMIT 1`,
        [serviceType],
      );

      if (recentJob.rows.length > 0) {
        log.debug({ serviceType }, 'Recent fine-tune job exists — skipping');
        continue;
      }

      const collectionResult = await collectTrainingData(serviceType);

      if (!collectionResult.isReady) {
        log.info(
          { serviceType, available: collectionResult.availableExamples },
          'Not enough data for fine-tuning',
        );
        continue;
      }

      log.info({ serviceType }, 'Building dataset for fine-tuning');
      const datasetPath = await buildDataset(serviceType);

      log.info({ serviceType, datasetPath }, 'Submitting fine-tune job');
      const jobId = await submitFineTuneJob(datasetPath);

      // Record the fine-tune job
      await pool.query(
        `INSERT INTO fine_tune_jobs (service_type, job_id, dataset_path, status)
         VALUES ($1, $2, $3, 'pending')`,
        [serviceType, jobId, datasetPath],
      );

      log.info({ serviceType, jobId }, 'Fine-tune job submitted and recorded');
    } catch (err) {
      log.error({ serviceType, err }, 'Fine-tune check failed for service type');
    }
  }

  log.info('Fine-tune check complete');
}
