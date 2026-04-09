import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCallerByApiKeyHash } from '../../db/queries/callers.js';
import { createPaymentIntent } from '../../billing/stripe.js';
import { hashApiKey } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';

const inputSchema = {
  api_key: z.string().describe('Your API key'),
  amount_cents: z.number().int().min(100).describe('Amount to fund in cents (minimum 100 = $1.00)'),
};

export function registerFundAccount(server: McpServer): void {
  server.tool(
    'fund_account',
    'Create a Stripe payment intent to fund your account. Returns a payment URL and payment ID.',
    inputSchema,
    async ({ api_key, amount_cents }) => {
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

        const paymentResult = await createPaymentIntent(amount_cents, caller.id, {
          source: 'mcp_tool',
        });

        const result = {
          payment_id: paymentResult.paymentIntentId,
          payment_url: `https://checkout.stripe.com/pay/${paymentResult.paymentIntentId}`,
          client_secret: paymentResult.clientSecret,
          amount_cents,
          caller_id: caller.id,
        };

        logger.info(
          { callerId: caller.id, amountCents: amount_cents, paymentId: paymentResult.paymentIntentId },
          'Payment intent created via MCP',
        );

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logger.error({ err }, 'fund_account tool error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to create payment intent' }) }],
          isError: true,
        };
      }
    },
  );
}
