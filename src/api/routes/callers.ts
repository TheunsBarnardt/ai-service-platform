import type { FastifyPluginAsync } from 'fastify';
import { createCaller, getCallerById } from '../../db/queries/callers.js';
import { createApiKey, rotateApiKey } from '../../db/queries/api-keys.js';
import { RegisterCallerBodySchema } from '../schemas/caller.schema.js';
import { NotFoundError, UnauthorizedError } from '../../utils/errors.js';
import type { CallerRow } from '../../db/queries/callers.js';

function formatCallerResponse(caller: CallerRow) {
  return {
    id: caller.id,
    caller_type: caller.caller_type,
    name: caller.name,
    balance_cents: Number(caller.balance_cents),
    total_calls: Number(caller.total_calls),
    tier: caller.tier,
    reputation: caller.reputation,
    rate_limit_rpm: caller.rate_limit_rpm,
    created_at: caller.created_at.toISOString(),
  };
}

export const callerRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/callers/register — public, no auth required
  fastify.post(
    '/v1/callers/register',
    {
      schema: {
        description: 'Register a new caller and receive an API key',
        tags: ['callers'],
        security: [],
      },
    },
    async (request, reply) => {
      const body = RegisterCallerBodySchema.parse(request.body);

      const caller = await createCaller({
        callerType: body.caller_type,
        name: body.name,
        metadata: body.metadata,
      });

      const apiKeyResult = await createApiKey(caller.id);

      return reply.status(201).send({
        caller: formatCallerResponse(caller),
        api_key: apiKeyResult.key,
      });
    },
  );

  // GET /v1/callers/me — requires auth
  fastify.get(
    '/v1/callers/me',
    {
      schema: {
        description: 'Get the authenticated caller profile',
        tags: ['callers'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!request.callerId) {
        throw new UnauthorizedError();
      }

      const caller = await getCallerById(request.callerId);
      if (!caller) {
        throw new NotFoundError('Caller not found');
      }

      return reply.send({ caller: formatCallerResponse(caller) });
    },
  );

  // POST /v1/keys/rotate — requires auth
  fastify.post(
    '/v1/keys/rotate',
    {
      schema: {
        description: 'Rotate API key: deactivates all existing keys and returns a new one',
        tags: ['callers'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!request.callerId) {
        throw new UnauthorizedError();
      }

      const result = await rotateApiKey(request.callerId);

      return reply.send({
        api_key: result.key,
        key_prefix: result.keyPrefix,
        message: 'Previous keys have been deactivated. Store this key securely — it will not be shown again.',
      });
    },
  );
};
