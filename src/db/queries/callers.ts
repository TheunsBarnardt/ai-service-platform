import type pg from 'pg';
import { pool } from '../pool.js';
import { generateId } from '../../utils/crypto.js';
import { InsufficientBalanceError, NotFoundError } from '../../utils/errors.js';

export interface CallerRow {
  id: string;
  caller_type: string;
  name: string | null;
  metadata: Record<string, unknown>;
  balance_cents: string; // bigint comes as string from pg
  total_calls: string;
  reputation: number;
  tier: string;
  rate_limit_rpm: number;
  created_at: Date;
  updated_at: Date;
}

export interface CallerWithApiKey {
  caller: CallerRow;
  apiKey: {
    id: string;
    key_hash: string;
    key_prefix: string;
    scopes: string[];
    is_active: boolean;
    expires_at: Date | null;
  };
}

export async function createCaller(data: {
  callerType: string;
  name?: string;
  metadata?: Record<string, unknown>;
}): Promise<CallerRow> {
  const id = generateId();
  const result = await pool.query<CallerRow>(
    `INSERT INTO callers (id, caller_type, name, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, data.callerType, data.name ?? null, JSON.stringify(data.metadata ?? {})],
  );
  return result.rows[0];
}

export async function getCallerById(id: string): Promise<CallerRow | null> {
  const result = await pool.query<CallerRow>(
    `SELECT * FROM callers WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function updateCallerBalance(
  id: string,
  deltaCents: bigint,
  client?: pg.PoolClient,
): Promise<string> {
  const queryFn = client ?? pool;

  // Use a single atomic UPDATE that checks the constraint in the WHERE clause
  // for negative deltas (withdrawals). For positive deltas (deposits), always allow.
  if (deltaCents < 0n) {
    const result = await queryFn.query<{ balance_cents: string }>(
      `UPDATE callers
       SET balance_cents = balance_cents + $2,
           updated_at = now()
       WHERE id = $1
         AND balance_cents + $2 >= 0
       RETURNING balance_cents`,
      [id, deltaCents.toString()],
    );

    if (result.rows.length === 0) {
      // Check if caller exists vs insufficient balance
      const exists = await queryFn.query(
        `SELECT id FROM callers WHERE id = $1`,
        [id],
      );
      if (exists.rows.length === 0) {
        throw new NotFoundError('Caller not found');
      }
      throw new InsufficientBalanceError();
    }

    return result.rows[0].balance_cents;
  }

  const result = await queryFn.query<{ balance_cents: string }>(
    `UPDATE callers
     SET balance_cents = balance_cents + $2,
         updated_at = now()
     WHERE id = $1
     RETURNING balance_cents`,
    [id, deltaCents.toString()],
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Caller not found');
  }

  return result.rows[0].balance_cents;
}

export async function incrementCallerCalls(id: string): Promise<void> {
  await pool.query(
    `UPDATE callers
     SET total_calls = total_calls + 1,
         updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function getCallerByApiKeyHash(keyHash: string): Promise<CallerWithApiKey | null> {
  const result = await pool.query<CallerRow & {
    ak_id: string;
    ak_key_hash: string;
    ak_key_prefix: string;
    ak_scopes: string[];
    ak_is_active: boolean;
    ak_expires_at: Date | null;
  }>(
    `SELECT
       c.*,
       ak.id AS ak_id,
       ak.key_hash AS ak_key_hash,
       ak.key_prefix AS ak_key_prefix,
       ak.scopes AS ak_scopes,
       ak.is_active AS ak_is_active,
       ak.expires_at AS ak_expires_at
     FROM callers c
     JOIN api_keys ak ON ak.caller_id = c.id
     WHERE ak.key_hash = $1
       AND ak.is_active = true
     LIMIT 1`,
    [keyHash],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    caller: {
      id: row.id,
      caller_type: row.caller_type,
      name: row.name,
      metadata: row.metadata,
      balance_cents: row.balance_cents,
      total_calls: row.total_calls,
      reputation: row.reputation,
      tier: row.tier,
      rate_limit_rpm: row.rate_limit_rpm,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    apiKey: {
      id: row.ak_id,
      key_hash: row.ak_key_hash,
      key_prefix: row.ak_key_prefix,
      scopes: row.ak_scopes,
      is_active: row.ak_is_active,
      expires_at: row.ak_expires_at,
    },
  };
}
