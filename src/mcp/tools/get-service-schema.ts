import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getServiceById } from '../../db/queries/services.js';
import { logger } from '../../utils/logger.js';

const inputSchema = {
  service_id: z.string().describe('The unique ID of the service'),
};

export function registerGetServiceSchema(server: McpServer): void {
  server.tool(
    'get_service_schema',
    'Get full input/output JSON schemas, pricing, and examples for a specific service',
    inputSchema,
    async ({ service_id }) => {
      try {
        const service = await getServiceById(service_id);

        if (!service) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Service not found' }) }],
            isError: true,
          };
        }

        const result = {
          id: service.id,
          name: service.name,
          service_type: service.service_type,
          description: service.description,
          input_schema: service.input_schema,
          output_schema: service.output_schema,
          price_cents: service.price_cents,
          quality_score: service.quality_score,
          latency_sla_ms: service.latency_sla_ms,
          config: service.config,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'get_service_schema tool error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to get service schema' }) }],
          isError: true,
        };
      }
    },
  );
}
