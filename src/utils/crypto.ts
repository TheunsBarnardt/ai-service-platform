import { randomBytes, createHash, randomUUID } from 'node:crypto';

export interface ApiKeyResult {
  key: string;
  hash: string;
  prefix: string;
}

export function generateApiKey(): ApiKeyResult {
  const buffer = randomBytes(32);
  const key = `sk_${buffer.toString('base64url')}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, 12);
  return { key, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateId(): string {
  return randomUUID();
}
