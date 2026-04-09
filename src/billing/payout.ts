import Stripe from 'stripe';
import { config } from '../config/index.js';
import { pool } from '../db/pool.js';
import { debitFund, recordTransaction } from '../db/queries/billing.js';
import { logger } from '../utils/logger.js';

let stripe: Stripe | null = null;

function getStripe(): Stripe | null {
  if (stripe) return stripe;
  if (!config.stripe.secretKey) {
    logger.warn('Stripe secret key not configured; payouts disabled');
    return null;
  }
  stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2025-02-24.acacia' });
  return stripe;
}

export interface PayoutResult {
  paid: boolean;
  amount_cents?: number;
}

/**
 * Checks the owner fund balance and processes a payout if the
 * balance meets or exceeds the configured threshold.
 *
 * Runs inside a PG transaction to ensure the fund debit and
 * payout record are atomic.
 */
export async function checkAndProcessPayout(): Promise<PayoutResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the owner fund row and read balance
    const fundResult = await client.query<{ balance_cents: number }>(
      `SELECT balance_cents FROM funds WHERE fund_id = 'owner' FOR UPDATE`,
    );

    if (fundResult.rowCount === 0) {
      logger.warn('Owner fund row not found');
      await client.query('ROLLBACK');
      return { paid: false };
    }

    const balance = fundResult.rows[0].balance_cents;

    if (balance < config.billing.ownerPayoutThresholdCents) {
      logger.debug(
        { balance, threshold: config.billing.ownerPayoutThresholdCents },
        'Owner fund below payout threshold',
      );
      await client.query('ROLLBACK');
      return { paid: false };
    }

    const payoutAmount = balance;

    // Attempt Stripe transfer if configured
    const stripeClient = getStripe();
    let transferId = 'manual_payout_' + Date.now();

    if (stripeClient) {
      try {
        const transfer = await stripeClient.transfers.create({
          amount: payoutAmount,
          currency: 'usd',
          destination: process.env.STRIPE_CONNECTED_ACCOUNT_ID ?? '',
          description: 'Owner fund payout',
        });
        transferId = transfer.id;
        logger.info({ transferId, payoutAmount }, 'Stripe transfer created');
      } catch (err) {
        // If no connected account is set up, log and continue with manual record
        logger.warn(
          { err, payoutAmount },
          'Stripe transfer failed (no connected account?), recording manual payout',
        );
      }
    } else {
      logger.info({ payoutAmount }, 'Stripe not configured, recording manual payout');
    }

    // Debit the owner fund
    await debitFund('owner', payoutAmount, client);

    // Record the payout transaction
    await recordTransaction(
      {
        type: 'payout',
        amountCents: -payoutAmount,
        referenceId: transferId,
        description: `Owner payout: ${payoutAmount} cents`,
      },
      client,
    );

    await client.query('COMMIT');

    logger.info({ payoutAmount, transferId }, 'Owner payout processed');

    return { paid: true, amount_cents: payoutAmount };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Payout processing failed');
    throw err;
  } finally {
    client.release();
  }
}
