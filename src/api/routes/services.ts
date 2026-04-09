import type { FastifyPluginAsync } from 'fastify';
import { listServices, getServiceById } from '../../db/queries/services.js';
import { ServiceListQuerySchema } from '../schemas/service.schema.js';
import { NotFoundError } from '../../utils/errors.js';
import type { ServiceRow } from '../../db/queries/services.js';

function formatServiceResponse(service: ServiceRow) {
  return {
    id: service.id,
    name: service.name,
    service_type: service.service_type,
    description: service.description,
    input_schema: service.input_schema,
    output_schema: service.output_schema,
    price_cents: service.price_cents,
    quality_score: service.quality_score,
    latency_sla_ms: service.latency_sla_ms,
    registry_status: service.registry_status,
    is_active: service.is_active,
  };
}

export const serviceRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /v1/services — public, list services with optional filters
  fastify.get(
    '/v1/services',
    {
      schema: {
        description: 'List available services with optional type and quality filters',
        tags: ['services'],
        security: [],
      },
    },
    async (request, reply) => {
      const query = ServiceListQuerySchema.parse(request.query);

      const services = await listServices({
        type: query.type,
        minQuality: query.min_quality,
        isActive: true,
      });

      return reply.send({
        data: services.map(formatServiceResponse),
        count: services.length,
      });
    },
  );

  // GET /v1/services/:id — public, get service detail
  fastify.get<{ Params: { id: string } }>(
    '/v1/services/:id',
    {
      schema: {
        description: 'Get service details by ID',
        tags: ['services'],
        security: [],
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const service = await getServiceById(id);
      if (!service) {
        throw new NotFoundError('Service not found');
      }

      return reply.send({ service: formatServiceResponse(service) });
    },
  );
};
