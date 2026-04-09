import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCallerByApiKeyHash } from '../../db/queries/callers.js';
import { calculateDiscount } from '../../billing/discounts.js';
import { hashApiKey } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';

const inputSchema = {
  api_key: z.string().describe('Your API key'),
};

export function registerCheckBalance(server: McpServer): void {
  server.tool(
    'check_balance',
    'Check account balance, total calls, tier, and current discount percentage',
    inputSchema,
    async ({ api_key }) => {
      try {
        const keyHash = hashApiKey(api_key);
        const callerData = await getCallerByApiKeyHash(keyHash);

        if (!callerData) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid API key' }) }],
            isError: true,
          };
        }

        const { caller } = callerData;
        const totalCalls = Number(caller.total_calls);
        const discountPct = calculateDiscount(totalCalls);

        const result = {
          caller_id: caller.id,
          name: caller.name,
          balance_cents: Number(caller.balance_cents),
          total_calls: totalCalls,
          tier: caller.tier,
          discount_pct: discountPct,
          reputation: caller.reputation,
          rate_limit_rpm: caller.rate_limit_rpm,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'check_balance tool error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to check balance' }) }],
          isError: true,
        };
      }
    },
  );
}
