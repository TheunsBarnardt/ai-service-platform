import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

// Custom plugins
import { auth } from './plugins/auth.js';
import { errorHandler } from './plugins/error-handler.js';
import { requestLogger } from './plugins/request-logger.js';
import { rateLimitPlugin_ } from './plugins/rate-limit.js';

// Routes
import { healthRoutes } from './routes/health.js';

export async function buildServer() {
  const fastify = Fastify({
    logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    ajv: {
      customOptions: {
        removeAdditional: 'all',
        coerceTypes: true,
        useDefaults: true,
      },
    },
  });

  // --- Third-party plugins ---

  await fastify.register(cors, {
    origin: config.server.nodeEnv === 'production'
      ? false
      : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: true,
  });

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'AI Service Platform API',
        description: 'Autonomous AI-to-AI service platform',
        version: '0.1.0',
      },
      servers: [
        {
          url: `http://localhost:${config.server.port}`,
          description: 'Local development',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API Key',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // --- Custom plugins ---

  await fastify.register(errorHandler);
  await fastify.register(requestLogger);
  await fastify.register(auth);
  await fastify.register(rateLimitPlugin_);

  // --- Routes ---

  await fastify.register(healthRoutes);

  return fastify;
}
