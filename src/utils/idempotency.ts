import { redis } from '../config/redis.js';

const KEY_PREFIX = 'idempotency:';

export async function checkIdempotency<T>(key: string): Promise<T | null> {
  const raw = await redis.get(`${KEY_PREFIX}${key}`);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

export async function setIdempotency<T>(
  key: string,
  result: T,
  ttlSeconds = 3600,
): Promise<void> {
  await redis.set(
    `${KEY_PREFIX}${key}`,
    JSON.stringify(result),
    'EX',
    ttlSeconds,
  );
}
