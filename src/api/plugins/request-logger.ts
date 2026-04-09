import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const requestLoggerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        requestId: request.id,
      },
      'incoming request',
    );
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const latencyMs = reply.elapsedTime;
    const callerId = (request as { callerId?: string }).callerId ?? 'anonymous';

    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        latencyMs: Math.round(latencyMs * 100) / 100,
        callerId,
        requestId: request.id,
      },
      'request completed',
    );
  });
};

export const requestLogger = fp(requestLoggerPlugin, {
  name: 'request-logger',
  fastify: '5.x',
});
