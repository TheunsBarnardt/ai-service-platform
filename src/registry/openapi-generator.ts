import { listServices, type ServiceRow } from '../db/queries/services.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, unknown>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
  security: Array<Record<string, string[]>>;
}

function buildServiceInvokePath(service: ServiceRow): Record<string, unknown> {
  const inputSchema = service.input_schema ?? {
    type: 'object',
    additionalProperties: true,
  };

  const outputSchema = service.output_schema ?? {
    type: 'object',
    additionalProperties: true,
  };

  return {
    post: {
      operationId: `invoke_${service.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
      summary: `Invoke ${service.name}`,
      description: service.description ?? `Invoke the ${service.name} service`,
      tags: ['invoke'],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Service ID',
          example: service.id,
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['input'],
              properties: {
                input: inputSchema,
                idempotency_key: { type: 'string', description: 'Idempotency key for deduplication' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Successful invocation',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  result: outputSchema,
                  confidence: { type: 'number', nullable: true },
                  cost_cents: { type: 'integer' },
                  latency_ms: { type: 'integer' },
                  tokens_used: { type: 'integer' },
                  model: { type: 'string' },
                  call_id: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        '401': { description: 'Unauthorized' },
        '402': { description: 'Insufficient balance' },
        '404': { description: 'Service not found' },
        '503': { description: 'Service unavailable (circuit breaker open)' },
      },
    },
  };
}

export async function generateOpenApiSpec(): Promise<OpenApiSpec> {
  const services = await listServices({ isActive: true });

  logger.info({ serviceCount: services.length }, 'Generating OpenAPI spec from service catalog');

  const paths: Record<string, unknown> = {
    '/v1/services': {
      get: {
        operationId: 'list_services',
        summary: 'List available services',
        tags: ['services'],
        security: [],
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string' }, description: 'Filter by service type' },
          { name: 'min_quality', in: 'query', schema: { type: 'number' }, description: 'Minimum quality score' },
        ],
        responses: {
          '200': {
            description: 'List of services',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Service' } },
                    count: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/services/{id}': {
      get: {
        operationId: 'get_service',
        summary: 'Get service details',
        tags: ['services'],
        security: [],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Service details' },
          '404': { description: 'Service not found' },
        },
      },
    },
    '/v1/callers/register': {
      post: {
        operationId: 'register_caller',
        summary: 'Register a new API caller',
        tags: ['callers'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: 'Caller display name' },
                  email: { type: 'string', format: 'email', description: 'Contact email' },
                  webhook_url: { type: 'string', format: 'uri', description: 'Webhook URL for notifications' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Caller registered',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    caller_id: { type: 'string', format: 'uuid' },
                    api_key: { type: 'string', description: 'API key (shown only once)' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/health': {
      get: {
        operationId: 'health_check',
        summary: 'Composite health check',
        tags: ['system'],
        security: [],
        responses: {
          '200': { description: 'System healthy' },
          '503': { description: 'System degraded or down' },
        },
      },
    },
  };

  // Add per-service invoke paths
  for (const service of services) {
    const pathKey = `/v1/services/${service.id}/invoke`;
    paths[pathKey] = buildServiceInvokePath(service);
  }

  const spec: OpenApiSpec = {
    openapi: '3.1.0',
    info: {
      title: 'AI Service Platform API',
      version: '0.1.0',
      description: 'Autonomous AI-to-AI service platform. Discover, invoke, and pay for AI services via a unified API.',
    },
    servers: [
      {
        url: `http://localhost:${config.server.port}`,
        description: 'Local development',
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
        },
      },
      schemas: {
        Service: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            service_type: { type: 'string' },
            description: { type: 'string', nullable: true },
            input_schema: { type: 'object', nullable: true },
            output_schema: { type: 'object', nullable: true },
            price_cents: { type: 'integer', nullable: true },
            quality_score: { type: 'number' },
            latency_sla_ms: { type: 'integer' },
            registry_status: { type: 'string' },
            is_active: { type: 'boolean' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  };

  return spec;
}
