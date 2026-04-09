import { pool } from '../pool.js';
import { generateApiKey, generateId } from '../../utils/crypto.js';

export interface ApiKeyRow {
  id: string;
  caller_id: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  expires_at: Date | null;
  created_at: Date;
}

export interface CreateApiKeyResult {
  key: string;
  keyPrefix: string;
  keyHash: string;
}

export async function createApiKey(callerId: string): Promise<CreateApiKeyResult> {
  const { key, hash, prefix } = generateApiKey();
  const id = generateId();

  await pool.query(
    `INSERT INTO api_keys (id, caller_id, key_hash, key_prefix)
     VALUES ($1, $2, $3, $4)`,
    [id, callerId, hash, prefix],
  );

  return { key, keyPrefix: prefix, keyHash: hash };
}

export async function getApiKeyByHash(hash: string): Promise<ApiKeyRow | null> {
  const result = await pool.query<ApiKeyRow>(
    `SELECT * FROM api_keys WHERE key_hash = $1 LIMIT 1`,
    [hash],
  );
  return result.rows[0] ?? null;
}

export async function deactivateApiKey(id: string): Promise<void> {
  await pool.query(
    `UPDATE api_keys SET is_active = false WHERE id = $1`,
    [id],
  );
}

export async function rotateApiKey(callerId: string): Promise<CreateApiKeyResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deactivate all existing active keys for this caller
    await client.query(
      `UPDATE api_keys SET is_active = false WHERE caller_id = $1 AND is_active = true`,
      [callerId],
    );

    // Create new key
    const { key, hash, prefix } = generateApiKey();
    const id = generateId();

    await client.query(
      `INSERT INTO api_keys (id, caller_id, key_hash, key_prefix)
       VALUES ($1, $2, $3, $4)`,
      [id, callerId, hash, prefix],
    );

    await client.query('COMMIT');
    return { key, keyPrefix: prefix, keyHash: hash };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
