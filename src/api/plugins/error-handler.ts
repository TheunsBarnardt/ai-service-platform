import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../../utils/errors.js';

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler(
    (error: Error, request: FastifyRequest, reply: FastifyReply) => {
      // Handle known application errors
      if (error instanceof AppError) {
        request.log.warn(
          { err: error, statusCode: error.statusCode, code: error.code },
          `App error: ${error.message}`,
        );

        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
            status: error.statusCode,
          },
        });
      }

      // Handle Fastify validation errors
      if ('validation' in error && 'statusCode' in error) {
        const statusCode = (error as { statusCode: number }).statusCode || 400;
        request.log.warn(
          { err: error },
          `Validation error: ${error.message}`,
        );

        return reply.status(statusCode).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message,
            status: statusCode,
          },
        });
      }

      // Handle rate-limit errors (from @fastify/rate-limit)
      if ('statusCode' in error && (error as { statusCode: number }).statusCode === 429) {
        return reply.status(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please try again later.',
            status: 429,
          },
        });
      }

      // Unknown / unexpected errors
      request.log.error(
        { err: error },
        'Unhandled error',
      );

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          status: 500,
        },
      });
    },
  );
};

export const errorHandler = fp(errorHandlerPlugin, {
  name: 'error-handler',
  fastify: '5.x',
});
