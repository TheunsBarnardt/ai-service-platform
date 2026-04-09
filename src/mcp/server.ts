import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListServices } from './tools/list-services.js';
import { registerGetServiceSchema } from './tools/get-service-schema.js';
import { registerInvokeService } from './tools/invoke-service.js';
import { registerRegisterCaller } from './tools/register-caller.js';
import { registerCheckBalance } from './tools/check-balance.js';
import { registerGetPricing } from './tools/get-pricing.js';
import { registerFundAccount } from './tools/fund-account.js';
import { logger } from '../utils/logger.js';

const VERSION = '0.1.0';

/**
 * Creates and configures an MCP server instance with all platform tools registered.
 *
 * Tools:
 *   - list_services    : Browse available AI services
 *   - get_service_schema: Get input/output schemas for a service
 *   - invoke_service   : Execute a service (the revenue tool)
 *   - register         : Create a caller account and API key
 *   - check_balance    : View account balance and tier info
 *   - get_pricing      : View pricing and discount tiers
 *   - fund_account     : Create a Stripe payment to add funds
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'ai-service-platform',
    version: VERSION,
  });

  // Register all tools
  registerListServices(server);
  registerGetServiceSchema(server);
  registerInvokeService(server);
  registerRegisterCaller(server);
  registerCheckBalance(server);
  registerGetPricing(server);
  registerFundAccount(server);

  logger.info({ version: VERSION }, 'MCP server created with 7 tools registered');

  return server;
}
