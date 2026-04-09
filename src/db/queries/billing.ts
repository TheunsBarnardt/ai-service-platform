import pg from 'pg';
import { pool } from '../pool.js';
import { logger } from '../../utils/logger.js';

export interface TransactionRow {
  id: string;
  caller_id: string | null;
  type: string;
  amount_cents: number;
  balance_after: number | null;
  reference_id: string | null;
  description: string | null;
  created_at: string;
}

export interface RecordTransactionData {
  callerId?: string;
  type: string;
  amountCents: number;
  balanceAfter?: number;
  referenceId?: string;
  description?: string;
}

export interface FundBalance {
  fund_id: string;
  balance_cents: number;
}

export interface FundBalances {
  owner: FundBalance;
  improvement: FundBalance;
  compute: FundBalance;
  reserve: FundBalance;
}

export interface PaginatedTransactions {
  transactions: TransactionRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function recordTransaction(
  data: RecordTransactionData,
  client?: pg.PoolClient,
): Promise<TransactionRow> {
  const q = client ?? pool;
  const result = await q.query<TransactionRow>(
    `INSERT INTO transactions (caller_id, type, amount_cents, balance_after, reference_id, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.callerId ?? null,
      data.type,
      data.amountCents,
      data.balanceAfter ?? null,
      data.referenceId ?? null,
      data.description ?? null,
    ],
  );
  logger.debug({ transactionId: result.rows[0].id, type: data.type }, 'Transaction recorded');
  return result.rows[0];
}

export async function getTransactions(
  callerId: string,
  pagination: { limit: number; cursor?: string },
): Promise<PaginatedTransactions> {
  const { limit, cursor } = pagination;
  const fetchLimit = limit + 1; // fetch one extra to detect hasMore

  let result: pg.QueryResult<TransactionRow>;
  if (cursor) {
    result = await pool.query<TransactionRow>(
      `SELECT * FROM transactions
       WHERE caller_id = $1 AND id < $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [callerId, cursor, fetchLimit],
    );
  } else {
    result = await pool.query<TransactionRow>(
      `SELECT * FROM transactions
       WHERE caller_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [callerId, fetchLimit],
    );
  }

  const hasMore = result.rows.length > limit;
  const transactions = hasMore ? result.rows.slice(0, limit) : result.rows;
  const nextCursor = hasMore ? transactions[transactions.length - 1].id : null;

  return { transactions, nextCursor, hasMore };
}

export async function getFundBalances(): Promise<FundBalances> {
  const result = await pool.query<FundBalance>(
    `SELECT fund_id, balance_cents FROM funds ORDER BY fund_id`,
  );

  const map = new Map(result.rows.map((r) => [r.fund_id, r]));
  const defaultFund = (id: string): FundBalance => ({ fund_id: id, balance_cents: 0 });

  return {
    owner: map.get('owner') ?? defaultFund('owner'),
    improvement: map.get('improvement') ?? defaultFund('improvement'),
    compute: map.get('compute') ?? defaultFund('compute'),
    reserve: map.get('reserve') ?? defaultFund('reserve'),
  };
}

export async function creditFund(
  fundId: string,
  amountCents: number,
  client?: pg.PoolClient,
): Promise<void> {
  const q = client ?? pool;
  await q.query(
    `UPDATE funds SET balance_cents = balance_cents + $1, updated_at = NOW()
     WHERE fund_id = $2`,
    [amountCents, fundId],
  );
  logger.debug({ fundId, amountCents }, 'Fund credited');
}

export async function debitFund(
  fundId: string,
  amountCents: number,
  client?: pg.PoolClient,
): Promise<void> {
  const q = client ?? pool;
  const result = await q.query<{ balance_cents: number }>(
    `UPDATE funds SET balance_cents = balance_cents - $1, updated_at = NOW()
     WHERE fund_id = $2 AND balance_cents >= $1
     RETURNING balance_cents`,
    [amountCents, fundId],
  );
  if (result.rowCount === 0) {
    throw new Error(`Insufficient balance in fund ${fundId} to debit ${amountCents} cents`);
  }
  logger.debug({ fundId, amountCents }, 'Fund debited');
}

export async function getCallerBalance(callerId: string): Promise<number> {
  const result = await pool.query<{ balance_cents: number }>(
    `SELECT balance_cents FROM callers WHERE id = $1`,
    [callerId],
  );
  if (result.rowCount === 0) {
    throw new Error(`Caller ${callerId} not found`);
  }
  return result.rows[0].balance_cents;
}
