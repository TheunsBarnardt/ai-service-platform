import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getServiceById } from '../../db/queries/services.js';
import { getCallerByApiKeyHash } from '../../db/queries/callers.js';
import { chargeForCall, InsufficientBalanceError } from '../../billing/engine.js';
import { calculateDiscount } from '../../billing/discounts.js';
import { routeServiceCall } from '../../services/router.js';
import { hashApiKey, generateId } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';

const inputSchema = {
  service_id: z.string().describe('The ID of the service to invoke'),
  api_key: z.string().describe('Your API key for authentication'),
  input: z.record(z.unknown()).describe('Input payload matching the service input schema'),
  idempotency_key: z.string().optional().describe('Optional idempotency key to prevent duplicate charges'),
};

export function registerInvokeService(server: McpServer): void {
  server.tool(
    'invoke_service',
    'Invoke an AI service. Authenticates via API key, checks balance, executes the service, charges the caller, and returns the result.',
    inputSchema,
    async ({ service_id, api_key, input, idempotency_key }) => {
      try {
        // 1. Authenticate caller via API key hash
        const keyHash = hashApiKey(api_key);
        const callerData = await getCallerByApiKeyHash(keyHash);

        if (!callerData) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Invalid API key' }) }],
            isError: true,
          };
        }

        const { caller } = callerData;

        // 2. Look up the service
        const service = await getServiceById(service_id);

        if (!service || !service.is_active) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Service not found or inactive' }) }],
            isError: true,
          };
        }

        const priceCents = service.price_cents ?? 0;

        // 3. Check balance before routing (fail fast)
        const balance = Number(caller.balance_cents);
        const discountPct = calculateDiscount(Number(caller.total_calls));
        const effectivePrice = Math.floor(priceCents * (1 - discountPct / 100));

        if (balance < effectivePrice) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'Insufficient balance',
              balance_cents: balance,
              required_cents: effectivePrice,
            }) }],
            isError: true,
          };
        }

        // 4. Route and execute the service call
        const callLogId = idempotency_key ?? generateId();
        const callResult = await routeServiceCall(service, input, caller.id);

        // 5. Charge the caller
        const chargeResult = await chargeForCall(
          caller.id,
          priceCents,
          discountPct,
          callLogId,
        );

        const result = {
          call_id: callLogId,
          service_id: service.id,
          service_name: service.name,
          result: callResult.result,
          tokens_input: callResult.tokensInput,
          tokens_output: callResult.tokensOutput,
          model: callResult.model,
          latency_ms: callResult.latencyMs,
          charged_cents: chargeResult.charged_cents,
          discount_applied: chargeResult.discount_applied,
          new_balance: chargeResult.new_balance,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              error: 'Insufficient balance',
              balance_cents: err.balanceCents,
              required_cents: err.requiredCents,
            }) }],
            isError: true,
          };
        }

        logger.error({ err }, 'invoke_service tool error');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Service invocation failed' }) }],
          isError: true,
        };
      }
    },
  );
}
