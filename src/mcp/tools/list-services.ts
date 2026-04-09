import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listServices } from '../../db/queries/services.js';
import { logger } from '../../utils/logger.js';

const inputSchema = {
  category: z.string().optional().describe('Filter by service type (e.g. inference, rag, tools, orchestration, eval)'),
  min_quality: z.number().min(0).max(100).optional().describe('Minimum quality score (0-100)'),
};

export function registerListServices(server: McpServer): void {
  server.tool(
    'list_services',
    'List all available AI services with pricing, quality scores, and latency SLAs',
    inputSchema,
    async ({ category, min_quality }) => {
      try {
        const services = await listServices({
          type: category,
          minQuality: min_quality,
          isActive: true,
        });

        const result = services.map((s) => ({
          id: s.id,
          name: s.name,
          service_type: s.service_type,
          description: s.description,
          price_cents: s.price_cents,
          quality_score: s.quality_score,
          latency_sla_ms: s.latency_sla_ms,
          registry_status: s.registry_status,
        }));

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'list_services tool error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to list services' }) }],
          isError: true,
        };
      }
    },
  );
}
