import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import {
  NotFoundError,
  InsufficientBalanceError,
  ServiceUnavailableError,
} from '../../utils/errors.js';
import { checkIdempotency, setIdempotency } from '../../utils/idempotency.js';
import { routeServiceCall } from '../../services/router.js';
import {
  chargeForCall,
  InsufficientBalanceError as BillingInsufficientBalance,
} from '../../billing/engine.js';
import { getCallerBalance } from '../../db/queries/billing.js';
import { getServiceById, type ServiceRow } from '../../db/queries/services.js';
import { reportError as reportCircuitError } from '../../providers/failover.js';
import { InvokeRequestBody, type InvokeResponseType } from '../schemas/invoke.schema.js';
import { pool } from '../../db/pool.js';

// Simple circuit breaker per service
const circuitBreakers = new Map<string, { failures: number; openUntil: number }>();
const CB_THRESHOLD = 10;
const CB_OPEN_DURATION_MS = 60_000;

function isCircuitOpen(serviceId: string): boolean {
  const cb = circuitBreakers.get(serviceId);
  if (!cb) return false;
  if (cb.failures < CB_THRESHOLD) return false;
  if (Date.now() > cb.openUntil) {
    // Half-open: allow one attempt
    cb.failures = CB_THRESHOLD - 1;
    return false;
  }
  return true;
}

function recordCircuitFailure(serviceId: string): void {
  const cb = circuitBreakers.get(serviceId) ?? { failures: 0, openUntil: 0 };
  cb.failures++;
  if (cb.failures >= CB_THRESHOLD) {
    cb.openUntil = Date.now() + CB_OPEN_DURATION_MS;
  }
  circuitBreakers.set(serviceId, cb);
}

function recordCircuitSuccess(serviceId: string): void {
  circuitBreakers.delete(serviceId);
}

export const invokeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Params: { id: string };
    Body: { input: Record<string, unknown>; idempotency_key?: string };
  }>('/v1/services/:id/invoke', async (request, reply) => {
    const { id: serviceId } = request.params;
    const callerId = request.callerId;

    if (!callerId) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 },
      });
    }

    // Validate request body
    const parsed = InvokeRequestBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_INPUT',
          message: parsed.error.issues.map((i) => i.message).join('; '),
          status: 400,
        },
      });
    }

    const { input, idempotency_key } = parsed.data;

    // (a) Look up service
    const service = await getServiceById(serviceId);
    if (!service) {
      throw new NotFoundError(`Service ${serviceId} not found`);
    }

    // (b) Check circuit breaker
    if (isCircuitOpen(serviceId)) {
      throw new ServiceUnavailableError('Service circuit breaker is open');
    }

    // (c) Check idempotency
    if (idempotency_key) {
      const cached = await checkIdempotency<InvokeResponseType>(
        `${callerId}:${serviceId}:${idempotency_key}`,
      );
      if (cached) {
        return reply.status(200).send(cached);
      }
    }

    // (d) Check caller balance
    const priceCents = service.price_cents ?? 0;
    const balance = await getCallerBalance(callerId);
    if (balance < priceCents) {
      throw new InsufficientBalanceError(
        `Insufficient balance for service (price: ${priceCents} cents)`,
      );
    }

    const callId = randomUUID();

    // (e) Route to service engine
    try {
      const callResult = await routeServiceCall(service, input, callerId);

      // (f) On success: charge, log, cache, return
      const totalCharge = Math.max(priceCents, callResult.costCents);

      // Log the call
      await pool.query(
        `INSERT INTO call_logs (id, service_id, caller_id, status, tokens_input, tokens_output, model, latency_ms, cost_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [callId, serviceId, callerId, 'success', callResult.tokensInput, callResult.tokensOutput, callResult.model, callResult.latencyMs, totalCharge],
      );

      // Charge the caller and allocate revenue
      await chargeForCall(callerId, totalCharge, 0, callId);

      recordCircuitSuccess(serviceId);

      const response: InvokeResponseType = {
        result: callResult.result,
        confidence: (callResult.result.confidence as number) ?? undefined,
        cost_cents: totalCharge,
        latency_ms: callResult.latencyMs,
        tokens_used: callResult.tokensInput + callResult.tokensOutput,
        model: callResult.model,
        call_id: callId,
      };

      if (idempotency_key) {
        await setIdempotency(
          `${callerId}:${serviceId}:${idempotency_key}`,
          response,
        );
      }

      return reply.status(200).send(response);
    } catch (err) {
      // (g) On error: log failed call, report to circuit breaker, return error
      recordCircuitFailure(serviceId);

      if (err instanceof Error) {
        reportCircuitError('provider');
      }

      await pool.query(
        `INSERT INTO call_logs (id, service_id, caller_id, status, tokens_input, tokens_output, model, latency_ms, cost_cents, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [callId, serviceId, callerId, 'error', 0, 0, 'unknown', 0, 0, err instanceof Error ? err.message : 'Unknown error'],
      ).catch((logErr) => {
        logger.error({ err: logErr }, 'Failed to log service call error');
      });

      throw err;
    }
  });
};
