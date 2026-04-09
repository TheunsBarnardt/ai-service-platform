import { Queue } from 'bullmq';
import { bullConnection } from './connection.js';

const defaultOpts = { connection: bullConnection };

export const evalQueue = new Queue('eval', defaultOpts);
export const improveQueue = new Queue('improve', defaultOpts);
export const fineTuneQueue = new Queue('fine-tune', defaultOpts);
export const payoutQueue = new Queue('payout', defaultOpts);
export const gapAnalysisQueue = new Queue('gap-analysis', defaultOpts);
