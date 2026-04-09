import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listServices, getServiceById } from '../../db/queries/services.js';
import { logger } from '../../utils/logger.js';

const DISCOUNT_TIERS = [
  { min_calls: 0, discount_pct: 0, label: 'Standard' },
  { min_calls: 100, discount_pct: 15, label: 'Bronze' },
  { min_calls: 1000, discount_pct: 30, label: 'Silver' },
  { min_calls: 10000, discount_pct: 50, label: 'Gold' },
];

const inputSchema = {
  service_id: z.string().optional().describe('Optional service ID to get pricing for a specific service. Omit for all services.'),
};

export function registerGetPricing(server: McpServer): void {
  server.tool(
    'get_pricing',
    'Get pricing information for all or a specific service, including volume discount tiers',
    inputSchema,
    async ({ service_id }) => {
      try {
        if (service_id) {
          const service = await getServiceById(service_id);

          if (!service) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Service not found' }) }],
              isError: true,
            };
          }

          const result = {
            service: {
              id: service.id,
              name: service.name,
              service_type: service.service_type,
              price_cents: service.price_cents,
              quality_score: service.quality_score,
            },
            discount_tiers: DISCOUNT_TIERS,
          };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // Return pricing for all active services
        const services = await listServices({ isActive: true });

        const result = {
          services: services.map((s) => ({
            id: s.id,
            name: s.name,
            service_type: s.service_type,
            price_cents: s.price_cents,
            quality_score: s.quality_score,
          })),
          discount_tiers: DISCOUNT_TIERS,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'get_pricing tool error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to get pricing' }) }],
          isError: true,
        };
      }
    },
  );
}
