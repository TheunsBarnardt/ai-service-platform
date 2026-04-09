import { Redis } from 'ioredis';
import { config } from './index.js';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: 3,
  retryStrategy(times: number): number | null {
    if (times > 10) return null;
    return Math.min(times * 200, 5_000);
  },
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  console.error('Redis connection error:', err);
});
