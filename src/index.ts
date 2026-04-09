import dotenv from 'dotenv';
dotenv.config();

import { config } from './config/index.js';
import { buildServer } from './api/server.js';
import { pool } from './config/database.js';
import { redis } from './config/redis.js';
import { logger } from './utils/logger.js';

async function main() {
  const server = await buildServer();

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

    try {
      await server.close();
      logger.info('Fastify server closed');
    } catch (err) {
      logger.error({ err }, 'Error closing Fastify server');
    }

    try {
      await pool.end();
      logger.info('Database pool closed');
    } catch (err) {
      logger.error({ err }, 'Error closing database pool');
    }

    try {
      redis.disconnect();
      logger.info('Redis connection closed');
    } catch (err) {
      logger.error({ err }, 'Error closing Redis connection');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await server.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(
      {
        port: config.server.port,
        host: config.server.host,
        env: config.server.nodeEnv,
      },
      `AI Service Platform API listening on ${config.server.host}:${config.server.port}`,
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
