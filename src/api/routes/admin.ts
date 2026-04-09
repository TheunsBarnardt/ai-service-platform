import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { listServices, getServiceById, createService } from '../../db/queries/services.js';
import { getFundBalances, debitFund, recordTransaction } from '../../db/queries/billing.js';
import { getMetrics } from '../../monitoring/metrics.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';

function assertAdmin(request: FastifyRequest): void {
  // Option 1: trusted caller tier
  if (request.callerTier === 'trusted') return;

  // Option 2: ADMIN_API_KEY header match
  if (ADMIN_API_KEY) {
    const authHeader = request.headers.authorization;
    if (authHeader === `Bearer ${ADMIN_API_KEY}`) return;
  }

  throw new ForbiddenError('Admin access required');
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /v1/admin/stats
  fastify.get('/v1/admin/stats', {
    schema: {
      description: 'Platform statistics overview',
      tags: ['admin'],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    assertAdmin(request);

    const [callersResult, callsResult, revenueResult, fundBalances, services, metricsSnapshot] = await Promise.all([
      pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM callers'),
      pool.query<{ count: string }>('SELECT COUNT(*) AS count FROM call_logs'),
      pool.query<{ total: string }>('SELECT COALESCE(SUM(cost_cents), 0) AS total FROM call_logs WHERE status = $1', ['success']),
      getFundBalances(),
      listServices({ isActive: true }),
      Promise.resolve(getMetrics()),
    ]);

    return reply.send({
      total_callers: parseInt(callersResult.rows[0].count, 10),
      total_calls: parseInt(callsResult.rows[0].count, 10),
      total_revenue_cents: parseInt(revenueResult.rows[0].total, 10),
      fund_balances: fundBalances,
      active_services: services.length,
      metrics: metricsSnapshot,
    });
  });

  // GET /v1/admin/funds
  fastify.get('/v1/admin/funds', {
    schema: {
      description: 'Detailed fund balances with totals',
      tags: ['admin'],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    assertAdmin(request);

    const balances = await getFundBalances();
    const total =
      balances.owner.balance_cents +
      balances.improvement.balance_cents +
      balances.compute.balance_cents +
      balances.reserve.balance_cents;

    return reply.send({
      funds: balances,
      total_cents: total,
    });
  });

  // GET /v1/admin/services/:id/evals
  fastify.get<{ Params: { id: string } }>('/v1/admin/services/:id/evals', {
    schema: {
      description: 'Eval history for a service',
      tags: ['admin'],
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    assertAdmin(request);

    const { id } = request.params;

    const service = await getServiceById(id);
    if (!service) {
      throw new NotFoundError(`Service ${id} not found`);
    }

    // Query eval history from eval_results table
    const result = await pool.query<{
      id: string;
      service_id: string;
      eval_type: string;
      score: number;
      details: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, service_id, eval_type, score, details, created_at
       FROM eval_results
       WHERE service_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id],
    );

    return reply.send({
      service_id: id,
      service_name: service.name,
      evals: result.rows,
      count: result.rows.length,
    });
  });

  // POST /v1/admin/services
  fastify.post<{
    Body: {
      name: string;
      service_type: string;
      description?: string;
      input_schema?: Record<string, unknown>;
      output_schema?: Record<string, unknown>;
      system_prompt?: string;
      config?: Record<string, unknown>;
      price_cents?: number;
      cost_cents?: number;
      quality_score?: number;
      latency_sla_ms?: number;
    };
  }>('/v1/admin/services', {
    schema: {
      description: 'Create or update a service definition',
      tags: ['admin'],
    },
  }, async (request, reply) => {
    assertAdmin(request);

    const body = request.body;

    if (!body.name || !body.service_type) {
      return reply.status(400).send({
        error: { code: 'INVALID_INPUT', message: 'name and service_type are required', status: 400 },
      });
    }

    // Check for existing service with same name (update case)
    const existing = await pool.query<{ id: string }>(
      'SELECT id FROM services WHERE name = $1',
      [body.name],
    );

    if (existing.rows.length > 0) {
      // Update existing service
      const serviceId = existing.rows[0].id;
      await pool.query(
        `UPDATE services SET
           service_type = COALESCE($2, service_type),
           description = COALESCE($3, description),
           input_schema = COALESCE($4, input_schema),
           output_schema = COALESCE($5, output_schema),
           system_prompt = COALESCE($6, system_prompt),
           config = COALESCE($7, config),
           price_cents = COALESCE($8, price_cents),
           cost_cents = COALESCE($9, cost_cents),
           quality_score = COALESCE($10, quality_score),
           latency_sla_ms = COALESCE($11, latency_sla_ms),
           updated_at = NOW()
         WHERE id = $1`,
        [
          serviceId,
          body.service_type,
          body.description ?? null,
          body.input_schema ? JSON.stringify(body.input_schema) : null,
          body.output_schema ? JSON.stringify(body.output_schema) : null,
          body.system_prompt ?? null,
          body.config ? JSON.stringify(body.config) : null,
          body.price_cents ?? null,
          body.cost_cents ?? null,
          body.quality_score ?? null,
          body.latency_sla_ms ?? null,
        ],
      );

      const updated = await getServiceById(serviceId);
      logger.info({ serviceId, serviceName: body.name }, 'Service updated via admin API');
      return reply.status(200).send({ service: updated });
    }

    // Create new service
    const service = await createService({
      name: body.name,
      serviceType: body.service_type,
      description: body.description,
      inputSchema: body.input_schema,
      outputSchema: body.output_schema,
      systemPrompt: body.system_prompt,
      config: body.config,
      priceCents: body.price_cents,
      costCents: body.cost_cents,
      qualityScore: body.quality_score,
      latencySlsMs: body.latency_sla_ms,
    });

    logger.info({ serviceId: service.id, serviceName: service.name }, 'Service created via admin API');
    return reply.status(201).send({ service });
  });

  // POST /v1/admin/payout
  fastify.post('/v1/admin/payout', {
    schema: {
      description: 'Manual owner payout trigger',
      tags: ['admin'],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    assertAdmin(request);

    const balances = await getFundBalances();
    const ownerBalance = balances.owner.balance_cents;

    if (ownerBalance <= 0) {
      return reply.status(400).send({
        error: { code: 'NO_FUNDS', message: 'Owner fund balance is zero', status: 400 },
      });
    }

    // In production: trigger Stripe payout here
    // For now: debit the owner fund and record a payout transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await debitFund('owner', ownerBalance, client);

      await recordTransaction(
        {
          type: 'owner_payout',
          amountCents: -ownerBalance,
          description: `Manual owner payout of ${ownerBalance} cents`,
        },
        client,
      );

      await client.query('COMMIT');

      logger.info({ amountCents: ownerBalance }, 'Owner payout processed');

      return reply.send({
        payout_cents: ownerBalance,
        status: 'completed',
        note: 'In production, this would trigger a Stripe transfer',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
};
