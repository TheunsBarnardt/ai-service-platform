import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCaller } from '../../db/queries/callers.js';
import { createApiKey } from '../../db/queries/api-keys.js';
import { logger } from '../../utils/logger.js';

const inputSchema = {
  name: z.string().optional().describe('Display name for the caller'),
  caller_type: z.string().describe('Type of caller (e.g. agent, human, service)'),
};

export function registerRegisterCaller(server: McpServer): void {
  server.tool(
    'register',
    'Register a new caller and receive an API key for accessing services',
    inputSchema,
    async ({ name, caller_type }) => {
      try {
        // 1. Create the caller record
        const caller = await createCaller({
          callerType: caller_type,
          name,
        });

        // 2. Generate an API key for the caller
        const apiKeyResult = await createApiKey(caller.id);

        const result = {
          caller_id: caller.id,
          api_key: apiKeyResult.key,
          key_prefix: apiKeyResult.keyPrefix,
          tier: caller.tier,
          balance_cents: Number(caller.balance_cents),
        };

        logger.info({ callerId: caller.id, callerType: caller_type }, 'New caller registered via MCP');

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'register tool error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to register caller' }) }],
          isError: true,
        };
      }
    },
  );
}
