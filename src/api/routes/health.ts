import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../../config/database.js';
import { redis } from '../../config/redis.js';

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  services: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
}

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        description: 'Health check endpoint',
        tags: ['system'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              uptime: { type: 'number' },
              timestamp: { type: 'string', format: 'date-time' },
              services: {
                type: 'object',
                properties: {
                  database: { type: 'string', enum: ['ok', 'error'] },
                  redis: { type: 'string', enum: ['ok', 'error'] },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      let dbStatus: 'ok' | 'error' = 'error';
      let redisStatus: 'ok' | 'error' = 'error';

      // Check PostgreSQL connectivity
      try {
        await pool.query('SELECT 1');
        dbStatus = 'ok';
      } catch {
        dbStatus = 'error';
      }

      // Check Redis connectivity
      try {
        await redis.ping();
        redisStatus = 'ok';
      } catch {
        redisStatus = 'error';
      }

      const allHealthy = dbStatus === 'ok' && redisStatus === 'ok';

      const body: HealthResponse = {
        status: allHealthy ? 'ok' : 'degraded',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        services: {
          database: dbStatus,
          redis: redisStatus,
        },
      };

      return reply
        .status(allHealthy ? 200 : 503)
        .send(body);
    },
  );
};
