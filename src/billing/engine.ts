import { pool } from '../db/pool.js';
import {
  recordTransaction,
  getCallerBalance,
  debitFund,
} from '../db/queries/billing.js';
import { allocateRevenue } from './revenue-split.js';
import { applyDiscount } from './discounts.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export class InsufficientBalanceError extends Error {
  public readonly balanceCents: number;
  public readonly requiredCents: number;

  constructor(balanceCents: number, requiredCents: number) {
    super(
      `Insufficient balance: have ${balanceCents} cents, need ${requiredCents} cents`,
    );
    this.name = 'InsufficientBalanceError';
    this.balanceCents = balanceCents;
    this.requiredCents = requiredCents;
  }
}

export interface ChargeResult {
  charged_cents: number;
  discount_applied: number;
  new_balance: number;
}

export interface FundResult {
  new_balance: number;
}

/**
 * Charges a caller for an API call. Runs entirely inside a PG
 * transaction to prevent race conditions and partial charges.
 *
 * 1. Debit caller balance (with row-level lock)
 * 2. Record charge transaction
 * 3. Allocate revenue to 4 funds
 * 4. Record allocation transactions
 */
export async function chargeForCall(
  callerId: string,
  servicePriceCents: number,
  discountPct: number,
  callLogId: string,
): Promise<ChargeResult> {
  const chargedCents = applyDiscount(servicePriceCents, discountPct);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the caller row and get current balance
    const balanceResult = await client.query<{ balance_cents: number }>(
      `SELECT balance_cents FROM callers WHERE id = $1 FOR UPDATE`,
      [callerId],
    );

    if (balanceResult.rowCount === 0) {
      throw new Error(`Caller ${callerId} not found`);
    }

    const currentBalance = balanceResult.rows[0].balance_cents;

    if (currentBalance < chargedCents) {
      throw new InsufficientBalanceError(currentBalance, chargedCents);
    }

    // Debit caller balance
    const newBalanceResult = await client.query<{ balance_cents: number }>(
      `UPDATE callers SET balance_cents = balance_cents - $1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance_cents`,
      [chargedCents, callerId],
    );
    const newBalance = newBalanceResult.rows[0].balance_cents;

    // Record the charge transaction
    await recordTransaction(
      {
        callerId,
        type: 'charge',
        amountCents: -chargedCents,
        balanceAfter: newBalance,
        referenceId: callLogId,
        description: `API call charge (${discountPct}% discount applied)`,
      },
      client,
    );

    // Allocate revenue to the 4 funds
    const split = await allocateRevenue(chargedCents, client);

    // Record allocation transactions for auditability
    await recordTransaction(
      {
        type: 'allocation',
        amountCents: split.ownerCents,
        referenceId: callLogId,
        description: 'Owner fund allocation',
      },
      client,
    );
    await recordTransaction(
      {
        type: 'allocation',
        amountCents: split.improvementCents,
        referenceId: callLogId,
        description: 'Improvement fund allocation',
      },
      client,
    );
    await recordTransaction(
      {
        type: 'allocation',
        amountCents: split.computeCents,
        referenceId: callLogId,
        description: 'Compute fund allocation',
      },
      client,
    );
    await recordTransaction(
      {
        type: 'allocation',
        amountCents: split.reserveCents,
        referenceId: callLogId,
        description: 'Reserve fund allocation',
      },
      client,
    );

    await client.query('COMMIT');

    logger.info(
      { callerId, chargedCents, discountPct, newBalance, callLogId },
      'Call charged successfully',
    );

    return {
      charged_cents: chargedCents,
      discount_applied: discountPct,
      new_balance: newBalance,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Credits a caller account after a successful Stripe payment.
 * Runs inside a PG transaction.
 */
export async function fundCallerAccount(
  callerId: string,
  amountCents: number,
  stripePaymentId: string,
): Promise<FundResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Credit caller balance with row-level lock
    const result = await client.query<{ balance_cents: number }>(
      `UPDATE callers SET balance_cents = balance_cents + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance_cents`,
      [amountCents, callerId],
    );

    if (result.rowCount === 0) {
      throw new Error(`Caller ${callerId} not found`);
    }

    const newBalance = result.rows[0].balance_cents;

    await recordTransaction(
      {
        callerId,
        type: 'fund',
        amountCents,
        balanceAfter: newBalance,
        referenceId: stripePaymentId,
        description: 'Account funded via Stripe',
      },
      client,
    );

    await client.query('COMMIT');

    logger.info(
      { callerId, amountCents, newBalance, stripePaymentId },
      'Caller account funded',
    );

    return { new_balance: newBalance };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refunds a call charge back to the caller. Debits funds
 * proportionally using the configured revenue split percentages
 * and credits the caller balance. Runs inside a PG transaction.
 */
export async function refundCall(
  callerId: string,
  amountCents: number,
  callLogId: string,
): Promise<FundResult> {
  const { ownerSplitPct, computeSplitPct, reserveSplitPct } = config.billing;

  const ownerDebit = Math.floor((amountCents * ownerSplitPct) / 100);
  const computeDebit = Math.floor((amountCents * computeSplitPct) / 100);
  const reserveDebit = Math.floor((amountCents * reserveSplitPct) / 100);
  const improvementDebit = amountCents - ownerDebit - computeDebit - reserveDebit;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Debit each fund proportionally
    await debitFund('owner', ownerDebit, client);
    await debitFund('improvement', improvementDebit, client);
    await debitFund('compute', computeDebit, client);
    await debitFund('reserve', reserveDebit, client);

    // Credit caller balance
    const result = await client.query<{ balance_cents: number }>(
      `UPDATE callers SET balance_cents = balance_cents + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance_cents`,
      [amountCents, callerId],
    );

    if (result.rowCount === 0) {
      throw new Error(`Caller ${callerId} not found`);
    }

    const newBalance = result.rows[0].balance_cents;

    await recordTransaction(
      {
        callerId,
        type: 'refund',
        amountCents,
        balanceAfter: newBalance,
        referenceId: callLogId,
        description: 'Call refund',
      },
      client,
    );

    await client.query('COMMIT');

    logger.info(
      { callerId, amountCents, newBalance, callLogId },
      'Call refunded',
    );

    return { new_balance: newBalance };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
