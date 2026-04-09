import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { redis } from '../../config/redis.js';

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    global: true,
    max: (request, _key) => {
      // Use per-caller rate limit if authenticated, otherwise default
      const callerRequest = request as { callerTier?: string };
      switch (callerRequest.callerTier) {
        case 'premium':
          return 600;
        case 'trusted':
          return 1200;
        case 'standard':
          return 100;
        case 'free':
          return 20;
        default:
          return 60; // unauthenticated / unknown
      }
    },
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const callerRequest = request as { callerId?: string };
      return callerRequest.callerId ?? request.ip;
    },
    redis,
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
        status: 429,
      },
    }),
  });
};

export const rateLimitPlugin_ = fp(rateLimitPlugin, {
  name: 'rate-limit',
  fastify: '5.x',
});
