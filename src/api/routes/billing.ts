import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../../db/pool.js';
import {
  getCallerBalance,
  getTransactions,
  getFundBalances,
} from '../../db/queries/billing.js';
import { createPaymentIntent } from '../../billing/stripe.js';
import { calculateDiscount } from '../../billing/discounts.js';
import { FundRequestBody } from '../schemas/billing.schema.js';
import { logger } from '../../utils/logger.js';

/** Discount tier label by percentage. */
function tierLabel(discountPct: number): string {
  if (discountPct >= 50) return 'enterprise';
  if (discountPct >= 30) return 'growth';
  if (discountPct >= 15) return 'starter';
  return 'free';
}

export const billingRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/billing/balance
   * Returns the caller's balance and discount tier.
   * If the caller has role 'admin', also returns fund balances.
   */
  fastify.get(
    '/v1/billing/balance',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const caller = (request as any).caller;
      if (!caller?.id) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 } });
      }

      try {
        const balanceCents = await getCallerBalance(caller.id);

        // Get total calls for discount calculation
        const callsResult = await pool.query<{ total_calls: number }>(
          `SELECT total_calls FROM callers WHERE id = $1`,
          [caller.id],
        );
        const totalCalls = callsResult.rows[0]?.total_calls ?? 0;
        const discountPct = calculateDiscount(totalCalls);

        const response: Record<string, unknown> = {
          balance_cents: balanceCents,
          total_calls: totalCalls,
          tier: tierLabel(discountPct),
          discount_pct: discountPct,
        };

        // Include fund summary for admin callers
        if (caller.role === 'admin') {
          response.funds = await getFundBalances();
        }

        return reply.status(200).send(response);
      } catch (err) {
        logger.error({ err, callerId: caller.id }, 'Failed to fetch balance');
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch balance', status: 500 },
        });
      }
    },
  );

  /**
   * GET /v1/billing/transactions
   * Returns paginated transaction history for the authenticated caller.
   * Query params: limit (default 20, max 100), cursor (UUID).
   */
  fastify.get(
    '/v1/billing/transactions',
    async (
      request: FastifyRequest<{
        Querystring: { limit?: string; cursor?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const caller = (request as any).caller;
      if (!caller?.id) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 } });
      }

      try {
        const limit = Math.min(Math.max(parseInt(request.query.limit ?? '20', 10) || 20, 1), 100);
        const cursor = request.query.cursor || undefined;

        const result = await getTransactions(caller.id, { limit, cursor });

        return reply.status(200).send({
          transactions: result.transactions.map((t) => ({
            id: t.id,
            type: t.type,
            amount_cents: t.amount_cents,
            balance_after: t.balance_after,
            description: t.description,
            created_at: t.created_at,
          })),
          next_cursor: result.nextCursor,
          has_more: result.hasMore,
        });
      } catch (err) {
        logger.error({ err, callerId: caller.id }, 'Failed to fetch transactions');
        return reply.status(500).send({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transactions', status: 500 },
        });
      }
    },
  );

  /**
   * POST /v1/callers/fund
   * Creates a Stripe PaymentIntent for the caller to add funds.
   * Body: { amount_cents: number } (minimum 100 = $1.00)
   */
  fastify.post(
    '/v1/callers/fund',
    async (
      request: FastifyRequest<{ Body: { amount_cents: number } }>,
      reply: FastifyReply,
    ) => {
      const caller = (request as any).caller;
      if (!caller?.id) {
        return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 } });
      }

      const parsed = FundRequestBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? 'Invalid request body',
            status: 400,
          },
        });
      }

      try {
        const { clientSecret, paymentIntentId } = await createPaymentIntent(
          parsed.data.amount_cents,
          caller.id,
        );

        return reply.status(201).send({
          payment_url: clientSecret,
          payment_intent_id: paymentIntentId,
        });
      } catch (err) {
        logger.error({ err, callerId: caller.id }, 'Failed to create payment intent');
        return reply.status(500).send({
          error: { code: 'PAYMENT_ERROR', message: 'Failed to create payment intent', status: 500 },
        });
      }
    },
  );
};
