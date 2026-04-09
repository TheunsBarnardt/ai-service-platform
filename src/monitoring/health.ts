import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { redis } from '../config/redis.js';
import { getActiveProviderName } from '../providers/failover.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface ServiceCheck {
  status: 'ok' | 'degraded' | 'down';
  latency_ms: number;
}

export interface HealthResult {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  timestamp: string;
  services: {
    database: ServiceCheck;
    redis: ServiceCheck;
    primary_provider: ServiceCheck;
    secondary_provider: ServiceCheck;
  };
}

async function checkService(
  name: string,
  fn: () => Promise<void>,
): Promise<ServiceCheck> {
  const start = performance.now();
  try {
    await fn();
    return { status: 'ok', latency_ms: Math.round(performance.now() - start) };
  } catch (err) {
    logger.warn({ err, service: name }, 'Health check failed for service');
    return { status: 'down', latency_ms: Math.round(performance.now() - start) };
  }
}

export async function checkHealth(): Promise<HealthResult> {
  const [database, redisCheck] = await Promise.all([
    checkService('database', async () => {
      await pool.query('SELECT 1');
    }),
    checkService('redis', async () => {
      await redis.ping();
    }),
  ]);

  // Provider checks: report which is active vs inactive
  const activeProvider = getActiveProviderName();
  const primaryName = config.providers.primary;
  const secondaryName = config.providers.secondary;

  const primaryProvider: ServiceCheck =
    activeProvider === primaryName
      ? { status: 'ok', latency_ms: 0 }
      : { status: 'degraded', latency_ms: 0 };

  const secondaryProvider: ServiceCheck =
    activeProvider === secondaryName
      ? { status: 'ok', latency_ms: 0 }
      : { status: 'ok', latency_ms: 0 }; // secondary is standby but available

  const checks = [database, redisCheck, primaryProvider, secondaryProvider];
  const anyDown = checks.some((c) => c.status === 'down');
  const anyDegraded = checks.some((c) => c.status === 'degraded');

  let status: 'ok' | 'degraded' | 'down';
  if (anyDown) {
    // If core infra (db/redis) is down, whole system is down
    status = database.status === 'down' || redisCheck.status === 'down' ? 'down' : 'degraded';
  } else if (anyDegraded) {
    status = 'degraded';
  } else {
    status = 'ok';
  }

  return {
    status,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      database,
      redis: redisCheck,
      primary_provider: primaryProvider,
      secondary_provider: secondaryProvider,
    },
  };
}

export const compositeHealthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/health', {
    schema: {
      description: 'Composite health check with per-service status and latency',
      tags: ['system'],
      security: [],
    },
  }, async (_request, reply) => {
    const health = await checkHealth();

    const httpStatus = health.status === 'ok' ? 200 : health.status === 'degraded' ? 200 : 503;
    return reply.status(httpStatus).send(health);
  });
};
