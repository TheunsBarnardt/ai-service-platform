import { Redis } from 'ioredis';
import { config } from '../config/index.js';

/**
 * Dedicated Redis connection for BullMQ.
 * BullMQ requires its own connection (not shared with the app's general Redis client)
 * because it uses blocking commands like BRPOPLPUSH.
 */
export const bullConnection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null, // BullMQ requirement — must be null
  enableReadyCheck: false,
  retryStrategy(times: number): number | null {
    if (times > 10) return null;
    return Math.min(times * 200, 5_000);
  },
});

bullConnection.on('error', (err: Error) => {
  console.error('BullMQ Redis connection error:', err);
});
